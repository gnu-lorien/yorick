// Category Collection
// ===================

// Includes file dependencies
define([
    "underscore",
	"parse",
	"../models/BNSCTDBS_KithRule" ], function( _, Parse, KithRule ) {

    var Collection = Parse.Collection.extend( {
        model: KithRule,
        get_arts_affinities_for_kith: function(kith) {
            var self = this;
            var clanName = kith;
            var rule = _.find(self.models, function (m) {
                return m.get("name") == clanName;
            });

            if (!rule) {
                return [];
            }

            return _.without([rule.get("art_1"),
                rule.get("art_2"),
                rule.get("art_3")], undefined);
        },
        get_arts_affinities: function(character) {
            var self = this;
            return self.get_arts_affinities_for_kith(character.get("ctdbs_kith"));
        }
    } );
    return Collection;

} );