// Includes file dependencies
define([
    "underscore",
    "parse",
    "../collections/BNSCTDBS_KithRules"
], function( _, Parse, BNSCTDBS_KithRules ) {

    // See BNSWTAV1_WerewolfCosts for why this list exists: categories that
    // genuinely cost nothing, so that an *unlisted* category can be treated
    // as a missing rule rather than as free.
    var FREE_CATEGORIES = [
        "focus_physicals",
        "focus_mentals",
        "focus_socials",
        "health_levels",
        "willpower_sources",
        "lore_specializations",
        "academics_specializations",
        "drive_specializations",
        "linguistics_specializations",
        "ctdbs_arts_affinities_links",
        "ctdbs_holdings_specializations",
        "contacts_specializations",
        "allies_specializations",
        "influence_elite_specializations",
        "influence_underworld_specializations"
    ];

    var ChangelingBetaSliceCosts = Parse.Object.extend("ChangelingBetaSliceCosts", {
        initialize: function() {
            var self = this;

            self.KithRules = new BNSCTDBS_KithRules;
            return self.KithRules.fetch().then(function () {
                return Parse.Promise.as(self);
            })
        },

        get_arts_affinities: function(character) {
            var self = this;
            var icds = self.KithRules.get_arts_affinities(character);
            var eicds = _.map(character.get('ctdbs_arts_affinities_links'), "attributes.name");
            icds = [].concat(icds, eicds);
            return icds;
        },

        get_arts_affinities_for_kith: function(kith) {
            var self = this;
            var icds = self.KithRules.get_arts_affinities_for_kith(kith);
            return icds;
        },

        art_is_affinity: function(character, trait) {
            var self = this;
            var icds = self.get_arts_affinities(character);
            if ([] == icds) {
                return false;
            }
            return _.any(icds, function (icd) {
                // Need to check if an in-clan includes a specialized name
                if (_.eq(icd, trait.get_base_name())) {
                    return true;
                }
                if (_.eq(icd, trait.get("name"))) {
                    return true;
                }
                return false;
            });
        },

        get_cost_table: function(cost_per_entry) {
            return _.map(_.range(1, 10), function(i) {
                return i * cost_per_entry;
            });
        },

        get_cost_on_table: function(ct, value) {
            return _.chain(ct).take(value).sum().value();
        },

        get_trait_cost_on_table: function(ct, trait) {
            var self = this;
            var value = trait.get("value");
            var free_value = trait.get("free_value") || 0;
            var total_cost = self.get_cost_on_table(ct, value);
            var free_cost = self.get_cost_on_table(ct, free_value);
            return total_cost - free_cost;
        },

        get_generation_cost_table: function() {
            var self = this;
            var ct = self.get_cost_table(2);
            ct[0] = 1;
            return ct;
        },

        calculate_trait_cost: function (character, trait) {
            var self = this;
            var category = trait.get("category");
            var name = trait.get("name");
            var value = trait.get("value");
            var free_value = trait.get("free_value") || 0;
            var mod_value = value - free_value;

            if ("attributes" == category) {
                return mod_value * 3;
            }

            if ("ctdbs_arts" == category) {
                if (self.art_is_affinity(character, trait)) {
                    return self.get_trait_cost_on_table(self.get_cost_table(4), trait);
                } else {
                    return self.get_trait_cost_on_table(self.get_cost_table(6), trait);
                }
            }

            /* Merits can have a "free" value if they're given by some other merit */
            if ("ctdbs_merits" == category) {
                return mod_value;
            }

            if ("ctdbs_flaws" == category) {
                return mod_value * -1;
            }
            
            // "backgrounds" is the Vampire/Werewolf spelling and is not in
            // this venue's category list at all; `ctdbs_backgrounds` is the
            // one Changelings actually use, and it had no branch, so every
            // Background purchase resolved to the `return 0` fallthrough at
            // the bottom and cost nothing. Both spellings are priced on the
            // same 2-per-level table the other two venues use.
            if ("backgrounds" == category || "ctdbs_backgrounds" == category) {
                return self.get_trait_cost_on_table(self.get_cost_table(2), trait);
            }

            var seeming = character.seeming();

            if ("skills" == category) {
                var skill_ct;
                if (seeming < 3) {
                    skill_ct = self.get_cost_table(1);
                } else {
                    skill_ct = self.get_cost_table(2);
                }
                return self.get_trait_cost_on_table(skill_ct, trait);
            }
            
            if ("ctdbs_realms" == category) {
                var realms = character.realms().length;
                return self.get_cost_on_table(self.get_cost_table(8), realms);
            }

            if (_.contains(FREE_CATEGORIES, category)) {
                return 0;
            }

            // Was `return 0`, which made every category anyone forgot to
            // price silently free - exactly how `ctdbs_backgrounds` went
            // unnoticed. Deliberately `undefined` now; `Character.update_trait`
            // turns it into a visible refusal.
            return undefined;
        }
    });

    return ChangelingBetaSliceCosts;
} );
