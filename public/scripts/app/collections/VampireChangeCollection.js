// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
	"parse",
	"../models/VampireChange" ], function( $, Parse, VampireChange ) {

    var Collection = Parse.Collection.extend( {
        model: VampireChange
    } );
    return Collection;

} );