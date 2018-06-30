/* global Parse */
var _ = require('lodash');

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
        //self.title_options = ["AST", "Narrator"];
    },

    get_staff: function() {
        var self = this;
        var users = [];
        return Parse.Promise.when(self.get_roles()).then(function (roles) {
            var userqs = _.map(roles, function(role, title) {
                var u = role.getUsers();
                var q = u.query();
                return q.each(function(user) {
                    user.set("role", title);
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
            console.log("In Troupe get_roles about to get title string");
            q.equalTo("name", title + "_" + self.id);
            console.log("In Troupe get_roles title string is " + title + "_" + self.id);
            return q.first().then(function (role) {
                roles[title] = role;
            });
        })
        return Parse.Promise.when(promises).then(function () {
            return Parse.Promise.as(roles);
        });
    },

    get_generic_roles: function() {
        var self = this;
        var roles = {};
        var promises = _.map(self.title_options, function (title) {
            var q = new Parse.Query(Parse.Role);
            q.equalTo("name", title);
            return q.first().then(function (role) {
                roles[title] = role;
            });
        })
        return Parse.Promise.when(promises).then(function () {
            return Parse.Promise.as(roles);
        });
    },

    get_thumbnail: function (size) {
        var self = this;
        if (self.get("portrait")) {
            var portrait = self.get("portrait");
            return portrait.fetch().then(function (portrait) {
                console.log(self.get_thumbnail_sync(size));
                return Parse.Promise.as(portrait.get("thumb_" + size).url());
            });
        } else {
            return Parse.Promise.as("head_skull.png");
        }
    },

    get_thumbnail_sync: function (size) {
        var self = this;
        return _.result(self, "attributes.portrait.attributes.thumb_" + size + ".url", "head_skull.png");
    }


} );

exports.Troupe = Model;