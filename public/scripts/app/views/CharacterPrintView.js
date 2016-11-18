// Category View
// =============

/* global _ */
// Includes file dependencies
define([
	"jquery",
	"backbone",
    "text!../templates/character-print-view.html",
    "../helpers/VampirePrintHelper",
    "marionette",
    "text!../templates/character-print-parent.html",
    "text!../templates/print/blood.html",
    "text!../templates/print/morality.html",
    "text!../templates/print/willpower.html",
    "text!../templates/print/health-levels.html",
    "text!../templates/print/skills.html",
    "text!../templates/print/section.html",
    "text!../templates/print/gnosis.html",
    "text!../templates/print/total.html",
    "text!../templates/print/fixed-blood.html",
], function(
    $,
    Backbone,
    character_print_view_html,
    VampirePrintHelper,
    Marionette,
    character_print_parent_html,
    blood_html,
    morality_html,
    willpower_html,
    health_levels_html,
    skills_html,
    section_html,
    gnosis_html,
    total_html,
    fixed_blood_html
) {

    var HeaderView = Marionette.ItemView.extend({
        template: _.template('<h1 class="ui-bar ui-bar-a"><%= format_simpletext("name") %></h1>'),
        templateHelpers: function() {
            var self = this;
            return {
                format_simpletext: self.format_simpletext
            }
        },
        initialize: function() {
            _.bindAll(this,
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        }
    });
    _.extend(HeaderView.prototype, VampirePrintHelper);
    
    var TextBarView = Marionette.ItemView.extend({
        className: "ui-grid-b ui-responsive",
        template: function(serialized_model) {
            var self = this;
            var tmpl = _.map(self.fields, function(field, i) {
                if (serialized_model[field.name]) {
                    return '<div class="ui-block-' + String.fromCharCode(97 + i) + '">\
                                <h2 class="ui-bar ui-bar-a">' + field.display + ': <%= format_simpletext("' + field.name + '") %></h2>\
                            </div>'
                }
            })
            tmpl = _.without(tmpl, undefined);
            tmpl = _.template(tmpl.join(""));
            return tmpl(serialized_model);
        },
        templateHelpers: function() {
            var self = this;
            return {
                format_simpletext: self.format_simpletext
            }
        },
        initialize: function(options) {
            var self = this;
            this.fields = options.fields
            
            _.each(this.fields, function (field) {
                self.listenTo(self.model, "change:" + field.name, self.render);
            });
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        }
    });
    _.extend(TextBarView.prototype, VampirePrintHelper);
    
    var AttributesView = Marionette.ItemView.extend({
        template: function(serialized_model) {
            var self = this;
            var tmpl = _.map(["Physical", "Social", "Mental"], function (name, i) {
                var str = ['<div class="ui-block-' + String.fromCharCode(97 + i) + '">'];
                str.push('<h4 class="ui-bar ui-bar-a ui-corner-all">' + name + '</h4>');
                str.push('<div class="ui-body">');
                var attribute = _.find(self.model.get("attributes"), "attributes.name", name);
                if (attribute) {
                    str.push(self.format_attribute_value(attribute));
                }
                str.push('<br/>');
                str.push(self.format_attribute_focus(name));
                str.push('</div></div>');
                return str.join("");
            });
            tmpl = _.without(tmpl, undefined);
            tmpl = _.template(tmpl.join(""));
            return tmpl(serialized_model);
        },
        templateHelpers: function() {
            var self = this;
            return {
                format_simpletext: self.format_simpletext,
                format_attribute_value: self.format_attribute_value,
                format_attribute_focus: self.format_attribute_focus
            }
        },
        initialize: function(options) {
            var self = this;
            this.$el.addClass("ui-grid-b");
            this.$el.addClass("ui-responsive");
            
            _.each(this.fields, function (field) {
                self.listenTo(self.model, "change:" + field, self.render);
            });
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        }
    });
    _.extend(AttributesView.prototype, VampirePrintHelper);
    
    var BloodView = Marionette.ItemView.extend({
        template: _.template(blood_html),
        templateHelpers: function() {
            var self = this;
            return {
                character: self.model
            }
        },
        initialize: function(options) {
            var self = this;
            
            self.listenTo(self.model, "change:backgrounds", self.render);
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        },
        onRender: function () {
            this.$el = this.$el.children();
            this.$el.unwrap();
            this.setElement(this.$el);
        }
    });
    _.extend(BloodView.prototype, VampirePrintHelper);
    
    var FixedBloodView = Marionette.ItemView.extend({
        template: _.template(fixed_blood_html),
        templateHelpers: function() {
            var self = this;
            return {
                character: self.model
            }
        },
        initialize: function(options) {
            var self = this;
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        },
        onRender: function () {
            this.$el = this.$el.children();
            this.$el.unwrap();
            this.setElement(this.$el);
        }
    });
    _.extend(FixedBloodView.prototype, VampirePrintHelper);
    
    var WillpowerView = Marionette.ItemView.extend({
        template: _.template(willpower_html),
        templateHelpers: function() {
            var self = this;
            return {
                character: self.model
            }
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change:willpower_sources", self.render);
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        }
    });
    _.extend(WillpowerView.prototype, VampirePrintHelper);
    
    var GnosisView = Marionette.ItemView.extend({
        template: _.template(gnosis_html),
        templateHelpers: function() {
            var self = this;
            return {
                character: self.model
            }
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change:gnosis_sources", self.render);
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        }
    });
    _.extend(GnosisView.prototype, VampirePrintHelper);
    
    var MoralityView = Marionette.ItemView.extend({
        template: _.template(morality_html),
        templateHelpers: function() {
            var self = this;
            return {
                character: self.model
            }
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change:paths", self.render);
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        }
    });
    _.extend(MoralityView.prototype, VampirePrintHelper);
    
    var HealthLevelsView = Marionette.ItemView.extend({
        template: _.template(health_levels_html),
        templateHelpers: function() {
            var self = this;
            return {
                character: self.model
            }
        },
        initialize: function(options) {
            var self = this;
            this.column = options.column;
            self.listenTo(self.model, "change:health_levels", self.render);
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        },
        onRender: function () {
            this.$el = this.$el.children();
            this.$el.unwrap();
            this.setElement(this.$el);
        }
    });
    _.extend(HealthLevelsView.prototype, VampirePrintHelper);
    
    var TotalView = Marionette.ItemView.extend({
        template: _.template(total_html),
        templateHelpers: function() {
            var self = this;
            return {
                character: self.model
            }
        },
        initialize: function(options) {
            var self = this;
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        },
        onRender: function () {
            this.$el = this.$el.children();
            this.$el.unwrap();
            this.setElement(this.$el);
        }
    });
    _.extend(TotalView.prototype, VampirePrintHelper);
 
    
    var SkillsView = Marionette.ItemView.extend({
        template: _.template(skills_html),
        templateHelpers: function() {
            var self = this;
            var sortedSkills = self.model.get_sorted_skills();
            return {
                character: self.model,
                skills: sortedSkills,
                groupedSkills: self.model.get_grouped_skills(sortedSkills, 3),
                format_skill: self.format_skill
            }
        },
        initialize: function(options) {
            var self = this;
            
            self.listenTo(self.model, "change:skills", self.render);
            
            self.base_abilities = [];
            self.base_abilities.push(["Academics", "Animal Ken", "Athletics", "Awareness", "Brawl", "Computer", "Crafts", "Dodge", "Drive"]);
            self.base_abilities.push(["Empathy", "Firearms", "Intimidation", "Investigation", "Leadership", "Linguistics", "Lore", "Medicine", "Melee", "Occult"]);
            self.base_abilities.push(["Performance", "Science", "Security", "Stealth", "Streetwise", "Subterfuge", "Survival"]);
            self.base_abilities = _.flatten(self.base_abilities);
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        }
    });
    _.extend(SkillsView.prototype, VampirePrintHelper);
    
    var SectionsView = Marionette.ItemView.extend({
        template: _.template(section_html),
        templateHelpers: function() {
            var self = this;
            _.each(self.sections, function(s) {
                var sort = s.sort || "name";
                var direction = s.direction || "asc";
                var values = self.model.get(s.name);
                if (sort == "name") {
                    values = _.sortByAll(values, ["attributes.name"]);
                } else if (sort == "value") {
                    values = _.sortByAll(values, ["attributes.value", "attributes.name"]);
                }
                if (direction == "desc") {
                    values = _(values).reverse().value();
                }
                s.values = values;
            });
            
            return {
                character: self.model,
                sections: self.sections,
                format_skill: self.format_skill
            }
        },
        initialize: function(options) {
            var self = this;
            this.column = options.column;
            this.sections = options.sections;
            
            _.each(self.sections, function(s) {
                self.listenTo(self.model, "change:" + s.name, self.render);
            })
            
            _.bindAll(this,
                "render",
                "template",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
        },
        onRender: function () {
            this.$el = this.$el.children();
            this.$el.unwrap();
            this.setElement(this.$el);
        }
    });
    _.extend(SectionsView.prototype, VampirePrintHelper);
    
    var LayoutView = Marionette.LayoutView.extend({
        template: _.template(character_print_parent_html),
        
        regions: {
            header: "#cpp-header",
            firstbar: "#cpp-firstbar",
            secondbar: "#cpp-secondbar",
            attributes: "#cpp-attributes",
            blood: "#cpp-blood",
            morality: "#cpp-morality",
            willpower: "#cpp-willpower",
            health_levels: "#cpp-health-levels",
            total_a: "#cpp-total-a",
            total_b: "#cpp-total-b",
            total_c: "#cpp-total-c",
            skills: "#cpp-skills",
            bottom_one_a: "#cpp-bottom-one-a",
            bottom_one_b: "#cpp-bottom-one-b",
            bottom_one_c: "#cpp-bottom-one-c",
            bottom_two_a: "#cpp-bottom-two-a",
            bottom_two_b: "#cpp-bottom-two-b",
            bottom_two_c: "#cpp-bottom-two-c"
        },
        
        setup: function(character) {
            var self = this;
            var options = self.options || {};
            if (self.lasttribe && self.character.get("wta_tribe") == self.lasttribe) {
                if (character == self.character) {
                    return;
                }
            }
            self.lasttribe = character.get("wta_tribe");
            self.character = character;
            
            self.render();
            
            if (self.character.get("type") == "Werewolf") {
                self.showChildView('header', new HeaderView({model: character}), options);
                self.showChildView('firstbar', new TextBarView({
                    model: character,
                    fields: [{
                        name: "wta_tribe",
                        display: "Tribe"
                    },{
                        name: "wta_breed",
                        display: "Breed", 
                    },{
                        name:"wta_auspice",
                        display: "Auspice"
                    }]
                }), options);
                self.showChildView('secondbar', new TextBarView({
                    model: character,
                    fields: [{
                        name: "archetype",
                        display: "Archetype" + ", " + "archtype_2" 
                    },{
                        name: "wta_camp",
                        display: "Camp", 
                    },{
                        name:"wta_faction",
                        display: "Faction"
                    }]
                }), options);
                self.showChildView('attributes', new AttributesView({model: character}), options);
                if (self.character.get("wta_tribe") == "Ananasi") {
                    self.showChildView('blood', new FixedBloodView({model: new Backbone.Model({
                        generation: 0,
                        total: 15,
                        split: 5,
                        linebreak: 10,
                        blood_per_turn: 3
                    })}), options);
                } else {
                    self.showChildView('blood', new GnosisView({
                        model: character,
                        column: 1
                    }), options);
                }
                self.showChildView('willpower', new WillpowerView({model: character}), options);
                self.showChildView('health_levels', new HealthLevelsView({model: character}), options);
                // Forms
                // Rage
                if (self.character.get("wta_tribe") != "Ananasi") {
                    self.showChildView('morality', new TotalView({model: new Backbone.Model({
                        name: "Rage",
                        total: 10,
                        split: 7
                    })}), options);
                }
                // Harano
                self.showChildView('total_a', new TotalView({model: new Backbone.Model({
                    name: "Harano",
                    total: 5,
                    split: 5
                })}), options);
                // Wyrm Taint
                self.showChildView('total_b', new TotalView({model: new Backbone.Model({
                    name: "Wyrm Taint",
                    total: 5,
                    split: 5
                })}), options);
                // Seethe
                self.showChildView('total_c', new TotalView({model: new Backbone.Model({
                    name: "Seethe Traits",
                    total: 10,
                    split: 5
                })}), options);
                self.showChildView('skills', new SkillsView({model: character}), options);
                self.showChildView('bottom_one_a', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Backgrounds",
                        name: "wta_backgrounds",
                        format: 1
                    },{
                        display: "Haven",
                        name: "haven_specializations",
                        format: 1
                    },{
                        display: "Influences: The Elite",
                        name: "influence_elite_specializations",
                        format: 1
                    },{
                        display: "Influences: The Underworld",
                        name: "influence_underworld_specializations",
                        format: 1
                    },{
                        display: "Contacts",
                        name: "contacts_specializations",
                        format: 1
                    },{
                        display: "Allies",
                        name: "allies_specializations",
                        format: 1
                    },{
                        display: "Rites",
                        name: "wta_rites",
                        format: 1
                    }]
                }), options);
     
                self.showChildView('bottom_one_b', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Gifts",
                        name: "wta_gifts",
                        format: 1,
                        sort: "value",
                        direction: "asc"
                    }]
                }), options);
                
                self.showChildView('bottom_one_c', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Merits",
                        name: "wta_merits",
                        format: 4
                    },{
                        display: "Flaws",
                        name: "wta_flaws",
                        format: 4
                    },{
                        display: "Monikers",
                        name: "monikers",
                        format: 4
                    }]
                }), options);
                
                self.showChildView('bottom_two_a', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Lores",
                        name: "lore_specializations",
                        format: 0
                    },{
                        display: "Academics",
                        name: "academics_specializations",
                        format: 0
                    },{
                        display: "Totem Bonuses",
                        name: "wta_totem_bonus_traits",
                        format: 0
                    }]
                }), options);
                
                self.showChildView('bottom_two_b', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Rituals",
                        name: "rituals",
                        format: 0
                    }]
                }), options);
                
                self.showChildView('bottom_two_c', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Languages",
                        name: "linguistics_specializations",
                        format: 0
                    },{
                        display: "Drive",
                        name: "drive_specializations",
                        format: 0
                    }]
                }), options);
            } else {
                self.showChildView('header', new HeaderView({model: character}), options);
                self.showChildView('firstbar', new TextBarView({
                    model: character,
                    fields: [{
                        name: "clan",
                        display: "Clan"
                    },{
                        name: "archetype",
                        display: "Archetype", 
                    },{
                        name:"antecedence",
                        display: "Antecedence"
                    }]
                }), options);
                self.showChildView('secondbar', new TextBarView({
                    model: character,
                    fields: [{
                        name: "sect",
                        display: "Sect"
                    },{
                        name: "faction",
                        display: "Faction", 
                    },{
                        name:"title",
                        display: "Title"
                    }]
                }), options);
                self.showChildView('attributes', new AttributesView({model: character}), options);
                self.showChildView('blood', new BloodView({model: character}), options);
                self.showChildView('morality', new MoralityView({model: character}), options);
                self.showChildView('willpower', new WillpowerView({model: character}), options);
                self.showChildView('health_levels', new HealthLevelsView({model: character}), options);
                self.showChildView('skills', new SkillsView({model: character}), options);
                self.showChildView('bottom_one_a', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Backgrounds",
                        name: "backgrounds",
                        format: 1
                    },{
                        display: "Haven",
                        name: "haven_specializations",
                        format: 1
                    },{
                        display: "Influences: The Elite",
                        name: "influence_elite_specializations",
                        format: 1
                    },{
                        display: "Influences: The Underworld",
                        name: "influence_underworld_specializations",
                        format: 1
                    },{
                        display: "Contacts",
                        name: "contacts_specializations",
                        format: 1
                    },{
                        display: "Sabbat Rituals",
                        name: "sabbat_rituals",
                        format: 1
                    },{
                        display: "Allies",
                        name: "allies_specializations",
                        format: 1
                    }]
                }), options);
     
                self.showChildView('bottom_one_b', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Disciplines",
                        name: "disciplines",
                        format: 1
                    },{
                        display: "Techniques",
                        name: "techniques",
                        format: 0
                    },{
                        display: "Elder Disciplines",
                        name: "elder_disciplines",
                        format: 0
                    }]
                }), options);
                
                self.showChildView('bottom_one_c', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Merits",
                        name: "merits",
                        format: 4
                    },{
                        display: "Flaws",
                        name: "flaws",
                        format: 4
                    },{
                        display: "Status",
                        name: "status_traits",
                        format: 4
                    }]
                }), options);
                
                self.showChildView('bottom_two_a', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Lores",
                        name: "lore_specializations",
                        format: 0
                    },{
                        display: "Academics",
                        name: "academics_specializations",
                        format: 0
                    }]
                }), options);
                
                self.showChildView('bottom_two_b', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Rituals",
                        name: "rituals",
                        format: 0
                    }]
                }), options);
                
                self.showChildView('bottom_two_c', new SectionsView({
                    model: character,
                    sections: [{
                        display: "Languages",
                        name: "linguistics_specializations",
                        format: 0
                    },{
                        display: "Drive",
                        name: "drive_specializations",
                        format: 0
                    },{
                        display: "Texts",
                        name: "vampiric_texts",
                        format: 0
                    }]
                }), options);
     
            }
 
            return self;
        }
        
    });

    //return View;
    return LayoutView;

} );
