// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
    "underscore",
	"parse",
	"../models/Referendum",
	"../models/ReferendumBallot",
	"../helpers/UserWreqr"], function( $, _, Parse, Referendum, Ballot, UserChannel ) {

    var Collection = Parse.Collection.extend( {
        model: Ballot,
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
        
        fetch: function (referendum) {
            var self = this;
            var q = new Parse.Query(self.model)
                .equalTo("owner", referendum);
            // NO include("caster"). Same defect as include("owner") elsewhere:
            // parse-server deletes an unreadable pointer only when asked to
            // EXPAND it, so a private voter's ballot arrived with no `caster`
            // at all -- and referendum/options.html reads
            // `e.get("caster").get("username")`, which throws on undefined
            // rather than rendering short. Without the include the pointer
            // survives and the hydrate below supplies the name.
            var latest = [];
            return q.each(function (ballot) {
                latest.push(ballot);
            }).then(function () {
                // Hydrate BEFORE reset -- `_finishFetch` fires no change event.
                return UserChannel.hydrate(latest, "caster");
            }).then(function () {
                self.reset(latest);
                return Parse.Promise.as(self);
            })
        }
    } );
    return Collection;

} );