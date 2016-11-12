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
            var eicds = _.map(character.get('extra_affinity_links'), "attributes.name");
            icds = [].concat(icds, eicds);
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
                return self.get_trait_cost_on_table(self.get_cost_table(), trait);
            }

            if ("attributes" == category) {
                return mod_value * 3;
            }

            if ("wta_gifts" == category) {
                if (self.gift_is_affinity(character, trait)) {
                    return self.get_trait_cost_on_table(self.get_cost_table(4), trait);
                } else {
                    return self.get_trait_cost_on_table(self.get_cost_table(6), trait);
                }
            }

            if ("wta_merits" == category) {
                return mod_value;
            }

            if ("wta_flaws" == category) {
                return mod_value * -1;
            }
            
            if ("wta_backgrounds" == category) {
                return self.get_trait_cost_on_table(self.get_cost_on_table(2), trait);
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
        }
    });

    return Costs;
} );
