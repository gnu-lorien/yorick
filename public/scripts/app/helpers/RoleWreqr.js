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
                // Ask _Role which roles this user holds, instead of asking
                // every role's _User relation whether it contains them. A
                // relation query IS a _User find, so it is refused outright now
                // that _User find is closed -- and it was an N+1 besides, one
                // sub-query per role in the entire system. _Role is
                // world-readable, so this reads nothing privileged.
                var q = new Parse.Query(Parse.Role);
                q.equalTo("users", Parse.User.current());
                return q.each(function (role) {
                    self.roles.add(role);
                }).fail(function (error) {
                    console.log("Couldn't list this user's roles: " + error.message);
                });
            });
            return self._updateRoleWrapper;
        }
    });

    return new RoleHelper;
} );
