var allTestFiles = [];
var TEST_REGEXP = /(spec|test)\.js$/i;

// An optional substring filter over spec filenames, from karma.conf.js's
// `client.args[1]` (set with the TEST_SPEC environment variable). Empty or
// absent means "run everything", which is the historical behaviour.
//
// This exists because the suite talks to a real Parse server and a single
// stuck `beforeAll` hangs the entire run without naming the file it was in.
// Being able to say `TEST_SPEC=troupe npm test` is the difference between
// triaging this suite and guessing at it.
var SPEC_FILTER = (window.__karma__.config &&
                   window.__karma__.config.args &&
                   window.__karma__.config.args[1]) || '';

// Get a list of all the test files to include
Object.keys(window.__karma__.files).forEach(function (file) {
    if (TEST_REGEXP.test(file)) {
        if (SPEC_FILTER && file.indexOf(SPEC_FILTER) === -1) {
            return;
        }
        allTestFiles.push(file);
    }
});

if (SPEC_FILTER) {
    console.log('TEST_SPEC="' + SPEC_FILTER + '" selected ' +
                allTestFiles.length + ' spec file(s): ' + allTestFiles.join(', '));
    if (allTestFiles.length === 0) {
        // Karma with nothing to load reports a cheerful "Executed 0 of 0
        // SUCCESS", which is the single most dangerous thing a test harness
        // can say. Refuse instead.
        throw new Error('TEST_SPEC="' + SPEC_FILTER + '" matched no spec files. ' +
                        'Nothing would run, and an empty run is not a passing run.');
    }
}

if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(searchString, position){
      position = position || 0;
      return this.substr(position, searchString.length) === searchString;
  };
}

if (!String.prototype.endsWith) {
  String.prototype.endsWith = function(searchString, position) {
      var subjectString = this.toString();
      if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
        position = subjectString.length;
      }
      position -= searchString.length;
      var lastIndex = subjectString.lastIndexOf(searchString, position);
      return lastIndex !== -1 && lastIndex === position;
  };
}

// Karma serves the spec files by absolute path (`/base/scripts/app/tests/
// foo-test.js`), and RequireJS resolves a relative dependency against the
// MODULE ID -- so `"../models/Vampire"` becomes a path with no extension that
// karma's exact-path middleware will not serve. Appending ".js" fixes that.
//
// The shim must not do anything else. The version this replaces declared
// `function (deps, callback)` and forwarded exactly those two arguments, which
// is only one of the four shapes define() is called in:
//
//     define(factory)                  lodash
//     define(deps, factory)            every module in this application
//     define(id, deps, factory)        jQuery -- `define("jquery", [], ...)`
//     define(id, factory)
//
// On the third shape it bound `deps` to the STRING "jquery" and `callback` to
// the empty deps array, then called `originalDefine("jquery", [])` -- dropping
// the factory entirely. RequireJS treats a non-function third argument as the
// module's value, so the "jquery" module resolved to `undefined` and every
// `define([... "jquery" ...], function ($) {` in the application received a `var allTestFiles = [];
var TEST_REGEXP = /(spec|test)\.js$/i;

// An optional substring filter over spec filenames, from karma.conf.js's
// `client.args[1]` (set with the TEST_SPEC environment variable). Empty or
// absent means "run everything", which is the historical behaviour.
//
// This exists because the suite talks to a real Parse server and a single
// stuck `beforeAll` hangs the entire run without naming the file it was in.
// Being able to say `TEST_SPEC=troupe npm test` is the difference between
// triaging this suite and guessing at it.
var SPEC_FILTER = (window.__karma__.config &&
                   window.__karma__.config.args &&
                   window.__karma__.config.args[1]) || '';

// Get a list of all the test files to include
Object.keys(window.__karma__.files).forEach(function (file) {
    if (TEST_REGEXP.test(file)) {
        if (SPEC_FILTER && file.indexOf(SPEC_FILTER) === -1) {
            return;
        }
        allTestFiles.push(file);
    }
});

