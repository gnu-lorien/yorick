// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "backform",
    "../forms/UserForm",
    "text!../templates/profile-facebook-account.html",
    "../helpers/PromiseFailReport",
    "../helpers/InjectAuthData",
    "marionette",
    "../views/PatronagesView",
    "../collections/Patronages",
    "text!../templates/user-settings-profile.html",
    "text!../templates/paypal-button.html"
], function ($, Backbone, Parse, Backform, UserForm, profile_facebook_account_html, PromiseFailReport, InjectAuthData, Marionette, PatronagesView, Patronages, user_settings_profile_html, paypal_button_html) {

    var View = Marionette.ItemView.extend({
        tagName: 'form',
        template: _.template(""),
        initialize: function () {
            var view = this;
            view.errorModel = new Backbone.Model();
            this.form = new UserForm({
                errorModel: view.errorModel,
                model: Parse.User.current() || new Backbone.Model,
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

                        /*
                        self.model.errorModel.set({"realname": "Refusing any real name whatsoever"});
                        */

                        InjectAuthData(self.model);

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
            view.form.fields.add(new Backform.Field({name: "submit", label: "Update", control: "button", disabled: true, id: "submit"}));
        },

        onRender: function() {
            if (this.form.model !== Parse.User.current()) {
                var errorModel = this.form.model.errorModel;
                this.form.model = Parse.User.current();
                this.form.model.errorModel = errorModel;
            }

            this.form.setElement(this.$el);
            this.form.render();

            this.$el.enhanceWithin();

            return this;
        }
    });

    var FacebookLinkButtonView = Marionette.ItemView.extend({
        tagName: 'div',
        template: _.template(profile_facebook_account_html),

        events: {
            "click #facebook-unlink": "unlink",
            "click #facebook-link": "link",
        },

        unlink: function (e) {
            var view = this;
            e.preventDefault();
            view.undelegateEvents();

            Parse.User.current().set("authData", {"facebook": null});
            Parse.User.current().save().then(function () {
                view.delegateEvents();
                view.render();
            }).fail(PromiseFailReport);
        },

        link: function (e) {
            var view = this;
            e.preventDefault();
            view.undelegateEvents();

            Parse.FacebookUtils.link(Parse.User.current(), "email").then(function (user) {
                return hello('facebook').api('/me');
            }).then(function (r) {
                view.delegateEvents();
                view.render();
                var user = Parse.User.current();
                if (!user.has("email"))
                    user.set("email", r.email);
                if (!user.has("realname"))
                    user.set("realname", r.name);
                InjectAuthData(user);
                return user.save();
            }).fail(PromiseFailReport);
        },

        onRender: function() {
            this.$el.enhanceWithin();
        }
    });

    var PaypalButton = Marionette.ItemView.extend({
        tagName: 'div',
        template: _.template(paypal_button_html),
        templateHelpers: {
            userid: function () {
                return Parse.User.current().id;
            },
        },
    })

    var LayoutView = Marionette.LayoutView.extend({
        el: "#user-settings-profile",
        template: _.template(user_settings_profile_html),
        regions: {
            profile: "#user-settings-profile-abs-form",
            facebook: "#facebook-account-linking",
            patronage: "#usp-patronage-list-region",
            paypal: "#usp-paypal-button"
        },
        initialize: function(options) {
            var self = this;
            self.patronages = new Patronages;
        },
        setup: function() {
            var self = this;
            var options = self.options || {};
            self.render();
            self.showChildView('profile', new View(), options);
            self.showChildView('facebook', new FacebookLinkButtonView(), options);
            self.showChildView('paypal', new PaypalButton(), options);
            self.showChildView('patronage', new PatronagesView({
                el: "#usp-patronage-list",
                collection: self.patronages,
            }), options);
            self.patronages.query.equalTo("owner", Parse.User.current());
            self.patronages.fetch();

            return self;
        }
    });

    // Returns the View class
    return LayoutView;

});
