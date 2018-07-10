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
        childView: PatronageListView

    } );

    // Returns the View class
    return View;

} );