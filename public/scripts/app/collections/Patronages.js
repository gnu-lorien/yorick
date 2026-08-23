// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
    "underscore",
	"parse",
    "backbone",
	"../models/Patronage" ], function( $, _, Parse, Backbone, Patronage ) {

    var Collection = Parse.Collection.extend( {
        model: Patronage,
        
        initialize: function() {
            var self = this;
            self.query = new Parse.Query(self.model);
        },
        
        // Sorted by expiresOn, descending, always. See
        // collections/Vampires.js for why the `sortbycreated` branch that used
        // to sit here is gone: the flag was set on the array handed to
        // `reset()`, never on the collection the comparator reads it off, so
        // the branch was unreachable.
        comparator: function (left, right) {
            var l = right.get("expiresOn");
            var r = left.get("expiresOn");
            if (_.gt(l, r)) {
                return 1;
            } else if (_.lt(l, r)){
                return -1;
            }
            return 0;
        },
        
        fetch: function (options) {
            var self = this;
            var options = options || {};
            _.defaults(options, {add: true, update: true});
            var q = self.query;
            if (options.update && 0 != self.models.length) {
                var allCreateds = _.map(self.models, "createdAt");
                allCreateds = _.sortBy(allCreateds);
                q.greaterThan("createdAt", _.last(allCreateds));
            }
            var latest = [];
            return q.each(function (patronage) {
                latest.push(patronage);
            }).then(function () {
                if (options.add) {
                    _.each(latest, function(l) {
                        self.add(l);
                    })
                } else {
                    self.reset(latest);
                }
                
                return Parse.Promise.as(self);
            })
        }
    } );
    return Collection;

} );