if (SPEC_FILTER) {
    console.log('TEST_SPEC="' + SPEC_FILTER + '" selected ' +
                allTestFiles.length + ' spec file(s): ' + allTestFiles.join(', '));
    if (allTestFiles.length === 0) {
        // Karma with nothing to load reports a cheerful "Executed 0 of 0
        // SUCCESS", which is the single most dangerous thing a test harness
        // can say. Refuse instead.
        throw new Error('TEST_SPEC="' + SPEC_FILTER + '" matched no spec files. ' +
                        'Nothing would run, and an empty run is not a passing run.');
    }
}

if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(searchString, position){
      position = position || 0;
      return this.substr(position, searchString.length) === searchString;
  };
}

if (!String.prototype.endsWith) {
  String.prototype.endsWith = function(searchString, position) {
      var subjectString = this.toString();
      if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
        position = subjectString.length;
      }
      position -= searchString.length;
      var lastIndex = subjectString.lastIndexOf(searchString, position);
      return lastIndex !== -1 && lastIndex === position;
  };
}


// that was not jQuery.
//
// Nothing surfaced until a spec drove the app down a failure path, because `var allTestFiles = [];
var TEST_REGEXP = /(spec|test)\.js$/i;

// An optional substring filter over spec filenames, from karma.conf.js's
// `client.args[1]` (set with the TEST_SPEC environment variable). Empty or
// absent means "run everything", which is the historical behaviour.
//
// This exists because the suite talks to a real Parse server and a single
// stuck `beforeAll` hangs the entire run without naming the file it was in.
// Being able to say `TEST_SPEC=troupe npm test` is the difference between
// triaging this suite and guessing at it.
var SPEC_FILTER = (window.__karma__.config &&
                   window.__karma__.config.args &&
                   window.__karma__.config.args[1]) || '';

// Get a list of all the test files to include
Object.keys(window.__karma__.files).forEach(function (file) {
    if (TEST_REGEXP.test(file)) {
        if (SPEC_FILTER && file.indexOf(SPEC_FILTER) === -1) {
            return;
        }
        allTestFiles.push(file);
    }
});

if (SPEC_FILTER) {
    console.log('TEST_SPEC="' + SPEC_FILTER + '" selected ' +
                allTestFiles.length + ' spec file(s): ' + allTestFiles.join(', '));
    if (allTestFiles.length === 0) {
        // Karma with nothing to load reports a cheerful "Executed 0 of 0
        // SUCCESS", which is the single most dangerous thing a test harness
        // can say. Refuse instead.
        throw new Error('TEST_SPEC="' + SPEC_FILTER + '" matched no spec files. ' +
                        'Nothing would run, and an empty run is not a passing run.');
    }
}

if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(searchString, position){
      position = position || 0;
      return this.substr(position, searchString.length) === searchString;
  };
}

if (!String.prototype.endsWith) {
  String.prototype.endsWith = function(searchString, position) {
      var subjectString = this.toString();
      if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
        position = subjectString.length;
      }
      position -= searchString.length;
      var lastIndex = subjectString.lastIndexOf(searchString, position);
      return lastIndex !== -1 && lastIndex === position;
  };
}


