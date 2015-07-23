// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
], function( $, Backbone ) {

    // Extends Backbone.View
    var View = Backbone.View.extend({

        // The View Constructor
        initialize: function (options) {
            _.bindAll(this, "remove", "update_value", "save_clicked");

            this.redirectRemove = options.redirectRemove || "#characters?all";
            this.redirectRemove = _.template(this.redirectRemove);
            this.redirectSave = options.redirectSave || "#character?<%= self.model.id %>";
            this.redirectSave = _.template(this.redirectSave);
        },

        events: {
            "click .cancel": "cancel",
            "change": "update_value",
            "click .save": "save_clicked"
        },

        cancel: function(a, b, c) {
            var self = this;
            $.mobile.loading("show");
            window.location.hash = self.redirectRemove({"self": self});

            return false;
        },

        update_value: function(a, b, c) {
            var self = this;
            var v = this.$(a.target).val();
            this.model.set("name", v);
        },

        save_clicked: function(a, b, c) {
            var self = this;
            var v = self.$el.find('input[name="characterName"]').val();
            self.model.save({name: v, owner: Parse.User.current()}).then(function() {
                window.location.hash = self.redirectSave({"self": self});
            }, function(error) {
                console.log("Failed to save a character", error);
            })
            return false;
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#characterNewView" ).html(), { "model": this.model } );

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