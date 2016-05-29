define([
    "jquery",
    "underscore",
    "parse",
], function( $, _, Parse ) {

    var func = function (user) {
        var authData = user.get("authData");
        if (_.has(authData, "facebook")) {
            authData.facebook = {
                id: authData.facebook.id,
                access_token: hello('facebook').getAuthResponse().access_token,
                expiration_date: new Date(hello('facebook').getAuthResponse().expires_in * 1000 + (new Date()).getTime()).toJSON(),
            };
            user.set("authData", authData);
        }
    };

    return func;
} );
