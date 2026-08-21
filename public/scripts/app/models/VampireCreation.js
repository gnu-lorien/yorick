// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse"
], function( $, Parse ) {

    // The Model constructor
    var Model = Parse.Object.extend( "VampireCreation", {
        /**
         * Total picks still available across every sub-pool of a category.
         *
         * This used to size its loop from a hardcoded map of the six Vampire
         * categories, so any category outside it - every `wta_*` and
         * `ctdbs_*` one - fell back to a top rating of 1 and summed only the
         * rating-1 and rating-0 sub-pools. The per-rating counters were
         * always right; only this badge was wrong.
         *
         * Reading the sub-pools that actually exist on the record needs no
         * per-venue table and cannot go stale when a venue gains a category.
         */
        remaining_picks: function(category) {
            var self = this;
            var prefix = category + "_";
            var suffix = "_remaining";
            var r = 0;
            _.each(self.attributes, function (value, key) {
                if (!_.isNumber(value)) {
                    return;
                }
                if (0 !== key.indexOf(prefix) || key.length <= prefix.length + suffix.length) {
                    return;
                }
                if (suffix !== key.slice(-suffix.length)) {
                    return;
                }
                // Only a bare rating belongs between the two, so that
                // "skills" does not swallow "skills_specializations_1".
                if (!/^-?\d+$/.test(key.slice(prefix.length, key.length - suffix.length))) {
                    return;
                }
                r += value;
            });
            return r;
        }
    } );

    // Returns the Model class
    return Model;

} );