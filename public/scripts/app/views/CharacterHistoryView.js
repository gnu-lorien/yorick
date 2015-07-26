// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone"
], function( $, Backbone) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;
            this.model.calculate_total_cost().then(function (costs) {
                // Sets the view's template property
                self.template = _.template(
                    $("script#characterHistoryView").html())(
                    {
                        "character": self.model,
                        "costs": costs
                    });

                // Renders the view's template inside of the current listview element
                self.$el.find("div[role='main']").html(self.template);

                self.$el.enhanceWithin();
            });

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );