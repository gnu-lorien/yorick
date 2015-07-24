// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone"
], function( $, Backbone) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

        },

        // Renders all of the Category models on the UI
        render: function() {

            var character = this.model;
            var cols = [];
            cols.push(["Academics", "Animal Ken", "Athletics", "Awareness", "Brawl", "Computer", "Crafts", "Dodge", "Drive"]);
            cols.push(["Empathy", "Firearms", "Intimidation", "Investigation", "Leadership", "Linguistics", "Lore", "Medicine", "Melee", "Occult"]);
            cols.push(["Performance", "Science", "Security", "Stealth", "Streetwise", "Subterfuge", "Survival"]);
            var a = _.zip.apply(_, cols)
            var s = character.get("skills");
            var f = _.find(s, {name: "Athletics"});
            var r = _.result(f, 'name', 0);
            skillsLookup = _.groupBy(s, function(skill) {
                return skill.get("name");
            });

            // Sets the view's template property
            this.template = _.template(
                $( "script#characterPrintView" ).html())(
                { "character": this.model,
                  "skills": skillsLookup} );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );