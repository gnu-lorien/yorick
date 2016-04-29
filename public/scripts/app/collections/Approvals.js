// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
    "underscore",
	"parse",
	"../models/Approval" ], function( $, _, Parse, Approval ) {

    var Collection = Parse.Collection.extend( {
        model: Approval,
        comparator: function (left, right) {
            var l, r;
            l = right.createdAt;
            r = left.createdAt;
            if (_.gt(l, r)) {
                return 1;
            } else if (_.lt(l, r)){
                return -1;
            }
            return 0;
        },
    } );
    return Collection;

} );