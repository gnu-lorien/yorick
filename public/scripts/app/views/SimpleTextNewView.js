// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "parse",
    "../collections/DescriptionCollection",
    "../models/Description"
], function( $, Backbone, Parse, DescriptionCollection, Description ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

            _.bindAll(this, "register", "update_collection_query_and_fetch");

        },

        register: function(character, category, targetValue, redirect) {
            var self = this;
            var changed = false;

            if (self.redirect !== redirect) {
                self.redirect = redirect;
                changed = true;
            }

            if (targetValue !== self.targetValue) {
                self.targetValue = targetValue;
                changed = true;
            }

            if (character !== self.character) {
                if (self.character)
                    self.stopListening(self.character);
                self.character = character;
                self.listenTo(self.character, "change:" + category, self.update_collection_query_and_fetch);
                changed = true;
            }

            if (category != self.category) {
                self.category = category;
                self.stopListening(self.character);
                self.listenTo(self.character, "change:" + category, self.update_collection_query_and_fetch);
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
            self.collection.query = q;
            self.collection.fetch({reset: true});
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template($("script#simpletextcategoryDescriptionItems").html())({
                "collection": this.collection,
                "character": this.character,
                "category": this.category,
                "targetValue": this.targetValue
            });

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();

            // Maintains chainability
            return this;
        },

        events: {
            "click": "clicked"
        },

        clicked: function(e) {
            var self = this;
            $.mobile.loading("show");
            self.character.update_text(self.targetValue, $(e.target).attr("name")).done(function(b) {
                window.location.hash = self.redirect;
            });

            return false;
        }

    } );

    // Returns the View class
    return View;

} );