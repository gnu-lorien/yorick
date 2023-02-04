// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "hello",
    "../helpers/PromiseFailReport",
    "../helpers/InjectAuthData",
    "../helpers/FacebookLogin"
], function( $, Backbone, Parse, hello, PromiseFailReport, InjectAuthData, FacebookLogin ) {

    // Extends Backbone.View
    var LoginView = Backbone.View.extend( {
        events: {
            "submit form.login-form": "logIn",
            "click #login-with-facebook": "logInWithFacebook",
        },

        el: "#login",

        initialize: function() {
            _.bindAll(this, "logIn");
            this.render();
        },

        logInWithFacebook: function (e) {
            var self = this;
            e.preventDefault();
            self.undelegateEvents();
            self.$(".login-form .error").hide();
            this.$(".login-form button").attr("disabled", "disabled");

            FacebookLogin().then(function () {
                var b = $.mobile.changePage(window.location.hash, {allowSamePageTransition: true, changeHash: false});
                var a = Parse.history.loadUrl();
            }, function (error) {
                console.log(JSON.stringify(error));
                if (typeof trackJs !== "undefined")
                    trackJs.console.error("Error in promise", JSON.stringify(error));
                self.$(".login-form .error").html(_.escape(error.message)).show();
                self.$(".login-form button").removeAttr("disabled");
                self.delegateEvents();
            });
        },

        logIn: function(e) {
            var self = this;
            self.$(".login-form .error").hide();
            var username = this.$("#login-username").val();
            var password = this.$("#login-password").val();
            e.preventDefault();
            self.undelegateEvents();
            Parse.User.logIn(username, password, {
                success: function(user) {
                    location.reload();
                },

                error: function(user, error) {
                    self.$(".login-form .error").html(_.escape(error.message)).show();
                    self.$(".login-form button").removeAttr("disabled");
                    self.delegateEvents();
                }
            });

            return false;
        },

        render: function() {
            this.template = _.template($("#login-template").html())();
            this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();
            this.delegateEvents();
        }
    });

    // Returns the View class
    return LoginView;

} );