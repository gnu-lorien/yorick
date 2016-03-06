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

        trackJs.configure({
            onError: function (payload) {
                _.defer(function () {
                    var closebtn = '<a href="#" data-rel="back" class="ui-btn ui-corner-all ui-btn-a ui-icon-delete ui-btn-icon-notext ui-btn-right">Close</a>',
                        header = '<div data-role="header"><h2>Error Reported</h2></div>',
                        span = '<span>' + payload.message + '</span>',
                        popup = '<div data-role="popup" id="popup-global-error" data-short="global-error" data-theme="none" data-overlay-theme="a" data-corners="false" data-tolerance="15"></div>';
                    $(header)
                        .appendTo($(popup)
                            .appendTo($.mobile.activePage)
                            .popup())
                        .toolbar()
                        .before(closebtn)
                        .after(span);
                    var fallback = _.delay(function () {
                        $("#popup-global-error").popup("open");
                    }, 2000);
                    $("#popup-global-error").load(function () {
                        $("#popup-global-error").popup("open");
                        clearTimeout(fallback);
                    });
                });
                return true;
            }
        })
    });
});
