// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "parse",
    "../models/SimpleTrait",
    "../collections/BNSMETV1_ClanRules",
    "../helpers/DescriptionFetcher"
], function( $, Backbone, Parse, SimpleTrait, ClanRules, DescriptionFetcher ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

            _.bindAll(this, "register", "update_collection_query_and_fetch");
        },

        switch_character_category_listening: function() {
            var self = this;
            if (!self.character) {
                return;
            }
            self.stopListening(self.character);
            self.listenTo(self.character, "change:" + self.category, self.render);
        },

        register: function(character, category, free_value, redirect, filterRule, specializationRedirect) {
            var self = this;
            var changed = false;
            var redirect = redirect || "#simpletrait/<%= self.category %>/<%= self.character.id %>/<%= b.linkId() %>";
            var specializationRedirect = specializationRedirect || "#simpletrait/specialize/<%= self.category %>/<%= self.character.id %>/<%= b.linkId() %>";

            if (redirect != _ && redirect != self.redirect) {
                self.redirect = _.template(redirect);
                changed = true;
            }

            if (specializationRedirect != _ && specializationRedirect != self.specializationRedirect) {
                self.specializationRedirect = _.template(specializationRedirect);
            }

            if (self.filterRule !== filterRule) {
                if (_.isString(filterRule)) {
                    self.filterRule = [filterRule];
                } else {
                    self.filterRule = filterRule;
                }
                changed = true;
            }

            if (free_value !== self.free_value && free_value != _) {
                self.free_value = free_value;
                changed = true;
            }

            if (character !== self.character) {
                if (self.character)
                    self.stopListening(self.character);
                self.character = character;
                //self.listenTo(self.character, "change:" + category, self.update_collection_query_and_fetch);
                self.listenTo(self.character, "change:" + category, self.render);
                changed = true;
            }

            if (category != self.category) {
                self.category = category;
                self.switch_character_category_listening();
                if (self.collection)
                    self.stopListening(self.collection);
                self.collection = DescriptionFetcher(category);
                self.listenTo(self.collection, "add", self.render);
                self.listenTo(self.collection, "reset", self.render);
                self.update_collection_query_and_fetch();
                changed = true;
            }

            if (changed) {
                return self.render();
            }
            return self;
        },

        update_collection_query_and_fetch: function () {
            var self = this;
            self.collection.fetch_avoiding_wait();
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            var descriptionItems;
            self.requireSpecializations = _.chain(self.collection.models).select(function (model) {
                if (model.get("requirement") == "requires_specialization") {
                    return true;
                }
                return false;
            }).pluck("attributes").pluck("name").value();
            var traitNames = _(self.character.get(self.category))
                .pluck("attributes")
                .pluck("name")
                .without(self.requireSpecializations)
                .value();

            if (_.contains(self.filterRule, "in clan disciplines")) {
                var icd = _.without(self.character.get_in_clan_disciplines(), undefined);
                descriptionItems = _.chain(self.collection.models);
                if (0 != icd.length) {
                    descriptionItems = descriptionItems.select(function (model) {
                        if (_.contains(traitNames, model.get("name"))) {
                            return false;
                        }
                        if (_.contains(icd, model.get("name"))) {
                            return true;
                        }
                        return false;
                    })
                }
                descriptionItems = descriptionItems.value();
            } else if (_.contains(self.filterRule, "affinity")) {
                var icd = _.without(self.character.get_affinities(), undefined);
                descriptionItems = _.chain(self.collection.models);
                if (0 != icd.length) {
                    descriptionItems = descriptionItems.select(function (model) {
                        if (_.contains(traitNames, model.get("name"))) {
                            return false;
                        }
                        return _.some(_.map(_.range(1, 4), function (i) {
                            if (_.contains(icd, model.get("affinity_" + i))) {
                                return true;
                            } else {
                                return false;
                            }
                        }));
                    })
                }
                descriptionItems = descriptionItems.value();
            } else {
                descriptionItems = _.chain(self.collection.models).select(function (model) {
                    if (!_.contains(traitNames, model.get("name"))) {
                        return true;
                    }
                    return false;
                }).value();
            }
            
            if (_.contains(self.filterRule, "show_only_value_1")) {
                descriptionItems = _.select(descriptionItems, function (model) {
                    return model.get("value") == 1;
                });
            }

            // Sets the view's template property
            this.template = _.template($("script#simpletraitcategoryDescriptionItems").html())({
                "collection": descriptionItems,
                "character": this.character,
                "category": this.category,
                "free_value": this.free_value
            });

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            /*
            this.headerTemplate = _.template($("script#headerTemplate").html())({
                "character": this.character,
                "title": this.category,
            });

            this.$el.find("div[data-role='header']").html(this.headerTemplate);
            */

            this.$el.enhanceWithin();

            // Maintains chainability
            return this;
        },

        events: {
            "click .simpletrait": "clicked"
        },

        clicked: function(e) {
            var self = this;
            $.mobile.loading("show");
            var pickedId = $(e.target).attr("backendId");
            var description = self.collection.get(pickedId);
            var valueField = _.parseInt(description.get("value"));
            var cost = self.free_value;
            if (valueField) {
                cost = valueField;
            }

            self.character.update_trait($(e.target).attr("name"), cost, self.category, self.free_value).done(function(trait) {
                if (_.contains(self.requireSpecializations, trait.get("name"))) {
                    window.location.hash = self.specializationRedirect({self: self, b: trait});
                } else {
                    window.location.hash = self.redirect({self: self, b: trait});
                }
            }).fail(function (error) {
                console.log(error.message);
            })

            return false;
        }

    } );

    // Returns the View class
    return View;

} );