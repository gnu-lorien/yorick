// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse"
], function( $, Parse ) {

    var instance_methods = {
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
        
        has_specialization: function () {
            var self = this;
            var name = self.get("name") || "";
            return -1 != name.indexOf(": ");
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

        validate: function(attr, options) {
            var self = this;
            var failures = {};
            _.each(["value", "free_value"], function (name) {
                if (_.has(attr, name)) {
                    if (!_.isFinite(attr[name])) {
                        failures[name] = {message: "" + name + " must be a number. Trying to save as " + attr[name]};
                    }
                }
            });
            if (0 != _.keys(failures).length) {
                return failures;
            }
        },

        _findUnsavedChildren: function(object, children, files) {
            console.log("Before " + this.get("name") + ": " + children.length);
            Parse.Object._findUnsavedChildren.apply(this, object, children, files);
            console.log("After " + this.get("name") + ": " + children.length);
        },
    };

    return instance_methods;

} );