// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse"
], function( $, Parse ) {

    // The Model constructor
    var Model = Parse.Object.extend( "SimpleTrait", {
        linkId: function() {
            return this.id || this.cid;
        },

        get_base_name: function() {
            var self = this;
            var name = self.get("name") || "";
            var s = name.split(": ");
            return s[0];
        },

        get_specialization: function() {
            var self = this;
            var name = self.get("name") || "";
            var s = name.split(": ");
            return s[1];
        },

        set_specialization: function(specialization) {
            var self = this;
            if (!specialization) {
                self.set("name", self.get_base_name());
            } else {
                self.set("name", self.get_base_name() + ": " + specialization);
            }

            return self;
        },

        _findUnsavedChildren: function(object, children, files) {
            console.log("Before " + this.get("name") + ": " + children.length);
            Parse.Object._findUnsavedChildren.apply(this, object, children, files);
            console.log("After " + this.get("name") + ": " + children.length);
        },
    } );

    // Returns the Model class
    return Model;

} );