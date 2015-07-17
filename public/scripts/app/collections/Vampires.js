// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
	"parse",
	"../models/Vampire" ], function( $, Parse, Vampire ) {

    var Collection = Parse.Collection.extend( {
        model: Vampire
    } );
    return Collection;

} );