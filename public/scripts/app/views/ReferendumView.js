// Includes file dependencies
/* global _ */
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
    "text!../templates/paypal-button.html",
    "text!../templates/referendum/referendum.html",
    "text!../templates/referendum/description.html",
    "text!../templates/referendum/options.html",
    "../models/ReferendumBallot"
], function (
    $,
    Backbone,
    Parse,
    Backform,
    UserForm,
    profile_facebook_account_html,
    PromiseFailReport,
    InjectAuthData,
    Marionette,
    PatronagesView,
    Patronages,
    user_settings_profile_html,
    paypal_button_html,
    referendum_html,
    description_html,
    options_html,
    ReferendumBallot) {

    var DescriptionView = Marionette.ItemView.extend({
        tagName: 'div',
        template: _.template(description_html),
    });
    
    var OptionsView = Marionette.ItemView.extend({
        tagName: 'div',
        template: _.template(options_html),
        templateHelpers: function() {
            var self = this;
            return {
                referendum: self.model,
                ballot_message: self.ballot_message,
                ballot: self.ballot
            }
        },
        initialize: function (options) {
            var self = this;
            self.ballot = options.ballot;
        },
        events: {
            "click a": "cast_ballot"
        },
        cast_ballot: function (e) {
            var self = this;
            e.preventDefault();
            self.undelegateEvents();
            
            var ballot_option = self.$(e.target).attr('name');
            
            console.log(self.$(e.target).attr('name'));
 
            Parse.Cloud.run("vote_for_referendum", {referendum_id: self.model.id, ballot_option: ballot_option})
            .fail(function (error) {
                self.ballot_message = error;
                console.error(error);
            }).then(function (cupcakeinfo) {
                self.ballot_message = cupcakeinfo;
                var q = new Parse.Query("ReferendumBallot")
                    .equalTo("owner", self.model)
                    .equalTo("caster", Parse.User.current());
                return q.first();
            }).then(function (ballot) {
                self.ballot = ballot;
            }).always(function () {
                self.delegateEvents();
                self.render();
            })
        }
    });
    
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

    var PaypalButton = Marionette.ItemView.extend({
        tagName: 'div',
        template: _.template(paypal_button_html),
        templateHelpers: {
            userid: function () {
                return Parse.User.current().id;
            },
        },
    });
    
    var RoleView = Marionette.ItemView.extend({
        template: function (serialized_model) {
            return _.template("The one: <%= attributes.name %>")(serialized_model);
        }
    });
    
    var RolesView = Marionette.CollectionView.extend({
        tagName: 'div',
        childView: RoleView
    });

    var LayoutView = Marionette.LayoutView.extend({
        el: "#referendum",
        template: _.template(referendum_html),
        regions: {
            description: "#referendum-description",
            options: "#referendum-options",
            profile: "#user-settings-profile-abs-form",
            facebook: "#facebook-account-linking",
            patronage: "#usp-patronage-list-region",
            paypal: "#usp-paypal-button",
            roles: "#user-roles-available"
        },
        initialize: function(options) {
            var self = this;
            self.patronages = new Patronages;
        },
        setup: function(options) {
            var self = this;
            var referendum = options.referendum;
            var ballot = options.ballot;
            self.render();
            self.showChildView('description', new DescriptionView({model: referendum}))
            self.showChildView('options', new OptionsView({model: referendum, ballot: ballot}))
            self.showChildView('profile', new View(), options);
            self.showChildView('paypal', new PaypalButton(), options);
            self.showChildView('patronage', new PatronagesView({
                el: "#usp-patronage-list",
                collection: self.patronages,
            }), options);
            
            var roles = new Backbone.Collection();
            var q = new Parse.Query(Parse.Role);
            q.each(function (role) {
                var users_relation = role.getUsers();
                var uq = users_relation.query();
                uq.equalTo("objectId", Parse.User.current().id);
                return uq.each(function (user) {
                    roles.add(role);
                }).fail(function (error) {
                    console.log("Failed in promise for " + role.get("name"));
                });
            }).fail(PromiseFailReport);
            self.showChildView('roles', new RolesView({
                collection: roles
            }), options);
            self.patronages.query.equalTo("owner", Parse.User.current());
            self.patronages.fetch();

            return self;
        }
    });

    // Returns the View class
    return LayoutView;

});
