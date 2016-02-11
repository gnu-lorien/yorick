// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "text!../templates/character-list-item.html"
], function( $, Backbone, character_list_item_html ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

            _.bindAll(this, "render");
            var debounced_render = _.debounce(this.render, 150);
            this.listenTo(this.collection, "add", debounced_render);
            this.listenTo(this.collection, "remove", debounced_render);
            this.listenTo(this.collection, "reset", this.render);
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( character_list_item_html )({ "collection": this.collection } );

            // Renders the view's template inside of the current div element
            this.$el.find("ul[data-role='listview']").html(this.template);

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );