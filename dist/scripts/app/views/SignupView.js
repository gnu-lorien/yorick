// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "../helpers/InjectAuthData",
    "../helpers/FacebookLogin"
], function( $, Backbone, Parse, InjectAuthData, FacebookLogin ) {

    // Extends Backbone.View
    var SignupView = Backbone.View.extend( {
        events: {
            "submit form.signup-form": "signUp",
            "click #signup-with-facebook": "signUpWithFacebook"
        },

        el: "#signup",

        initialize: function() {
            _.bindAll(this, "signUp");
            this.render();
        },

        signUpWithFacebook: function(e) {
            var self = this;
            e.preventDefault();
            self.undelegateEvents();
            self.$(".signup-form .error").hide();
            this.$(".signup-form button").attr("disabled", "disabled");

            FacebookLogin().then(function () {
                location.reload();
            }, function (error) {
                console.log(JSON.stringify(error));
                self.$(".signup-form .error").html(_.escape(error.message)).show();
                self.$(".signup-form button").removeAttr("disabled");
                self.delegateEvents();
            });
        },

        signUp: function(e) {
            var self = this;
            var username = this.$("#signup-username").val();
            var password = this.$("#signup-password").val();
            e.preventDefault();
            self.undelegateEvents();
            self.$(".signup-form .error").hide();
            this.$(".signup-form button").attr("disabled", "disabled");

            Parse.User.signUp(username, password, { }, {
                success: function(user) {
                    location.reload();
                    self.undelegateEvents();
                },

                error: function(user, error) {
                    self.$(".signup-form .error").html(_.escape(error.message)).show();
                    self.$(".signup-form button").removeAttr("disabled");
                    self.delegateEvents();
                }
            });

            return false;
        },

        render: function() {
            this.template = _.template($("#signup-template").html())();
            this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();
            this.delegateEvents();
        }
    });

    // Returns the View class
    return SignupView;

} );