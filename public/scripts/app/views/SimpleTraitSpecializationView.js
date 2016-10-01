// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "../models/Description",
    "../collections/DescriptionCollection",
], function( $, Backbone, Description, DescriptionCollection ) {

    // Extends Backbone.View
    var View = Backbone.View.extend({

        // The View Constructor
        initialize: function (options) {
            _.bindAll(this, "remove", "update_value", "save_clicked");
            this.collection = new DescriptionCollection;
        },

        register: function (character, simpletrait, category, redirectRemove, redirectSave) {
            var self = this;
            var changed = false;

            this.redirectRemove = _.template(redirectRemove);
            this.redirectSave = _.template(redirectSave);

            if (character !== self.character) {
                if (self.character)
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
                var q = new Parse.Query(Description);
                q
                    .equalTo("category", self.category)
                    .startsWith("name", self.simpletrait.get_base_name())
                    .addAscending(["order", "name"]);
                self.collection.query = q;
                return self.collection.fetch({reset: true}).then(function () {
                    return self.render();
                });
            }

            if (changed) {
                return Parse.Promise.as(self.render());
            } else {
                return Parse.Promise.as(self);
            }
        },

        events: {
            "click .cancel": "cancel",
            "change": "update_value",
            "click .save": "save_clicked",
            "submit": "save_clicked"
        },

        cancel: function(a, b, c) {
            var self = this;
            $.mobile.loading("show");
            window.location.hash = self.redirectRemove({"self": self});

            return false;
        },

        update_value: function(a, b, c) {
            var self = this;
        },

        save_clicked: function(e) {
            var self = this;
            e.preventDefault();
            $.mobile.loading("show");
            var v = self.$el.find('input[name="specialization"]').val();
            _.defer(function() {
                self.simpletrait.set_specialization(v);
                self.character.update_trait(self.simpletrait).then(function (trait) {
                    window.location.hash = self.redirectSave({'self': self});
                }).fail(function (error) {
                    console.log("Couldn't specialize trait because of " + JSON.stringify(error));
                    window.location.hash = self.redirectRemove({'self': self});
                })
            });
            return false;
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#simpleTraitSpecialization" ).html())({
                "model": this.simpletrait,
                "name": this.simpletrait.get_base_name(),
                "specialization": this.simpletrait.get_specialization(),
                "description": this.collection.first()
            } );

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