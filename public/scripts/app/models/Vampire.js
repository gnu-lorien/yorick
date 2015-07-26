// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse",
    "../models/SimpleTrait",
    "../models/VampireChange",
    "../models/VampireCreation"
], function( $, Parse, SimpleTrait, VampireChange, VampireCreation ) {

    // The Model constructor
    var Model = Parse.Object.extend( "Vampire", {
        remove_trait: function (trait) {
            var self = this;
            var serverData = _.clone(trait._serverData);
            self.remove(trait.get("category"), trait);
            self.increment("change_count");
            return self.save().then(function () {
                // Injected server side beforeSave
                var vc = new VampireChange;
                vc.set({
                    "name": trait.get("name"),
                    "category": trait.get("category"),
                    "owner": self,
                    "old_value": serverData.value,
                    "type": "remove",
                    "change_count": self.get("change_count")
                });
                vc.save().then(function () {
                    console.log("Saved vc");
                }, function (error) {
                    console.log("Failed to save vc", error);
                });
                // End injected server side beforeSave
                return trait.destroy({wait: true});
            });
        },
        ensure_category: function(category) {
            if (!this.has(category)) {
                this.set(category, []);
            }
        },
        update_trait: function(nameOrTrait, value, category, freeValue) {
            var self = this;
            var modified_trait, name, trait, serverData;
            if (!_.isString(nameOrTrait)) {
                trait = nameOrTrait;
                category = trait.get("category");
            } else {
                name = nameOrTrait;
            };
            self.ensure_category(category);
            return Parse.Object.fetchAllIfNeeded(self.get(category)).then(function(list) {
                if (!_.isString(nameOrTrait)) {
                    var trait = nameOrTrait;
                    if (!_.contains(list, trait)) {
                        throw "Provided trait not already in Vampire as expected";
                    }
                    serverData = _.clone(trait._serverData);
                    return trait.save();
                } else {
                    var b = new SimpleTrait;
                    _.each(self.get(category), function (st) {
                        if (_.isEqual(st.get("name"), name)) {
                            b = st;
                        }
                    });
                    b.set({"name": name,
                        "value": freeValue || value,
                        "category": category,
                        "owner": self,
                        "free_value": freeValue
                    });
                    serverData = _.clone(b._serverData);
                    return b.save();
                }
                return undefined;
            }).then(function (st) {
                modified_trait = st;
                self.increment("change_count");
                self.addUnique(category, st);
                return self.save();
            }, function(error) {
                console.log("Error saving new trait", error);
            }).then(function () {
                // Injected server side beforeSave
                // Must be here to get the new atomic value of change_count
                var vc = new VampireChange;
                vc.set({
                    "name": modified_trait.get("name"),
                    "category": modified_trait.get("category"),
                    "owner": self,
                    "old_value": serverData.value,
                    "value": modified_trait.get("value"),
                    "type": serverData.value === undefined ? "define" : "update",
                    "free_value": modified_trait.get("free_value"),
                    "change_count": self.get("change_count")
                });
                vc.save().then(function () {
                    console.log("Saved vc");
                }, function(error) {
                    console.log("Failed to save vc", error);
                });
                // End injected server side beforeSave

                if (!freeValue) {
                    return Parse.Promise.as(self);
                }
                /* FIXME Move to the creation model */
                if (!_.contains(["skills", "disciplines", "backgrounds"], category)) {
                    return Parse.Promise.as(self);
                }
                return Parse.Object.fetchAllIfNeeded([self.get("creation")]).then(function (creations) {
                    var creation = creations[0];
                    var stepName = category + "_" + freeValue + "_remaining";
                    var listName = category + "_" + freeValue + "_picks";
                    creation.increment(stepName, -1);
                    creation.addUnique(listName, modified_trait);
                    return creation.save();
                }).then(function() {
                    return Parse.Promise.as(self);
                });
            }).then(function () {
                self.trigger("change:" + modified_trait.get(category));
                return Parse.Promise.as(modified_trait);
            });
        },

        ensure_creation_rules_exist: function() {
            var self = this;
            if (self.has("creation")) {
                return Parse.Object.fetchAllIfNeeded([self.get("creation")]).then(function() {
                    return Parse.Promise.as(self);
                })
            }
            var creation = new VampireCreation({
                "owner": self,
                "completed": false,
                "concept": false,
                "archetype": false,
                "clan": false,
                "attributes": false,
                "focuses": false,
                "skills_4_remaining": 1,
                "skills_3_remaining": 2,
                "skills_2_remaining": 3,
                "skills_1_remaining": 4,
                "backgrounds_3_remaining": 1,
                "backgrounds_2_remaining": 1,
                "backgrounds_1_remaining": 1,
                "disciplines_2_remaining": 1,
                "disciplines_1_remaining": 1,
                "initial_xp": 30
            });
            return creation.save().then(function (newCreation) {
                self.set("creation", newCreation);
                return self.save();
            });
        },

        is_being_created: function() {
            return !this.get("creation").get("completed");
        },

        discipline_is_in_clan: function(trait) {
            // TODO real implementation
            return _.sample([true, false]);
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

        generation: function() {
            var self = this;
            var generation;
            _.each(self.get("backgrounds"), function(b) {
                if (b.get("name") == "Generation") {
                    generation = b.get("value");
                }
            });

            return generation;
        },

        calculate_trait_cost: function(trait) {
            var self = this;
            var category = trait.get("category");
            var value = trait.get("value");
            var free_value = trait.get("free_value") || 0;
            var mod_value = value - free_value;

            if ("attributes" == category) {
                return mod_value * 3;
            }

            if ("disciplines" == category && self.discipline_is_in_clan(trait)) {
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

            var generation = self.generation() || 1;

            var background_ct, skill_ct, ooc_discipline_ct, technique_cost, ic_elder_cost, ooc_elder_cost;

            if ("backgrounds" == category) {
                if (generation == 1) {
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
                if (self.discipline_is_in_clan(trait)) {
                    return mod_value * ic_elder_cost;
                } else {
                    return mod_value * ooc_elder_cost;
                }
            }

        },

        calculate_total_cost: function() {
            var self = this;
            var current_categories = ["skills", "backgrounds", "disciplines"];
            var response = {};
            var objectIds = _.chain(current_categories).map(function(category) {
                return self.get(category);
            }).flatten().without(undefined).value();
            return Parse.Object.fetchAllIfNeeded(objectIds).then(function (traits) {
                _.each(traits, function(trait) {
                    response[trait.get("category") + "-" + trait.get("name")] = {
                        trait: trait,
                        cost: self.calculate_trait_cost(trait)
                    };
                })
                return Parse.Promise.as(response);
            })
        }

    } );

    // Returns the Model class
    return Model;

} );