// Includes File Dependencies
require([
    "jquery",
    "parse",
    "app/routers/mobileRouter",
    "app/collections/BNSMETV1_ClanRules"
], function ( $, Parse, Mobile, ClanRules ) {

    $( document ).on( "mobileinit",

        // Set up the "mobileinit" handler before requiring jQuery Mobile's module
        function () {

            // Prevents all anchor click handling including the addition of active button state and alternate link bluring.
            $.mobile.linkBindingEnabled = false;

            // Disabling this will prevent jQuery Mobile from handling hash changes
            $.mobile.hashListeningEnabled = false;
        }
    )

    require( [ "jquerymobile" ], function () {

        Parse.$ = $;

        Parse.initialize("rXfLuSWZZs1xxyeX4IzlG1ZCuglbIoDlGHwg68Ru", "yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR");

        // Instantiates a new Backbone.js Mobile Router
        this.router = new Mobile();

        // Instantiates global rule access
        this.BNSMETV1_ClanRules = new ClanRules;
        this.BNSMETV1_ClanRules.fetch();
    });
});
