// Includes file dependencies
define([
    "jquery",
    "backbone",
    "text!../templates/player_options.html"
], function( $, Backbone, player_options_html) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            _.bindAll(this, "render");
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template(player_options_html)();

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
