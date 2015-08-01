// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "parse",
    "../models/SimpleTrait",
    "../collections/DescriptionCollection",
    "../models/Description",
    "../collections/BNSMETV1_ClanRules"
], function( $, Backbone, Parse, SimpleTrait, DescriptionCollection, Description, ClanRules ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

            _.bindAll(this, "register", "update_collection_query_and_fetch");

            this.clanRules = new ClanRules;
            this.clanRules.fetch();
        },

        register: function(character, category, freeValue, redirect, filterRule) {
            var self = this;
            var changed = false;
            var redirect = redirect || "#simpletrait/<%= self.category %>/<%= self.character.id %>/<%= b.linkId() %>";

            if (redirect != _ && redirect != self.redirect) {
                self.redirect = _.template(redirect);
                changed = true;
            }

            if (self.filterRule !== filterRule) {
                self.filterRule = filterRule;
                change = true;
            }

            if (freeValue !== self.freeValue && freeValue != _) {
                self.freeValue = freeValue;
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
            q.equalTo("category", self.category).addAscending(["order", "name"]);
            /*
            var traitNames = _(self.character.get(self.category)).pluck("attributes").pluck("name").value();
            q.notContainedIn("name", traitNames);
            */
            self.collection.query = q;
            self.collection.fetch({reset: true});
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            var descriptionItems;

            if ("in clan disciplines" == self.filterRule) {
                var icd = self.clanRules.get_in_clan_disciplines(self.character);
                descriptionItems = _.chain(self.collection.models).select(function (model) {
                    if (_.contains(icd, model.get("name"))) {
                        return true;
                    }
                    return false;
                }).value();
            } else {
                var traitNames = _(self.character.get(self.category)).pluck("attributes").pluck("name").value();
                descriptionItems = _.chain(self.collection.models).select(function (model) {
                    if (!_.contains(traitNames, model.get("name"))) {
                        return true;
                    }
                    return false;
                }).value();
            }

            // Sets the view's template property
            this.template = _.template($("script#simpletraitcategoryDescriptionItems").html())({
                "collection": descriptionItems,
                "character": this.character,
                "category": this.category,
                "freeValue": this.freeValue
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
            var cost = 1;
            if (valueField) {
                cost = valueField;
            }

            self.character.update_trait($(e.target).attr("name"), cost, self.category, self.freeValue).done(function(b) {
                window.location.hash = self.redirect({self: self, b: b});
            }).fail(function (error) {
                console.log(error.message);
            })

            return false;
        }

    } );

    // Returns the View class
    return View;

} );