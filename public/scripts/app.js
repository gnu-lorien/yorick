// Sets the require.js configuration for your application.
requirejs.config( {
	baseUrl: "scripts/lib",
	//urlArgs: "bust=" + (new Date()).getTime(),
	urlArgs: "bust=010101",
	waitSeconds: 0,

	// 3rd party script alias names
	paths: {

		// Core Libraries
		jquery: "//ajax.googleapis.com/ajax/libs/jquery/1.11.2/jquery",
		jquerymobile: "jquery.mobile-1.4.5",
		jscookie: "js.cookie",
		// Vendored, not fetched. Both are byte-for-byte the versions these
		// paths used to serve (lodash 3.10.0, Backbone 1.1.2 — checked against
		// each file's own VERSION constant), so this changes nothing at
		// runtime except removing two third-party hosts from the critical path.
		//
		// It also matters for the Parse SDK upgrade: the compatibility layer
		// that replaces Parse.Collection and Parse.Object's change events is
		// built on Backbone, so fetching Backbone from cdnjs would put a CDN
		// outage between the app and its own data layer.
		//
		// jQuery is deliberately still on its CDN. public/scripts/lib/jquery.js
		// is 1.12.4 while the CDN path pins 1.11.2, and jQuery Mobile 1.4.5 is
		// not tested against 1.12 — so repointing it here would be a silent
		// version bump disguised as a vendoring change. It needs its own commit
		// with the suite run against it.
		underscore: "lodash",
		backbone: "backbone",
		// The Parse SDK, at 8.6.0, behind the 1.5 compatibility layer.
		//
		// "parse" resolves to the wrapper rather than the bundle, because the
		// bundle is AMD-aware but its factory returns nothing (it assigns
		// globalThis.Parse). Depending on it directly yields undefined. The
		// wrapper loads it, picks the namespace off the global, and installs
		// the shims for Parse.Promise, Parse.Collection, Parse.Object change
		// events and Parse.Router before handing it to any app module.
		//
		// parse-1.5.0.js is kept in the tree, unreferenced, as the reference
		// implementation the shims were written against.
		parse: "parse-compat/parse",
		"parse-sdk": "parse-8.6.0",
		pretty: "prettyprint",
		moment: "moment",
		vis: "vis",
		backform: "backform",
		nprogress: "nprogress",
		hello: "hello",
		marionette: "backbone.marionette",
		"bootstrap-datepicker": "//cdnjs.cloudflare.com/ajax/libs/bootstrap-datepicker/1.6.1/js/bootstrap-datepicker",
		"url-search-params": "url-search-params.max.amd",
		papaparse: "papaparse-4.1.2",

		app: "../app"
	},

	// Sets the configuration for your third party scripts that are not AMD compatible
	shim: {

		"backbone": {
			"deps": [ "underscore", "jquery" ],
			"exports": "Backbone"
		},

		"backform": {
			"deps": [ "backbone" ],
			"exports": "Backform",
		},

	}

});

// Load the main app module to start the app
requirejs(["app/main"]);
requirejs(["app/loadall"]);
