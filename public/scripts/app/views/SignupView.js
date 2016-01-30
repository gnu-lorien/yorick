// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse"
], function( $, Backbone, Parse ) {

    // Extends Backbone.View
    var SignupView = Backbone.View.extend( {
        events: {
            "submit form.signup-form": "signUp"
        },

        el: "#signup",

        initialize: function() {
            _.bindAll(this, "signUp");
            this.render();
        },

        signUp: function(e) {
            var self = this;
            var username = this.$("#signup-username").val();
            var password = this.$("#signup-password").val();

            Parse.User.signUp(username, password, { }, {
                success: function(user) {
                    location.reload();
                    self.undelegateEvents();
                },

                error: function(user, error) {
                    self.$(".signup-form .error").html(_.escape(error.message)).show();
                    self.$(".signup-form button").removeAttr("disabled");
                }
            });

            this.$(".signup-form button").attr("disabled", "disabled");

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