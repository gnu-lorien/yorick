// Category View
// =============

// Includes file dependencies
define([
    "jquery",
    "backbone",
    "moment",
    "text!../templates/character-print-view.html",
    "text!../templates/character-approval-view.html",
    "../collections/Approvals",
    "../models/Approval",
    "text!../templates/character-approval-selected-view.html",
], function( $,
             Backbone,
             moment,
             character_print_view_html,
             character_approval_view_html,
             Approvals,
             Approval,
             character_approval_selected_view_html) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            var self = this;

            self.sheetTemplate = _.template(character_print_view_html);
            self.approvalSelectedTemplate = _.template(character_approval_selected_view_html);
        },

        register: function(character) {
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

                self.approvals = new Approvals;
                var q = new Parse.Query(Approval);
                q.equalTo("owner", self.character);
                self.approvals.query = q;
                p = q.each(function (approval) {
                    self.approvals.add(approval);
                    self.approval_index = self.approvals.length;
                });
                p.then(function () {
                    return self.character.get_recorded_changes(function (rc) {
                        self.listenTo(rc, "add", self.render);
                        self.listenTo(rc, "reset", self.render);
                    });
                });
            }

            return p.then(function () {
                Parse.Promise.as(self);
            });
        },

        events: {
            "change #slider": "update_selected",
            "change #approval-slider": "update_approval_selected",
            "click .approve-change": "approve_change"
        },

        approve_change: function() {
            var self = this;
            var change = self.character.recorded_changes.at(self.idForPickedIndex);
            var approval = new Approval({
                approved: true,
                change: change,
                approver: Parse.User.current(),
                owner: self.character
            });
            return approval.save();
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
        
        format_approval: function(approval, h) {
            var sub = approval.get(h);
            if (_.isUndefined(sub)) {
                return _.result(approval, h);
            }
            if (_.has(sub, "id")) {
                return sub.id;
            }
            return sub;
        },

        _update_approval_selected: function (selectedIndex) {
            var self = this;
            self.approval_index = selectedIndex;
            self.approved = self.approvals.models[self.approval_index];
            self.left_approval_index = self.approval_index - 1
            if (self.left_approval_index >= 0) {
                self.left_approved = self.approvals.models[self.left_approval_index];
            } else {
                self.left_approved = null;
            }

            var selectedIndex = 0;
            if (self.approval_index < self.approvals.length) {
                var change = _.findLast(self.character.recorded_changes.models, function (model, i) {
                    if (model.id == self.approved.get("change").id) {
                        selectedIndex = i;
                        return true;
                    }
                    return false;
                })
            } else {
                selectedIndex = self.character.recorded_changes.length - 1;
            }
            self.idForPickedIndex = selectedIndex;
            if (self.left_approval_index >= 0) {
                _.findLast(self.character.recorded_changes.models, function (model, i) {
                    if (model.id == self.left_approved.get("change").id) {
                        self.left_rc_index = i + 1;
                        return true;
                    }
                    return false;
                });
            } else {
                self.left_rc_index = 0;
            }

            self.$("#slider").val(selectedIndex).slider('refresh');
            self.$("#sliderbaserange").val(self.left_rc_index).slider('refresh');

            return change || _.at(self.character.recorded_changes.models, -1);
        },

        update_approval_selected: function (e) {
            var self = this;
            var selectedIndex = _.parseInt(this.$(e.target).val());
            var change = self._update_approval_selected(selectedIndex);

            self._render_viewing(true);

            var changesToApply = _.chain(self.character.recorded_changes.models).takeRightWhile(function (model) {
                return model.id != change.id;
            }).reverse().value();
            var c = self.character.get_transformed(changesToApply);
            self._render_sheet(c, true);
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
            this.$el.find("#approval-viewing").html(this.approvalSelectedTemplate({
                "character": this.character,
                "logs": self.character.recorded_changes.models,
                "format_entry": this.format_entry,
                "format_approval": this.format_approval,
                idForPickedIndex: sendId,
                left_rc_index: self.left_rc_index,
                approval_index: self.approval_index,
                approvals: self.approvals.models,
                approval: self.approvals.models[self.approval_index]
            }));
            if (enhance) {
                this.$el.find("#approval-viewing").enhanceWithin();
            }
        },

        _render_sheet: function(characterOverride, enhance) {
            var self = this;
            var c = characterOverride || self.character;
            var sortedSkills = c.get_sorted_skills();
            var groupedSkills = c.get_grouped_skills(sortedSkills, 3);
            this.$el.find("#approval-sheet").html(this.sheetTemplate({
                "character": c,
                "skills": sortedSkills,
                "groupedSkills": groupedSkills} ));
            if (enhance) {
                this.$el.find("#approval-sheet").enhanceWithin();
            }
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            var sendId = self.idForPickedIndex;
            if (_.isUndefined(sendId)) {
                sendId = self.character.recorded_changes.models.length - 1;
            }

            self._update_approval_selected(self.approvals.length);

            // Sets the view's template property
            this.template = _.template(character_approval_view_html)({
                    "character": this.character,
                    "logs": this.character.recorded_changes.models,
                    "format_entry": this.format_entry,
                    "format_approval": this.format_approval,
                    idForPickedIndex: sendId,
                    left_rc_index: self.left_rc_index,
                    approval_index: self.approval_index,
                    approvals: self.approvals.models,
                    approval: self.approvals.models[self.approval_index]
                 });

            /*
            _.each(self.approvals.models[self.approval_index], function (approval, i) {
                var headers = ["approved", "change", "approver", "owner"];
                _.each(headers, function (h) {
                    console.log(approval.get(h));
                });
            });
            */
            // Renders the view's template inside of the current listview element
            this.$el.find("#approval-main").html(this.template);

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