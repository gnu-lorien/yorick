// Includes file dependencies
define([
    "underscore",
    "parse",
    "../collections/BNSMETV1_ClanRules",
], function( _, Parse, BNSMETV1_ClanRules ) {

    var VampireCosts = Parse.Object.extend("VampireCosts", {
        initialize: function() {
            var self = this;
            self.ClanRules = new BNSMETV1_ClanRules;
            return self.ClanRules.fetch();
        },

        discipline_is_in_clan: function(character, trait) {
            var self = this;
            var icd = self.ClanRules.get_in_clan_disciplines(character);
            if ([] == icd) {
                return false;
            }
            return _.contains(icd, trait.get_base_name());
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

        get_generation_cost: function(trait) {
            var self = this;
            var s = [1];
            return _(s).concat(self.get_cost_table(2)).value();
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

            if ("disciplines" == category && self.discipline_is_in_clan(character, trait)) {
                return self.get_trait_cost_on_table(self.get_cost_table(3), trait);
            }

            if ("humanity" == category) {
                return mod_value * 10;
            }

            /* Merits can have a "free" value if they're given by some other merit */
            if ("merits" == category) {
                return mod_value;
            }

            if ("rituals" == category) {
                return mod_value * 2;
            }

            var generation = character.generation();

            var background_ct, skill_ct, ooc_discipline_ct;
            var technique_cost = 9999,
                ic_elder_cost = 99999,
                ooc_elder_cost = 99999;

            if ("backgrounds" == category) {
                if (name == "Generation") {
                    background_ct = self.get_generation_cost();
                } else if (generation == 1) {
                    background_ct = self.get_cost_table(1);
                } else {
                    background_ct = self.get_cost_table(2);
                }
                return self.get_trait_cost_on_table(background_ct, trait);
            }

            if ("skills" == category) {
                if (generation == 1) {
                    skill_ct = self.get_cost_table(1);
                } else {
                    skill_ct = self.get_cost_table(2);
                }
                return self.get_trait_cost_on_table(skill_ct, trait);
            }

            if ("disciplines" == category) {
                // Must be OOC to have gotten this far
                if (generation < 5) {
                    ooc_discipline_ct = self.get_cost_table(4);
                } else {
                    ooc_discipline_ct = self.get_cost_table(5);
                }
                return self.get_trait_cost_on_table(ooc_discipline_ct, trait);
            }

            if ("techniques" == category) {
                if (generation < 3) {
                    technique_cost = 12;
                } else if (generation == 3) {
                    technique_cost = 20;
                }
                return mod_value * technique_cost;
            }

            if ("elder_disciplines" == category) {
                if (generation >= 3) {
                    ic_elder_cost = 18;
                }
                if (generation == 5) {
                    ooc_elder_cost = 30;
                } else if (generation >= 3) {
                    ooc_elder_cost = 30;
                }
                if (self.discipline_is_in_clan(character, trait)) {
                    return mod_value * ic_elder_cost;
                } else {
                    return mod_value * ooc_elder_cost;
                }
            }

        }
    });

    return VampireCosts;
} );
