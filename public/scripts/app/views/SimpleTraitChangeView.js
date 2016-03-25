// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
	"../models/SimpleTrait",
    "../helpers/PromiseFailReport"
], function( $, Backbone, SimpleTrait, PromiseFailReport ) {

    // Extends Backbone.View
    var View = Backbone.View.extend({

        // The View Constructor
        initialize: function () {
            _.bindAll(this, "remove", "update_value", "update_free_value", "update_specialty_name", "save_clicked", "render_view");
        },

        register: function (character, simpletrait, category) {
            var self = this;
            var changed = false;
            if (character !== self.character) {
                if (self.character)
                    self.stopListening(self.character);
                self.character = character;
                self.listenTo(self.character, "change", self.render_view);
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
            "change .value-slider": "update_value",
            "change .free-slider": "update_free_value",
            "change #specialize-name": "update_specialty_name",
            "click .save": "save_clicked"
        },

        remove: function(a, b, c) {
            var self = this;
            $.mobile.loading("show");
            console.log("remove value", self.category, self.simpletrait);
            self.character.remove_trait(self.simpletrait).done(function() {
                window.location.hash = "#simpletraits/" + self.category + "/" + self.character.id + "/all";
            })

            return false;
        },

        update_value: function(a, b, c) {
            var self = this;
            var v = this.$(a.target).val();
            console.log("update value", self.category, self.simpletrait, this.$(a.target).val());
            this.simpletrait.set("value", _.parseInt(this.$(a.target).val()));
            self.render_view();
        },

        update_free_value: function(a, b, c) {
            var self = this;
            var v = this.$(a.target).val();
            this.simpletrait.set("free_value", _.parseInt(this.$(a.target).val()));
            self.render_view();
        },

        update_specialty_name: function(a) {
            var self = this;
            var v = this.$(a.target).val();
            self.simpletrait.set_specialization(this.$(a.target).val());
            self.render_view();
        },

        save_clicked: function(e) {
            var self = this;
            e.preventDefault();
            $.mobile.loading("show");
            _.defer(function () {
                console.log("save clicked", self.category, self.simpletrait);
                self.character.update_trait(self.simpletrait).then(function (a, b, c) {
                    console.log("asaved", self.category, self.simpletrait);
                    window.location.hash = "#simpletraits/" + self.category + "/" + self.character.id + "/all";
                }, PromiseFailReport);
            });
            return false;
        },

        render_view: function() {
            this.view_template = _.template($("script#simpleTraitChangeView").html())({
                "c": this.character,
                "character": this.character,
                "b": this.simpletrait,
                "trait": this.simpletrait,
            });

            this.$el.find("#simpletrait-viewing").html(this.view_template);
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template($("script#simpleTraitChangeChange").html())({
                "c": this.character,
                "b": this.simpletrait,
                "category": this.category,
                "traitmax": this.character.max_trait_value(this.simpletrait),
            });

            // Renders the view's template inside of the current listview element
            this.render_view();
            this.$el.find("#simpletrait-changing").html(this.template);
            this.$el.find("#simpletrait-changing").enhanceWithin();


            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );