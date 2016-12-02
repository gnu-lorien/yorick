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
    "../helpers/PromiseFailReport",
    "../helpers/ExpirationMixin",
    "../helpers/UserWreqr",
    "../models/FauxSimpleTrait",
    "../collections/Approvals",
    "../models/Approval"
], function( _, $, Parse, SimpleTrait, VampireChange, VampireCreation, VampireChangeCollection, ExperienceNotationCollection, ExperienceNotation, BNSMETV1_VampireCosts, PromiseFailReport, ExpirationMixin, UserChannel, FauxSimpleTrait, Approvals, Approval ) {

    // The Model constructor
    var instance_methods = _.extend({
        remove_trait: function (trait) {
            var self = this;
            return trait.destroy().then(function () {
                var en_options = {
                    alteration_spent: (trait.get("cost") || 0) * -1,
                    reason: "Removed " + trait.get("name"),
                };
                self.remove(trait.get("category"), trait);
                self.increment("change_count");
                return self.add_experience_notation(en_options);
            });
        },

        ensure_category: function(category) {
            if (!this.has(category)) {
                this.set(category, []);
            }
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

        update_trait: function(
                nameOrTrait,
                value,
                category,
                free_value,
                wait,
                experience_cost_type,
                experience_cost_modifier) {
            var self = this;
            var modified_trait, name, serverData, toSave = [];
            if (!_.isString(nameOrTrait)) {
                modified_trait = nameOrTrait;
                category = modified_trait.get("category");
            } else {
                name = nameOrTrait;
            };
            if (_.isUndefined(wait)) {
                wait = true;
            }
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
                        "value": value || free_value,
                        "category": category,
                        "owner": new TempVampire({id: self.id}),
                        "free_value": free_value || 0,
                    });
                    if (experience_cost_type) {
                        modified_trait.set("experience_cost_type", experience_cost_type);
                        modified_trait.set("experience_cost_modifier", _.parseInt(experience_cost_modifier));
                    }
                }
                var cost = self.calculate_trait_cost(modified_trait);
                var spend = self.calculate_trait_to_spend(modified_trait);
                if (!_.isFinite(spend)) {
                    spend = 0;
                }
                modified_trait.set("cost", cost);
                self.increment("change_count");
                self.addUnique(category, modified_trait, {silent: true});

                var minimumPromise = self._update_creation(category, modified_trait, free_value).then(function() {
                    return self.save();
                }).then(function() {
                    if (0 != spend) {
                        return self.add_experience_notation({
                            alteration_spent: spend,
                            reason: "Update " + modified_trait.get("name") + " to " + modified_trait.get("value"),
                        });
                    }
                    return Parse.Promise.as();
                }).then(function() {
                    console.log("Finished saving character");
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
        
        unpick_text: function(target) {
            var self = this;
            self.unset(target);
            return self.save().then(function() {
                return Parse.Object.fetchAllIfNeeded([self.get("creation")]).then(function (creations) {
                    var creation = creations[0];
                    creation.set(target, false);
                    return creation.save().then(function () {
                        return Parse.Promise.as(self);
                    });
                });
            })
        },

        get_trait_by_name: function(category, name) {
            var self = this;
            var models = self.get(category);
            name = "" + name;
            var st = _.find(models, "attributes.name", name);
            return Parse.Promise.as(st, self);
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

        unpick_from_creation: function(category, picked_trait_id, pick_index, wait) {
            var self = this;
            return self.fetch_all_creation_elements().then(function() {
                return self.get_trait(category, picked_trait_id);
            }).then(function (picked_trait) {
                var picks_name = category + "_" + pick_index + "_picks";
                var remaining_name = category + "_" + pick_index + "_remaining";
                var creation = self.get("creation");
                creation.remove(picks_name, picked_trait);
                if (_.contains(self.get_sum_creation_categories(), category)) {
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
            self._addExperienceEntryWrapper = self._addExperienceEntryWrapper || Parse.Promise.as();
            
            self._addExperienceEntryWrapper = self._addExperienceEntryWrapper.always(function () {
                return self.get_experience_notations();
            }).then(function (ens) {
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
            });
            
            return self._addExperienceEntryWrapper;
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
        
        get_approvals: function () {
            var self = this;
            self._approvalsFetch = self._approvalsFetch || Parse.Promise.as();
            self._approvalsFetch = self._approvalsFetch.always(function () {
                if (_.isUndefined(self.approvals)) {
                    self.approvals = new Approvals;
                }
                var q = new Parse.Query(Approval);
                q.equalTo("owner", self);
                
                if (0 != self.approvals.length) {
                    q.greaterThan("createdAt", self.approvals.last().createdAt);
                }
                
                return q.each(function(approval) {
                    self.approvals.add(approval);
                });
            }).then(function() {
                return Parse.Promise.as(self.approvals);
            });
            return self._approvalsFetch;
        },
        
        get_transformed_last_approved: function () {
            var self = this;
            return self.get_approvals().then(function () {
                return self.get_recorded_changes();
            }).then(function () {
                var last_approved_recorded_change_id = self.approvals.last().get("change").id;
                var changesToApply = _.chain(self.recorded_changes.models).takeRightWhile(function (model) {
                    return model.id != last_approved_recorded_change_id;
                }).reverse().value();
                var c = self.get_transformed(changesToApply);
                return Parse.Promise.as(c);
            })
        },

        get_transformed: function(changes) {
            // do not define self to prevent self-modification
            // Work around oddness due to cloning relationships
            // I have to change the parent and hope nothing is still set on them
            // Relations aren't cloned properly so it's the *same* damned relation
            var mustFixBrokenRelation = !_.isUndefined(this.troupes);
            var c = this.clone();
            if (mustFixBrokenRelation) {
                this.troupes.parent = null;
            }
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
                    var trait = new FauxSimpleTrait({
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
            if (_.isUndefined(self.troupes)) {
                // Never been set up in the first place
                self.troupes = self.relation("troupes");
                self.troupes.targetClassName = "Troupe";
            } else if (_.isNull(self.troupes.parent)) {
                // Was trickily overwritten for the sake of get_transformed
                self.troupes.parent = self;
            }
            var q = self.troupes.query();
            return q.each(function (troupe) {
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
                delete self.attributes.troupes;
                delete self.troupes;
                delete self._previousAttributes.troupes;
                delete self._serverData.troupes;
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
                self.progress("Finishing up!");
                return Parse.Promise.as(self);
            });
        },

        join_troupe: function(troupe) {
            var self = this;
            return self.initialize_troupe_membership().then(function () {
                self.troupes.add(troupe);
                self.troupe_ids.push(troupe.id);
                return self.update_troupe_acls();
            });
        },

        leave_troupe: function(troupe) {
            var self = this;
            return self.initialize_troupe_membership().then(function () {
                self.troupes.remove(troupe);
                self.troupe_ids = _.remove(self.troupe_ids, troupe.id);
                return self.update_troupe_acls();
            });
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
        }
    }, ExpirationMixin );

    var Model = Parse.Object.extend("Vampire", instance_methods);

    // Returns the Model class
    return Model;

} );