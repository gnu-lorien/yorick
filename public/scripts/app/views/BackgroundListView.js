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
        },

        register_character: function(c) {
            var self = this;
            if (c === self.model) {
                return self;
            }

            self.stopListening(self.model);
            self.model = c;
            self.listenTo(self.model, "change:backgrounds", self.render);

            return self.render();
        },

        degugall: function(n) {
            console.log(n);
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#backgroundView" ).html(), { "c": this.model } );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );