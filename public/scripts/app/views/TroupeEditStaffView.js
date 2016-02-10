// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "backform",
    "../helpers/PromiseFailReport"
], function( $, Backbone, Parse, Backform, PromiseFailReport) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            _.bindAll(this, "render", "submit");
        },

        register: function(troupe, user) {
            var self = this;
            self.troupe = troupe;
            self.user = user;

            var roles = {};
            return Parse.Promise.when(self.troupe.get_roles()).then(function (inroles) {
                roles = inroles;
                var promises = _.map(self.troupe.title_options, function (title) {
                    var u = roles[title].getUsers();
                    var q = u.query();
                    q.equalTo("objectId", self.user.id);
                    return q.count().then(function (count) {
                        roles[title] = count;
                        console.log("Setting up role " + title + " count with " + count);
                    })
                });
                return Parse.Promise.when(promises);
            }).then(function () {
                var role = _.findKey(roles, function (count, key, rolesagain) {
                    console.log("Got " + count + " for " + key);
                    if (_.isFinite(count) && count > 0) {
                        return true;
                    }
                    return false;
                })
                console.log("I found this user with a role of " + role);
                return Parse.Promise.as(role);
            }).then(function (role) {
                self.user.set("role", role);
                self.form = new Backform.Form({
                    el: "#troupe-edit-staff-form",
                    model: self.user,
                    fields: [
                        {name: "username", label: "Username", control: "uneditable-input"},
                        {name: "realname", label: "Name", control: "uneditable-input"},
                        {
                            name: "role",
                            label: "Role",
                            control: "select",
                            options: [
                                {label: "Lead Storyteller", value: "LST"},
                                {label: "Assistant Storyteller", value: "AST"},
                                {label: "Narrator", value: "Narrator"},
                                {label: "Not on Staff", value: undefined}
                            ]
                        },
                        {control: "spacer"},
                        {control: "button", label: "Save"}
                    ],
                });
                self.render();
            }).fail(function(error) {
                if (_.isArray(error)) {
                    _.each(error, function(e) {
                        console.log("Something failed" + e.message);
                    })
                } else {
                    console.log("error updating experience" + error.message);
                }
            });
        },

        events: {
            "submit": "submit",
        },

        submit: function (e) {
            var self = this;
            e.preventDefault();
            var role = self.user.get("role");
            var roles_to_remove = _.slice(self.troupe.title_options),
                roles_to_add = [];
            if (!_.isUndefined(role)) {
                roles_to_add.push(role);
                roles_to_remove = _.xor(roles_to_remove, roles_to_add);
            }

            var alter_roles = function (roles) {
                _.each(roles_to_remove, function (title) {
                    var u = roles[title].getUsers();
                    console.log(u);
                    u.remove(self.user);
                });
                _.each(roles_to_add, function (title) {
                    roles[title].getUsers().add(self.user);
                })
                var to_save = _.values(roles);
                var promises = _.map(to_save, function (s) {
                    return s.save().fail(PromiseFailReport);
                })
                return Parse.Promise.when(promises);
            }

            return Parse.Promise
                .when(self.troupe.get_roles())
                .then(alter_roles)
                .then(function () {
                    return self.troupe.get_generic_roles();
                })
                .then(alter_roles)
                .always(function () {
                    window.location.hash = "#troupe/" + self.troupe.id;
                }).fail(PromiseFailReport);
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            self.form.render();
            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
