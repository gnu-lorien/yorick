// Includes file dependencies
/* global _ */
define([
    "jquery",
    "backbone",
    "parse",
    "backform",
    "marionette",
    "../helpers/PromiseFailReport",
    "text!../templates/character-long-text-parent.html",
], function (
    $,
    Backbone,
    Parse,
    Backform,
    Marionette,
    PromiseFailReport, 
    character_long_text_parent_html
) {

    var EditForm = Marionette.ItemView.extend({
        tagName: 'form',
        template: _.template(""),
        initialize: function (options) {
            var view = this;
            view.character = options.character;
            
            this.form = new Backform.Form({
                el: this.$el,
                model: view.model,
                fields: [
                    {
                        name: "text",
                        label: options.pretty,
                        control: "textarea",
                        helpMessage: options.description
                    },{
                        name: "preview",
                        label: "Live Preview Changes",
                        control: "checkbox",
                    },{
                        name: "submit",
                        label: "Update",
                        control: "button",
                        disabled: true,
                        id: "submit"
                    }
                ],
                events: {
                    "change": function(e) {
                        e.preventDefault();
                        this.model.errorModel.clear();
                        this.fields.get("submit").set({status: "", message: "", disabled: false});
                        this.$el.enhanceWithin();
                    },
                    "submit": function (e) {
                        var self = this;
                        e.preventDefault();
                        $.mobile.loading("show");
                        self.undelegateEvents();
                        self.model.errorModel.clear();

                        view.character.update_long_text(options.category, self.model.get("text")).then(function () {
                            self.fields.get("submit").set({status: "success", message: "Successfully Updated", disabled: true});
                            self.$el.enhanceWithin();
                        }, function (error) {
                            self.fields.get("submit").set({status: "error", message: _.escape(error.message), disabled: false});
                            self.$el.enhanceWithin();
                        }).always(function () {
                            $.mobile.loading("hide");
                            self.delegateEvents();
                        });

                        return false;
                    }
                }
            });
        },

        onRender: function() {
            this.form.render();

            this.$el.enhanceWithin();
            return this;
        }
    });

    var Preview = Marionette.ItemView.extend({
        tagName: 'div',
        template: _.template("<h1>Preview<h1><p><%= inputtext %>"),
        templateHelpers: function () {
            var self = this;
            var inputtext = "";
            if (self.model.get("preview")) {
                inputtext = self.model.get("text")
            } else {
                var lt = self.options.character.get_fetched_long_text(self.options.category)
                if (lt && lt.has("text")) {
                    inputtext = lt.get("text");
                }
            }
            inputtext = _.template(inputtext)({
                character: self.options.character
            });
            return {
                inputtext: inputtext
            }
        },
        initialize: function(options) {
            var self = this;
            self.options = options;
            // Listen to the character and always render when that changes
            self.listenTo(
                self.options.character,
                "change:longtext" + self.options.category,
                self.render);
            // Listen to the option object but only render if live preview is on
            self.listenTo(
                self.model,
                "change:text",
                self.renderIfLive);
                
            _.bindAll(
                self,
                "renderIfLive",
                "templateHelpers");
        },
        renderIfLive: function() {
            var self = this;
            if (self.model.get("preview")) {
                return self.render();
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        }
    });

    var LayoutView = Marionette.LayoutView.extend({
        template: _.template(character_long_text_parent_html),
        regions: {
            top: "#top",
            edit: "#edit",
            preview: "#preview"
        },
        setup_regions: function() {
            var self = this;
            var options = {};
            
            self.showChildView('edit', new EditForm({
                character: self.character,
                category: self.options.category,
                pretty: self.options.pretty,
                model: self.editingoptions
            }), options);
            self.showChildView('preview', new Preview({
                character: self.character,
                category: self.options.category,
                model: self.editingoptions
            }), options);
        },
        onRender: function() {
            this.setup_regions();
        },
        initialize: function(options) {
            _.bindAll(this, "setup_regions");
        },
        setup: function(character, options) {
            var self = this;
            var options = self.options || {};
            self.character = character;
            self.editingoptions = new Backbone.Model({
                preview: true
            });
            var lt = self.character.get_fetched_long_text(options.category);
            if (lt && lt.has("text")) {
                self.editingoptions.set("text", lt.get("text"));
            }
            self.render();
            return self;
        }
    });

    // Returns the View class
    return LayoutView;

});
