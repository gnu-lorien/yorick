// Category View
// =============

// Includes file dependencies
define([
    "jquery",
    "backbone",
    "moment",
    "../models/VampireChange",
    "../collections/VampireChangeCollection"
], function( $, Backbone, moment, VampireChange, VampireChangeCollection) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            var self = this;

            self.sheetTemplate = _.template($( "script#characterPrintView" ).html());
            self.selectedTemplate = _.template($("script#characterHistorySelectedView").html());
        },

        register: function(character, changeId) {
            var self = this;
            var p = Parse.Promise.as([]);

            if (character !== self.character) {
                if (self.character) {
                    self.stopListening(self.character);
                    if (self.character.recorded_changes) {
                        self.stopListening(self.character.recorded_changes);
                    }
                }
                self.character = character;

                p = self.character.get_recorded_changes(function (rc) {
                    self.listenTo(rc, "add", self.render);
                    self.listenTo(rc, "reset", self.render);
                });
            }

            return p.then(function () {
                Parse.Promise.as(self);
            });
        },

        events: {
            "click .previous": "previous",
            "click .next": "next",
            "change": "update_selected",
        },

        update_collection_query_and_fetch: function () {
            var self = this;
            var options = {reset: true};
            var q = new Parse.Query(VampireChange);
            q.equalTo("owner", self.character).addAscending("createdAt").limit(1000);
            self.collection.query = q;
            return self.collection.fetch(options);
        },

        format_entry: function(log, entry) {
            if (log.get(entry)) {
                return log.get(entry);
            }
            var attr = log[entry];
            if (_.isDate(attr)) {
                return moment(attr).format('lll');
            }
            return attr;
        },

        update_selected: function (e) {
            var self = this;
            var selectedIndex = _.parseInt(this.$(e.target).val());
            self.idForPickedIndex = selectedIndex;
            self._render_viewing(true);

            var selectedId = this.$("#history-changes-" + selectedIndex).val();
            var changesToApply = _.chain(self.character.recorded_changes.models).takeRightWhile(function (model) {
                return model.id != selectedId;
            }).reverse().value();
            var c = self.character.get_transformed(changesToApply);
            self._render_sheet(c, true);
        },

        _render_viewing: function(enhance) {
            var self = this;
            var sendId = self.idForPickedIndex;
            if (_.isUndefined(sendId)) {
                sendId = self.character.recorded_changes.models.length - 1;
            }
            this.$el.find("#history-viewing").html(this.selectedTemplate({
                "character": this.character,
                "logs": self.character.recorded_changes.models,
                "format_entry": this.format_entry,
                idForPickedIndex: sendId,
            }));
            if (enhance) {
                this.$el.find("#history-viewing").enhanceWithin();
            }
        },

        _render_sheet: function(characterOverride, enhance) {
            var self = this;
            var c = characterOverride || self.character;
            var sortedSkills = c.get_sorted_skills();
            var groupedSkills = c.get_grouped_skills(sortedSkills, 3);
            this.$el.find("#history-sheet").html(this.sheetTemplate({
                "character": c,
                "skills": sortedSkills,
                "groupedSkills": groupedSkills} ));
            if (enhance) {
                this.$el.find("#history-sheet").enhanceWithin();
            }
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            var sendId = self.idForPickedIndex;
            if (_.isUndefined(sendId)) {
                sendId = self.character.recorded_changes.models.length - 1;
            }

            // Sets the view's template property
            this.template = _.template(
                $( "script#characterHistoryView" ).html())({
                    "character": this.character,
                    "logs": this.character.recorded_changes.models,
                    "format_entry": this.format_entry,
                    idForPickedIndex: sendId,
                 });

            // Renders the view's template inside of the current listview element
            this.$el.find("#history-main").html(this.template);

            this._render_viewing();

            this._render_sheet();

            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );