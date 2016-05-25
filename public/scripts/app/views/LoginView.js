// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse"
], function( $, Backbone, Parse ) {

    // Extends Backbone.View
    var LoginView = Backbone.View.extend( {
        events: {
            "submit form.login-form": "logIn",
        },

        el: "#login",

        initialize: function() {
            _.bindAll(this, "logIn");
            Parse.FacebookUtils.init({
                facebook : "1607159299598020",
            })
            this.render();
        },

        logIn: function(e) {
            var self = this;
            var username = this.$("#login-username").val();
            var password = this.$("#login-password").val();

            Parse.FacebookUtils.logIn("", {
                scope : 'email',
                redirect_uri: "http://localhost:63342/yorick/public/index.html"
            }).then(function(user) {
                location.reload();
                self.undelegateEvents();
            }, function(error) {
                console.log(JSON.stringify(error));
                self.$(".login-form .error").html("Invalid username or password. Please try again.").show();
                self.$(".login-form button").removeAttr("disabled");
            });
            /*
            Parse.User.logIn(username, password, {
                success: function(user) {
                    location.reload();
                    self.undelegateEvents();
                },

                error: function(user, error) {
                    self.$(".login-form .error").html("Invalid username or password. Please try again.").show();
                    self.$(".login-form button").removeAttr("disabled");
                }
            });
            */

            this.$(".login-form button").attr("disabled", "disabled");

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