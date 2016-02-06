// Includes file dependencies
define([
	"jquery",
	"parse"
], function( $, Parse ) {

    // The Model constructor
    var Model = Parse.Object.extend( "Troupe", {
        initialize: function(options) {
            var self = this;
            var acl = new Parse.ACL();
            acl.setPublicReadAccess(true);
            acl.setPublicWriteAccess(false);
            acl.setRoleReadAccess("Administrator", true);
            acl.setRoleWriteAccess("Administrator", true);
            self.setACL(acl);
            self.title_options = ["LST", "AST", "Narrator"];
        },

        get_staff: function() {
            var self = this;
            var users = [];
            return Parse.Promise.when(self.get_roles()).then(function (roles) {
                var userqs = _.map(roles, function(role, title) {
                    var u = role.getUsers();
                    var q = u.query();
                    return q.each(function(user) {
                        users.push(user);
                    });
                })
                return Parse.Promise.when(userqs);
            }).then(function() {
                return Parse.Promise.as(users);
            });
        },

        get_roles: function() {
            var self = this;
            var roles = {};
            var promises = _.map(self.title_options, function (title) {
                var q = new Parse.Query(Parse.Role);
                q.equalTo("name", title + "_" + self.id);
                return q.first().then(function (role) {
                    roles[title] = role;
                });
            })
            return Parse.Promise.when(promises).then(function () {
                return Parse.Promise.as(roles);
            });
        },


    } );

    // Returns the Model class
    return Model;

} );