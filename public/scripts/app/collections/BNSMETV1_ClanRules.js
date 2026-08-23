// Category Collection
// ===================

// Includes file dependencies
define([
    "underscore",
	"parse",
	"../models/BNSMETV1_ClanRule" ], function( _, Parse, ClanRule ) {

    // Every clan rule, not the server's default first page.
    //
    // The whole ruleset has to be in hand for `get_in_clan_disciplines` to
    // answer correctly: a clan whose rule fell off the end of the page reads
    // as "no rule", which prices its in-clan disciplines at the out-of-clan
    // rate. That surfaces as characters being over-charged experience, not as
    // an error anywhere.
    //
    // With no `query` set, `Parse.Collection.prototype.fetch` builds a bare
    // `new Parse.Query(this.model)` and `find()` caps at 100. There are 42
    // rules on the running server today, so nothing is lost yet - which is
    // exactly why this is worth fixing before the set grows.
    var CLAN_RULE_FETCH_LIMIT = 1000;

    var Collection = Parse.Collection.extend( {
        model: ClanRule,
        initialize: function() {
            var self = this;
            self.query = new Parse.Query(self.model);
            self.query.limit(CLAN_RULE_FETCH_LIMIT);
        },
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