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
        }

    } );

    // Returns the Model class
    return Model;

} );