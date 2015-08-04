// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "../models/VampireChange",
    "../collections/VampireChangeCollection"
], function( $, Backbone, VampireChange, VampireChangeCollection) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            var self = this;
            this.collection = new VampireChangeCollection;
            self.listenTo(self.collection, "add", self.render);
            self.listenTo(self.collection, "reset", self.render);
        },

        register: function(character) {
            var self = this;

            if (character !== self.character) {
                if (self.character)
                    self.stopListening(self.character);
                self.character = character;
                self.listenTo(self.character, "change:change_count", self.update_collection_query_and_fetch);
                self.update_collection_query_and_fetch();
            }

            return self;
        },

        update_collection_query_and_fetch: function (character) {
            var self = this;
            var options = {reset: true};
            if (character) {
                options = {add: true};

                // change this to be something that only queries the latest ones
            }
            var q = new Parse.Query(VampireChange);
            q.equalTo("owner", self.character).addDescending("createdAt");
            self.collection.query = q;
            self.collection.fetch(options);
        },

        // Renders all of the Category models on the UI
        render: function() {
            // Sets the view's template property
            this.template = _.template(
                $( "script#characterLogView" ).html())(
                { "character": this.character,
                  "logs": this.collection.models} );

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