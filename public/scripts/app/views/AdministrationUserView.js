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
                        var self = this;
                        var email = self.model.get("email");
                        $.mobile.loading("show");
                        self.undelegateEvents();
                        self.$(".reset-password-button").attr("disabled", true);
                        Parse.User.requestPasswordReset(email, function () {
                            self.fields.get("reset").set({status: "success", message: "Password Reset Email Sent"});
                        }, function (error) {
                            self.fields.get("reset").set({status: "error", message: _.escape(error.message)});
                        }).always(function() {
                            self.$el.enhanceWithin();
                            self.$(".reset-password-button").removeAttr("disabled");
                            $.mobile.loading("hide");
                            self.delegateEvents();
                        })
                    },
                    "submit": function (e) {
                        var self = this;
                        e.preventDefault();
                        self.undelegateEvents();
                        $.mobile.loading("show");

                        var user = self.model;
                        new Parse.Query(Parse.Role).equalTo("name", "Administrator").first().then(function (role) {
                            if (user.get("admininterface")) {
                                // Make an admin
                                role.getUsers().add(user);
                            } else {
                                // Destroy their admin rights
                                role.getUsers().remove(user);
                            }
                            return role.save();
                        }).then(function () {
                            if (user.get("admininterface")) {
                                self.fields.get("submit").set({status: "success", message: "Made them an admin!"});
                            } else {
                                self.fields.get("submit").set({status: "success", message: "Removed their admin privileges!"});
                            }
                        }).fail(function (error) {
                            self.fields.get("submit").set({status: "error", message: _.escape(error.message)});
                        }).always(function () {
                            self.$el.enhanceWithin();
                            $.mobile.loading("hide");
                            self.delegateEvents();
                        });
                    }
                }
            });
            view.form.fields.each(function(field) {
                field.set("disabled", true);
            });
            view.form.fields.add(new Backform.Field({name: "admininterface", label: "Administrator", control: "checkbox"}));
            view.form.fields.add(new Backform.Field({name: "reset", label: "Reset Password", control: "button", id: "reset", extraClasses: ["reset-user-password"], type: "reset"}));
            view.form.fields.add(new Backform.Field({name: "submit", label: "Update", control: "button", id: "submit"}));
        },

        register: function (user) {
            var self = this;
            self.user = user;
            //(new Parse.Query(Parse.Role)).equalTo("users", theUser).find()
            if (self.form.model.id != user.id) {
                var adminq = (new Parse.Query(Parse.Role)).equalTo("users", user).equalTo("name", "Administrator");
                var siteadminq = (new Parse.Query(Parse.Role)).equalTo("users", user).equalTo("name", "SiteAdministrator");
                var q = Parse.Query.or(adminq, siteadminq);
                return q.count().then(function (isadministrator) {
                    user.set("admininterface", isadministrator ? true : false);
                    var errorModel = self.form.errorModel;
                    self.form.model = user;
                    self.form.model.errorModel = errorModel;
                    return self.render();
                });
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
