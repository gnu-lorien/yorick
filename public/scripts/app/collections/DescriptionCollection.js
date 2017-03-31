// Category Collection
// ===================

// Includes file dependencies
define([
	"jquery",
	"underscore",
	"parse",
	"../models/Description" ], function( $, _, Parse, Description ) {

    var Collection = Parse.Collection.extend( {
        model: Description,
        
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
            l = left.get("name");
            r = right.get("name");
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
                var allUpdateds = _.map(self.models, "updatedAt");
                allUpdateds = _.sortBy(allUpdateds);
                q.greaterThan("updatedAt", _.last(allUpdateds));
            }
            var latest = [];
            return q.each(function (description) {
                latest.push(description);
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