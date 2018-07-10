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
        
        comparator: function (left, right) {
            var self = this;
            var l, r;
            if (_.has(self, "sortbycreated")) {
                l = right.createdAt;
                r = left.createdAt;
            } else {
                l = right.get("expiresOn");
                r = left.get("expiresOn");
            }
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