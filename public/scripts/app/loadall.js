// Includes File Dependencies
require([
    "jquery",
    "parse",
    "app/routers/mobileRouter",
    "app/collections/BNSMETV1_ClanRules",
    "nprogress"
], function ( $, Parse, Mobile, ClanRules, nprogress ) {
    require( [ "jquerymobile" ], function () {

        Parse.$ = $;

        Parse.initialize("rXfLuSWZZs1xxyeX4IzlG1ZCuglbIoDlGHwg68Ru", "yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR");

        // Instantiates a new Backbone.js Mobile Router
        this.router = new Mobile();

        // Instantiates global rule access
        this.BNSMETV1_ClanRules = new ClanRules;
        this.BNSMETV1_ClanRules.fetch();

        nprogress.done();
    });
});
