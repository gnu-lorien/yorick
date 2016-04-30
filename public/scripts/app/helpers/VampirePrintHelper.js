// Includes file dependencies
define([
    "jquery",
    "backbone",
], function( $, Backbone, character_print_view_html) {

    var Mixin = {
        format_simpletext: function(attrname) {
            if (this.transform_description) {
                var matcher = {
                    name: attrname,
                    category: "core"
                }
                if (_.find(this.transform_description, matcher)) {
                    var updates = _(this.transform_description)
                        .select(matcher)
                        .reject({old_text: undefined})
                        .reverse()
                        .map("old_text")
                        .map(function (t) {
                            return "<span style='color: indianred'><i class='fa fa-minus'></i>" + t + "</span>";
                        })
                        .value();
                    updates.push("<span style='color: darkseagreen'><i class='fa fa-plus'></i>" + this.character.get(attrname) + "</span>");
                    return updates.join(" ");
                }
            }
            return this.character.get(attrname);
        },

        format_attribute_value: function(attribute) {
            if (this.transform_description) {
                var matcher = {
                    name: attribute.get("name"),
                    category: "attributes"
                }
                var change = _.find(this.transform_description, matcher);
                if (change) {
                    var updates = _(this.transform_description)
                        .select(matcher)
                        .reject({fake: undefined})
                        .map("fake")
                        .map(function (fake) {
                            return "<span style='color: indianred'><i class='fa fa-minus'></i>" + fake.get("value") + "</span>";
                        })
                        .value();
                    updates.push("<span style='color: darkseagreen'><i class='fa fa-plus'></i>" + attribute.get("value") + "</span>");
                    return updates.join(" ");
                }
            }
            return attribute.get("value");
        },

        format_attribute_focus: function(name) {
            var focusName = "focus_" + name.toLowerCase() + "s";
            var focusNames = _.map(this.character.get(focusName), function (focus) {
                return focus.get("name");
            });
            return focusNames.join(" ");
        },

        _format_skill_string: function(skill, style) {
            var dot = "O";
            if (_.isUndefined(style)) {
                style = 2;
            }
            var name = skill.get("name");
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
        
        format_skill: function(skill, style) {
            var self = this;
            var output = this._format_skill_string(skill, style);
            if (this.transform_description) {
                var matcher = {
                    name: skill.get("name"),
                    category: skill.get("category"),
                }
                var change = _.find(this.transform_description, matcher);
                if (change) {
                    var updates = _(this.transform_description)
                        .select(matcher)
                        .reject({fake: undefined})
                        .map("fake")
                        .map(function (fake) {
                            var fake_format = self._format_skill_string(fake, style);
                            return "<span style='color: indianred'><i class='fa fa-minus'></i>" + fake_format + "</span>";
                        })
                        .value();
                    updates.push("<span style='color: darkseagreen'><i class='fa fa-plus'></i>" + output + "</span>");
                    return updates.join(" ");
                }
            }
            return output;
        },

        format_specializations: function(name) {
            return _.pluck(this.character.get(name), "attributes.name");
        },
    };

    // Returns the View class
    return Mixin;

} );
