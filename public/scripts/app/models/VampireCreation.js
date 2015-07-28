// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse"
], function( $, Parse ) {

    // The Model constructor
    var Model = Parse.Object.extend( "VampireCreation", {
        remaining_picks: function(category) {
            var self = this;
            var r = 0;
            var tops = {
                skills: 4,
                disciplines: 2,
                backgrounds: 3,
                attributes: 7};
            var start = tops[category] || 1;
            _.each(_.range(start, 0, -1), function(i) {
                var n = category + "_" + i + "_remaining";
                var tv = self.get(n);
                if (_.isNumber(tv)) {
                    r += tv;
                }
            });
            return r;
        }
    } );

    // Returns the Model class
    return Model;

} );