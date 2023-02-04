define([
    "jquery",
    "underscore",
    "parse",
    "backbone",
    "marionette",
    "../collections/Users",
], function( $, _, Parse, Backbone, Marionette, Users ) {

    var RoleHelper = Backbone.Model.extend({
        initialize: function() {
            var self = this;

            self.channel = Backbone.Wreqr.radio.channel('role');
            self.roles = new Backbone.Collection;

            Backbone.Wreqr.radio.reqres.setHandler("role", "get", function (id) {
                return self.roles.get(id);
            })
            Backbone.Wreqr.radio.reqres.setHandler("role", "all", function () {
                return self.roles;
            })
        },
        get_current_roles: function() {
            var self = this;
            self._updateRoleWrapper = self._updateRoleWrapper || Parse.Promise.as();
            self._updateRoleWrapper = self._updateRoleWrapper.always(function () {
                if (_.eq(self.last_user_id, Parse.User.current().id)) {
                    return Parse.Promise.as();
                }
                self.last_user_id = Parse.User.current().id;
                var q = new Parse.Query(Parse.Role);
                return q.each(function (role) {
                    var users_relation = role.getUsers();
                    var uq = users_relation.query();
                    uq.equalTo("objectId", Parse.User.current().id);
                    return uq.each(function (user) {
                        self.roles.add(role);
                    }).fail(function (error) {
                        console.log("Failed in promise for " + role.get("name"));
                    });
                });
            });
            return self._updateRoleWrapper;
        }
    });

    return new RoleHelper;
} );
