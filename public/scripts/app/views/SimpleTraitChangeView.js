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
                self.fauxtrait = new SimpleTrait({
                    name: self.simpletrait.get("name"),
                    value: self.simpletrait.get("value"),
                    free_value: self.simpletrait.get("free_value"),
                    cost: self.simpletrait.get("cost"),
                    category: self.simpletrait.get("category")
                })
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
            "change .experience-modifier-slider": "update_experience_modifier_value",
            "change #specialize-name": "update_specialty_name",
            "change #experience-type-select": "update_experience_type",
            "click .save": "save_clicked"
        },

        remove: function(e) {
            var self = this;
            e.preventDefault();
            self.undelegateEvents();
            $.mobile.loading("show");
            console.log("remove value", self.category, self.simpletrait);
            self.character.remove_trait(self.simpletrait).fail(PromiseFailReport).always(function() {
                window.location.hash = "#simpletraits/" + self.category + "/" + self.character.id + "/all";
                self.delegateEvents();
            });

            return false;
        },

        update_value: function(a, b, c) {
            var self = this;
            var v = this.$(a.target).val();
            console.log("update value", self.category, self.fauxtrait, this.$(a.target).val());
            this.fauxtrait.set("value", _.parseInt(this.$(a.target).val()));
            self.render_view();
        },

        update_free_value: function(a, b, c) {
            var self = this;
            var v = this.$(a.target).val();
            this.fauxtrait.set("free_value", _.parseInt(this.$(a.target).val()));
            self.render_view();
        },
        
        update_experience_modifier_value: function(a, b, c) {
            var self = this;
            var v = this.$(a.target).val();
            this.fauxtrait.set("experience_cost_modifier", _.parseInt(this.$(a.target).val()));
            self.render_view();
        },

        update_specialty_name: function(a) {
            var self = this;
            var v = this.$(a.target).val();
            self.fauxtrait.set_specialization(this.$(a.target).val());
            self.render_view();
        },
        
        update_experience_type: function(a) {
            var self = this;
            var elem = this.$(a.target)[0];
            var v = elem.options[elem.selectedIndex].value;
            if ("automatic" == v) {
                v = undefined;
            }
            self.fauxtrait.set("experience_cost_type", v);
            if (!_.isFinite(self.fauxtrait.get("experience_cost_modifier"))) {
                self.fauxtrait.set("experience_cost_modifier", 1);
            }
            self.render_view();
        },

        save_clicked: function(e) {
            var self = this;
            e.preventDefault();
            $.mobile.loading("show");
            _.defer(function () {
                console.log("save clicked", self.category, self.fauxtrait);
                self.character.update_trait(
                    self.fauxtrait.get("name"),
                    self.fauxtrait.get("value"),
                    self.fauxtrait.get("category"),
                    self.fauxtrait.get("free_value"),
                    true
                ).then(function (newtrait) {
                    console.log("asaved", self.category, newtrait);
                    window.location.hash = "#simpletraits/" + self.category + "/" + self.character.id + "/all";
                }, PromiseFailReport);
            });
            return false;
        },

        render_view: function() {
            this.view_template = _.template($("script#simpleTraitChangeView").html())({
                "c": this.character,
                "character": this.character,
                "b": this.fauxtrait,
                "trait": this.fauxtrait,
            });

            this.$el.find("#simpletrait-viewing").html(this.view_template);
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template($("script#simpleTraitChangeChange").html())({
                "c": this.character,
                "b": this.fauxtrait,
                "category": this.category,
                "traitmax": this.character.max_trait_value(this.fauxtrait),
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