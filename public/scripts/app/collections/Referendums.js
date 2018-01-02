// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
    "underscore",
	"parse",
	"../models/Referendum" ], function( $, _, Parse, Referendum ) {

    var Collection = Parse.Collection.extend( {
        model: Referendum,
        comparator: function (left, right) {
            var self = this;
            var l, r;
            l = left.get("order");
            r = right.get("order");
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