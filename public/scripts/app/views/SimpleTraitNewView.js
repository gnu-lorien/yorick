// Category View
// =============

/* global _ */

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "parse",
    "backform",
    "marionette",
    "../models/SimpleTrait",
    "../collections/DescriptionCollection",
    "../models/Description",
    "../collections/BNSMETV1_ClanRules",
    "marionette",
    "text!../templates/simpletrait-new-base.html",
    "text!../templates/simpletrait-new-list.html",
], function(
    $,
    Backbone,
    Parse,
    Backform,
    Marionette,
    SimpleTrait,
    DescriptionCollection,
    Description,
    ClanRules,
    Marionette,
    simpletrait_new_base_html,
    simpletrait_new_list_html
) {

    var View = Marionette.ItemView.extend( {
        initialize: function(options) {
            this.gift_filter_options = options.gift_filter_options;
            this.listenTo(this.gift_filter_options, "change", this.render);
            
            _.bindAll(
                this,
                "register",
                "update_collection_query_and_fetch",
                "templateHelpers");
        },
        
        //template: "script#simpletraitcategoryDescriptionItems",
        template: _.template(simpletrait_new_list_html),
        
        templateHelpers: function () {
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

            if ("in clan disciplines" == self.filterRule) {
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
            } else if ("affinity" == self.filterRule) {
                descriptionItems = self.get_affinity_items();
            } else {
                descriptionItems = _.chain(self.collection.models).select(function (model) {
                    if (!_.contains(traitNames, model.get("name"))) {
                        return true;
                    }
                    return false;
                }).value();
            }
            
            if (self.category == "wta_gifts") {
                if (self.gift_filter_options.attributes.affinities == "mine") {
                    descriptionItems = self.get_affinity_items();
                }
                
                if (self.gift_filter_options.attributes.ladder) {
                    var available_levels = [1];
                    var ladder = _.countBy(self.character.get("wta_gifts"), function(gift) {
                        return gift.attributes.value;
                    });
                    _.each(_.range(2, 6), function(current_level) {
                        var current_rungs = ladder[current_level] || 0;
                        var previous_rungs = ladder[current_level - 1] || 0;
                        var available_rungs = previous_rungs - current_rungs;
                        if (available_rungs <= 0 || !_.isFinite(available_rungs)) {
                            available_rungs = 0;
                        } else {
                            available_levels.push(current_level);
                        }
                    })
                    
                    descriptionItems = _.select(descriptionItems, function (item) {
                        return _.contains(available_levels, _.parseInt(item.attributes.value));
                    });
                }
                
                if (self.gift_filter_options.attributes.sort == "alpha") {
                    descriptionItems = _.sortByAll(descriptionItems, ["attributes.name"]);
                } else if (self.gift_filter_options.attributes.sort == "level") {
                    descriptionItems = _.sortByAll(descriptionItems, ["attributes.value", "attributes.name"]);
                }
                
                if (self.gift_filter_options.attributes.direction == "desc") {
                    descriptionItems = _(descriptionItems).reverse().value();
                }
            }

            return {
                "collection": descriptionItems,
                "character": self.character,
                "category": self.category,
                "free_value": self.free_value
            };
        },
        
        get_affinity_items: function() {
            var self = this;
            var icd = self.character.get_affinities();
            var descriptionItems = _.chain(self.collection.models);
            if (0 != icd.length) {
                descriptionItems = descriptionItems.select(function (model) {
                    return _.some(_.map(_.range(1, 4), function (i) {
                        if (_.contains(icd, model.get("affinity_" + i))) {
                            return true;
                        } else {
                            return false;
                        }
                    }));
                })
            }
            return descriptionItems.value();
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
            var redirect = redirect || "#simpletrait/spacer/<%= self.category %>/<%= self.character.id %>/<%= b.get('name') %>/<%= b.get('value') %>/<%= b.get('free_value') || 0 %>/new";
            var specializationRedirect = specializationRedirect || "#simpletrait/specialize/<%= self.category %>/<%= self.character.id %>/<%= b.get('name') %>/<%= b.get('value') %>/<%= b.get('free_value') || 0 %>/new";

            if (redirect != _ && redirect != self.redirect) {
                self.redirect = _.template(redirect);
                changed = true;
            }

            if (specializationRedirect != _ && specializationRedirect != self.specializationRedirect) {
                self.specializationRedirect = _.template(specializationRedirect);
            }

            if (self.filterRule !== filterRule) {
                self.filterRule = filterRule;
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
                self.listenTo(self.character, "change:" + category, self.render);
                changed = true;
            }

            if (category != self.category) {
                self.category = category;
                self.switch_character_category_listening();
                if (self.collection)
                    self.stopListening(self.collection);
                self.collection = new DescriptionCollection;
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
            var q = new Parse.Query(Description);
            q.equalTo("category", self.category);
            self.collection.query = q;
            self.collection.fetch({reset: true});
        },

        onRender: function() {
            this.$el = this.$el.children();
            this.$el.unwrap();
            this.setElement(this.$el);
            this.$el.enhanceWithin();
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
            var cost = 1;
            if (valueField) {
                cost = valueField;
            }
            
            var trait = new SimpleTrait({
                name: $(e.target).attr("name"),
                value: cost,
                category: self.category,
                free_value: self.free_value
            });

            if (_.contains(self.requireSpecializations, trait.get("name"))) {
                window.location.hash = self.specializationRedirect({self: self, b: trait});
            } else {
                window.location.hash = self.redirect({self: self, b: trait});
            }

            return false;
        }

    } );
    
    var GiftsForm = Backform.Form.extend({
        fields: [
            {
                name: "affinities",
                label: "Show by Affinity",
                control: "select",
                options: [
                    {label: "Mine", value: "mine"},
                    {label: "Any", value: "any"}
                ]
            },
            {
                name: "ladder",
                label: "Show only available on the gift level ladder",
                control: "checkbox"
            },
            {
                name: "sort",
                label: "Sort By",
                control: "select",
                options: [
                    {label: "Alphabetical", value: "alpha"},
                    {label: "Level", value: "level"}
                ]
            },{
                name: "direction",
                label: "Direction",
                control: "select",
                options: [
                    {label: "Ascending", value: "asc"},
                    {label: "Descending", value: "desc"}
                ]
            }
        ]
    });
    
    var LayoutView = Marionette.LayoutView.extend({
        template: _.template(simpletrait_new_base_html),
        
        regions: {
            filter_rules: "#category-filter-rules",
            list: "#category-list"
        },
        
        model: new Backbone.Model(),
        
        initialize: function() {
            var self = this;
            self.gift_filter_options = new Backbone.Model({
                "affinities": "mine",
                "ladder": true,
                "sort": "level",
                "direction": "asc"
            });
        },

        register: function(character, category, free_value, redirect, filterRule, specializationRedirect) {
            var self = this;
            
            self.model.set("free_value", free_value);
            
            self.render();
        
            if (category == "wta_gifts") {
                self.showChildView('filter_rules', new GiftsForm({model: self.gift_filter_options}));
            }
            
            self.view = new View({gift_filter_options: self.gift_filter_options});
            self.view.register(
                character,
                category,
                free_value,
                redirect,
                filterRule,
                specializationRedirect)
            self.showChildView('list', self.view);
                
            self.$el.enhanceWithin();
        },

    });

    return LayoutView;

} );