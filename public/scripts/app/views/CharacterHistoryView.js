// Category View
// =============

// Includes file dependencies
define([
    "underscore",
    "jquery",
    "backbone",
    "marionette",
    "parse",
    "moment",
    "text!../templates/character-print-view.html",
    "text!../templates/character-history-selected-view.html",
    "text!../templates/character-history-view.html",
    "../helpers/VampirePrintHelper"
], function( _, $, Backbone, Marionette, Parse, moment, character_print_view_html, character_history_selected_view_html, character_history_view_html, VampirePrintHelper) {

    var MainView = Marionette.ItemView.extend({
        template: _.template(character_history_view_html),
        templateHelpers: function () {
            var self = this;
            return {
                "character": this.model,
                "logs": this.model.recorded_changes.models,
                idForPickedIndex: self.picked.get("value")
            }
        },       
        modelEvents: {
            "saved": "update_then_render"
        },
        events: {
            "change": "update_picked"
        },
        initialize: function(options) {
            this.picked = options.picked;
            this.override = options.override;
            
            _.bindAll(this, "templateHelpers");
        },
        update_picked: function (e) {
            var self = this;
            var selectedIndex = _.parseInt(this.$(e.target).val());
            self.picked.set("value", selectedIndex);

            var selectedId = this.$("#history-changes-" + selectedIndex).val();
            var changesToApply = _.chain(self.model.recorded_changes.models).takeRightWhile(function (model) {
                return model.id != selectedId;
            }).reverse().value();
            var c = self.model.get_transformed(changesToApply);
            self.override.set("character", c);
        },
        update_then_render: function() {
            var self = this;
            self.model.update_recorded_changes().then(function () {
                self.render();
            });
        },
        onRender: function() {
            this.$el.enhanceWithin();
        }
    });
    
    var ViewingView = Marionette.ItemView.extend({
        template: _.template(character_history_selected_view_html),
        templateHelpers: function () {
            var self = this;
            return {
                "character": this.model,
                "logs": this.model.recorded_changes.models,
                "format_entry": this.format_entry,
                idForPickedIndex: self.picked.get("value")
            }
        },       
        modelEvents: {
            "add": "render",
            "reset": "render"
        },
        initialize: function(options) {
            this.picked = options.picked;
            
            this.listenTo(
                this.picked,
                "change",
                _.debounce(this.render, 100, { trailing: true}));
            
            _.bindAll(this, "templateHelpers");
        },
        format_entry: function(log, entry) {
            if (_.isUndefined(log)) {
                console.log("Undefined log");
                return "Undefined log";
            }
            if (log.get(entry)) {
                return log.get(entry);
            }
            var attr = log[entry];
            if (_.isDate(attr)) {
                return moment(attr).format('lll');
            }
            return attr;
        },
        onRender: function() {
            this.$el.enhanceWithin();
        }
    });
    
    var SheetView = Marionette.ItemView.extend({
        template: _.template(character_print_view_html),
        templateHelpers: function () {
            var self = this;
            var character = self.override.get("character") || self.model
            var sortedSkills = character.get_sorted_skills();
            return {
                "character": character,
                "skills": sortedSkills,
                "groupedSkills": character.get_grouped_skills(sortedSkills),
                format_simpletext: this.format_simpletext,
                format_attribute_value: this.format_attribute_value,
                format_attribute_focus: this.format_attribute_focus,
                format_skill: this.format_skill,
                format_specializations: this.format_specializations
            }
        },       
        modelEvents: {
            "change": "renderIfNoOverride",
        },
        initialize: function(options) {
            this.override = options.override;
            this.listenTo(
                this.override,
                "change",
                _.debounce(this.render, 100, { trailing: true}));
            
            _.bindAll(
                this,
                "templateHelpers",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );
 
        },
        renderIfNoOverride: function() {
            var self = this;
            if (self.override.get("character") == null) {
                return;
            }
            return self.render();
        },
        onRender: function() {
            this.$el.enhanceWithin();
        }
    })
    _.extend(SheetView.prototype, VampirePrintHelper);
    
    var LayoutView = Marionette.LayoutView.extend({
        tagName: "div",
        regions: {
            main: "#history-main",
            viewing: "#history-viewing",
            sheet: "#history-sheet"
        },
        
        register: function(model) {
            var self = this;
            var p = Parse.Promise.as([]);

            if (model != self.model) {
                self.model = model;
                self.picked = new Backbone.Model({value: 0});
                self.override = new Backbone.Model({character: null});

                p = self.model.get_recorded_changes().then(function () {
                    self.picked.set("value", self.model.recorded_changes.models.length - 1);
                    
                    // Set up child views now
                    self.showChildView('main', new MainView({
                        model: self.model,
                        picked: self.picked,
                        override: self.override
                    }));
                    self.showChildView('viewing', new ViewingView({
                        model: self.model,
                        picked: self.picked
                    }));
                    self.showChildView('sheet', new SheetView({
                        model: self.model,
                        override: self.override
                    }));
                });
            }
            
            return p.then(function () {
                Parse.Promise.as(self);
            });
        },
        onRender: function () {
            this.$el.enhanceWithin();
        }
    });
    
    return LayoutView;

} );