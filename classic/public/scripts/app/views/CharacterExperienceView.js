// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "moment",
    "../models/ExperienceNotation",
    "../collections/ExperienceNotationCollection",
    "../collections/VampireChangeCollection"
], function( $, Backbone, moment, ExperienceNotation, ExperienceNotationCollection, VampireChangeCollection) {

    var MOMENT_FORMAT = "L LTS";
    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            var self = this;

            self.start = 0;
            self.changeBy = 10;
        },

        register: function(character, start, changeBy) {
            var self = this;
            var p = Parse.Promise.as([]);

            if (character !== self.character) {
                if (self.character) {
                    self.stopListening(self.character);
                    self.stopListening(self.collection);
                }
                self.character = character;
                p = self.character.get_experience_notations(function (rc) {
                    self.stopListening(rc);
                    self.listenTo(rc, "add reset remove change:reason", self.render);
                    self.listenTo(self.character, "begin_experience_notation_propagation", function() {
                        $.mobile.loading("show");
                    });
                    self.listenTo(self.character, "finish_experience_notation_propagation", function() {
                        self.render();
                        $.mobile.loading("hide");
                    })
                    self.collection = rc;
                }, function (rc) {
                    self.render();
                });
            }

            return p.then(function () {
                Parse.Promise.as(self);
            });
        },

        events: {
            "click .previous": "previous",
            "click .next": "next",
            "click .add": "add",
            "click .experience-notation-edit": "edit_experience_notation",
            "submit #edit-entered-popup-form": "submit_experience_notation_entered",
            "submit #edit-reason-popup-form": "submit_experience_notation_reason",
            "submit #edit-alteration-popup-form": "submit_experience_notation_alteration",
            "click .experience-notation-delete": "delete_experience_notation"
        },

        submit_experience_notation_entered: function(event, a, b, c, d) {
            var self = this;
            event.preventDefault();
            var id = self.$("#popupEditEntered #date-id").val();
            var d = self.$("#popupEditEntered #date-input").val();
            var en = self.collection.getByCid(id);
            var updatedEntered = moment(d, MOMENT_FORMAT);
            if (updatedEntered.isValid()) {
                en.set("entered", updatedEntered.toDate());
                en.save();
                $("#popupEditEntered").popup("close");
            } else {
                // Can't do validation this way because then we would have to watch for
                // change to update the state ourselves
                //self.$("#popupEditEntered #date-input")[0].setCustomValidity("Can't parse date and/or time input");
            }
        },

        submit_experience_notation_reason: function(event) {
            var self = this;
            event.preventDefault();
            var id = self.$("#popupEditReason #reason-id").val();
            var txt = self.$("#popupEditReason #reason-input").val();
            var en = self.collection.getByCid(id);
            en.set("reason", txt);
            en.save();
            $("#popupEditReason").popup("close");
        },

        submit_experience_notation_alteration: function(event) {
            var self = this;
            event.preventDefault();
            var id = self.$("#alterationpopupEdit #alteration-id").val();
            var n = _.parseInt(self.$("#alterationpopupEdit #alteration-input").val());
            n = _.isFinite(n) ? n : 0;
            var en = self.collection.getByCid(id);
            var type = self.$("#alterationpopupEdit #alteration-type").val();
            en.set("alteration_" + type, n);
            en.save();
            $("#alterationpopupEdit").popup("close");
        },

        edit_experience_notation: function(event) {
            var self = this;
            var t = self.$(event.target);
            var clickedNotationId = t.attr("notation-id");
            var headerName = t.attr("header");
            var en = self.collection.getByCid(clickedNotationId);
            event.preventDefault();
            if ("entered" === headerName) {
                var popup = $("#popupEditEntered");
                $("#popupEditEntered #date-input").val(moment(en.get("entered")).format(MOMENT_FORMAT));
                //self.$("#popupEditEntered #date-input")[0].setCustomValidity("");
                $("#popupEditEntered #date-id").val(clickedNotationId);
                popup.enhanceWithin().popup("open");
            } else if ("reason" === headerName) {
                var popup = $("#popupEditReason");
                $("#popupEditReason #reason-input").val(en.get("reason"));
                $("#popupEditReason #reason-id").val(clickedNotationId);
                popup.enhanceWithin().popup("open");
            } else if ("alteration_spent" === headerName) {
                var popup = $("#alterationpopupEdit");
                $("#alterationpopupEdit #alteration-input").val(en.get("alteration_spent"));
                $("#alterationpopupEdit #alteration-id").val(clickedNotationId);
                $("#alterationpopupEdit #alteration-type").val("spent");
                popup.enhanceWithin().popup("open");
            } else if ("alteration_earned" === headerName) {
                var popup = $("#alterationpopupEdit");
                $("#alterationpopupEdit #alteration-input").val(en.get("alteration_earned"));
                $("#alterationpopupEdit #alteration-id").val(clickedNotationId);
                $("#alterationpopupEdit #alteration-type").val("earned");
                popup.enhanceWithin().popup("open");
            }
        },

        delete_experience_notation: function(event) {
            event.preventDefault();
            var self = this;
            var t = self.$(event.target);
            var clickedNotationId = t.attr("notation-id");
            var cidgot = self.collection.getByCid(clickedNotationId);
            var idgot = self.collection.get(clickedNotationId);
            var en = self.collection.getByCid(clickedNotationId) || self.collection.get(clickedNotationId);
            if (!en) {
                return self;
            }
            self.character.remove_experience_notation(en);
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
            self.character.add_experience_notation({reason: "Unspecified reason"});
        },

        update_collection_query_and_fetch: function () {
            var self = this;
            var options = {reset: true};
            var q = new Parse.Query(ExperienceNotation);
            q.equalTo("owner", self.character).addDescending("entered").addDescending("createdAt");
            /*
            q.skip(self.start);
            q.limit(self.changeBy);
            */
            self.collection.query = q;
            return self.collection.fetch(options).then(function () {
                var q = new Parse.Query(VampireChange);
                q.equalTo("owner", self.character).addAscending("createdAt").limit(1000);
                self.changes.query = q;
                return self.changes.fetch(options);
            });
        },

        format_entry: function(log, entry) {
            if (log.has(entry)) {
                var v = log.get(entry);
                if (_.isDate(v)) {
                    return moment(v).format(MOMENT_FORMAT);
                }
                return log.get(entry);
            }
            var attr = log[entry];
            if (_.isDate(attr)) {
                return moment(attr).format(MOMENT_FORMAT);
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