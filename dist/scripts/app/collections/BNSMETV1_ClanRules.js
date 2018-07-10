// Category Collection
// ===================

// Includes file dependencies
define([
    "underscore",
	"parse",
	"../models/BNSMETV1_ClanRule" ], function( _, Parse, ClanRule ) {

    var Collection = Parse.Collection.extend( {
        model: ClanRule,
        get_in_clan_disciplines: function(character) {
            var self = this;
            var clanName = character.get("clan");
            var rule = _.find(self.models, function (m) {
                return m.get("clan") == clanName;
            });

            if (!rule) {
                return [];
            }

            return [rule.get("discipline_1"),
                rule.get("discipline_2"),
                rule.get("discipline_3")]
        }
    } );
    return Collection;

} );