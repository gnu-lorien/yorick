// Includes file dependencies
define([
], function() {

    var Mixin = {
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
    };

    // Returns the View class
    return Mixin;

} );
