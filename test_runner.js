var spawn = require('child_process').spawn;
var http = require('http');
var path = require('path');

var target = process.argv[2] || 'localhost';
var port = process.env.PORT || 1337;

function isServerListening(port) {
  return new Promise(function (resolve) {
    var req = http.get('http://localhost:' + port + '/parse/1', function (res) {
      resolve(true);
    });
    req.on('error', function () {
      resolve(false);
    });
    req.setTimeout(1000, function () {
      req.abort();
      resolve(false);
    });
  });
}

function waitForServer(port, maxAttempts) {
  return new Promise(function (resolve, reject) {
    var attempts = 0;
    function poll() {
      attempts++;
      isServerListening(port).then(function (alive) {
        if (alive) {
          return resolve();
        }
        if (attempts >= maxAttempts) {
          return reject(new Error('Timed out waiting for server on port ' + port));
        }
        setTimeout(poll, 500);
      });
    }
    poll();
  });
}

async function run() {
  var serverProcess = null;

  if (target === 'localhost') {
    var alreadyRunning = await isServerListening(port);
    if (!alreadyRunning) {
      console.log('Starting server and seeding database...');
      serverProcess = spawn(process.execPath, ['index.js'], {
        cwd: __dirname,
        stdio: 'inherit',
        // Seeding is opt-in (see `seedingAllowed` in seed_db.js). This runner
        // exists to stand up a throwaway local backend for the Jasmine suite,
        // which cannot run without the test accounts, so it opts in explicitly.
        // Without this the server would come up unseeded on any machine with a
        // mongod already listening on 27017, and every spec would fail on auth.
        env: Object.assign({}, process.env, { YORICK_ALLOW_SEED: '1' })
      });

      try {
        await waitForServer(port, 40);
        console.log('Server is ready on port ' + port);
      } catch (err) {
        console.error(err.message);
        if (serverProcess) serverProcess.kill();
        process.exit(1);
      }
    } else {
      console.log('Server already running on port ' + port);
    }
  } else {
    console.log('Running tests against target: ' + target);
  }

  // Resolve karma through Node rather than assuming ./node_modules/.bin.
  //
  // In a git worktree there is no local node_modules — resolution walks up to
  // the main checkout's — so the hardcoded path missed and the run died with a
  // bare "The system cannot find the path specified." Asking Node where karma
  // actually is works from a worktree, a normal checkout, or a hoisted install.
  //
  // It has to be the package's `bin` entry. `lib/cli.js` resolves fine but only
  // exports functions, so running it as a main script does nothing and exits 0 —
  // which looks exactly like a suite that passed without running anything.
  var karmaPkgDir = path.dirname(require.resolve('karma/package.json'));
  var karmaCli = path.join(karmaPkgDir, require('karma/package.json').bin.karma);
  var karmaArgs = [
    karmaCli,
    'start',
    path.join(__dirname, 'public', 'karma.conf.js'),
    '--single-run',
    '--target=' + target
  ];

  // karma-chrome-launcher checks CHROME_BIN before the standard install paths,
  // so only set it when there is nothing for it to find. Playwright's bundled
  // Chromium is the fallback for a machine set up only for the E2E suite, but
  // it is genuinely a fallback: pointing CHROME_BIN at it when a system Chrome
  // exists makes the launcher time out waiting for a browser that never
  // captures ("ChromeHeadless has not captured in 60000 ms").
  var karmaEnv = Object.assign({}, process.env);
  if (!karmaEnv.CHROME_BIN) {
    var fs = require('fs');
    var systemChrome = [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser'
    ].filter(Boolean).some(function (p) { return fs.existsSync(p); });

    if (!systemChrome) {
      try {
        karmaEnv.CHROME_BIN = require('playwright-core').chromium.executablePath();
        console.log('No system Chrome found; using Playwright Chromium at ' + karmaEnv.CHROME_BIN);
      } catch (err) {
        // Nothing available. Let karma-chrome-launcher report its own error.
      }
    }
  }

  // No `shell: true`: the args are passed as an array to the Node executable
  // directly, which avoids the shell-concatenation warning and the quoting
  // problems that come with paths containing spaces.
  var karmaProcess = spawn(process.execPath, karmaArgs, {
    cwd: __dirname,
    stdio: 'inherit',
    env: karmaEnv
  });

  karmaProcess.on('close', function (code) {
    if (serverProcess) {
      console.log('Stopping test server...');
      serverProcess.kill();
    }
    process.exit(code);
  });
}

run().catch(function (err) {
  console.error(err);
  process.exit(1);
});
