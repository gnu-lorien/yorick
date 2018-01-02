// Includes file dependencies
define([
	"jquery",
	"parse"
], function( $, Parse ) {

    // The Model constructor
    var Model = Parse.Object.extend( "ReferendumBallot", {
        initialize: function(options) {
            var self = this;
            var acl = new Parse.ACL();
            acl.setPublicReadAccess(false);
            acl.setPublicWriteAccess(false);
            acl.setRoleReadAccess("Administrator", true);
            acl.setRoleWriteAccess("Administrator", true);
            self.setACL(acl);
            self.title_options = ["LST", "AST", "Narrator"];
        },
    } );

    // Returns the Model class
    return Model;

} );