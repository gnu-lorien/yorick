// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
	"../models/SimpleTrait"
], function( $, Backbone, SimpleTrait ) {

    // Extends Backbone.View
    var View = Backbone.View.extend({

        // The View Constructor
        initialize: function () {
            _.bindAll(this, "remove", "update_value", "save_clicked");
        },

        register: function (character, simpletrait, category) {
            var self = this;
            var changed = false;
            if (character !== self.character) {
                self.stopListening(self.character);
                self.character = character;
                changed = true;
            }

            if (simpletrait !== self.simpletrait) {
                self.simpletrait = simpletrait;
                changed = true;
            }

            if (!_.isEqual(category, self.category)) {
                self.category = category;
                changed = true;
            }

            if (changed) {
                return self.render();
            } else {
                return self;
            }
        },

        events: {
            "click .remove": "remove",
            "change": "update_value",
            "click .save": "save_clicked"
        },

        remove: function(a, b, c) {
            var self = this;
            $.mobile.loading("show");
            console.log("remove value", self.category, self.simpletrait);
            self.character.remove(self.category, self.simpletrait);
            self.character.save().then(function () {
                return self.simpletrait.destroy({wait: true});
            }).done(function() {
                window.location.hash = "#simpletraits/" + self.category + "/" + self.character.id + "/all";
            })

            return false;
        },

        update_value: function(a, b, c) {
            var self = this;
            var v = this.$(a.target).val();
            console.log("update value", self.category, self.simpletrait, this.$(a.target).val());
            this.simpletrait.set("value", _.parseInt(this.$(a.target).val()));
        },

        save_clicked: function(a, b, c) {
            var self = this;
            console.log("save clicked", self.category, self.simpletrait);
            self.character.update_trait(self.simpletrait).then(function (a, b, c) {
                console.log("asaved", self.category, self.simpletrait);
                window.location.hash = "#simpletraits/" + self.category + "/" + self.character.id + "/all";
            }, function(a, b, c) {
                console.log('error', a);
            });
            return false;
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#simpleTraitChangeView" ).html(), { "c": this.character, "b": this.simpletrait, "category": this.category } );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );