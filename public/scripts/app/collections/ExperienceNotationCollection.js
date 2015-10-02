// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
	"parse",
	"../models/ExperienceNotation" ], function( $, Parse, ExperienceNotation ) {

    var Collection = Parse.Collection.extend( {
        model: ExperienceNotation,
        comparator: function(leftm, rightm) {
            var left = leftm.get("entered");
            var right = rightm.get("entered");
            if (left > right) {
                return -1;
            } else if (right > left) {
                return 1;
            }
            return 0;
        },
    } );
    return Collection;

} );