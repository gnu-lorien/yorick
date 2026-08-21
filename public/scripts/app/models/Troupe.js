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
            //self.title_options = ["AST", "Narrator"];
        },

        /**
         * The troupe's staff, from the server.
         *
         * This used to walk each role's users relation with an ordinary client
         * query carrying no options at all. That is an ACL-filtered read, so a
         * private staffer was simply ABSENT -- the roster rendered one fewer
         * name with no marker anywhere, re-creating exactly the "this troupe
         * has no staff" confusion TroupeView documents fighting.
         *
         * It also did `user.set("role", title)`, dirtying a _User row the
         * caller cannot write. The Cloud function attaches the title without
         * dirtying anything.
         *
         * Role order is fixed LST, AST, Narrator server-side; the old version
         * iterated an object whose key order came from promise resolution.
         */
        get_staff: function() {
            var self = this;
            return Parse.Cloud.run("get_troupe_staff", {troupe_id: self.id}).then(function (payload) {
                return Parse.Promise.as(payload.staff);
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

    // Returns the Model class
    return Model;

} );