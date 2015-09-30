// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "moment",
    "../models/ExperienceNotation",
    "../collections/ExperienceNotationCollection"
], function( $, Backbone, moment, ExperienceNotation, ExperienceNotationCollection) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            var self = this;
            this.collection = new ExperienceNotationCollection;
            self.listenTo(self.collection, "add", self.render);
            self.listenTo(self.collection, "reset", self.render);

            self.start = 0;
            self.changeBy = 10;
        },

        register: function(character, start, changeBy) {
            var self = this;
            var changed = false;
            start = _.parseInt(start);
            changeBy = _.parseInt(changeBy);

            if (start != self.start) {
                self.start = start;
                changed = true;
            }

            if (changeBy != self.changeBy) {
                self.changeBy = changeBy;
                changed = true;
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
            "click .add": "add",
            "click .experience-notation-edit": "edit_experience_notation",
        },

        edit_experience_notation: function(event, b, c, d) {
            console.log("I'm here");
            var t = self.$(event.target);
            var clickedNotationId = t.attr("notation-id");
            var headerName = t.attr("header");
            event.preventDefault();
        },

        previous: function() {
            var self = this;
            var incr = this.start - this.changeBy;
            this.start = _.max([0, incr]);
            window.location.hash = "#character/" + self.character.id + "/experience/" + this.start + "/10";
            $.mobile.loading("show");
            this.update_collection_query_and_fetch().then(function() {
                $.mobile.loading("hide");
            })
        },

        next: function() {
            var self = this;
            this.start += self.changeBy;
            window.location.hash = "#character/" + self.character.id + "/experience/" + this.start + "/10";
            $.mobile.loading("show");
            this.update_collection_query_and_fetch().then(function() {
                $.mobile.loading("hide");
            })
        },

        add: function() {
            var self = this;
            var en = new ExperienceNotation({
                entered: new Date,
                reason: "Unspecified reason",
                earned: 0,
                available: 0,
                alteration: 0,
                owner: self.character,
            });
            en.setACL(self.character.get_me_acl());
            self.collection.add(en);
            en.save();
        },

        update_collection_query_and_fetch: function () {
            var self = this;
            var options = {reset: true};
            var q = new Parse.Query(ExperienceNotation);
            q.equalTo("owner", self.character).addDescending("entered").addDescending("createdAt");
            q.skip(self.start);
            q.limit(self.changeBy);
            self.collection.query = q;
            return self.collection.fetch(options);
        },

        format_entry: function(log, entry) {
            if (log.has(entry)) {
                var v = log.get(entry);
                if (_.isDate(v)) {
                    return moment(v).format('lll');
                }
                return log.get(entry);
            }
            var attr = log[entry];
            if (_.isDate(attr)) {
                return moment(attr).format('lll');
            }
            return attr;
        },

        // Renders all of the Category models on the UI
        render: function() {
            // Sets the view's template property
            this.template = _.template(
                $( "script#experienceNotationsAllView" ).html())(
                { "character": this.character,
                  "logs": this.collection.models,
                  "format_entry": this.format_entry} );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );