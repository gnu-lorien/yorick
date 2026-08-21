// Includes file dependencies
define([
    "jquery",
    "backbone",
    "text!../templates/choose-user.html",
    "parse",
    "../helpers/UserWreqr"
], function( $, Backbone, choose_user_html, Parse, UserChannel) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            _.bindAll(this, "render");
        },

        register: function(click_template) {
            var self = this;
            self.click_template = _.template(click_template);
            self.collection = [];
            // This was a SECOND independent _User sweep, separate from the one
            // in collections/Users.js and subject to the same decay. It now
            // shares the registry, so there is one directory and one policy.
            return UserChannel.get_users().then(function (users) {
                self.collection = users.models;
                self.render();
                if ("all" !== users.scope) {
                    // Was `console.log("No users? " + error.message)`: a refusal
                    // that rendered an empty picker and told the user nothing.
                    // A short list has to explain itself or it reads as a bug.
                    self.$el.find("div[role='main']").prepend(
                        "<p class='message'>Only storytellers and administrators " +
                        "can browse the full member list.</p>");
                }
            }, function (error) {
                self.$el.find("div[role='main']").prepend(
                    "<p class='message'>The member list could not be loaded: " +
                    _.escape(error.message) + "</p>");
            })
        },

        events: {
            "click .user-listing": "clicked",
        },

        clicked: function(e) {
            var self = this;
            e.preventDefault();
            $.mobile.loading("show");
            var pickedId = $(e.target).attr("backendId");
            window.location.hash = self.click_template({id: pickedId});
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            // Sets the view's template property
            this.template = _.template(choose_user_html)({collection: self.collection});

            // Renders the view's template inside of the current div element
            this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
