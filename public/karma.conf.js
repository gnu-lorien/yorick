// Karma configuration
// Generated on Sat Nov 07 2015 22:22:03 GMT-0500 (Eastern Standard Time)

module.exports = function(config) {
  var targetArg = process.env.TEST_TARGET;
  if (!targetArg) {
    process.argv.forEach(function(arg) {
      if (arg.indexOf('--target=') === 0) {
        targetArg = arg.split('=')[1];
      } else if (arg === '--staging' || arg === '--stagingapi') {
        targetArg = 'staging';
      }
    });
  }

  config.set({
    transports: ['polling'],
    client: {
      // args[0] is the target (see testsiteconfig.js). args[1] is an optional
      // substring filter over spec FILENAMES, applied in test-main.js.
      //
      // Without it this suite is all-or-nothing: 166 specs against a real
      // server, where one hanging `beforeAll` costs the whole run and tells
      // you nothing about which file it was in. Triaging a suite that has not
      // run in years is impossible on those terms.
      //
      //   TEST_SPEC=troupe npm test        -- just troupe-test.js
      //   TEST_SPEC=fast npm test          -- just fast-test.js
      //   npm test                         -- everything, as before
      args: [targetArg || 'localhost', process.env.TEST_SPEC || ''],
      jasmine: {
        random: false
      }
    },

    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',


    // frameworks to use
    // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
    frameworks: ['jasmine', 'requirejs'],


    // list of files / patterns to load in the browser
    // `scripts/tests/` used to be listed here and does not exist -- there is
    // no such directory under public/scripts, only app/ and lib/. Karma warns
    // ("pattern does not match any file") and carries on, so it cost nothing
    // but a warning that looks like a real problem at the top of every run.
    //
    // The specs themselves live under scripts/app/tests/ and are pulled in by
    // test-main.js, which globs window.__karma__.files -- which is why they
    // are served (included: false) rather than listed here.
    files: [
      'scripts/app/tests/test-main.js',
      {pattern: 'scripts/app/**/*.js', included: false},
      {pattern: 'scripts/lib/**/*.js', included: false}
    ],


    // list of files to exclude
    exclude: [
    ],


    // preprocess matching files before serving them to the browser
    // available preprocessors: https://npmjs.org/browse/keyword/karma-preprocessor
    preprocessors: {
    },


    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['progress'],

    // Headless Chrome, with a no-sandbox variant for CI containers.
    //
    // `ChromeHeadless` resolves a real Chrome via karma-chrome-launcher, which
    // looks at CHROME_BIN first and then the standard install paths.
    // test_runner.js points CHROME_BIN at Playwright's bundled Chromium when no
    // system Chrome is installed, so a machine set up only for the E2E suite can
    // run these too without a second browser download.
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
      }
    },


    // web server port
    port: 8082,


    // How long Karma waits for ANY message from the browser before declaring
    // it dead. The default is 30s, and these specs blow straight through it:
    // a single `beforeAll` in default-test.js creates a character and then
    // saves a dozen traits one after another, each a real round trip to a
    // real Parse server, and Jasmine emits nothing between specs while it
    // does. Measured: the browser was killed with "Disconnected, because no
    // message in 30000 ms" having executed 0 of 166 specs, mid-setup.
    //
    // This is not the same knob as a Jasmine spec timeout
    // (DEFAULT_TIMEOUT_INTERVAL, which the spec files set themselves to
    // 60000). That one fails one spec; this one kills the whole run and
    // reports it as a browser error, so it has to be the larger of the two.
    browserNoActivityTimeout: 300000,

    // And how long to wait for the browser to connect in the first place.
    // Raised in step with the above so a slow first load on a loaded machine
    // does not read as a missing browser.
    captureTimeout: 120000,


    // enable / disable colors in the output (reporters and logs)
    colors: true,


    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    //
    // LOG_DEBUG buried the actual failures under a wall of per-file 404/200
    // request logging. LOG_WARN still shows browser errors and the failure
    // summary, which is what anyone reading this output is looking for.
    logLevel: config.LOG_WARN,


    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: false,


    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    //
    // Was PhantomJS, which has been abandoned since 2018 and could no longer
    // run at all — leaving these Jasmine specs as decoration. Headless
    // Chrome is what karma-chrome-launcher (already a devDependency) drives.
    //
    // The count is 166 specs at runtime, measured, not 120: ten spec files
    // carrying 118 static it() calls, of which 28 sit inside
    // `_.each(character_types, ...)` loops and are registered once per
    // creature type. spec.thebegining.js and test-default.js are NOT among
    // them — test-main.js's TEST_REGEXP only matches a filename ending in
    // "test.js" or "spec.js", so those two have never loaded.
    browsers: [process.env.CI ? 'ChromeHeadlessNoSandbox' : 'ChromeHeadless'],


    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,

    // Concurrency level
    // how many browser should be started simultanous
    concurrency: Infinity
  })
}
