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
            var paging_changed = false;

            // R48: both parameters were accepted and neither was used, so
            // /experience/0/10 and /experience/10/10 returned the identical
            // full set and the Prev/Next controls were commented out of the
            // template.
            //
            // Unlike `CharacterLogView`, which owns a display-only collection
            // and can page server-side, this view renders the character's own
            // `experience_notations` - the same collection
            // `_propagate_experience_notation_change` walks to keep every
            // row's running balance correct. Skipping rows in that query would
            // quietly corrupt the ledger, so the page is taken at render time
            // and the collection stays whole.
            start = _.parseInt(start);
            changeBy = _.parseInt(changeBy);
            if (!_.isFinite(start) || start < 0) {
                start = 0;
            }
            if (!_.isFinite(changeBy) || changeBy < 1) {
                changeBy = 10;
            }
            if (start !== self.start || changeBy !== self.changeBy) {
                self.start = start;
                self.changeBy = changeBy;
                paging_changed = true;
            }

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
            } else if (paging_changed) {
                self.render();
            }

            return p.then(function () {
                return Parse.Promise.as(self);
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
            self.start = _.max([0, self.start - self.changeBy]);
            self.render();
            window.location.hash = "#character/" + self.character.id + "/experience/" + self.start + "/" + self.changeBy;
        },

        next: function() {
            var self = this;
            if (self.start + self.changeBy >= self.collection.length) {
                return;
            }
            self.start += self.changeBy;
            self.render();
            window.location.hash = "#character/" + self.character.id + "/experience/" + self.start + "/" + self.changeBy;
        },

        add: function() {
            var self = this;
            self.character.add_experience_notation({reason: "Unspecified reason"});
        },

        /**
         * Refetch the whole ledger.
         *
         * Deliberately unpaged - see `register`. This also used to reference
         * `self.changes` and a `VampireChange` symbol that exist nowhere in
         * this view, so it threw if it was ever reached; nothing called it.
         */
        update_collection_query_and_fetch: function () {
            var self = this;
            var q = new Parse.Query(ExperienceNotation);
            q.equalTo("owner", self.character).addDescending("entered").addDescending("createdAt");
            self.collection.query = q;
            return self.collection.fetch({reset: true});
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
            var all = (this.collection && this.collection.models) || [];
            this.template = _.template(
                $( "script#experienceNotationsAllView" ).html())(
                { "character": this.character,
                  // The page, taken here rather than in the query, so the
                  // model keeps the whole ledger for balance propagation.
                  "logs": all.slice(this.start, this.start + this.changeBy),
                  "start": this.start,
                  "changeBy": this.changeBy,
                  "total": all.length,
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