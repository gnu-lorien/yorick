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
    "../helpers/PromiseFailReport"
], function( _, $, Parse, SimpleTrait, VampireChange, VampireCreation, VampireChangeCollection, ExperienceNotationCollection, ExperienceNotation, BNSMETV1_VampireCosts, PromiseFailReport ) {

    // The Model constructor
    var Model = Parse.Object.extend( "Vampire", {
        remove_trait: function (trait) {
            var self = this;
            var en_options = {
                alteration_spent: (trait.get("cost") || 0) * -1,
                reason: "Removed " + trait.get("name"),
            };
            self.remove(trait.get("category"), trait);
            self.increment("change_count");
            trait.destroy();
            return self.add_experience_notation(en_options);
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

        get_troupe_ids: function () {
            return this.troupe_ids;
        },

        get_me_acl: function () {
            var self = this;
            var acl = new Parse.ACL;
            acl.setPublicReadAccess(false);
            acl.setPublicWriteAccess(false);
            var owner = self.get("owner");
            if (_.isUndefined(owner)) {
                acl.setReadAccess(Parse.User.current(), true);
                acl.setWriteAccess(Parse.User.current(), true);
            } else {
                acl.setReadAccess(owner, true);
                acl.setWriteAccess(owner, true);
            }
            acl.setRoleReadAccess("Administrator", true);
            acl.setRoleWriteAccess("Administrator", true);
            _.each(self.troupe_ids, function(id) {
                acl.setRoleReadAccess("LST_" + id, true);
                acl.setRoleWriteAccess("LST_" + id, true);
                acl.setRoleReadAccess("AST_" + id, true);
                acl.setRoleWriteAccess("AST_" + id, true);
            });
            return acl;
        },

        set_cached_acl: function(acl) {
            var self = this;
            acl = acl || self.get_me_acl();
            self.set("acl_to_json", JSON.stringify(acl.toJSON()));
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
                wait = true;
            } else {
                name = nameOrTrait;
            };
            self.ensure_category(category);
            return Parse.Object.fetchAllIfNeeded(self.get_category_for_fetch(category)).then(function() {
                if (!_.isString(nameOrTrait)) {
                    if (!_.contains(self.get(category), modified_trait)) {
                        return Parse.Promise.error({code:0, message:"Provided trait not already in Vampire as expected"});
                    }
                    if (modified_trait.dirty("name")) {
                        var matching_names = _.select(
                            _.without(self.get(category), modified_trait),
                            "attributes.name",
                            modified_trait.get("name"));
                        if (0 != matching_names.length) {
                            try {
                                modified_trait.set("name", modified_trait._serverData.name);
                                return Parse.Promise.error({
                                    code: 1,
                                    message: "Name matches an existing trait. Restoring original name"
                                });
                            } catch (e) {
                                 return Parse.Promise.error({
                                    code: 2,
                                    message: "Name matches an existing trait. Failed to restore original name. " + e
                                });
                            }
                        }
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
                var spend = self.calculate_trait_to_spend(modified_trait);
                if (!_.isFinite(spend)) {
                    spend = 0;
                }
                modified_trait.set("cost", cost);
                self.increment("change_count");
                self.addUnique(category, modified_trait);

                var minimumPromise = self._update_creation(category, modified_trait, freeValue).then(function() {
                    if (0 != spend) {
                        return self.add_experience_notation({
                            alteration_spent: spend,
                            reason: "Update " + modified_trait.get("name") + " to " + modified_trait.get("value"),
                        });
                    } else {
                        return self.save();
                    }
                }).then(function() {
                    console.log("Finished saving vampire");
                    return Parse.Promise.as(self);
                }).fail(function (errors) {
                    console.log("Failing to save vampire because of " + JSON.stringify(errors));
                    PromiseFailReport(errors);
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
            }).fail(PromiseFailReport)
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
                ["attributes", "Attributes", "Attributes"],
                ["paths", "Path of Enlightenment/Humanity", "Morality"],
                ["health_levels", "Health Levels", "Expended"],
                ["willpower_sources", "Willpower", "Expended"],
                ["skills", "Skills", "Skills"],
                ["focus_mentals", "Mental Focus", "Attributes"],
                ["focus_physicals", "Physical Focus", "Attributes"],
                ["focus_socials", "Social Focus", "Attributes"],
                ["backgrounds", "Backgrounds", "Backgrounds"],
                ["disciplines", "Disciplines", "Disciplines"],
                ["techniques", "Techniques", "Disciplines"],
                ["elder_disciplines", "Elder Disciplines", "Disciplines"],
                ["flaws", "Flaws", "Merits and Flaws"],
                ["merits", "Merits", "Merits and Flaws"],
                ["haven_specializations", "Haven Specializations", "Backgrounds"],
                ["lore_specializations", "Lore Specializations", "Skills"],
                ["academics_specializations", "Academics Specializations", "Skills"],
                ["drive_specializations", "Drive Specializations", "Skills"],
                ["contacts_specializations", "Contacts Specializations", "Backgrounds"],
                ["allies_specializations", "Allies Specializations", "Backgrounds"],
                ["rituals", "Rituals", "Disciplines"],
                ["sabbat_rituals", "Sabbat Ritae", "Backgrounds"],
                ["vampiric_texts", "Vampiric Texts", "Backgrounds"],
                ["linguistics_specializations", "Languages", "Skills"],
                ["influence_elite_specializations", "Influence: Elite", "Backgrounds"],
                ["influence_underworld_specializations", "Influence: Underworld", "Backgrounds"],
                ["status_traits", "Sect Status", "Backgrounds"],
                ["extra_in_clan_disciplines", "Extra In Clan Disciplines", "Disciplines"]];
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

        complete_character_creation: function() {
            var self = this;
            return self.fetch_all_creation_elements().then(function() {
                var creation = self.get("creation");
                creation.set("completed", true);
                return creation.save();
            });
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

        get_experience_notations: function(register, already_exists) {
            var self = this;

            if (!_.isUndefined(self.experience_notations)) {
                if (register) {
                    register(self.experience_notations);
                }
                if (already_exists) {
                    already_exists(self.experience_notations);
                }
                return Parse.Promise.as(self.experience_notations);
            }

            self.experience_notations = new ExperienceNotationCollection;
            self.experience_notations.on("change", self.on_update_experience_notation, self);
            self.experience_notations.on("remove", self.on_remove_experience_notation, self);
            if (register) {
                register(self.experience_notations);
            }
            return self.fetch_experience_notations();
        },

        fetch_experience_notations: function () {
            var self = this;
            self._experienceNotationsFetch = self._experienceNotationsFetch || Parse.Promise.as();
            self._experienceNotationsFetch = self._experienceNotationsFetch.always(function () {
                var q = new Parse.Query(ExperienceNotation);
                q.equalTo("owner", self).addDescending("entered").addDescending("createdAt");
                self.experience_notations.query = q;
                return self.experience_notations.fetch({reset: true});
            });
            return self._experienceNotationsFetch;
        },

        wait_on_current_experience_update: function() {
            var self = this;
            return self._propagateExperienceUpdate || Parse.Promise.as();
        },

        _finalize_triggered_experience_notation_changes: function(changed_index, ens) {
            var self = this;
            var altered_ens = self._propagate_experience_notation_change(self.experience_notations, changed_index);
            self._propagateExperienceUpdate = self._propagateExperienceUpdate || Parse.Promise.as();
            self._propagateExperienceUpdate = self._propagateExperienceUpdate.done(function() {
                return Parse.Object.saveAll(altered_ens);
            }).done(function() {
                self.trigger("finish_experience_notation_propagation");
            }).fail(function(error) {
                if (_.isArray(error)) {
                    _.each(error, function(e) {
                        console.log("Something failed" + e.message);
                    })
                } else {
                    console.log("error updating experience" + error.message);
                }
            })
            return self._propagateExperienceUpdate;
        },

        on_remove_experience_notation: function(en, ens, options) {
            var self = this;
            return self._finalize_triggered_experience_notation_changes(options.index, ens);
        },

        on_update_experience_notation: function(en, changes, options) {
            var self = this;
            var propagate = false, changed = false;
            var altered_ens, changed_index;
            var return_promise = Parse.Promise.as([]);
            options = options || {};
            var c = changes.changes;
            if (c.entered) {
                changed = true;
                self.experience_notations.sort();
            }
            if (c.alteration_earned || c.alteration_spent) {
                changed = true;
            }
            if (!changed) {
                return Parse.Promise.as([]);
            }
            changed_index = self.experience_notations.indexOf(en);
            return self._finalize_triggered_experience_notation_changes(changed_index, self.experience_notations);
        },

        _default_experience_notation: function(options) {
            var self = this;
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
            return en;
        },

        _propagate_experience_notation_change: function(experience_notations, index) {
            var self = this;
            self.trigger("begin_experience_notation_propagation");
            var initial_accumulator;
            if (index + 1 < experience_notations.models.length) {
                initial_accumulator = experience_notations.at(index + 1);
            } else {
                initial_accumulator = self._default_experience_notation();
            }
            var altered_ens = [];
            var final_en = _.reduceRight(_.slice(experience_notations.models, 0, index + 1), function(previous_en, en, index, collection) {
                var tearned = en.get("alteration_earned") + previous_en.get("earned");
                en.set("earned", tearned, {silent: true});
                var tspent = en.get("alteration_spent") + previous_en.get("spent");
                en.set("spent", tspent, {silent: true});
                altered_ens.push(en);
                return en;
            }, initial_accumulator);
            self.set("experience_earned", final_en.get("earned"));
            self.set("experience_spent", final_en.get("spent"));
            altered_ens.push(self);
            return altered_ens;
        },

        add_experience_notation: function(options) {
            var self = this;
            return self.get_experience_notations().then(function (ens) {
                var en = self._default_experience_notation(options);
                // Silence the notification
                ens.add(en, {silent: true});
                // Find the index for the new model afterward
                var index, model;
                for (var i = 0, length = ens.models.length; i < length; i++) {
                    model = ens.models[i];
                    if (ens._byCid[model.cid]) {
                        index = i;
                        break;
                    }
                }
                var altered_ens = self._propagate_experience_notation_change(ens, index);
                return Parse.Object.saveAll(altered_ens).then(function() {
                    model.trigger('add', model, ens, {index: index});
                    self.trigger("finish_experience_notation_propagation");
                });
            })
        },

        remove_experience_notation: function(models, options) {
            var self = this;
            var options, models;
            options = options || {};
            models = _.isArray(models) ? models.slice() : [models];
            var en = models[0];
            var model = en;
            return self.get_experience_notations().then(function (ens) {
                var index = ens.indexOf(en);
                // Silence the notification
                ens.remove(en, {silent: true});
                var altered_ens = self._propagate_experience_notation_change(ens, index);
                return Parse.Promise.when(en.destroy(), Parse.Object.saveAll(altered_ens)).then(function() {
                    model.trigger('remove', model, ens, {index: index});
                    self.trigger("finish_experience_notation_propagation");
                });
            })
        },

        get_recorded_changes: function(register) {
            var self = this;

            if (!_.isUndefined(self.recorded_changes)) {
                var p = self.update_recorded_changes();
                if (register) {
                    p.then(function (rc) {
                        register(rc);
                    });
                }
                return p;
            }

            self.recorded_changes = new VampireChangeCollection;
            self.on("saved", self.update_recorded_changes, self);
            //self.on("saved", self.fetch_recorded_changes, self);
            if (register) {
                register(self.recorded_changes);
            }
            return self.fetch_recorded_changes();
        },

        update_recorded_changes: function() {
            var self = this;
            if (0 == self.recorded_changes.models.length) {
                return self.fetch_recorded_changes();
            }
            self._recordedChangesFetch = self._recordedChangesFetch || Parse.Promise.as();
            self._recordedChangesFetch = self._recordedChangesFetch.always(function () {
                var lastCreated = _.last(self.recorded_changes.models).createdAt;
                var q = new Parse.Query(VampireChange);
                q.equalTo("owner", self).addAscending("createdAt").limit(1000);
                q.greaterThan("createdAt", lastCreated);
                self.recorded_changes.query = q;
                return self.recorded_changes.fetch({add: true});
            });
            return self._recordedChangesFetch;
        },

        fetch_recorded_changes: function() {
            var self = this;
            self._recordedChangesFetch = self._recordedChangesFetch || Parse.Promise.as();
            self._recordedChangesFetch = self._recordedChangesFetch.always(function () {
                console.log("Resetting recorded changes");
                var q = new Parse.Query(VampireChange);
                q.equalTo("owner", self).addAscending("createdAt").limit(1000);
                self.recorded_changes.query = q;

                return self.recorded_changes.fetch({reset: true});
            });
            return self._recordedChangesFetch;
        },

        calculate_trait_cost: function(trait) {
            var self = this;
            return self.VampireCosts.calculate_trait_cost(self, trait);
        },

        calculate_trait_to_spend: function(trait) {
            var self = this;
            var new_cost = self.VampireCosts.calculate_trait_cost(self, trait);
            var old_cost = trait.get("cost") || 0;
            return new_cost - old_cost;
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
            // Work around oddness due to cloning relationships
            // I have to change the parent and hope nothing is still set on them
            // Relations aren't cloned properly so it's the *same* damned relation
            var theRelation = this.relation("troupes");
            var c = this.clone();
            theRelation.parent = null;
            var description = [];

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
                        "category": change.get("category")
                    });
                    if (change.get("type") == "update") {
                        c.set(category, _.xor(c.get(category), [current, trait]));
                        description.push({
                            category: category,
                            name: change.get("name"),
                            fake: trait,
                            type: "changed",
                        });
                    } else if (change.get("type") == "define") {
                        c.set(category, _.without(c.get(category), current));
                        description.push({
                            category: category,
                            name: trait.get("name"),
                            fake: undefined,
                            type: "define",
                        });
                    } else if (change.get("type") == "remove") {
                        c.set(category, _.union(c.get(category), [trait]));
                        description.push({
                            category: category,
                            name: trait.get("name"),
                            fake: trait,
                            type: "removed",
                        });
                    }
                } else {
                    if (change.get("type") == "core_define") {
                        c.set(change.get("name"), undefined);
                        description.push({
                            category: change.get("category"),
                            name: change.get("name"),
                            old_text: undefined,
                            type: "define"
                        });
                    } else if (change.get("type") == "core_update") {
                        c.set(change.get("name"), change.get("old_text"));
                        description.push({
                            category: change.get("category"),
                            name: change.get("name"),
                            old_text: change.get("old_text"),
                            type: "update"
                        });
                    }

                }
            })
            c.transform_description = description;
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
        },

        get_thumbnail: function (size) {
            var self = this;
            if (self.get("portrait")) {
                var portrait = self.get("portrait");
                return portrait.fetch().then(function (portrait) {
                    console.log(self.get_thumbnail_sync(size));
                    return Parse.Promise.as(portrait.get("thumb_" + size).url());
                });
            } else {
                return Parse.Promise.as("head_skull.png");
            }
        },

        get_thumbnail_sync: function (size) {
            var self = this;
            return _.result(self, "attributes.portrait.attributes.thumb_" + size + ".url", "head_skull.png");
        },

        get_willpower_total: function() {
            var self = this;
            var wps = self.get("willpower_sources");
            var total = _.sum(wps, "attributes.value");
            return total;
        },

        archive: function() {
            var self = this;
            self.unset("owner");
            return self.save();
        },

        initialize_troupe_membership: function() {
            var self = this;
            self.troupe_ids = [];
            var troupes = self.relation("troupes");
            var q = troupes.query();
            return q.each(function(troupe) {
                self.troupe_ids.push(troupe.id);
            }).then(function () {
                return Parse.Promise.as(self);
            })
        },

        broken_update_troupe_acls: function() {
            var self = this;
            var allsts = [];
            var newACL = self.get_me_acl();
            $.mobile.loading("show", {text: "Updating character permissions", textVisible: true});
            self.set_cached_acl(newACL);
            self.setACL(newACL);
            return self.save().then(function () {
                $.mobile.loading("show", {text: "Updating trait permissions", textVisible: true});
                var q = new Parse.Query("SimpleTrait");
                q.equalTo("owner", self);
                return q.each(function (st) {
                    st.setACL(self.get_me_acl());
                    allsts.push(st)
                })
            }).then(function () {
                $.mobile.loading("show", {text: "Saving trait permissions", textVisible: true});
                return Parse.Object.saveAll(allsts);
            }).then(function () {
                $.mobile.loading("show", {text: "Fetching experience notations", textVisible: true});
                return Parse.Promise.error();
                //return self.get_experience_notations();
            }).then(function (ens) {
                $.mobile.loading("show", {text: "Updating experience notations", textVisible: true});
                ens.each(function (en) {
                    en.setACL(self.get_me_acl());
                })
                return Parse.Object.saveAll(ens.models);
            }).then(function () {
                $.mobile.loading("show", {text: "Updating server side change log", textVisible: true});
                return Parse.Cloud.run("update_vampire_change_permissions_for", {character: self.id});
            });
        },

        progress: function(text) {
            if (_.isUndefined($) || _.isUndefined($.mobile) || _.isUndefined($.mobile.loading)) {
                console.log("Progress: " + text);
            } else {
                $.mobile.loading("show", {text: text, textVisible: true});
            }
        },

        update_troupe_acls: function() {
            var self = this;
            var allsts = [];
            var newACL = self.get_me_acl();
            self.progress("Updating character permissions");
            self.set_cached_acl(newACL);
            self.setACL(newACL);
            return self.save().then(function () {
                self.progress("Updating trait permissions");
                var q = new Parse.Query("SimpleTrait");
                q.equalTo("owner", self);
                return q.each(function (st) {
                    st.setACL(self.get_me_acl());
                    allsts.push(st)
                })
            }).then(function () {
                self.progress("Saving trait permissions");
                return Parse.Object.saveAll(allsts);
            }).then(function () {
                self.progress("Fetching experience notations");
                return self.get_experience_notations();
            }).then(function (ens) {
                self.progress("Updating experience notations");
                ens.each(function (en) {
                    en.setACL(self.get_me_acl());
                })
                return Parse.Object.saveAll(ens.models);
            }).then(function () {
                self.progress("Updating server side change log");
                return Parse.Cloud.run("update_vampire_change_permissions_for", {character: self.id});
            }).then(function () {
                return Parse.Promise.as(self);
            });
        },

        join_troupe: function(troupe) {
            var self = this;
            self.relation("troupes").add(troupe);
            self.troupe_ids.push(troupe.id);
            return self.update_troupe_acls();
        },

        leave_troupe: function(troupe) {
            var self = this;
            self.relation("troupes").remove(troupe);
            self.troupe_ids = _.remove(self.troupe_ids, troupe.id);
            return self.update_troupe_acls();
        },

        get_owned_ids: function () {
            // A spiritual clone of get_expected_vampire_ids in cloud\main.js
            var self = this;
            var results = {
                SimpleTrait: [],
                ExperienceNotation: [],
                VampireChange: []
            };
            var v = self;
            return Parse.Promise.when(_.map(["SimpleTrait", "ExperienceNotation", "VampireChange"], function (class_name) {
                 var q = new Parse.Query(class_name)
                    .equalTo("owner", v)
                    .select("id");
                 return q.each(function (t) {
                     results[class_name].push(t.id);
                 })
            })).then(function () {
                return Parse.Promise.as(results);
            });
        },

        update_server_client_permissions_mismatch: function () {
            var self = this;
            self._mismatchFetch = self._mismatchFetch || Parse.Promise.as();
            self._mismatchFetch = self._mismatchFetch.always(function () {
                return Parse.Promise.when(
                    self.get_owned_ids(),
                    Parse.Cloud.run("get_expected_vampire_ids", {character: self.id}))
                    .then(function (client, server) {
                        if (_.eq(client, server)) {
                            self.is_mismatched = false;
                        } else {
                            self.is_mismatched = true;
                        }
                        return Parse.Promise.as(self);
                    })
            });
            return self._mismatchFetch;
        },
        
        check_server_client_permissions_mismatch: function () {
            if (_.isUndefined(this.is_mismatched)) {
                return this.update_server_client_permissions_mismatch();
            }
            return Parse.Promise.as(this);
        },
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
            //q.equalTo("owner", Parse.User.current());
            q.include("portrait");
            q.include("owner");
            q.include("backgrounds");
            q.include("extra_in_clan_disciplines");
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
        }).then(function (c) {
            return character_cache._character.initialize_troupe_membership();
        });
    };

    Model.create = function(name) {
        var populated_character;
        var v = new Model;
        var acl = new Parse.ACL;
        acl.setPublicReadAccess(false);
        acl.setPublicWriteAccess(false);
        acl.setWriteAccess(Parse.User.current(), true);
        acl.setReadAccess(Parse.User.current(), true);
        acl.setRoleReadAccess("Administrator", true);
        acl.setRoleWriteAccess("Administrator", true);
        v.setACL(acl);
        return v.save({name: name, owner: Parse.User.current(), change_count: 0}).then(function () {
            return Model.get_character(v.id);
        }).then(function (vampire) {
            populated_character = vampire;
            return populated_character.update_trait("Humanity", 5, "paths", 5, true);
        }).then(function () {
            return populated_character.update_trait("Healthy", 3, "health_levels", 3, true);
        }).then(function () {
            return populated_character.update_trait("Injured", 3, "health_levels", 3, true);
        }).then(function () {
            return populated_character.update_trait("Incapacitated", 3, "health_levels", 3, true);
        }).then(function () {
            return populated_character.update_trait("Willpower", 6, "willpower_sources", 6, true);
        }).then(function () {
            return Parse.Promise.as(populated_character);
        });
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