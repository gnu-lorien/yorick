// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "backform",
    "../forms/UserForm"
], function ($, Backbone, Parse, Backform, UserForm) {

    // Extends Backbone.View
    var View = Backbone.View.extend({
        initialize: function () {
            var view = this;
            view.errorModel = new Backbone.Model();
            this.form = new UserForm({
                errorModel: view.errorModel,
                model: new Backbone.Model,
                events: {
                    "click .reset-user-password": function (e) {
                        e.preventDefault();
                        alert("reset that password");
                    },
                }
            });
            view.form.fields.add(new Backform.Field({name: "reset", label: "Reset Password", control: "button", id: "reset", extraClasses: ["reset-user-password"], type: "reset"}));
        },

        register: function (user) {
            var self = this;
            self.user = user;
            if (self.form.model.id != user.id) {
                var errorModel = self.form.errorModel;
                this.form.model = user;
                this.form.model.errorModel = errorModel;
                return self.render();
            }
        },
        
        render: function () {
            var view = this;

            this.form.setElement(this.$el.find("form.profile-form"));
            this.form.render();
            this.$el.enhanceWithin();
            
            return this;
        }
    });

    // Returns the View class
    return View;

});
