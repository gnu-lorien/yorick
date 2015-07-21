// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
	"../models/BackgroundDescription",
    "../collections/BackgroundDescriptionsCollection"
], function( $, Backbone, BackgroundDescription, BackgroundDescriptions ) {

    // Extends Backbone.View
    var View = Backbone.View.extend({

        // The View Constructor
        initialize: function () {
            _.bindAll(this, "remove", "update_value", "save_clicked");
        },

        register_character: function (c, b) {
            var self = this;
            var changed = false;
            if (c !== self.model) {
                self.stopListening(self.model);
                self.model = c;
                changed = true;
            }

            if (b !== self.background) {
                self.background = b;
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
            console.log("remove value");
            self.model.remove("backgrounds", self.background);
            self.model.save().then(function () {
                return self.background.destroy({wait: true});
            }).done(function() {
                window.location.hash = "#backgrounds/" + self.model.id + "/all";
            })

            return false;
        },

        update_value: function(a, b, c) {
            var v = this.$(a.target).val();
            console.log("update value", this.$(a.target).val());
            this.background.set("value", _.parseInt(this.$(a.target).val()));
        },

        save_clicked: function(a, b, c) {
            var self = this;
            console.log("save clicked");
            this.background.save().then(function (a, b, c) {
                console.log("asaved");
                self.model.trigger("change:backgrounds");
                window.location.hash = "#backgrounds/" + self.model.id + "/all";
            }, function(a, b, c) {
                console.log('error');
            });
            return false;
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#backgroundChangeView" ).html(), { "c": this.model, "b": this.background } );

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