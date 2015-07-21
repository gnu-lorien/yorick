// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "parse",
    "../models/SimpleTrait",
    "../collections/DescriptionCollection",
    "../models/Description"
], function( $, Backbone, Parse, SimpleTrait, DescriptionCollection, Description ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

            _.bindAll(this, "register");

        },

        register: function(character, category) {
            var self = this;
            var changed = false;
            if (character !== self.character) {
                self.stopListening(self.character);
                self.character = character;
                changed = true;
            }

            if (category != self.category) {
                self.category = category;
                self.stopListening(self.collection);
                self.collection = new DescriptionCollection;
                var q = new Parse.Query(Description);
                q.equalTo("category", self.category);
                self.collection.query = q;
                self.listenTo(self.collection, "add", self.render);
                self.listenTo(self.collection, "reset", self.render);
                self.collection.fetch();
                changed = true;
            }

            if (changed) {
                return self.render();
            }
            return self;
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template($("script#simpletraitcategoryDescriptionItems").html(), {
                "collection": this.collection,
                "character": this.character,
                "category": this.category
            });

            // Renders the view's template inside of the current listview element
            this.$el.find("ul").html(this.template);
            //this.$el.find("ul").html("oh hi there");

            // Maintains chainability
            return this;
        },

        events: {
            "click": "clicked"
        },

        clicked: function(e, b, c) {
            var self = this;
            $.mobile.loading("show");
            var b = new SimpleTrait;
            b.set("name", $(e.target).attr("name"));
            b.set("category", self.category);
            b.save().done(function (bg) {
                self.character.addUnique(self.category, b);
                self.character.save().done(function () {
                    window.location.hash = "#simpletrait/" + self.category + "/" + self.character.id + "/" + b.id;
                });
            });

            return false;
        }

    } );

    // Returns the View class
    return View;

} );