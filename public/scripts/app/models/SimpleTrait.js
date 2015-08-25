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
            var s = self.get("name").split(": ");
            return s[0];
        },

        get_specialization: function() {
            var self = this;
            var s = self.get("name").split(": ");
            return s[1];
        },

        set_specialization: function(specialization) {
            var self = this;
            self.set("name", self.get_base_name() + ": " + specialization);

            return self;
        },

        save: function() {
            return Parse.Object.prototype.save.apply(this, arguments);
        },

        dirty: function() {
            var ret = Parse.Object.prototype.dirty.apply(this, arguments);
            if (ret) {
                console.log("SimpleTrait " + this.get("name") + "is dirty " + ret);
            }
            return ret;
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