/**
 * Dev launcher: a persistent MongoDB, then the app.
 *
 * `index.js` starts an in-memory MongoDB when nothing answers on 27017, which
 * is why a plain `npm start` loses its database at every restart -- portraits
 * included, since those live in GridFS inside it. This gives it a real one.
 *
 * It deliberately does NOT put that database on 27017. That port is not free
 * real estate: `index.js` probes it, and e2e/ports.js documents what happens
 * when the probe hits -- every Playwright worker abandons its private
 * in-memory instance and shares whatever is listening, isolated only by
 * database name. Nothing in the harness drops those databases between runs and
 * seed_db.js only loads bulk seed data into an EMPTY database, so a second run
 * would silently inherit the first one's mutations -- reintroducing exactly
 * the cross-suite contamination per-worker backends were built to remove.
 * Staying off 27017 keeps the suite behaving as it always has.
 *
 * The app port defaults to 41337 for the same reason: e2e/ports.js allocates
 * from BASE_PORT 1337 upward, one per worker.
 *
 * The database binds to loopback, so it is reachable only from this machine --
 * not over the tailnet, not from the LAN. `tailscale serve` forwards exactly
 * one port (the app's), so the proxy does not expose it either.
 *
 * See docs/runbooks/tailscale-dev-environment.md.
 */

var spawn = require('child_process').spawn;
var execFileSync = require('child_process').execFileSync;
var net = require('net');
var os = require('os');
var path = require('path');
var fs = require('fs');

var MONGO_HOST = '127.0.0.1';
var MONGO_PORT = Number(process.env.YORICK_DEV_MONGO_PORT || 27117);
var DB_NAME = process.env.YORICK_DEV_DB || 'yorick_dev';
var MONGODB_URI = 'mongodb://' + MONGO_HOST + ':' + MONGO_PORT + '/' + DB_NAME;
var APP_PORT = Number(process.env.PORT || 41337);
var MOUNT_PATH = process.env.MOUNT_PATH || '/parse/1';

// Under the home directory, not a hard-coded absolute path, so this file is
// not specific to one machine. Outside the repo either way: a dbpath inside a
// worktree is one `git clean -xdf` away from being deleted.
var DBPATH = process.env.YORICK_DEV_DBPATH ||
  path.join(os.homedir(), '.yorick-dev-mongo', 'data');

var appDir = path.resolve(__dirname, '..');
var mongod = null;
var shuttingDown = false;

/**
 * Find a mongod to run.
 *
 * `mongodb-memory-server` caches real mongod builds under the home directory
 * as a side effect of every E2E run, so a working binary is usually already
 * present and no MongoDB install is needed. The filename encodes platform and
 * version (e.g. mongod-x64-win32-8.2.6.exe), which is why this scans the cache
 * and takes the highest rather than naming one.
 */
function resolveMongod() {
  if (process.env.YORICK_DEV_MONGOD) return process.env.YORICK_DEV_MONGOD;

  var cacheDir = path.join(os.homedir(), '.cache', 'mongodb-binaries');
  if (fs.existsSync(cacheDir)) {
    var found = fs.readdirSync(cacheDir)
      .filter(function (f) { return f.indexOf('mongod') === 0; })
      .sort()
      .reverse();
    if (found.length) return path.join(cacheDir, found[0]);
  }
  return 'mongod';
}

/**
 * This machine's MagicDNS name, or null.
 *
 * Derived rather than written down, so no personal tailnet name is baked into
 * a file in a public repository, and so this works unchanged on anyone else's
 * machine. With Tailscale absent or stopped the app just falls back to the
 * localhost default in index.js.
 */
