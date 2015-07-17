// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "parse"
], function( $, Backbone ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function(options) {
            var self = this;
            self.character = options.character;
            self.category = options.category;
        },

        register: function(character, category) {
            var self = this;
            var changed = false;
            if (character !== self.character) {
                self.stopListening(self.character);
                self.character = character;
                self.listenTo(self.character, "change:" + category, self.render);
                changed = true;
            }

            if (category != self.category) {
                self.category = category;
                changed = true;
            }

            if (changed) {
                return self.render();
            }
            return self;
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#simpleTraitCategoryView" ).html(), { "character": this.character, "category": this.category } );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );