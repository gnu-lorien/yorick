// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
	"parse",
	"../models/ExperienceNotation" ], function( $, Parse, ExperienceNotation ) {

    var Collection = Parse.Collection.extend( {
        model: ExperienceNotation
    } );
    return Collection;

} );