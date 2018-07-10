// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"backbone",
	"../models/SimpleTraitMixin"
], function( $, Backbone, SimpleTraitMixin ) {

    // The Model constructor
    var Model = Backbone.Model.extend( SimpleTraitMixin );

    // Returns the Model class
    return Model;

} );