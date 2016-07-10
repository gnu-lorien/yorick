// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "backform",
    "../forms/UserForm",
    "marionette",
    "../views/PatronagesView",
    "../collections/Patronages"
], function ($, Backbone, Parse, Backform, UserForm, Marionette, PatronagesView, Patronages) {
    // Extends Backbone.View
    var View = Marionette.ItemView.extend({
        tagName: 'form',
        template: _.template(""),
        initialize: function () {
            var view = this;
            view.errorModel = new Backbone.Model();
            this.form = new UserForm({
                errorModel: view.errorModel,
                model: new Backbone.Model,
                events: {
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
            view.form.fields.add(new Backform.Field({name: "submit", label: "Update", control: "button", id: "submit"}));
        },

        register: function (user) {
            var self = this;
            self.user = user;
            //(new Parse.Query(Parse.Role)).equalTo("users", theUser).find()
            if (self.form.model.id != user.id) {
                self.form.fields.get("submit").set({status: "", message: ""});
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

        onRender: function() {
            this.form.setElement(this.$el);
            this.form.render();
            this.$el.enhanceWithin();

            return this;
        },
    });

    var ResetButtonView = Marionette.ItemView.extend({
        tagName: 'div',
        template: function(data) {
            return _.template("<button>Reset Password</button><p class='message'></p>")(data);
        },
        events: {
            "click": function (e) {
                e.preventDefault();
                var self = this;
                var email = self.model.get("email");
                var button = self.$("button");
                var message = self.$(".message");
                $.mobile.loading("show");
                self.undelegateEvents();
                button.attr("disabled", true);
                Parse.User.requestPasswordReset(email).then(function () {
                    message.text("Password Reset Email Sent");
                }, function (error) {
                    message.text(_.escape(error.message));
                }).always(function () {
                    self.$el.enhanceWithin();
                    self.$("button").removeAttr("disabled");
                    $.mobile.loading("hide");
                    self.delegateEvents();
                })
            },
        },
    });

    var LayoutView = Marionette.LayoutView.extend({
        el: "#administration-user-view",
        regions: {
            profile: "#abs-form",
            password: "#reset-password-view",
            patronage: "#patronage-list-region"
        },
        initialize: function(options) {
            var self = this;
            self.patronages = new Patronages;
            self.showChildView('profile', new View(), options);
            self.showChildView('password', new ResetButtonView(), options);
            self.showChildView('patronage', new PatronagesView({
                el: "#patronage-list",
                collection: self.patronages,
            }))
        },
        register: function(user) {
            var self = this;
            self.profile.currentView.register.apply(self.profile.currentView, arguments);
            self.password.currentView.model = user;
            self.patronage.currentView.render();
        }
    });

    // Returns the View class
    return LayoutView;

});
