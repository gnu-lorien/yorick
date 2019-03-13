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
    "../helpers/BNSCTDBS_ChangelingCostsFetcher",
    "../helpers/PromiseFailReport",
    "../helpers/ExpirationMixin",
    "../helpers/UserWreqr",
    "../models/Character"
], function( _, $, Parse, SimpleTrait, VampireChange, VampireCreation, VampireChangeCollection, ExperienceNotationCollection, ExperienceNotation, BNSCTDBS_ChangelingCostsFetcher, PromiseFailReport, ExpirationMixin, UserChannel, Character ) {

    var ALL_SIMPLETRAIT_CATEGORIES = [
        ["attributes", "Attributes", "Attributes"],
        ["focus_physicals", "Physical Focus", "Attributes"],
        ["focus_mentals", "Mental Focus", "Attributes"],
        ["focus_socials", "Social Focus", "Attributes"],
        ["health_levels", "Health Levels", "Expended"],
        ["willpower_sources", "Willpower", "Expended"],
        ["skills", "Skills", "Skills"],
        ["lore_specializations", "Lore Specializations", "Skills"],
        ["academics_specializations", "Academics Specializations", "Skills"],
        ["drive_specializations", "Drive Specializations", "Skills"],
        ["linguistics_specializations", "Languages", "Skills"],
        ["ctdbs_arts", "Arts", "Arts"],
        ["ctdbs_arts_affinities_links", "Arts Affinities", "Arts"],
        ["ctdbs_realms", "Realms", "Arts"],
        ["ctdbs_backgrounds", "Backgrounds", "Backgrounds"],
        ["ctdbs_holdings_specializations", "Holdings Specializations", "Backgrounds"],
        ["contacts_specializations", "Contacts Specializations", "Backgrounds"],
        ["allies_specializations", "Allies Specializations", "Backgrounds"],
        ["influence_elite_specializations", "Influence: Elite", "Backgrounds"],
        ["influence_underworld_specializations", "Influence: Underworld", "Backgrounds"],
        ["ctdbs_merits", "Merits", "Merits and Flaws"],
        ["ctdbs_flaws", "Flaws", "Merits and Flaws"],
    ];
    
    var TEXT_ATTRIBUTES = ["archetype", "ctdbs_kith", "ctdbs_fealty_court", "ctdbs_noble_house", "ctdbs_kith_group_type", "antecedence"];
    var TEXT_ATTRIBUTES_PRETTY_NAMES = ["Archetype", "Kith", "Court", "House", function(character) { return "Group"; }, "Primary, Secondary, or NPC"];
    
    var SUM_CREATION_CATEGORIES = ["ctdbs_merits", "ctdbs_flaws"];
    
    // The Model constructor
    var instance_methods = _.extend({
        get_sum_creation_categories: function() {
            return SUM_CREATION_CATEGORIES;
        },
        update_creation_rules_for_changed_trait: function(category, modified_trait, freeValue) {
            var self = this;
            // The creation model doesn't need to change for merits without free values
            if (!_.contains(["ctdbs_merits", "ctdbs_flaws"], category)) {
                if (!freeValue) {
                    return Parse.Promise.as(self);
                }
            }
            /* FIXME Move to the creation model */
            if (!_.contains(["ctdbs_flaws", "ctdbs_merits", "focus_mentals", "focus_physicals", "focus_socials", "attributes", "skills", "ctdbs_arts", "ctdbs_backgrounds"], category)) {
                return Parse.Promise.as(self);
            }
            return Parse.Object.fetchAllIfNeeded([self.get("creation")]).then(function (creations) {
                var creation = creations[0];
                var stepName = category + "_" + freeValue + "_remaining";
                var listName = category + "_" + freeValue + "_picks";
                creation.addUnique(listName, modified_trait);
                if (_.contains(["ctdbs_merits", "ctdbs_flaws"], category)) {
                    var sum = _.sum(creation.get(listName), "attributes.value");
                    creation.set(stepName, 7 - sum);
                } else {
                    creation.increment(stepName, -1);
                }
                return Parse.Promise.as(self);
            })
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
                "ctdbs_backgrounds_3_remaining": 1,
                "ctdbs_backgrounds_2_remaining": 1,
                "ctdbs_backgrounds_1_remaining": 1,
                "attributes_7_remaining": 1,
                "attributes_5_remaining": 1,
                "attributes_3_remaining": 1,
                "ctdbs_arts_1_remaining": 3,
                "focus_mentals_1_remaining": 1,
                "focus_socials_1_remaining": 1,
                "focus_physicals_1_remaining": 1,
                "ctdbs_merits_0_remaining": 7,
                "ctdbs_flaws_0_remaining": 7,
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
                var listCategories = ["ctdbs_flaws", "ctdbs_merits", "focus_mentals", "focus_physicals", "focus_socials", "attributes", "skills", "ctdbs_backgrounds", "ctdbs_arts"];
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

        all_simpletrait_categories: function() {
            return ALL_SIMPLETRAIT_CATEGORIES;
        },
        
        all_text_attributes: function() {
            return TEXT_ATTRIBUTES;
        },
        
        all_text_attributes_pretty_names: function() {
            return TEXT_ATTRIBUTES_PRETTY_NAMES;
        },
 
        _raw_seeming: function() {
            var self = this;
            var seeming;
            _.each(self.get("ctdbs_backgrounds"), function(b) {
                if (b.get_base_name() == "Seeming") {
                    seeming = b.get("value");
                }
            });

            return seeming;
        },

        seeming: function() {
            return this._raw_seeming() || 0;
        },

        has_seeming: function() {
            return !_.isUndefined(this._raw_seeming());
        },
        
        realms: function() {
            var self = this;
            return self.get("ctdbs_realms");
        },
 
        calculate_trait_cost: function(trait) {
            var self = this;
            return self.Costs.calculate_trait_cost(self, trait);
        },

        calculate_trait_to_spend: function(trait) {
            var self = this;
            var new_cost = self.Costs.calculate_trait_cost(self, trait);
            var old_cost = trait.get("cost") || 0;
            return new_cost - old_cost;
        },

        calculate_total_cost: function() {
            var self = this;
            var current_categories = [
                "skills",
                "ctdbs_backgrounds",
                "ctdbs_arts",
                "attributes",
                "ctdbs_merits"
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

        max_trait_value: function(trait) {
            var self = this;
            if (trait.get("category") == "skills") {
                return 10;
            };

            return 20;
        },

        initialize_costs: function() {
            var self = this;
            if (_.isUndefined(self.Costs)) {
                return BNSCTDBS_ChangelingCostsFetcher().then(function (costs) {
                    self.Costs = costs;
                    return Parse.Promise.as(self);
                })
            }
            return Parse.Promise.as(self);
        },
        
        get_arts_affinities: function() {
            var self = this;
            return self.Costs.get_arts_affinities(self);
        },
    }, ExpirationMixin );
    
    _.extend(instance_methods, Character);

    var Model = Parse.Object.extend("Vampire", instance_methods);

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
            q.include("ctdbs_backgrounds");
            q.include("ctdbs_arts_affinities_links");
            q.include("ctdbs_realms");
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
            return character_cache._character.initialize_costs();
        }).then(function (c) {
            return character_cache._character.initialize_troupe_membership();
        });
    };

    var progress = function(text) {
        if (_.isUndefined($) || _.isUndefined($.mobile) || _.isUndefined($.mobile.loading)) {
            console.log("Progress: " + text);
        } else {
            $.mobile.loading("show", {text: text, textVisible: true});
        }
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
        progress("Fetching patronage status");
        return UserChannel.get_latest_patronage(Parse.User.current()).then(function (patronage) {
            var changes = {
                name: name,
                type: "ChangelingBetaSlice",
                owner: Parse.User.current(),
                change_count: 0
            };
            if (patronage) {
                _.extend(changes, {expiresOn: patronage.get("expiresOn")});
            }
            progress("Saving base character");
            return v.save(changes);
        }).then(function () {
            progress("Fetching character from server");
            return Model.get_character(v.id);
        }).then(function (vampire) {
            populated_character = vampire;
            progress("Adding Healthy");
            return populated_character.update_trait("Healthy", 3, "health_levels", 3, true);
        }).then(function () {
            progress("Adding Injured");
            return populated_character.update_trait("Injured", 3, "health_levels", 3, true);
        }).then(function () {
            progress("Adding Incapacitated");
            return populated_character.update_trait("Incapacitated", 3, "health_levels", 3, true);
        }).then(function () {
            progress("Adding Willpower");
            return populated_character.update_trait("Willpower", 6, "willpower_sources", 6, true);
        }).then(function () {
            progress("Done!");
            return Parse.Promise.as(populated_character);
        });
    };

    Model.create_test_character = function(nameappend) {
        var nameappend = nameappend || "";
        var name = "karmacharactertestwerewolf" + nameappend + Math.random().toString(36).slice(2);
        return Model.create(name);
    };
    
    Model.all_simpletrait_categories = function () {
        return ALL_SIMPLETRAIT_CATEGORIES;
    };

    Model.all_text_attributes = function () {
        return TEXT_ATTRIBUTES;
    };
    
    Model.all_text_attributes_pretty_names = function () {
        return TEXT_ATTRIBUTES_PRETTY_NAMES;
    };

    // Returns the Model class
    return Model;

} );
