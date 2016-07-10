// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse"
], function( $, Parse ) {

    // The Model constructor
    var Model = Parse.Object.extend("Patronage", {
        isActive: function() {
            return this.get("expiresOn") > Date.now();
        },
        isExpired: function() {
            return this.get("expiresOn") < Date.now();
        },
        status: function() {
            if (this.isActive()) {
                return "Active";
            } else {
                return "Expired";
            }
        }
    });

    // Returns the Model class
    return Model;

} );