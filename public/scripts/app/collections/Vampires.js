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
        // Sorted by name, always.
        //
        // There used to be a `sortbycreated` branch here that ordered newest
        // first. Nothing could ever reach it: the flag was set on the plain
        // ARRAY passed to `reset()` (mobileRouter.js's get_user_characters and
        // friends), and `reset` copies an array's elements, not its
        // properties, so the collection never saw it. Three collections
        // carried an identical dead branch. It was a developer convenience
        // hard-coded to one username and has never run in production, so it is
        // deleted rather than repaired - a dead branch that looks live is how
        // someone comes to trust it.
        comparator: function (left, right) {
            var l = left.get("name");
            var r = right.get("name");
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