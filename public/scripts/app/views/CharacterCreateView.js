// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "text!../templates/character-create-view.html"
], function( $, Backbone, character_create_view_html ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            _.bindAll(this, "scroll_back_after_page_change");
        },

        scroll_back_after_page_change: function() {
            var self = this;
            $(document).one("pagechange", function() {
                var top = _.parseInt(self.backToTop);
                $.mobile.silentScroll(top);
            });
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template(character_create_view_html)({ "character": this.model } );

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