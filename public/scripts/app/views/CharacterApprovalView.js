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
    "../helpers/VampirePrintHelper",
    "text!../templates/character-approval-edit.html"
], function( $,
             Backbone,
             moment,
             character_print_view_html,
             character_approval_view_html,
             Approvals,
             Approval,
             character_approval_selected_view_html,
             VampirePrintHelper,
             character_approval_edit_html) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            var self = this;

            _.bindAll(this,
                "render",
                "format_simpletext",
                "format_attribute_value",
                "format_attribute_focus",
                "format_skill",
                "format_specializations"
            );


            self.sheetTemplate = _.template(character_print_view_html);
            self.approvalSelectedTemplate = _.template(character_approval_selected_view_html);
            self.editTemplate = _.template(character_approval_edit_html);
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
                        if (self.character.recorded_changes.length > 0) {
                            _.defer(self.render);
                        }
                    });
                });
            }

            return p.then(function () {
                Parse.Promise.as(self);
            });
        },

        events: {
            "change #slider": "update_selected",
            "change #sliderbaserange": "update_base_selected",
            "change #approval-slider": "update_approval_selected",
            "click .approve-change": "approve_change"
        },

        approve_change: function() {
            var self = this;
            var change = self.character.recorded_changes.at(self.idForPickedIndex);
            var a = new Approval({
                approved: true,
                change: change,
                approver: Parse.User.current(),
                owner: self.character
            });
            a.save().then(function (approval) {
                self.approvals.add(approval);
                self.approval_index = self.approvals.length;
                return self.render();
            });
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

        _update_approval_selected: function (approval_index) {
            var self = this;
            self.approval_index = approval_index;
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

            self.$("#sliderbaserange").val(self.left_rc_index).slider('refresh');
            self.$("#slider").val(selectedIndex).slider('refresh');

            return change || _.last(self.character.recorded_changes.models);
        },

        _get_display_character: function(id) {
            var self = this;
            var changesToApply = _.chain(self.character.recorded_changes.models).takeRightWhile(function (model) {
                return model.id != id;
            }).reverse().value();
            var c = self.character.get_transformed(changesToApply);
            if (self.transform_description) {
                // Add back any removed traits
                var a = _(self.transform_description).select({type: "removed"}).value();
                _.each(a, function (trait) {
                    trait.fake.is_deleted = true;
                    c.set(trait.category, _.union(c.get(trait.category), [trait.fake]));
                });
            }
            return c;
        },

        update_approval_selected: function (e) {
            var self = this;
            var selectedIndex = _.parseInt(this.$(e.target).val());
            var change = self._update_approval_selected(selectedIndex);
            self._update_transform_description(self.left_rc_index);

            self._render_viewing(true);
            self._render_edit(true);

            var c = self._get_display_character(change.id);
            self._render_sheet(c, true);
        },

        update_selected: function (e) {
            var self = this;
            var selectedIndex = _.parseInt(this.$(e.target).val());
            self.idForPickedIndex = selectedIndex;
            self._update_transform_description(self.left_rc_index);
            self._render_viewing(true);
            self._render_edit(true);

            var selectedId = this.$("#history-changes-" + selectedIndex).val();
            var c = self._get_display_character(selectedId);
            self._render_sheet(c, true);
        },

        _update_transform_description: function(selectedIndex) {
            var self = this;
            var changesToApply = _.chain(self.character.recorded_changes.models)
                .takeRightWhile(function (model, i) {
                    return i != selectedIndex - 1;
                })
                .reverse()
                .value();
            var c = self.character.get_transformed(changesToApply);
            self.transform_description = _.takeRight(c.transform_description, (self.idForPickedIndex + 1) - selectedIndex);
        },

        update_base_selected: function (e) {
            var self = this;
            var selectedIndex = _.parseInt(this.$(e.target).val());
            self.left_rc_index = selectedIndex;
            self._update_transform_description(self.left_rc_index);
            self._render_viewing(true);
            self._render_edit(true);

            var selectedId = this.$("#history-changes-" + self.idForPickedIndex).val();
            var c = self._get_display_character(selectedId);
            self._render_sheet(c);
        },

        _render_edit: function(enhance) {
            var self = this;
            var sendId = self.idForPickedIndex;
            if (_.isUndefined(sendId)) {
                sendId = self.character.recorded_changes.models.length - 1;
            }
            this.$el.find("#approval-edit").html(this.editTemplate({
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
                this.$el.find("#approval-edit").enhanceWithin();
            }
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
            self.character_override = characterOverride || self.character;
            var c = self.character_override;
            var sortedSkills = c.get_sorted_skills();
            var groupedSkills = c.get_grouped_skills(sortedSkills, 3);
            this.$el.find("#approval-sheet").html(this.sheetTemplate({
                "character": c,
                "skills": sortedSkills,
                "groupedSkills": groupedSkills,
                "transform_description": self.transform_description,
                format_simpletext: this.format_simpletext,
                format_attribute_value: this.format_attribute_value,
                format_attribute_focus: this.format_attribute_focus,
                format_skill: this.format_skill,
                format_specializations: this.format_specializations,
            }));
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
            self._update_transform_description(self.left_rc_index);

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
            this._render_edit();

            var selectedId = this.$("#history-changes-" + self.idForPickedIndex).val();
            var c = self._get_display_character(selectedId);
            self._render_sheet(c);

            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    _.extend(View.prototype, VampirePrintHelper);

    // Returns the View class
    return View;

} );