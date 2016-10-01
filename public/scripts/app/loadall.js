// Includes File Dependencies
require([
    "jquery",
    "parse",
    "app/routers/mobileRouter",
    "app/collections/BNSMETV1_ClanRules",
    "nprogress",
    "hello",
    "app/siteconfig"
], function ( $, Parse, Mobile, ClanRules, nprogress, hello, siteconfig ) {
    require( [ "jquerymobile" ], function () {

        Parse.$ = $;

        Parse.initialize("APPLICATION_ID", "yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR");
        Parse.serverURL = siteconfig.serverURL;
        
        hello.init({
            facebook : siteconfig.facebookAppId,
        },{
            scope : 'email',
            redirect_uri: siteconfig.redirect_uri
        });

        Parse.FacebookUtils.init(hello);

        // Instantiates a new Backbone.js Mobile Router
        this.router = new Mobile();

        // Instantiates global rule access
        this.BNSMETV1_ClanRules = new ClanRules;
        this.BNSMETV1_ClanRules.fetch();

        if (typeof trackJs !== "undefined") {
            trackJs.configure({
                serialize: function (item) {
                    try {
                        return JSON.stringify(item);
                    } catch (e) {
                        return item.toString();
                    }
                },

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
        } else {
            console.log("Something is blocking trackJs. No user debugging available.");
        }
    });
});
