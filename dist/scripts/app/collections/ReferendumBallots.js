// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
    "underscore",
	"parse",
	"../models/Referendum",
	"../models/ReferendumBallot"], function( $, _, Parse, Referendum, Ballot ) {

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
            q.include("caster");
            var latest = [];
            return q.each(function (ballot) {
                latest.push(ballot);
            }).then(function () {
                self.reset(latest);
                return Parse.Promise.as(self);
            })
        }
    } );
    return Collection;

} );