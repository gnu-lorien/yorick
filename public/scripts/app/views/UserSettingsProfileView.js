// Includes file dependencies
/* global _ */
define([
    "jquery",
    "backbone",
    "parse",
    "backform",
    "../forms/UserForm",
    "../helpers/PromiseFailReport",
    "../helpers/InjectAuthData",
    "marionette",
    "../views/PatronagesView",
    "../collections/Patronages",
    "text!../templates/user-settings-profile.html",
    "text!../templates/paypal-button.html"
], function ($, Backbone, Parse, Backform, UserForm, PromiseFailReport, InjectAuthData, Marionette, PatronagesView, Patronages, user_settings_profile_html, paypal_button_html) {

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

    // `FacebookLinkButtonView` used to live here, rendering a "Link Account to
    // Facebook" button into `#facebook-account-linking`.
    //
    // It could not work. Its click handler called `Parse.FacebookUtils.link`,
    // and `app/loadall.js` deliberately no longer calls
    // `Parse.FacebookUtils.init()` -- under parse@8 that throws "The Facebook
    // JavaScript SDK must be loaded before calling init" during bootstrap and
    // takes the whole router down with it, so every route 404s. The template
    // also asked `Parse.FacebookUtils.isLinked()` which side of the button to
    // draw. So the control painted and did nothing.
    //
    // Removed rather than repaired, matching the decision already taken for
    // Facebook login (loadall.js:18) and the state greensboro already ships,
    // where these buttons are hidden.

    var PaypalButton = Marionette.ItemView.extend({
        tagName: 'div',
        template: _.template(paypal_button_html),
        templateHelpers: {
            userid: function () {
                return Parse.User.current().id;
            },
        },
    });
    
    // `name`, not `attributes.name`.
    //
    // Marionette hands a template `model.toJSON()` (`serializeModel`,
    // backbone.marionette.js:1708), and a parse@8 Parse.Role's `toJSON()` is
    // the flat attribute bag - `{createdAt, updatedAt, name, users, roles,
    // ACL, objectId}`, measured - with no `attributes` key on it. lodash
    // compiles a template body inside `with (obj)`, so a key that is not there
    // is a bare undeclared identifier and the render died with a
    // ReferenceError: "attributes is not defined".
    //
    // Nothing surfaced. The throw happened inside the `q.each` callback in
    // `setup` below, so the Parse chain caught it and rejected, and
    // `.fail(PromiseFailReport)` logged `Error in promise {}` - a
    // ReferenceError has no enumerable own properties, so JSON.stringify
    // renders it as an empty object and even the log said nothing.
    //
    // Measured on the running app as devuser, who holds Administrator: the
    // Roles section of #profile rendered `<div></div>` and the role name was
    // simply absent. The same defect class as PlayerOptionsView's troupe
    // shortcuts - see docs/legacy-bugs-fixed.md.
    var RoleView = Marionette.ItemView.extend({
        template: function (serialized_model) {
            return _.template("The one: <%= name %>")(serialized_model);
        }
    });
    
    var RolesView = Marionette.CollectionView.extend({
        tagName: 'div',
        childView: RoleView
    });

    var LayoutView = Marionette.LayoutView.extend({
        el: "#user-settings-profile",
        template: _.template(user_settings_profile_html),
        regions: {
            profile: "#user-settings-profile-abs-form",
            patronage: "#usp-patronage-list-region",
            paypal: "#usp-paypal-button",
            roles: "#user-roles-available"
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
            self.showChildView('paypal', new PaypalButton(), options);
            self.showChildView('patronage', new PatronagesView({
                el: "#usp-patronage-list",
                collection: self.patronages,
                // R46: this built links to "#profile/<patronageId>", and no
                // such route exists - the router only defines
                // "patronage/:id" (`a_patronage`), which is the page these
                // rows are meant to open. Every row here was a dead link.
                back_url_base: "#patronage/"
            }), options);
            
            var roles = new Backbone.Collection();
            // See the note in helpers/RoleWreqr.js: a relation query is a
            // _User find, which is now closed, and this was an N+1 besides.
            var q = new Parse.Query(Parse.Role);
            q.equalTo("users", Parse.User.current());
            q.each(function (role) {
                roles.add(role);
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
