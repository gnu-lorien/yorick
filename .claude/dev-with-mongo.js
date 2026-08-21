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
 * Warn when the tailnet proxy points somewhere this process is not.
 *
 * A `tailscale serve --bg` mapping outlives the process it was pointed at, so
 * a stale one survives a port change and answers 502 forever after -- which
 * reads as the app being broken rather than the proxy being stale.
 *
 * Warn, do not "fix". Rewriting a serve config changes how this machine is
 * reachable from other people's devices, and that is the operator's call.
 */
function checkServeMapping() {
  try {
    var out = execFileSync('tailscale', ['serve', 'status'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (out.indexOf('proxy') === -1) return;
    if (out.indexOf(':' + APP_PORT) === -1) {
      console.warn('[dev-mongo] WARNING: `tailscale serve` does not point at ' + APP_PORT + ':');
      out.split(/\r?\n/).forEach(function (l) {
        if (l.trim()) console.warn('[dev-mongo]   ' + l);
      });
      console.warn('[dev-mongo] The tailnet URL will answer 502. Repoint it with:');
      console.warn('[dev-mongo]   tailscale serve --bg ' + APP_PORT);
    }
  } catch (e) { /* tailscale absent; nothing to check */ }
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
    var host = tailscaleHostname();
    if (host) {
      env.PUBLIC_SERVER_URL = 'https://' + host + MOUNT_PATH;
      console.log('[dev-mongo] Tailnet URL: https://' + host);
    }
  }
  checkServeMapping();

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
