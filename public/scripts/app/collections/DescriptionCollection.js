// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
	"parse",
	"../models/Description" ], function( $, Parse, Description ) {

    var Collection = Parse.Collection.extend( {
        model: Description
    } );
    return Collection;

} );