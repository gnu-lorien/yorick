// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "../models/Vampire",
    "backform",
    "../models/Werewolf",
], function( $, Backbone, Vampire, Backform, Werewolf ) {

    // Extends Backbone.View
    var View = Backform.Form.extend({

        // The View Constructor
        initialize: function (options) {
            Backform.Form.prototype.initialize.apply(this, arguments);
            
            this.redirectRemove = options.redirectRemove || "#characters?all";
            this.redirectRemove = _.template(this.redirectRemove);
            this.redirectSave = options.redirectSave || "#character?<%= character.id %>";
            this.redirectSave = _.template(this.redirectSave);
        },
        
        model: new Backbone.Model({
            name: "New Character Name",
            type: "Vampire"
        }),
        
        errorModel: new Backbone.Model(),

        fields: [
            {
                name: "name",
                label: "Character Name",
                control: "input"
            },
            {
                name: "type",
                label: "Venue",
                control: "select",
                options: [
                    {label: "Vampire", value: "Vampire"},
                    {label: "Werewolf", value: "Werewolf"}
                ]
            },
            {
                control: "Button",
                label: "Create New Character"
            }
        ],
        
        events: {
            "submit": "save_clicked"
        },
        
        validate: function(attributes, options) {
            var self = this;
            self.errorModel.clear();
            
            if (_.isEmpty(self.model.get("name"))) {
                self.errorModel.set({name: "Name cannot be empty."});
                return "Validation errors. Please fix.";
            }
        },

        save_clicked: function(e) {
            var self = this;
            e.preventDefault();
            if (self.validate()) {
                return;
            }
            if (self.model.get("type") == "Vampire") {
                $.mobile.loading("show");
                Vampire.create(self.model.get("name")).then(function(populated_character) {
                    window.location.hash = self.redirectSave({"character": populated_character});
                }, function(error) {
                    console.log("Failed to save a character", error.message);
                })               
            } else {
                $.mobile.loading("show");
                Werewolf.create(self.model.get("name")).then(function(populated_character) {
                    window.location.hash = self.redirectSave({"character": populated_character});
                }, function(error) {
                    console.log("Failed to save a character", error.message);
                })               
            }
            
            return false;
        }

    } );

    // Returns the View class
    return View;

} );