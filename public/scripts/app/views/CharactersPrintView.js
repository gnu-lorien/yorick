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
    "text!../templates/character-approval-approvals.html",
    "../collections/Approvals",
    "../models/Approval",
    "text!../templates/character-approval-selected-view.html",
    "../helpers/VampirePrintHelper",
    "text!../templates/character-approval-edit.html",
    "../views/CharacterPrintView",
    "text!../templates/character-approval-changes.html",
    "../helpers/PromiseFailReport"
], function( _,
             $,
             Backbone,
             Marionette,
             Parse,
             moment,
             character_print_view_html,
             character_approval_approvals_html,
             Approvals,
             Approval,
             character_approval_selected_view_html,
             VampirePrintHelper,
             character_approval_edit_html,
             CharacterPrintView,
             character_approval_changes_html,
             PromiseFailReport
) {
    var EditView = Marionette.ItemView.extend({
        template: _.template(character_approval_edit_html),
        templateHelpers: function () {
            var self = this;
            var no_changes_remaining = self.picked.get("left") >= self.model.recorded_changes.length;
            if (0 != self.approvals.length) {
                var last_approved_id = self.approvals.last().get("change").id;
                var last_recorded_id = self.model.recorded_changes.last().id;
                if (last_approved_id == last_recorded_id) {
                    no_changes_remaining = true;
                }
            }
            return {
                "character": this.model,
                "logs": this.model.recorded_changes.models,
                indexForPickedChange: self.picked.get("right"),
                format_approval: self.format_approval,
                left_rc_index: self.picked.get("left"),
                approval_index: self.picked.get("approval"),
                approvals: self.approvals.models,
                no_changes_remaining: no_changes_remaining
            }
        },       
        events: {
            "click .approve-change": "approve_change"
        },
        initialize: function(options) {
            this.picked = options.picked;
            this.approvals = options.approvals;
            this.no_changes_remaining = false;
            
            this.listenTo(
                this.picked,
                "change:right",
                _.debounce(this.render, 100, {trailing: true}));
            
            _.bindAll(this, "templateHelpers", "format_approval", "approve_change");
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
        approve_change: function (e) {
            var self = this;
            e.preventDefault();
            var change = self.model.recorded_changes.at(self.picked.get("right"));
            var a = new Approval({
                approved: true,
                change: change,
                approver: Parse.User.current(),
                owner: self.model
            });
            a.save().then(function (approval) {
                self.approvals.add(approval);
                self.picked.set({
                    approval: self.approvals.length,
                    left: self.picked.get("right"),
                    right: self.model.recorded_changes.models.length - 1
                });
                self.render();
            });
        },
        onRender: function() {
            this.$el.enhanceWithin();
        }
    });
    
    var ChangesView = Marionette.ItemView.extend({
        template: _.template(character_approval_changes_html),
        templateHelpers: function () {
            var self = this;
            return {
                "character": this.model,
                "logs": this.model.recorded_changes.models,
                right_rc_index: self.picked.get("right"),
                left_rc_index: self.picked.get("left"),
            }
        },       
        initialize: function(options) {
            this.picked = options.picked;
            this.watchPicks();
            this.listenTo(this.model, "saved", this.update_then_render);
            
            _.bindAll(this, "templateHelpers", "update_then_render");
        },
        events: {
            "change #slider": "update_right",
            "change #sliderbaserange": "update_left"
        },
        watchPicks: function() {
            this.listenTo(this.picked, "change", this.render);
        },
        unwatchPicks: function() {
            this.stopListening(this.picked);
        },
        update_right: function(e) {
            this.unwatchPicks();
            var v = _.parseInt(this.$(e.target).val());
            this.picked.set("right", v);
            var id = this.$("#history-changes-" + v).val();
            this.watchPicks();
        },
        update_left: function(e) {
            this.unwatchPicks();
            var v = _.parseInt(this.$(e.target).val());
            this.picked.set("left", v);
            var id = this.$("#history-changes-" + v).val();
            this.watchPicks();
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
    
    var ApprovalsView = Marionette.ItemView.extend({
        template: _.template(character_approval_approvals_html),
        templateHelpers: function () {
            var self = this;
            return {
                "character": this.model,
                "logs": this.model.recorded_changes.models,
                approvals: self.approvals.models,
                approval_index: self.picked.get("approval"),
            }
        },       
        initialize: function(options) {
            this.picked = options.picked;
            this.approvals = options.approvals;
            
            this.update_picks_for_approval(this.picked.get("approval"));
            this.watchPicks();
            
            this.listenTo(this.model, "saved", this.render);
            
            _.bindAll(this, "templateHelpers", "approval_changed", "update_picks_for_approval");
        },
        events: {
            "change #approval-slider": "update_index",
        },
        watchPicks: function() {
            this.listenTo(this.picked, "change:approval", this.approval_changed);
        },
        unwatchPicks: function() {
            this.stopListening(this.picked);
        },
        update_picks_for_approval: function(v) {
            var self = this;
            var approval = self.approvals.models[v];
            var left = 0,
                right = self.model.recorded_changes.length - 1;
                
            if (approval) {
                _.findLast(self.model.recorded_changes.models, function (model, i) {
                    if (model.id == approval.get("change").id) {
                        right = i;
                        return true;
                    }
                    return false;
                })
            }
            
            if (v > 0) {
                var left_approval_index = v - 1;
                var left_approved = self.approvals.models[left_approval_index];
                _.findLast(self.model.recorded_changes.models, function (model, i) {
                    if (model.id == left_approved.get("change").id) {
                        left = i + 1;
                        return true;
                    }
                    return false;
                });  
            }           
            
            self.picked.set({
                approval: v,
                left: left,
                right: right
            })
        },
        approval_changed: function() {
            this.unwatchPicks();
            this.update_picks_for_approval(this.picked.get("approval"));
            this.render();
            this.watchPicks();
        },
        update_index: function(e) {
            var self = this;
            this.unwatchPicks();
            var v = _.parseInt(this.$(e.target).val());
            self.update_picks_for_approval(v);
            this.watchPicks();
        },

        onRender: function() {
            this.$el.enhanceWithin();
        }
    });
    
    var ChangesSelectedView = Marionette.ItemView.extend({
        template: _.template(character_approval_selected_view_html),
        templateHelpers: function () {
            var self = this;
            return {
                "character": this.model,
                "logs": this.model.recorded_changes.models,
                indexForPickedChange: self.picked.get("right"),
                format_entry: self.format_entry,
                left_rc_index: self.picked.get("left")
            }
        },       
        initialize: function(options) {
            this.picked = options.picked;
            this.approvals = options.approvals;
            this.no_changes_remaining = false;
            
            this.listenTo(
                this.picked,
                "change:right change:left",
                _.debounce(this.render, 100, {trailing: true}));
            
            _.bindAll(this, "templateHelpers", "format_entry");
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
    
    var LayoutView = Marionette.LayoutView.extend({
        tagName: "div",
        regions: {
            changes: "#approval-changes",
            approvals: "#approval-approvals",
            edit: "#approval-edit",
            viewing: "#approval-viewing",
            sheet: "#approval-sheet"
        },
        initialize: function() {
            _.bindAll(this, "update_override_character_and_transform");
        },
        update_override_character_and_transform: function () {
            var self = this;
            var c, td, described_character;
            if (self.picked.has("right")) {
                var right_id = self.model.recorded_changes.at(self.picked.get("right"));
                right_id = right_id.id || right_id.cid || null;
                var changesToApply = _.chain(self.model.recorded_changes.models).takeRightWhile(function (model) {
                    return model.id != right_id;
                }).reverse().value();
                c = self.model.get_transformed(changesToApply);
            }
            if (self.picked.has("left") && self.picked.has("right")) {
                var changesForDescription = _.chain(self.model.recorded_changes.models)
                    .takeRightWhile(function (model, i) {
                        return i != self.picked.get("left") - 1;
                    })
                    .reverse()
                    .value();
                described_character = self.model.get_transformed(changesForDescription);
                td = _.takeRight(described_character.transform_description, (self.picked.get("right") + 1) - self.picked.get("left"));
                var a = _(td).select({type: "removed"}).value();
                _.each(a, function (trait) {
                    trait.fake.is_deleted = true;
                    c.set(trait.category, _.union(c.get(trait.category), [trait.fake]));
                });
                self.model.transform_description = td;
                if (c) {
                    c.transform_description = td;
                }
            }
            self.override.set({
                character: c,
                description: td,
                described: described_character
            });
        },
        register: function(model) {
            var self = this;
            var p = Parse.Promise.as([]);

            if (model != self.model) {
                self.model = model;
                
                if (self.picked) {
                    self.stopListening(self.picked);
                }
                self.picked = new Backbone.Model({
                    left: 0,
                    right: 0,
                    approval: 0
                });
                
                if (self.override) {
                    self.stopListening(self.override)
                }
                self.override = new Backbone.Model({
                    character: null,
                    description: null
                });

                p = self.model.get_recorded_changes().then(function () {
                    self.picked.set("left", 0);
                    self.picked.set("right", self.model.recorded_changes.models.length - 1);
                    
                    return self.model.get_approvals();
                }).then(function (approvals) {
                    self.approvals = approvals;
                    self.picked.set("approval", self.approvals.length);
                    
                    // Set up parent functions
                    self.listenTo(self.picked, "change:right change:left", _.debounce(self.update_override_character_and_transform, 100, {trailing: true}));
                    
                    // Set up child views now
                    self.showChildView('changes', new ChangesView({
                        model: self.model,
                        picked: self.picked
                    }));
                    self.showChildView('approvals', new ApprovalsView({
                        model: self.model,
                        picked: self.picked,
                        approvals: self.approvals
                    }));
                    self.showChildView('edit', new EditView({
                        model: self.model,
                        picked: self.picked,
                        approvals: self.approvals
                    }));
                    self.showChildView('viewing', new ChangesSelectedView({
                        model: self.model,
                        picked: self.picked
                    }));
                    var cpv = new CharacterPrintView;
                    cpv = cpv.setup({
                        character: self.model,
                        override: self.override
                    });
                    self.showChildView('sheet', cpv);
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
    
    var CollectionView = Marionette.CollectionView.extend({
        childView: CharacterPrintView,
        setup: function() {
            return this.render();
        },
        buildChildView: function(child, ChildViewClass, childViewOptions){
            // create the child view instance
            var view = new CharacterPrintView({
                no_print_settings_form: true
            });
            
            return view.setup({
                character: child,
                print_options: this.options.print_options
            });
        }
    });
    
    //return LayoutView;
    return CollectionView;
} );