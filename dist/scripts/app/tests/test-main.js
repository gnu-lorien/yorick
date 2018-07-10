var allTestFiles = [];
var TEST_REGEXP = /(spec|test)\.js$/i;

// Get a list of all the test files to include
Object.keys(window.__karma__.files).forEach(function (file) {
    if (TEST_REGEXP.test(file)) {
        /*
        var normalizedTestModule = file.replace(/^\/base\/|\.js$/g, '');
        allTestFiles.push(normalizedTestModule);
        alert("Found " + file);
        alert("Became " + normalizedTestModule);
        */
        allTestFiles.push(file);
    }
});

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

function createDefineShim(originalDefine) {
    return function (deps, callback) {
        for(var i = 0; i < deps.length; i++) {
            if (deps[i].startsWith("..") && !deps[i].endsWith(".js")) {
                deps[i] = deps[i] + ".js";
            }
        }
        console.log(deps);
        originalDefine(deps, callback);
    };
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
        jscookie: "js.cookie",
        underscore: "lodash",
        backbone: "backbone",
        //parse: "//www.parsecdn.com/js/parse-1.5.0.min",
        parse: "parse-1.5.0",
        pretty: "prettyprint",
        moment: "moment",
        marionette: "backbone.marionette",

        app: "../app"
    },

    // Sets the configuration for your third party scripts that are not AMD compatible
    shim: {
		"backbone": {
			"deps": [ "underscore", "jquery" ],
			"exports": "Backbone"
		},

        "parse": {
            "deps": [ "underscore", "jquery" ],
            "exports": "Parse"
        },

    },
    // dynamically load all test files
    deps: allTestFiles,

    // we have to kickoff jasmine, as it is asynchronous
    callback: window.__karma__.start,
});
