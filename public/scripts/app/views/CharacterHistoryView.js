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
            this.collection = new VampireChangeCollection;
            self.listenTo(self.collection, "add", self.render);
            self.listenTo(self.collection, "reset", self.render);

            self.sheetTemplate = _.template($( "script#characterPrintView" ).html());
            self.selectedTemplate = _.template($("script#characterHistorySelectedView").html());
        },

        register: function(character, changeId) {
            var self = this;
            var changed = false;

            if (changeId != self.changeId) {
                self.changeId = changeId;
                change = true;
            }

            if (character !== self.character) {
                if (self.character)
                    self.stopListening(self.character);
                self.character = character;
                self.listenTo(self.character, "change:change_count", self.update_collection_query_and_fetch);
                changed = true;
            }

            if (changed) {
                self.update_collection_query_and_fetch();
            }

            return self;
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
            q.equalTo("owner", self.character).addAscending("createdAt");
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
            var selectedId = this.$("#history-changes-" + selectedIndex).val();
            self.idForPickedIndex = selectedIndex;
            self._render_viewing(true);

        },

        _render_viewing: function(enhance) {
            var self = this;
            var sendId = self.idForPickedIndex;
            if (_.isUndefined(sendId)) {
                var sendId = this.collection.models.length - 1;
            }
            this.$el.find("#history-viewing").html(this.selectedTemplate({
                "character": this.character,
                "logs": this.collection.models,
                "format_entry": this.format_entry,
                idForPickedIndex: sendId,
            }));
            if (enhance) {
                this.$el.find("#history-viewing").enhanceWithin();
            }
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;
            var cols = [];
            cols.push(["Academics", "Animal Ken", "Athletics", "Awareness", "Brawl", "Computer", "Crafts", "Dodge", "Drive"]);
            cols.push(["Empathy", "Firearms", "Intimidation", "Investigation", "Leadership", "Linguistics", "Lore", "Medicine", "Melee", "Occult"]);
            cols.push(["Performance", "Science", "Security", "Stealth", "Streetwise", "Subterfuge", "Survival"]);
            var a = _.zip.apply(_, cols)
            var s = self.character.get("skills");
            var f = _.find(s, {name: "Athletics"});
            var r = _.result(f, 'name', 0);
            skillsLookup = _.groupBy(s, function(skill) {
                return skill.get("name");
            });

            var sendId = self.idForPickedIndex;
            if (_.isUndefined(sendId)) {
                var sendId = this.collection.models.length - 1;
            }

            // Sets the view's template property
            this.template = _.template(
                $( "script#characterHistoryView" ).html())({
                    "character": this.character,
                    "logs": this.collection.models,
                    "format_entry": this.format_entry,
                    idForPickedIndex: sendId,
                 });

            // Renders the view's template inside of the current listview element
            this.$el.find("#history-main").html(this.template);

            this._render_viewing();

            this.$el.find("#history-sheet").html(this.sheetTemplate({
                "character": this.character,
                "skills": skillsLookup} ));

            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );