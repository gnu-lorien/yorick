// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "text!../templates/character-print-view.html"
], function( $, Backbone, character_print_view_html) {

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
            
            _.bindAll(this,
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        },

        format_simpletext: function(attrname) {
            return this.model.get(attrname);
        },
        
        format_attribute_value: function(attribute) {
            return attribute.get("value");
        },

        format_attribute_focus: function(name) {
            var focusName = "focus_" + name.toLowerCase() + "s";
            var focusNames = _.map(this.model.get(focusName), function (focus) {
                return focus.get("name");
            });
            return focusNames.join(" ");
        },

        format_skill: function(skill, style) {
            var dot = "O";
            if (_.isUndefined(style)) {
                style = 2;
            }
            var name = skill.get("name");
            if (_.startsWith(name, "Retainers")) {
                console.log("break");
            }
            if (0 == style) {
                return name;
            }
            if (1 == style) {
                if (!skill.has_specialization()) {
                    return name + " x" + skill.get("value");
                } else {
                    return skill.get_base_name() + " x" + skill.get("value") + ": " + skill.get_specialization();
                }
            }
            if (2 == style) {
                var value = " x" + skill.get("value") + " " + _.repeat(dot, skill.get("value"));
                if (!skill.has_specialization()) {
                    return name + value;
                } else {
                    return skill.get_base_name() + value + ": " + skill.get_specialization();
                }
            }
            if (3 == style) {
                var value = " " + _.repeat(dot, skill.get("value"));
                if (!skill.has_specialization()) {
                    return name + value;
                } else {
                    return skill.get_base_name() + value + ": " + skill.get_specialization();
                }
            }
            if (4 == style) {
                if (!skill.has_specialization()) {
                    return name + " (" + skill.get("value") + ")";
                } else {
                    return skill.get_base_name() + " (" + skill.get("value") + ", " + skill.get_specialization() + ")";
                }
            }
            if (5 == style) {
                if (!skill.has_specialization()) {
                    return name;
                } else {
                    return skill.get_base_name() + " (" + skill.get_specialization() + ")";
                }
            }
            if (6 == style) {
                return name + " (" + skill.get("value") + ")";
            }
            if (7 == style) {
                var thewords;
                if (!skill.has_specialization()) {
                    thewords = name + dot;
                } else {
                    thewords = name + " (" + skill.get_specialization() + ")" + dot;
                }
                return _.repeat(thewords, skill.get("value"));
            }
            if (8 == style) {
                return _.repeat(dot, skill.get("value"));
            }
            if (9 == style) {
                return skill.get("value");
            }
            if (10 == style) {
                return skill.get_specialization();
            }
        },
        
        format_specializations: function(name) {
            return _.pluck(this.model.get(name), "attributes.name");
        },

        // Renders all of the Category models on the UI
        render: function() {

            var character = this.model;
            var sortedSkills = character.get_sorted_skills();
            var groupedSkills = character.get_grouped_skills(sortedSkills, 3);

            // Sets the view's template property
            this.template = _.template(character_print_view_html)(
                {
                    "character": this.model,
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

    // Returns the View class
    return View;

} );