function tailscaleHostname() {
  var candidates = ['tailscale'];
  if (process.platform === 'win32') {
    candidates.push(path.join(process.env.ProgramFiles || 'C:/Program Files',
                              'Tailscale', 'tailscale.exe'));
  }
  for (var i = 0; i < candidates.length; i++) {
    try {
      var out = execFileSync(candidates[i], ['status', '--json'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      var self = JSON.parse(out).Self;
      var dns = (self && self.DNSName || '').replace(/\.$/, '');
      if (dns) return dns;
    } catch (e) { /* try the next candidate */ }
  }
  return null;
}

/**
 * The tailnet origin that reaches THIS app, read out of `tailscale serve`.
 *
 * Not assembled from the hostname alone. `serve` publishes on whatever https
 * port it was given, and on this machine port 443 is already spoken for -- `/`
 * there proxies to the editor. Guessing `https://<host>` therefore produced a
 * PUBLIC_SERVER_URL that resolved, answered 200, and returned the editor's
 * HTML; cloud/main.js fed that to Jimp and every portrait upload died with
 * "Could not find MIME for Buffer". A URL that answers is not a URL that is
 * right, so this reads the actual mapping instead of predicting it.
 *
 * Returns an origin like `https://host:8443` such that origin + MOUNT_PATH
 * reaches this process, or null when no mapping does.
 *
 * `serve status` looks like:
 *
 *   https://host.tailnet.ts.net (tailnet only)
 *   |-- / proxy http://127.0.0.1:3773
 *
 *   https://host.tailnet.ts.net:8443 (tailnet only)
 *   |-- /      proxy http://127.0.0.1:5273
 *   |-- /parse proxy http://127.0.0.1:41337/parse
 *
 * Still only ever reads. Rewriting a serve config changes how this machine is
 * reachable from other people's devices, and that is the operator's call.
 */
function tailnetOrigin() {
  var out;
  try {
    out = execFileSync('tailscale', ['serve', 'status'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch (e) {
    return null; // tailscale absent or stopped; nothing to read
  }

  var origin = null;
  var match = null;
  out.split(/\r?\n/).forEach(function (line) {
    var text = line.trim();
    var head = /^(https:\/\/\S+?)(?:\s|$)/.exec(text);
    if (head && text.indexOf('|--') !== 0) {
      origin = head[1].replace(/\/$/, '');
      return;
    }
    var mount = /^\|--\s+(\S+)\s+proxy\s+(\S+)/.exec(text);
    if (!mount || !origin || match) return;

    var mountPath = mount[1].replace(/\/$/, '');       // '/parse', or '' for '/'
    var target = mount[2];
    if (target.indexOf(':' + APP_PORT) === -1) return;

    // Tailscale strips the mount path and appends the rest to the target's
    // own path, so the two have to agree or the app is handed a truncated
    // URL. `/parse -> :41337/parse` is identity; `/parse -> :41337` turns
    // /parse/1/... into /1/... and 404s everything.
    var targetPath = (/^https?:\/\/[^/]+(\/.*)?$/.exec(target) || [])[1] || '';
    targetPath = targetPath.replace(/\/$/, '');
    if (targetPath !== mountPath) return;
    if (mountPath && MOUNT_PATH.indexOf(mountPath + '/') !== 0 && MOUNT_PATH !== mountPath) return;

    match = origin;
  });

  return match;
}

function canConnect(port) {
  return new Promise(function (resolve) {
    var sock = new net.Socket();
    sock.setTimeout(500);
    sock.on('connect', function () { sock.destroy(); resolve(true); });
    sock.on('error', function () { sock.destroy(); resolve(false); });
    sock.on('timeout', function () { sock.destroy(); resolve(false); });
    sock.connect(port, MONGO_HOST);
  });
}

async function waitForMongo(timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(MONGO_PORT)) return true;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  return false;
}

async function startMongo() {
  // Reuse an already-running instance rather than failing on a busy port --
  // the same courtesy index.js extends to a mongod it finds on 27017.
  if (await canConnect(MONGO_PORT)) {
    console.log('[dev-mongo] Reusing MongoDB already listening on ' + MONGO_PORT + '.');
    return;
  }

  var mongodPath = resolveMongod();

  // Refuse a relative dbpath rather than creating one.
  //
  // Not hypothetical: a mangled literal once made this "C:prj...", which
  // Windows reads as drive-relative, not absolute. mkdir made it under the
  // worktree, mongod opened it, and the app came up healthy on a brand new
  // EMPTY database while the real one sat untouched on disk. Nothing failed;
  // it just quietly served nothing. path.isAbsolute() is false for "C:foo" and
  // true for "C:/foo", which is exactly the distinction that went wrong.
  if (!path.isAbsolute(DBPATH)) {
    console.error('[dev-mongo] dbpath is not absolute: ' + DBPATH);
    console.error('[dev-mongo] Refusing to create it -- a relative dbpath ' +
                  'silently yields a new empty database.');
    process.exit(1);
  }

  var cold = !fs.existsSync(DBPATH) || fs.readdirSync(DBPATH).length === 0;
  fs.mkdirSync(DBPATH, { recursive: true });

  console.log('[dev-mongo] Starting ' + path.basename(mongodPath));
  console.log('[dev-mongo]   dbpath  ' + DBPATH);
  console.log('[dev-mongo]   bind    ' + MONGO_HOST + ':' + MONGO_PORT + ' (loopback only)');

  mongod = spawn(mongodPath, [
    '--dbpath', DBPATH,
    '--port', String(MONGO_PORT),
    '--bind_ip', MONGO_HOST
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  mongod.on('error', function (err) {
    console.error('[dev-mongo] Could not start mongod (' + mongodPath + '): ' + err.message);
    console.error('[dev-mongo] Set YORICK_DEV_MONGOD to a mongod executable.');
    process.exit(1);
  });
  mongod.stdout.on('data', function (d) {
    var s = d.toString();
    if (/exception|ERROR/i.test(s)) process.stdout.write('[mongod] ' + s);
  });
  mongod.stderr.on('data', function (d) {
    process.stderr.write('[mongod] ' + d.toString());
  });
  mongod.on('exit', function (code) {
    if (code !== 0 && code !== null && !shuttingDown) {
      console.error('[dev-mongo] mongod exited with code ' + code);
      process.exit(1);
    }
  });

  if (!(await waitForMongo(30000))) {
    console.error('[dev-mongo] MongoDB did not accept connections within 30s.');
    shutdown(1);
    return;
  }
  console.log('[dev-mongo] MongoDB ready.');

  // Seeding is opt-in and a real database does not qualify (see
  // `seedingAllowed` in seed_db.js), so a cold one produces a server that
  // boots healthy and serves an app with no clans, disciplines, descriptions
  // or accounts -- announced by one easily-missed line. Say so here instead.
  //
  // Deliberately not seeding on its behalf: that gate exists because seeding
  // writes an admin account whose password is public in this repository.
  if (cold) {
    console.log('[dev-mongo] This database is empty. Seed it once with:');
    console.log('[dev-mongo]   MONGODB_URI=' + MONGODB_URI + ' npm run seed');
  }
}

async function main() {
  await startMongo();

  console.log('[dev-mongo] App database: ' + MONGODB_URI);

  var env = Object.assign({}, process.env, {
    MONGODB_URI: MONGODB_URI,
    PORT: String(APP_PORT)
  });

  // parse-server bakes this origin into password-reset links and every
  // Parse.File URL, and cloud/main.js reads each uploaded portrait back over
  // HTTP from it. Left at the localhost default, a portrait uploaded from a
  // phone resolves to the phone and the save is refused. See
  // resolvePublicServerURL in index.js.
  if (!env.PUBLIC_SERVER_URL) {
    var origin = tailnetOrigin();
    if (origin) {
      env.PUBLIC_SERVER_URL = origin + MOUNT_PATH;
      console.log('[dev-mongo] Tailnet URL: ' + origin);
    } else if (tailscaleHostname()) {
      console.warn('[dev-mongo] WARNING: no `tailscale serve` mapping reaches port ' + APP_PORT + '.');
      console.warn('[dev-mongo] Portrait uploads will fail from anywhere but this machine.');
      console.warn('[dev-mongo] Add one (443 is taken by the editor -- use another port):');
      console.warn('[dev-mongo]   tailscale serve --bg --https=8443 --set-path=' + MOUNT_PATH.replace(/\/1$/, '') +
                   ' http://127.0.0.1:' + APP_PORT + MOUNT_PATH.replace(/\/1$/, ''));
      console.warn('[dev-mongo] See docs/runbooks/tailscale-dev-environment.md.');
    }
  }

  var app = spawn(process.execPath, ['index.js'], {
    cwd: appDir,
    env: env,
    stdio: 'inherit'
  });
  app.on('exit', function (code) { shutdown(code === null ? 0 : code); });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  // Only stop what this process started. A mongod that was already running is
  // somebody else's, and killing it would take their data down mid-write.
  if (mongod && !mongod.killed) {
    console.log('[dev-mongo] Stopping mongod.');
    try { mongod.kill(); } catch (e) { /* already gone */ }
  }
  process.exit(code);
}

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(function (sig) {
  process.on(sig, function () { shutdown(0); });
});

main().catch(function (err) {
  console.error('[dev-mongo] ' + (err && err.stack || err));
  shutdown(1);
});
