// Includes file dependencies
define([
	"jquery",
    "underscore",
	"parse",
    "backbone" ], function( $, _, Parse, Backbone ) {

    var Collection = Parse.Collection.extend( {
        model: Parse.User,
        
        initialize: function() {
            // No `self.query` here. Nothing read it, and leaving a _User query
            // lying around invites Parse.Collection.prototype.fetch to sweep
            // the table again -- the thing this collection stopped doing.
        },
        
        comparator: function (left, right) {
            var self = this;
            var l, r;
            if (_.has(self, "sortbycreated")) {
                l = right.createdAt;
                r = left.createdAt;
            } else {
                l = left.get("paidOn");
                r = right.get("paidOn");
            }
            if (_.gt(l, r)) {
                return 1;
            } else if (_.lt(l, r)){
                return -1;
            }
            return 0;
        },
        
        /**
         * The account directory, from the server rather than from a _User sweep.
         *
         * A client-side query cannot do this any more: under enforcePrivateUsers
         * a new signup has no public read, so the sweep silently returned fewer
         * people every week and nothing anywhere said so.
         *
         * The `createdAt` watermark went with it, deliberately. It took its
         * high-water mark from rows ALREADY LOADED, so the moment new accounts
         * became invisible it froze at the newest visible one and re-scanned an
         * empty window forever -- it could not even notice it was missing
         * anyone. It was broken by the same change it was meant to survive.
         *
         * `self.scope` records which tier the server was willing to serve, so a
         * caller can say WHY a list is short instead of rendering a mystery.
         */
        fetch: function (options) {
            var self = this;
            options = options || {};
            _.defaults(options, {add: true});
            return Parse.Cloud.run("list_users").then(function (payload) {
                self.scope = payload.scope;
                if (options.add) {
                    _.each(payload.users, function (u) {
                        self.add(u);
                    })
                } else {
                    self.reset(payload.users);
                }

                return Parse.Promise.as(self);
            })
        }
    } );
    return Collection;

} );