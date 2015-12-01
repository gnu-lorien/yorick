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

require.config({
    // Karma serves files under /base, which is the basePath from your config file
    baseUrl: '/base/scripts/lib',
    paths: {

        // Core Libraries
        jquery: "//ajax.googleapis.com/ajax/libs/jquery/1.11.2/jquery",
        "jquery-ui": "//ajax.googleapis.com/ajax/libs/jqueryui/1.11.4/jquery-ui.min",
        jquerymobile: "//code.jquery.com/mobile/1.4.5/jquery.mobile-1.4.5",
        "mobiledatepicker": "jquery.mobile.datepicker",
        jscookie: "js.cookie",
        underscore: "//cdn.jsdelivr.net/lodash/3.10.0/lodash",
        backbone: "//cdnjs.cloudflare.com/ajax/libs/backbone.js/1.1.2/backbone",
        //parse: "//www.parsecdn.com/js/parse-1.5.0.min",
        parse: "parse-1.5.0",
        pretty: "prettyprint",
        moment: "moment",

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
