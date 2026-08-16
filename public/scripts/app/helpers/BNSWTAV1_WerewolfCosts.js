// Includes file dependencies
define([
    "underscore",
    "parse",
    "backbone",
    "../models/Description"
], function( _, Parse, Backbone, Description ) {

    var Descriptions = Backbone.Collection.extend( {
        model: Description
    } );

    // Categories that genuinely cost nothing: focus tracks, expended pools,
    // skill/background specializations, and the link categories that only
    // record affinities. Listing them explicitly is what lets an *unlisted*
    // category be treated as a missing rule rather than as free - see the
    // bottom of `calculate_trait_cost` and `Character.update_trait`.
    var FREE_CATEGORIES = [
        "focus_physicals",
        "focus_mentals",
        "focus_socials",
        "health_levels",
        "willpower_sources",
        "wta_gnosis_sources",
        "lore_specializations",
        "academics_specializations",
        "drive_specializations",
        "linguistics_specializations",
        "extra_affinity_links",
        "wta_territory_specializations",
        "contacts_specializations",
        "allies_specializations",
        "influence_elite_specializations",
        "influence_underworld_specializations",
        "wta_monikers",
        "wta_totem_bonus_traits"
    ];

    var Costs = Parse.Object.extend("WerewolfCosts", {
        initialize: function() {
            var self = this;
            
            self.descriptions = new Descriptions;
            
            var q = new Parse.Query(Description).equalTo("category", "wta_gifts");
            return q.each(function (d) {
                self.descriptions.add(d);
            })
        },

        get_affinities: function(character) {
            var self = this;
            var icds = character.get_affinities();
            return icds;
        },
        
        gift_is_affinity: function(character, trait) {
            var self = this;
            // Get the trait's description
            var base_name = trait.get_base_name();
            var description = _.find(self.descriptions.models, function (d) {
                return d.get("name") == base_name;
            });
            
            if (!description) {
                return false;
            }
            
            // Get the affinities for the trait from description
            var trait_affinities = _.without(_.map(_.range(1, 4), function (i) {
                var a = description.get("affinity_" + i);
                if (a) {
                    return a;
                }
            }), undefined);
            console.log(trait_affinities);
            // Get the character affinities
            var character_affinities = self.get_affinities(character);
            // Take the union and see if it's empty
            var combined = _.intersection(trait_affinities, character_affinities);
            
            return combined.length != 0;
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

        calculate_trait_cost: function (character, trait) {
            var self = this;
            var category = trait.get("category");
            var name = trait.get("name");
            var value = trait.get("value");
            var free_value = trait.get("free_value") || 0;
            var mod_value = value - free_value;
            var experience_cost_type = trait.get("experience_cost_type");
            var experience_cost_modifier = _.parseInt(trait.get("experience_cost_modifier"));
            
            if ("flat" == experience_cost_type) {
                return mod_value * experience_cost_modifier;
            } else if ("linear" == experience_cost_type) {
                return self.get_trait_cost_on_table(self.get_cost_table(experience_cost_modifier), trait);
            }

            if ("attributes" == category) {
                return mod_value * 3;
            }

            if ("wta_gifts" == category) {
                if (self.gift_is_affinity(character, trait)) {
                    return mod_value * 4;
                } else {
                    return mod_value * 6;
                }
            }

            if ("wta_merits" == category) {
                return mod_value;
            }

            if ("wta_flaws" == category) {
                return mod_value * -1;
            }
            
            if ("wta_backgrounds" == category) {
                return self.get_trait_cost_on_table(self.get_cost_table(2), trait);
            }

            // Rites are the Werewolf analogue of the Vampire's Rituals, which
            // this codebase prices at 2 experience per level
            // (BNSMETV1_VampireCosts, "rituals"), and the model already files
            // them under the same print section as Backgrounds. Before this
            // branch existed the cost resolved to `undefined` and
            // `Character.update_trait`'s `_.isFinite` guard zeroed it, so
            // every Rite was silently free.
            if ("wta_rites" == category) {
                return mod_value * 2;
            }

            var rank = character.rank();

            if ("skills" == category) {
                var skill_ct;
                if (rank >= 3) {
                    skill_ct = self.get_cost_table(2);
                } else {
                    skill_ct = self.get_cost_table(1);
                }
                return self.get_trait_cost_on_table(skill_ct, trait);
            }

            if (_.contains(FREE_CATEGORIES, category)) {
                return 0;
            }

            // Deliberately `undefined`, not 0: there is no rule for this
            // category, which is a different thing from a rule that says
            // "free". `Character.update_trait` turns this into a visible
            // refusal rather than a silent giveaway.
            return undefined;
        }
    });

    return Costs;
} );
