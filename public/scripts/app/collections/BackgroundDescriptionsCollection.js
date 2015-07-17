// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
	"parse",
	"../models/BackgroundDescription" ], function( $, Parse, BackgroundDescription ) {

    var Collection = Parse.Collection.extend( {
        model: BackgroundDescription
    } );
    return Collection;

} );