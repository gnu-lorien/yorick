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
            return self.save().then(function () {
                // Injected server side beforeSave
                var vc = new VampireChange;
                vc.set({
                    "name": trait.get("name"),
                    "category": trait.get("category"),
                    "owner": self,
                    "old_value": serverData.value,
                    "type": "remove"
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

                // Injected server side beforeSave
                var vc = new VampireChange;
                vc.set({
                    "name": st.get("name"),
                    "category": st.get("category"),
                    "owner": self,
                    "old_value": serverData.value,
                    "value": st.get("value"),
                    "type": serverData.value === undefined ? "define" : "update",
                    "free_value": st.get("free_value")
                });
                vc.save().then(function () {
                    console.log("Saved vc");
                }, function(error) {
                    console.log("Failed to save vc", error);
                });
                // End injected server side beforeSave

                self.addUnique(category, st);
                return self.save();
            }, function(error) {
                console.log("Error saving new trait", error);
            }).then(function () {
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
                "initial_xp": false
            });
            return creation.save().then(function (newCreation) {
                self.set("creation", newCreation);
                return self.save();
            });
        },

        is_being_created: function() {
            return !this.get("creation").get("completed");
        }

    } );

    // Returns the Model class
    return Model;

} );