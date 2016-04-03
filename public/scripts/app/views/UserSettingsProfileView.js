// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "backform"
], function ($, Backbone, Parse, Backform) {

    // Extends Backbone.View
    var UserSettingsProfileView = Backbone.View.extend({
        initialize: function () {
            var view = this;
            view.errorModel = new Backbone.Model();
            this.form = new Backform.Form({
                errorModel: view.errorModel,
                model: Parse.User.current() || new Backbone.Model,
                fields: [
                    {name: "realname", label: "Real Name", control: "input"},
                    {name: "email", label: "Email", control: "input", type: "email"},
                    {name: "submit", label: "Update", control: "button", disabled: true, id: "submit"}
                ],
                events: {
                    "change": function (e) {
                        e.preventDefault();
                        this.$('button[name=submit]').removeAttr("disabled");
                        var s = this.fields.get("submit");
                        if ("success" == s.get("status")) {
                            s.set({status: "", message: "", disabled: false});
                            this.$el.enhanceWithin();
                        }
                    },
                    "submit": function (e) {
                        var self = this;
                        e.preventDefault();
                        $.mobile.loading("show");
                        self.undelegateEvents();
                        self.model.errorModel.clear();

                        self.model.save().then(function () {
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

        render: function () {
            var view = this;

            if (this.form.model !== Parse.User.current()) {
                var errorModel = this.form.errorModel;
                this.form.model = Parse.User.current();
                this.form.model.errorModel = errorModel;
            }
            this.form.setElement(this.$el.find("form.profile-form"));
            this.form.render();
            this.$el.enhanceWithin();
        }
    });

    // Returns the View class
    return UserSettingsProfileView;

});
