// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
	"../models/BackgroundDescription",
    "../collections/BackgroundDescriptionsCollection",
    "../models/Background"
], function( $, Backbone, BackgroundDescription, BackgroundDescriptions, Background ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

            _.bindAll(this, "register_character");

            // The render method is called when Category Models are added to the Collection
            this.listenTo(this.collection, "add", this.render);
            this.listenTo(this.collection, "reset", this.render);
            //this.listenTo(this.model)
            this.model = null;

        },

        register_character: function(c) {
            var self = this;
            if (c === self.model) {
                return self;
            }

            self.stopListening(self.model);
            self.model = c;
            return self.render();
        },

        // Renders all of the Category models on the UI
        render: function() {

            if (!this.model) {
                return this;
            }
            // Sets the view's template property
            this.template = _.template( $( "script#backgroundDescriptionItems" ).html(), { "collection": this.collection, "character": this.model } );

            // Renders the view's template inside of the current listview element
            this.$el.find("ul").html(this.template);

            // Maintains chainability
            return this;
        },

        events: {
            "click": "clicked"
        },

        clicked: function(e, b, c) {
            var self = this;
            $.mobile.loading("show");
            var b = new Background;
            b.set("name", $(e.target).attr("name"));
            b.save().done(function (bg) {
                self.model.addUnique("backgrounds", b);
                self.model.save().done(function () {
                    window.location.hash = "#backgrounds/" + self.model.id + "/all";
                });
            });

            return false;
        }

    } );

    // Returns the View class
    return View;

} );