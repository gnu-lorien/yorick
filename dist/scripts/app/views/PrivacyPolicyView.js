define([
    "jquery",
    "backbone",
    "text!../templates/privacy-policy.html"
], function( $, Backbone, privacy_policy_html) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            var self = this;
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            self.template = _.template(privacy_policy_html)();
            self.$el.find("div[role='main']").html(self.template);

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
