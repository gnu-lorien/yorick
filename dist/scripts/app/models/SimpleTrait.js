// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse",
	"../models/SimpleTraitMixin"
], function( $, Parse, SimpleTraitMixin ) {

    // The Model constructor
    var Model = Parse.Object.extend( "SimpleTrait", SimpleTraitMixin );

    // Returns the Model class
    return Model;

} );