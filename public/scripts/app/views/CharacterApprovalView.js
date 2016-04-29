// Category View
// =============

// Includes file dependencies
define([
    "jquery",
    "backbone",
    "moment",
    "text!../templates/character-print-view.html",
    "text!../templates/character-history-selected-view.html",
    "text!../templates/character-approval-view.html",
    "../collections/Approvals",
    "../models/Approval",
    "text!../templates/character-approval-selected-view.html",
], function( $,
             Backbone,
             moment,
             character_print_view_html,
             character_history_selected_view_html,
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
            self.selectedTemplate = _.template(character_history_selected_view_html);
            self.approvalSelectedTemplate = _.template(character_approval_selected_view_html);

            self.approval_index = 0;
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
                    self.approval_index = self.approvals.length - 1;
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

        update_approval_selected: function (e) {
            var self = this;
            var selectedIndex = _.parseInt(this.$(e.target).val());
            self.approval_index = selectedIndex;
            self.approved = self.approvals.models[self.approval_index];

            var selectedIndex = 0;
            var change = _.findLast(self.character.recorded_changes.models, function (model, i) {
                if (model.id == self.approved.get("change").id) {
                    selectedIndex = i;
                    return true;
                }
                return false;
            })
            self.idForPickedIndex = selectedIndex;
            self._render_viewing(true);

            self.$("#slider").val(selectedIndex).slider('refresh');
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
            this.$el.find("#history-viewing").html(this.selectedTemplate({
                "character": this.character,
                "logs": self.character.recorded_changes.models,
                "format_entry": this.format_entry,
                idForPickedIndex: sendId,
            }));
            this.$el.find("#approval-viewing").html(this.approvalSelectedTemplate({
                "character": this.character,
                "logs": self.character.recorded_changes.models,
                "format_entry": this.format_entry,
                "format_approval": this.format_approval,
                idForPickedIndex: sendId,
                approval_index: self.approval_index,
                approvals: self.approvals.models,
                approval: self.approvals.models[self.approval_index]
            }));
            if (enhance) {
                this.$el.find("#history-viewing").enhanceWithin();
                this.$el.find("#approval-viewing").enhanceWithin();
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
            this.template = _.template(character_approval_view_html)({
                    "character": this.character,
                    "logs": this.character.recorded_changes.models,
                    "format_entry": this.format_entry,
                    "format_approval": this.format_approval,
                    idForPickedIndex: sendId,
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