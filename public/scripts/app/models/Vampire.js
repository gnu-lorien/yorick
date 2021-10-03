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
    "../models/Character"
], function( _, $, Parse, SimpleTrait, VampireChange, VampireCreation, VampireChangeCollection, ExperienceNotationCollection, ExperienceNotation, BNSMETV1_VampireCosts, PromiseFailReport, ExpirationMixin, UserChannel, Character ) {

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
        ["disciplines", "Disciplines", "Disciplines"],
        ["techniques", "Techniques", "Disciplines"],
        ["elder_disciplines", "Elder Disciplines", "Disciplines"],
        ["luminary_disciplines", "Luminary Disciplines", "Disciplines"],
        ["rituals", "Rituals", "Disciplines"],
        ["extra_in_clan_disciplines", "Extra In Clan Disciplines", "Disciplines"],
        ["paths", "Path of Enlightenment/Humanity", "Morality"],
        ["backgrounds", "Backgrounds", "Backgrounds"],
        ["haven_specializations", "Haven Specializations", "Backgrounds"],
        ["contacts_specializations", "Contacts Specializations", "Backgrounds"],
        ["allies_specializations", "Allies Specializations", "Backgrounds"],
        ["sabbat_rituals", "Sabbat Ritae", "Backgrounds"],
        ["vampiric_texts", "Vampiric Texts", "Backgrounds"],
        ["influence_elite_specializations", "Influence: Elite", "Backgrounds"],
        ["influence_underworld_specializations", "Influence: Underworld", "Backgrounds"],
        ["status_traits", "Sect Status", "Backgrounds"],
        ["merits", "Merits", "Merits and Flaws"],
        ["flaws", "Flaws", "Merits and Flaws"]
    ];
    
    var TEXT_ATTRIBUTES = ["clan", "archetype", "sect", "faction", "title", "antecedence"];
    
    var SUM_CREATION_CATEGORIES = ["merits", "flaws"];
    
    // The Model constructor
    var instance_methods = _.extend({
        get_sum_creation_categories: function() {
            return SUM_CREATION_CATEGORIES;
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

        all_simpletrait_categories: function() {
            return ALL_SIMPLETRAIT_CATEGORIES;
        },
        
        all_text_attributes: function() {
            return TEXT_ATTRIBUTES;
        },
        
        _raw_generation: function() {
            var self = this;
            var generation;
            _.each(self.get("backgrounds"), function(b) {
                if (b.get_base_name() == "Generation") {
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
                "luminary_disciplines"
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
        
        get_in_clan_disciplines: function() {
            var self = this;
            return self.VampireCosts.get_in_clan_disciplines(self);
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
            return character_cache._character.initialize_troupe_membership(true);
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
            progress("Adding Humanity");
            return populated_character.update_trait("Humanity", 5, "paths", 5, true);
        }).then(function () {
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
        var name = "karmacharactertest" + nameappend + Math.random().toString(36).slice(2);
        return Model.create(name);
    };
    
    Model.all_simpletrait_categories = function () {
        return ALL_SIMPLETRAIT_CATEGORIES;
    };
    
    Model.all_text_attributes = function () {
        return TEXT_ATTRIBUTES;
    };

    // Returns the Model class
    return Model;

} );