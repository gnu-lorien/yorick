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
        env: process.env
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

  var karmaBin = path.join(__dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'karma.cmd' : 'karma');
  var karmaArgs = [
    'start',
    'public/karma.conf.js',
    '--single-run',
    '--browsers',
    'PhantomJS',
    '--target=' + target
  ];

  var karmaProcess = spawn(karmaBin, karmaArgs, {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
    env: process.env
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
