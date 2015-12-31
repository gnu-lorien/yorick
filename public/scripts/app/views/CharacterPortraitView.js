// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "parse"
], function( $, Backbone, Parse ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function(options) {
            var self = this;
            _.bindAll(self, "update");
        },

        register: function(character) {
            var self = this;
            var changed = false;
            if (character !== self.character) {
                if (self.character)
                    self.stopListening(self.character);
                var p = character.get("portrait") ? character.get("portrait").fetch() : Parse.Promise.as([]);
                return p.then(function () {
                    self.character = character;
                    self.listenTo(self.character, "change:portrait", self.render);
                    return Parse.Promise.as(self.render());
                });
            }

            return Parse.Promise.as(self);
        },

        events: {
            "submit form.portrait-form": "update",
            "click .update": "update",
        },

        update: function(e) {
            var self = this;
            var portraitFile = self.$("#input-portrait")[0].files[0];
            var extension = portraitFile.name.split('.').pop();
            if (portraitFile.size > 1000000) {
                self.$(".error").html(_.escape("Picture too large. Limit is 1MB")).show();
            }
            var parseFile = new Parse.File("portrait" + extension, portraitFile);
            $.mobile.loading("show");
            self.undelegateEvents();
            parseFile.save().done(function(file) {
                var characterPortrait = new Parse.Object("CharacterPortrait");
                characterPortrait.set("original", file);
                return characterPortrait.save();
            }).done(function (portrait) {
                self.character.set("portrait", portrait);
                return self.character.save();
            }).done(function() {
                self.$(".error").hide();
            }).fail(function(error) {
                self.$(".error").html(_.escape(error.message)).show();
                console.log(error.message);
            }).always(function() {
                self.delegateEvents();
                $.mobile.loading("hide");
            })

            return false;
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#characterPortraitView" ).html())({
                "character": this.character,
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