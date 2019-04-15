// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "marionette",
    "../views/PatronageListView"
], function( $, Backbone, Marionette, PatronageListView) {

    // Extends Backbone.View
    var View = Marionette.CollectionView.extend( {
        childView: PatronageListView,
        initialize: function(options) {
            this.options = options;
        },
        childViewOptions: function () {
            var self = this;
            return {
                back_url_base: self.options.back_url_base
            } 
        }
    } );

    // Returns the View class
    return View;

} );