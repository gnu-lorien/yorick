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


    // web server port
    port: 8082,


    // enable / disable colors in the output (reporters and logs)
    colors: true,


    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_DEBUG,


    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: true,


    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: ['PhantomJS'],


    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: false,

    // Concurrency level
    // how many browser should be started simultanous
    concurrency: Infinity
  })
}
