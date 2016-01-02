// Category Model
// ==============

// Includes file dependencies
define([
    "underscore",
	"jquery",
	"parse",
    "../models/SimpleTrait",
    "../models/VampireChange",
    "../models/VampireCreation",
    "../collections/VampireChangeCollection",
    "../collections/ExperienceNotationCollection",
    "../models/ExperienceNotation",
    "../helpers/BNSMETV1_VampireCosts",
], function( _, $, Parse, SimpleTrait, VampireChange, VampireCreation, VampireChangeCollection, ExperienceNotationCollection, ExperienceNotation, BNSMETV1_VampireCosts ) {

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

        _update_creation: function(category, modified_trait, freeValue) {
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
                creation.addUnique(listName, modified_trait);
                if (_.contains(["merits", "flaws"], category)) {
                    var sum = _.sum(creation.get(listName), "attributes.value");
                    creation.set(stepName, 7 - sum);
                } else {
                    creation.increment(stepName, -1);
                }
                return Parse.Promise.as(self);
            })
        },

        get_me_acl: function () {
            var acl = new Parse.ACL;
            acl.setPublicReadAccess(false);
            acl.setPublicWriteAccess(false);
            acl.setWriteAccess(Parse.User.current(), true);
            acl.setReadAccess(Parse.User.current(), true);
            return acl;
        },

        get_category_for_fetch: function(category) {
            var self = this;
            var cat = self.get(category);
            return _.filter(cat, function(e) {
                return !_.isUndefined(e.id);
            });
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
            return Parse.Object.fetchAllIfNeeded(self.get_category_for_fetch(category)).then(function() {
                if (!_.isString(nameOrTrait)) {
                    if (!_.contains(self.get(category), modified_trait)) {
                        throw "Provided trait not already in Vampire as expected";
                    }
                } else {
                    modified_trait = new SimpleTrait;
                    _.each(self.get(category), function (st) {
                        if (_.isEqual(st.get("name"), name)) {
                            modified_trait = st;
                        }
                    });
                    modified_trait.setACL(self.get_me_acl());
                    var TempVampire = Parse.Object.extend("Vampire");
                    modified_trait.set({"name": name,
                        "value": freeValue || value,
                        "category": category,
                        "owner": new TempVampire({id: self.id}),
                        "free_value": freeValue
                    });
                }
                var cost = self.calculate_trait_cost(modified_trait);
                modified_trait.set("cost", cost);
                self.increment("change_count");
                self.addUnique(category, modified_trait);

                var minimumPromise = self._update_creation(category, modified_trait, freeValue).then(function() {
                    return self.save();
                }).then(function() {
                    console.log("Finished saving vampire");
                    return Parse.Promise.as(self);
                }).fail(function (error) {
                    console.log("Failed to save vampire because of " + error.message);
                })
                var returnPromise;
                if (wait) {
                    returnPromise = minimumPromise;
                } else {
                    returnPromise = Parse.Promise.as(self);
                }
                return returnPromise.then(function () {
                    self.trigger("change:" + category);
                    return Parse.Promise.as(modified_trait, self);
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
            }).fail(function (error) {
                console.log("Error received when updating text" + error.message);
            })
        },

        get_trait: function(category, id) {
            var self = this;
            var models = self.get(category);
            if (_.isObject(id)) {
                id = id.id || id.cid;
            }
            var st = _.findWhere(models, {cid: id});
            if (st) {
                return Parse.Promise.as(st, self);
            }
            st = _.findWhere(models, {id: id});
            try {
                var p = Parse.Object.fetchAllIfNeeded([st]);
            } catch (e) {
                if (e instanceof TypeError) {
                    console.log("Caught a typeerror indicating this object is still saving " + e.message);
                    console.log(JSON.stringify(st));
                    console.log(JSON.stringify(models));
                    return st.save().then(function (st) {
                        return Parse.Promise.as(st, self);
                    })
                } else {
                    return Parse.Promise.reject(e);
                }
            }
            return p.then(function (traits) {
                return Parse.Promise.as(traits[0], self);
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
                "disciplines_1_remaining": 2,
                "attributes_7_remaining": 1,
                "attributes_5_remaining": 1,
                "attributes_3_remaining": 1,
                "focus_mentals_1_remaining": 1,
                "focus_socials_1_remaining": 1,
                "focus_physicals_1_remaining": 1,
                "merits_0_remaining": 7,
                "flaws_0_remaining": 7,
                "phase_1_finished": false,
                "initial_xp": 30,
                "phase_2_finished": false,
            });
            return creation.save().then(function (newCreation) {
                self.set("creation", newCreation);
                self.set("experience_spent", 0);
                self.set("experience_earned", newCreation.get("initial_xp"));
                return self.save();
            }).then(function (c) {
                return self.add_experience_notation({
                    reason: "Character Creation XP",
                    alteration_earned: 30,
                    earned: 30});
            }).then(function (en) {
                return Parse.Promise.as(self);
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

        all_simpletrait_categories: function () {
            return [
                ["attributes", "Attributes"],
                ["paths", "Path of Enlightenment/Humanity"],
                ["health_levels", "Health Levels"],
                ["skills", "Skills"],
                ["focus_mentals", "Mental Focus"],
                ["focus_physicals", "Physical Focus"],
                ["focus_socials", "Social Focus"],
                ["backgrounds", "Backgrounds"],
                ["disciplines", "Disciplines"],
                ["techniques", "Techniques"],
                ["elder_disciplines", "Elder Disciplines"],
                ["flaws", "Flaws"],
                ["merits", "Merits"],
                ["haven_specializations", "Haven Specializations"],
                ["lore_specializations", "Lore Specializations"],
                ["academics_specializations", "Academics Specializations"],
                ["drive_specializations", "Drive Specializations"],
                ["contacts_specializations", "Contacts Specializations"],
                ["allies_specializations", "Allies Specializations"],
                ["rituals", "Rituals"],
                ["sabbat_rituals", "Sabbat Ritae"],
                ["vampiric_texts", "Vampiric Texts"],
                ["linguistics_specializations", "Languages"],
                ["influence_elite_specializations", "Influence: Elite"],
                ["influence_underworld_specializations", "Influence: Underworld"],
                ["status_traits", "Sect Status"]];
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
                    var sum = _.sum(creation.get(picks_name), "attributes.value");
                    creation.set(remaining_name, 7 - sum);
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

        _raw_generation: function() {
            var self = this;
            var generation;
            _.each(self.get("backgrounds"), function(b) {
                if (b.get("name") == "Generation") {
                    generation = b.get("value");
                }
            });

            return generation;
        },

        generation: function() {
            return this._raw_generation() || 1;
        },

        has_generation: function() {
            return !_.isUndefined(this._raw_generation());
        },

        morality_merit: function() {
            var self = this;
            var morality = "Humanity";
            _.each(self.get("merits"), function (m) {
                if (_.startsWith(m.get("name"), "Path of")) {
                    var words = _.words(m.get("name"));
                    morality = _.slice(words, 2);
                    morality = morality.join(" ");
                }
            });
            return morality;
        },

        morality: function() {
            var self = this;
            if (!self.has("paths")) {
                return new SimpleTrait;
            }
            var p = self.get("paths")[0];
            if (!p) {
                return new SimpleTrait({'name': "Humanity", "value": 1});
            }
            return p;
        },

        health_levels: function() {
            var self = this;
            var health_levels_order = ["Healthy", "Injured", "Incapacitated"];
            var health_levels = {};
            var ret = [];
            _.each(self.get("health_levels"), function (hl) {
                health_levels[hl.get("name")] = hl.get("value");
            });
            _.each(health_levels_order, function (n) {
                ret.push([n, health_levels[n]]);
            })
            return ret;
        },

        experience_available: function() {
            var self = this;
            return self.get("experience_earned") - self.get("experience_spent");
        },

        get_experience_notations: function(register) {
            var self = this;

            if (!_.isUndefined(self.experience_notations)) {
                if (register) {
                    register(self.experience_notations);
                }
                return Parse.Promise.as(self.experience_notations);
            }

            self.experience_notations = new ExperienceNotationCollection;
            self.experience_notations.on("change", self.update_experience_notation, self);
            if (register) {
                register(self.experience_notations);
            }
            return self.fetch_experience_notations();
        },

        fetch_experience_notations: function () {
            var self = this;
            var q = new Parse.Query(ExperienceNotation);
            q.equalTo("owner", self).addDescending("entered").addDescending("createdAt");
            self.experience_notations.query = q;
            return self.experience_notations.fetch({reset: true});
        },

        update_experience_notation: function(en, changes, options) {
            var self = this;
            var propagate = false;
            var propagate_slice;
            var return_promise = Parse.Promise.as([]);
            options = options || {};
            var c = changes.changes;
            if (c.entered) {
                var current_index = self.experience_notations.indexOf(en);
                self.experience_notations.sort();
                var new_index = self.experience_notations.indexOf(en);
                // Force the change logic to update these values for the new right
                c.alteration_earned = true;
                c.alteration_spent = true;
                propagate = true;
                // TODO: Find a smarter way to know how many entries moved as a result of the sort
                propagate_slice = self.experience_notations.models.slice(0, _.max([current_index, new_index]) + 2);
            }
            if (c.alteration_earned || c.alteration_spent) {
                propagate = true;
            }
            if (c.alteration_earned || c.earned) {
                var changed_index = self.experience_notations.indexOf(en);
                var right_index = changed_index + 1;
                var right = self.experience_notations.at(right_index);
                var right_earned = right ? right.get("earned") : 0;
                en.set("earned", right_earned + en.get("alteration_earned"), {silent: true});
            }
            if (c.alteration_spent || c.spent) {
                var changed_index = self.experience_notations.indexOf(en);
                var right_index = changed_index + 1;
                var right = self.experience_notations.at(right_index);
                var right_spent = right ? right.get("spent") : 0;
                en.set("spent", right_spent + en.get("alteration_spent"), {silent: true});
            }
            if (propagate) {
                self.trigger("begin_experience_notation_propagation");
                var changed_index = self.experience_notations.indexOf(en);
                propagate_slice = propagate_slice || self.experience_notations.models.slice(0, changed_index + 1);

                console.log("Propagating changes requires " + propagate_slice.length + " changes");
                var trigger_c = {changes: {earned: true, spent: true}};
                _.eachRight(propagate_slice, function (elem, i) {
                    self.update_experience_notation(elem, trigger_c, {norender: true});
                });
                return_promise = Parse.Object.saveAll(propagate_slice).then(function () {
                    var first = _.first(self.experience_notations.models);
                    var changed;
                    _.each(["earned", "spent"], function (t) {
                        if (first.get(t) != self.get("experience_" + t)) {
                            self.set("experience_" + t, first.get(t));
                            changed = true;
                        }
                    });
                    if (changed) {
                        return self.save();
                    } else {
                        return Parse.Promise.as(self);
                    }
                });
            }
            if (!options.norender) {
                return return_promise.then(function () {
                    self.trigger("finish_experience_notation_propagation");
                });
            } else {
                return self;
            }
        },

        add_experience_notation: function(options) {
            var self = this;
            return self.get_experience_notations().then(function (ens) {
                var properties = _.defaults(options || {}, {
                    entered: new Date,
                    reason: "Unspecified reason",
                    earned: 0,
                    spent: 0,
                    alteration_earned: 0,
                    alteration_spent: 0,
                    owner: self});
                var en = new ExperienceNotation(properties);
                en.setACL(self.get_me_acl());
                ens.add(en);
                return en.save();
            })
        },

        get_recorded_changes: function(register) {
            var self = this;

            if (!_.isUndefined(self.recorded_changes)) {
                return Parse.Promise.as(self.recorded_changes);
            }

            self.recorded_changes = new VampireChangeCollection;
            self.on("saved", self.fetch_recorded_changes, self);
            if (register) {
                register(self.recorded_changes);
            }
            return self.fetch_recorded_changes();
        },

        fetch_recorded_changes: function() {
            var self = this;
            var q = new Parse.Query(VampireChange);
            q.equalTo("owner", self).addAscending("createdAt").limit(1000);
            self.recorded_changes.query = q;
            console.log("Resetting recorded changes");
            return self.recorded_changes.fetch({reset: true});
        },

        calculate_trait_cost: function(trait) {
            var self = this;
            return self.VampireCosts.calculate_trait_cost(self, trait);
        },

        calculate_total_cost: function() {
            var self = this;
            var current_categories = [
                "skills",
                "backgrounds",
                "disciplines",
                "attributes",
                "merits",
                "rituals",
                "techniques",
                "elder_disciplines",
                ];
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
        },

        get_transformed: function(changes) {
            // do not define self to prevent self-modification
            if (0 == changes.length) {
                return null;
            }
            var c = this.clone();
            _.each(changes, function(change) {
                if (change.get("category") != "core") {
                    // Find current
                    var category = change.get("category");
                    var current = _.find(c.get(category), function (st) {
                        if (_.isUndefined(st)) {
                            console.log("Something went wrong fetching the full character object and now a name is undefined");
                        }
                        return _.isEqual(st.get("name"), change.get("name"));
                    });
                    // Create fake
                    var trait = new SimpleTrait({
                        "name": change.get("old_text") || change.get("name"),
                        "free_value": change.get("free_value"),
                        "value": change.get("old_value") || change.get("value"),
                        "cost": change.get("old_cost") || change.get("cost"),
                    });
                    if (change.get("type") == "update") {
                        c.set(category, _.xor(c.get(category), [current, trait]));
                    } else if (change.get("type") == "define") {
                        c.set(category, _.without(c.get(category), current));
                    } else if (change.get("type") == "remove") {
                        c.set(category, _.union(c.get(category), [trait]));
                    }
                } else {
                    if (change.get("type") == "core_define") {
                        c.set(change.get("name"), undefined);
                    } else if (change.get("type") == "core_update") {
                        c.set(change.get("name"), change.get("old_text"));
                    }
                }
            })
            return c;
        },

        max_trait_value: function(trait) {
            var self = this;
            if (trait.get("category") == "skills") {
                return 10;
            };

            return 20;
        },

        get_sorted_skills: function() {
            var self = this;
            var sortedSkills = self.get("skills");
            sortedSkills = _.sortBy(sortedSkills, "attributes.name");
            sortedSkills = _.map(sortedSkills, function (skill) {
                var name = skill.get("name");
                if (-1 == name.indexOf(":")) {
                    return name + " x" + skill.get("value");
                } else {
                    var rootName = name.slice(0, name.indexOf(':'));
                    var rightName = name.slice(name.indexOf(':'));
                    return rootName + " x" + skill.get("value") + rightName;
                }
            });
            return sortedSkills;
        },

        get_grouped_skills: function(sortedSkills, columnCount) {
            var self = this;
            var sortedSkills = sortedSkills || self.get_sorted_skills();
            var columnCount = columnCount || 3;
            var groupedSkills = {0: [], 1: [], 2: []};
            var shiftAmount = _.ceil(sortedSkills.length / columnCount);
            _.each(_.range(columnCount), function (i) {
                groupedSkills[i] = _.take(sortedSkills, shiftAmount);
                sortedSkills = _.drop(sortedSkills, shiftAmount);
            });
            groupedSkills = _.zip(groupedSkills[0], groupedSkills[1], groupedSkills[2]);
            return groupedSkills;
        },

        initialize_vampire_costs: function() {
            var self = this;
            if (_.isUndefined(self.VampireCosts)) {
                self.VampireCosts = new BNSMETV1_VampireCosts;
                return self.VampireCosts.initialize().then(function () {
                    return Parse.Promise.as(self);
                });
            }
            return Parse.Promise.as(self);
        }
    } );

    Model.get_character = function(id, categories, character_cache) {
        if (_.isUndefined(character_cache)) {
            character_cache = {_character: null};
        }
        categories = categories || [];
        if (_.isString(categories)) {
            categories = [categories];
        }
        if (character_cache._character === null) {
            var q = new Parse.Query(Model);
            q.equalTo("owner", Parse.User.current());
            return q.get(id).then(function(m) {
                character_cache._character = m;
                return Model.get_character(id, categories, character_cache);
            });
        }
        if (character_cache._character.id != id) {
            return character_cache._character.save().then(function() {
                character_cache._character = null;
                return Model.get_character(id, categories, character_cache);
            })
        }
        if (categories == "all") {
            categories = _.result(character_cache._character, "all_simpletrait_categories", []);
            categories = _.map(categories, function (e) {
                return e[0];
            })
        }
        if (0 !== categories.length) {
            var objectIds = _.chain(categories).map(function(category) {
                return character_cache._character.get(category);
            }).flatten().without(undefined).filter(function(id) {
                return id.id;
            }).value();

            return Parse.Object.fetchAllIfNeeded(objectIds).done(function () {
                return Model.get_character(id, [], character_cache);
            });
        }
        /* FIXME: Hack to inject something that should be created with the character */
        return character_cache._character.ensure_creation_rules_exist().then(function (c) {
            return character_cache._character.initialize_vampire_costs();
        });
    };

    Model.create = function(name) {
        var v = new Model;
        var acl = new Parse.ACL;
        acl.setPublicReadAccess(false);
        acl.setPublicWriteAccess(false);
        acl.setWriteAccess(Parse.User.current(), true);
        acl.setReadAccess(Parse.User.current(), true);
        v.setACL(acl);
        return v.save({name: name, owner: Parse.User.current(), change_count: 0});
    };

    Model.create_test_character = function(nameappend) {
        var v = new Model;
        var nameappend = nameappend || "";
        var name = "karmacharactertest" + nameappend + Math.random().toString(36).slice(2);
        var acl = new Parse.ACL;
        acl.setPublicReadAccess(false);
        acl.setPublicWriteAccess(false);
        acl.setWriteAccess(Parse.User.current(), true);
        acl.setReadAccess(Parse.User.current(), true);
        v.setACL(acl);
        return v.save({name: name, owner: Parse.User.current(), change_count: 0});
    };

    // Returns the Model class
    return Model;

} );