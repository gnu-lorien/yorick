// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
	"../models/BackgroundDescription",
    "../collections/BackgroundDescriptionsCollection"
], function( $, Backbone, BackgroundDescription, BackgroundDescriptions ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

            // The render method is called when Category Models are added to the Collection
            this.listenTo(this.collection, "add", this.render);
            this.listenTo(this.collection, "reset", this.render);

        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#characterLinkItems" ).html(), { "collection": this.collection } );

            // Renders the view's template inside of the current listview element
            this.$el.find("ul").html(this.template);

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );