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
      args: [targetArg || 'localhost'],
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
    files: [
      'scripts/app/tests/test-main.js',
      {pattern: 'scripts/tests/*.js', included: false},
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
    // run at all — leaving these 120 Jasmine specs as decoration. Headless
    // Chrome is what karma-chrome-launcher (already a devDependency) drives.
    browsers: [process.env.CI ? 'ChromeHeadlessNoSandbox' : 'ChromeHeadless'],


    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,

    // Concurrency level
    // how many browser should be started simultanous
    concurrency: Infinity
  })
}