// is only *called* in a handful of places. `helpers/ReportError.js:130` is one,
// so the first refused trait purchase died with "TypeError: $ is not a
// function" from inside the error reporter -- an error about reporting the
// error, masking the real one. Ten specs failed that way.
//
// Passing every argument through untouched, and rewriting only the array
// argument wherever it happens to sit, handles all four shapes.
function createDefineShim(originalDefine) {
    var shimmed = function () {
        var args = Array.prototype.slice.call(arguments);
        for (var a = 0; a < args.length; a++) {
            if (Object.prototype.toString.call(args[a]) !== "[object Array]") {
                continue;
            }
            var deps = args[a];
            for (var i = 0; i < deps.length; i++) {
                if (typeof deps[i] === "string" &&
                    deps[i].startsWith("..") && !deps[i].endsWith(".js")) {
                    deps[i] = deps[i] + ".js";
                }
            }
            break;
        }
        return originalDefine.apply(this, args);
    };

    // Carry over whatever RequireJS hung on define -- `amd` above all, which
    // is what every UMD wrapper feature-detects on. Replacing define with a
    // bare function silently turns every AMD-aware library into its browser-
    // global fallback.
    for (var key in originalDefine) {
        if (Object.prototype.hasOwnProperty.call(originalDefine, key)) {
            shimmed[key] = originalDefine[key];
        }
    }
    return shimmed;
}
define = createDefineShim(define);
define.amd = {
    jQuery: true,
};

require.config({
    // Karma serves files under /base, which is the basePath from your config file
    baseUrl: '/base/scripts/lib',
	waitSeconds: 0,
    paths: {

        // Core Libraries
        //jquery: "jquery",
        jquery: "//cdnjs.cloudflare.com/ajax/libs/jquery/1.11.2/jquery",
        
        jquerymobile: "jquery.mobile-1.4.5",
        underscore: "lodash",
        backbone: "backbone",
        // The Parse SDK at 8.6.0 behind the 1.5 compatibility layer, exactly
        // as public/scripts/app.js maps it. These two entries have to move
        // together and have to match the app: "parse" is the compat wrapper,
        // which loads "parse-sdk" (the real bundle, which publishes on the
        // global and returns nothing) and installs the shims before handing
        // the namespace to any app module.
        //
        // This used to say `parse: "parse-1.5.0"`, which pointed these specs
        // at a 2015 client while the app they exercise runs an SDK from 2026.
        // Under that mapping the suite tested software nobody ships.
        //
        // It also fixes app/testsiteconfig.js, whose serverURLs carry the
        // "/1" API version segment: SDK 1.5 appended that segment itself, so
        // every request from this harness went to ".../parse/1/1/..." and
        // 404'd. Modern SDKs do not append it, so those URLs are right now.
        parse: "parse-compat/parse",
        "parse-sdk": "parse-8.6.0",
        pretty: "prettyprint",
        moment: "moment",
        marionette: "backbone.marionette",

        // Present in app.js's map and previously absent here. A spec that
        // pulls in a view pulls in the view's own dependencies, and a module
        // id with no path entry resolves to <baseUrl>/<id>.js -- which is
        // right for vis/backform/nprogress/hello (their files are named after
        // their ids) and wrong for these three, whose filenames differ.
        // Without them the first view requiring one dies with a 404 that
        // reads as a missing module rather than a missing path.
        papaparse: "papaparse-5.6.0",
        "url-search-params": "url-search-params.max.amd",
        vis: "vis",
        backform: "backform",
        nprogress: "nprogress",
        hello: "hello",
        "bootstrap-datepicker": "//cdnjs.cloudflare.com/ajax/libs/bootstrap-datepicker/1.6.1/js/bootstrap-datepicker",

        app: "../app"
    },

    // Sets the configuration for your third party scripts that are not AMD compatible
    shim: {
		"backbone": {
			"deps": [ "underscore", "jquery" ],
			"exports": "Backbone"
		},

        // No "parse" shim any more. A shim only applies to a script that does
        // NOT call define(), and parse-compat/parse.js is a real AMD module --
        // RequireJS would ignore this entry, and leaving it would suggest the
        // dependency order below is doing something it is not. app.js has no
        // parse shim either, for the same reason.
        "backform": {
            "deps": [ "backbone" ],
            "exports": "Backform",
        },

    },
    // dynamically load all test files
    deps: allTestFiles,

    // we have to kickoff jasmine, as it is asynchronous
    callback: window.__karma__.start,
});
