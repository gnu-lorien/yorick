// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "hello"
], function( $, Backbone, Parse, hello ) {

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

        logInWithFacebook: function(e) {
            var self = this;
            self.undelegateEvents();
            this.$(".login-form button").attr("disabled", "disabled");

            Parse.FacebookUtils.logIn("email").then(function (user) {
                hello('facebook').api('/me').then(function (r) {
                    console.log(JSON.stringify(r));
                }, function (error) {
                    console.log(JSON.stringify(error));
                });
                if (!user.has("email") || !user.has("realname")) {
                    console.log("Missing email or realname");
                    user.set("email", user.get("authData").facebook.email);
                    user.set("realname", user.get("authData").facebook.realname);
                    return user.save();
                }
                return Parse.Promise.as([]);
            }).then(function () {
                window.location.reload();
            }, function (error) {
                console.log(JSON.stringify(error));
                self.$(".login-form .error").html("Invalid username or password. Please try again.").show();
                self.$(".login-form button").removeAttr("disabled");
                self.delegateEvents();
            });
        },

        logIn: function(e) {
            var self = this;
            var username = this.$("#login-username").val();
            var password = this.$("#login-password").val();
            e.preventDefault();
            self.undelegateEvents();
            Parse.User.logIn(username, password, {
                success: function(user) {
                    location.reload();
                },

                error: function(user, error) {
                    self.$(".login-form .error").html("Invalid username or password. Please try again.").show();
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