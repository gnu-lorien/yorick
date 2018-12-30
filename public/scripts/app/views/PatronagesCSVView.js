// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "marionette",
    "../views/PatronageCSVListView"
], function( $, Backbone, Marionette, PatronageCSVListView) {

    // Extends Backbone.View
    var View = Marionette.CollectionView.extend( {
        childView: PatronageCSVListView

    } );

    // Returns the View class
    return View;

} );