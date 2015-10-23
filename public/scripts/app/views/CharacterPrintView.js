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
            var self = this;
            self.base_abilities = [];
            self.base_abilities.push(["Academics", "Animal Ken", "Athletics", "Awareness", "Brawl", "Computer", "Crafts", "Dodge", "Drive"]);
            self.base_abilities.push(["Empathy", "Firearms", "Intimidation", "Investigation", "Leadership", "Linguistics", "Lore", "Medicine", "Melee", "Occult"]);
            self.base_abilities.push(["Performance", "Science", "Security", "Stealth", "Streetwise", "Subterfuge", "Survival"]);
            self.base_abilities = _.flatten(self.base_abilities);
        },

        // Renders all of the Category models on the UI
        render: function() {

            var character = this.model;
            var sortedSkills = character.get_sorted_skills();
            var groupedSkills = character.get_grouped_skills(sortedSkills, 3);

            // Sets the view's template property
            this.template = _.template(
                $( "script#characterPrintView" ).html())(
                { "character": this.model,
                  "skills": sortedSkills,
                  "groupedSkills": groupedSkills} );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );