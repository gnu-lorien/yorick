// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "text!../templates/single-character-list-item.html"
], function( $, Backbone, single_character_list_item_html ) {

    var View = Backbone.View.extend( {
        template: _.template(single_character_list_item_html),

        initialize: function(character) {
            this.character = character;
        },

        // Renders all of the Category models on the UI
        render: function() {
            // Renders the view's template inside of the current div element
            this.$el.html(this.template({e: this.character}));

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );