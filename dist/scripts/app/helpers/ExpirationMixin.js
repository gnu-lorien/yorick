// Includes file dependencies
define([
], function() {

    var Mixin = {
        isActive: function() {
            if (this.has("expiresOn")) {
                return this.get("expiresOn") > Date.now();
            }
            return false;
        },
        isExpired: function() {
            if (this.has("expiresOn")) {
                return this.get("expiresOn") < Date.now();
            }
            return false;
        },
        status: function() {
            if (this.isActive()) {
                return "Active";
            } else {
                return "Expired";
            }
        }
    };

    // Returns the View class
    return Mixin;

} );
