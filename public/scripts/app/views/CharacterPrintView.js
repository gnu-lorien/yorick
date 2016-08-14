// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "text!../templates/character-print-view.html",
    "../helpers/VampirePrintHelper",
    "marionette"
], function( $, Backbone, character_print_view_html, VampirePrintHelper, Marionette) {

    // Extends Backbone.View
    var View = Marionette.LayouView.extend( {
        template: _.template(character_print_view_html),
        templateHelpers: function () {
            var self = this;
            return {
                "character": self.character,
                "skills": self.character.get_sorted_skills(),
                "groupedSkills": self.character.get_grouped_skills(self.character.get_sorted_skills() 3),
                format_simpletext: self.format_simpletext,
                format_attribute_value: self.format_attribute_value,
                format_attribute_focus: self.format_attribute_focus,
                format_skill: self.format_skill,
                format_specializations: self.format_specializations,
            }
        },
        
        // The View Constructor
        initialize: function() {
            var self = this;
            self.base_abilities = [];
            self.base_abilities.push(["Academics", "Animal Ken", "Athletics", "Awareness", "Brawl", "Computer", "Crafts", "Dodge", "Drive"]);
            self.base_abilities.push(["Empathy", "Firearms", "Intimidation", "Investigation", "Leadership", "Linguistics", "Lore", "Medicine", "Melee", "Occult"]);
            self.base_abilities.push(["Performance", "Science", "Security", "Stealth", "Streetwise", "Subterfuge", "Survival"]);
            self.base_abilities = _.flatten(self.base_abilities);
            
            _.bindAll(this,
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        },

        // Renders all of the Category models on the UI
        render: function() {

            var character = this.character;
            var sortedSkills = character.get_sorted_skills();
            var groupedSkills = character.get_grouped_skills(sortedSkills, 3);

            // Sets the view's template property
            this.template = _.template(character_print_view_html)(
                {
                    "character": this.character,
                    "skills": sortedSkills,
                    "groupedSkills": groupedSkills,
                    format_simpletext: this.format_simpletext,
                    format_attribute_value: this.format_attribute_value,
                    format_attribute_focus: this.format_attribute_focus,
                    format_skill: this.format_skill,
                    format_specializations: this.format_specializations,
                } );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            // Maintains chainability
            return this;

        }

    } );

    _.extend(View.prototype, VampirePrintHelper);

    // Returns the View class
    return View;

} );