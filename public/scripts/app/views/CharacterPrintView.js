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
            var columnCount = 3;
            var sortedSkills = character.get("skills");
            sortedSkills = _.sortBy(sortedSkills, "attributes.name");
            sortedSkills = _.map(sortedSkills, function (skill) {
                var name = skill.get("name");
                if (-1 == name.indexOf(":")) {
                    return name + " x" + skill.get("value");
                } else {
                    var rootName = name.slice(0, name.indexOf(':'));
                    var rightName = name.slice(name.indexOf(':'));
                    return rootName + " x" + skill.get("value") + rightName;
                }
            })
            var groupedSkills = {0: [], 1: [], 2: []};
            var shiftAmount = _.ceil(sortedSkills.length / columnCount);
            _.each(_.range(columnCount), function (i) {
                groupedSkills[i] = _.take(sortedSkills, shiftAmount);
                sortedSkills = _.drop(sortedSkills, shiftAmount);
            });
            groupedSkills = _.zip(groupedSkills[0], groupedSkills[1], groupedSkills[2]);

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