// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
    "underscore",
	"parse",
	"../models/Vampire" ], function( $, _, Parse, Vampire ) {

    var Collection = Parse.Collection.extend( {
        model: Vampire,
        comparator: function (left, right) {
            var self = this;
            var l, r;
            if (_.has(self, "sortbycreated")) {
                l = right.createdAt;
                r = left.createdAt;
            } else {
                l = left.get("name");
                r = right.get("name");
            }
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