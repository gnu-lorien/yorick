define([
    "jquery",
    "underscore",
    "parse",
    "hello",
    "../helpers/InjectAuthData"
], function( $, _, Parse, hello, InjectAuthData ) {

    var func = function (user) {
        return Parse.FacebookUtils.logIn("email").then(function (user) {
            return hello('facebook').api('/me');
        }).then(function (r) {
            return Parse.Cloud.run("submit_facebook_profile_data", r);
        }).then(function (id) {
            return new Parse.Query("UserFacebookData").get(id);
        }).then(function (storage) {
            var r = storage.attributes;
            var user = Parse.User.current();
            console.log(user.get("authData").facebook.access_token);
            if (!user.has("username"))
                user.set("username", r.name);
            if (!user.has("email"))
                user.set("email", r.email);
            if (!user.has("realname"))
                user.set("realname", r.name);
            InjectAuthData(user);

            console.log(user.get("authData").facebook.access_token);
            console.log(hello('facebook').getAuthResponse().access_token);
            return user.save();
        }).fail(function (error) {
            return Parse.Promise.error(error);
        });
    };

    return func;
} );
