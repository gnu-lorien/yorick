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
            self.remove(trait.get("category"), trait);
            self.increment("change_count");
            trait.destroy();
            return self.save();
        },
        ensure_category: function(category) {
            if (!this.has(category)) {
                this.set(category, []);
            }
        },

        _get_creation_update: function(category, modified_trait, freeValue) {
            var self = this;
            if (!_.contains(["merits", "flaws"], category)) {
                if (!freeValue) {
                    return Parse.Promise.as(self);
                }
            }
            /* FIXME Move to the creation model */
            if (!_.contains(["flaws", "merits", "focus_mentals", "focus_physicals", "focus_socials", "attributes", "skills", "disciplines", "backgrounds"], category)) {
                return Parse.Promise.as(self);
            }
            return Parse.Object.fetchAllIfNeeded([self.get("creation")]).then(function (creations) {
                var creation = creations[0];
                var stepName = category + "_" + freeValue + "_remaining";
                var listName = category + "_" + freeValue + "_picks";
                if (_.contains(["merits", "flaws"], category)) {
                    creation.increment(stepName, -1 * modified_trait.get("value"));
                } else {
                    creation.increment(stepName, -1);
                }
                creation.addUnique(listName, modified_trait);
                return creation.save();
            })
        },

        update_trait: function(nameOrTrait, value, category, freeValue, wait) {
            var self = this;
            var modified_trait, name, serverData, toSave = [];
            if (!_.isString(nameOrTrait)) {
                modified_trait = nameOrTrait;
                category = modified_trait.get("category");
            } else {
                name = nameOrTrait;
            };
            self.ensure_category(category);
            return Parse.Object.fetchAllIfNeeded(self.get(category)).then(function(list) {
                if (!_.isString(nameOrTrait)) {
                    if (!_.contains(list, modified_trait)) {
                        throw "Provided trait not already in Vampire as expected";
                    }
                } else {
                    modified_trait = new SimpleTrait;
                    _.each(self.get(category), function (st) {
                        if (_.isEqual(st.get("name"), name)) {
                            modified_trait = st;
                        }
                    });
                    modified_trait.set({"name": name,
                        "value": freeValue || value,
                        "category": category,
                        "owner": self,
                        "free_value": freeValue
                    });
                }
                self.increment("change_count");
                self.addUnique(category, modified_trait);
                var everythingSavedPromise = Parse.Promise.when(self.save(), self._get_creation_update(category, modified_trait, freeValue));
                var returnPromise;
                if (wait) {
                    returnPromise = everythingSavedPromise;
                } else {
                    returnPromise = Parse.Promise.as(self);
                }
                return returnPromise.then(function () {
                    self.trigger("change:" + category);
                    return Parse.Promise.as(modified_trait);
                });
            });
        },

        update_text: function(target, value) {
            var self = this;
            self.set(target, value);
            return self.save().then(function() {
                return Parse.Object.fetchAllIfNeeded([self.get("creation")]).then(function (creations) {
                    var creation = creations[0];
                    if (creation.get(target)) {
                        return Parse.Promise.as(self);
                    }
                    creation.set(target, true);
                    return creation.save().then(function () {
                        return Parse.Promise.as(self);
                    });
                });
            })
        },

        get_trait: function(category, id) {
            var self = this;
            var models = self.get(category);
            var st = _.findWhere(models, {cid: id});
            if (st) {
                return Parse.Promise.as(st);
            }
            st = _.findWhere(models, {id: id});
            return Parse.Object.fetchAllIfNeeded([st]).then(function (traits) {
                return Parse.Promise.as(traits[0]);
            });
        },

        ensure_creation_rules_exist: function() {
            var self = this;
            if (self.has("creation")) {
                return Parse.Object.fetchAllIfNeeded([self.get("creation")]).then(function() {
                    return Parse.Promise.as(self);
                }, function (error) {
                    console.log("ensure_creation_rules_exist", error);
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
                "attributes_7_remaining": 1,
                "attributes_5_remaining": 1,
                "attributes_3_remaining": 1,
                "focus_mentals_1_remaining": 1,
                "focus_socials_1_remaining": 1,
                "focus_physicals_1_remaining": 1,
                "merits_0_remaining": 7,
                "flaws_0_remaining": 7,

                "initial_xp": 30
            });
            return creation.save().then(function (newCreation) {
                self.set("creation", newCreation);
                return self.save();
            });
        },

        fetch_all_creation_elements: function() {
            var self = this;
            return self.ensure_creation_rules_exist().then(function () {
                var creation = self.get("creation");
                var listCategories = ["flaws", "merits", "focus_mentals", "focus_physicals", "focus_socials", "attributes", "skills", "backgrounds", "disciplines"];
                var objectIds = [];
                _.each(listCategories, function(category) {
                    _.each(_.range(-1, 10), function(i) {
                        var gn = category + "_" + i + "_picks";
                        objectIds = _.union(creation.get(gn), objectIds);
                    });
                });
                objectIds = _.chain(objectIds).flatten().without(undefined).filter(function(id) {
                    return id.id;
                }).value();
                return Parse.Object.fetchAllIfNeeded(objectIds).then(function() {
                    return Parse.Promise.as(self);
                });
            });
        },

        unpick_from_creation: function(category, picked_trait_id, pick_index, wait) {
            var self = this;
            return self.fetch_all_creation_elements().then(function() {
                return self.get_trait(category, picked_trait_id);
            }).then(function (picked_trait) {
                var picks_name = category + "_" + pick_index + "_picks";
                var remaining_name = category + "_" + pick_index + "_remaining";
                var creation = self.get("creation");
                creation.remove(picks_name, picked_trait);
                if (_.contains(["merits", "flaws"], category)) {
                    creation.increment(remaining_name, picked_trait.get("value"));
                } else {
                    creation.increment(remaining_name, 1);
                }
                var promises = Parse.Promise.when(creation.save(), self.remove_trait(picked_trait));
                if (!wait) {
                    return Parse.Promise.as(self);
                }
                return promises.then(function () {
                    return Parse.Promise.as(self);
                })
            })
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