// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse",
    "../models/SimpleTrait"
], function( $, Parse, SimpleTrait ) {

    // The Model constructor
    var Model = Parse.Object.extend( "Vampire", {
        update_trait: function(nameOrTrait, value, category) {
            var self = this;
            var modified_trait, trait = undefined;
            if (!_.isString(nameOrTrait)) {
                trait = nameOrTrait;
                category = trait.get("category");
            };
            return Parse.Object.fetchAllIfNeeded(self.get(category)).then(function(list) {
                if (!_.isString(nameOrTrait)) {
                    var trait = nameOrTrait;
                    if (!_.contains(list, trait)) {
                        throw "Provided trait not already in Vampire as expected";
                    }
                    return trait.save();
                } else {
                    var b = new SimpleTrait;
                    _.each(self.get(category), function (st) {
                        if (_.isEqual(st.get("name"), name)) {
                            b = st;
                        }
                    });
                    b.set({"name": name, "value": value, "category": category});
                    return b.save();
                }
                return undefined;
            }).then(function(b) {
                modified_trait = b;
                self.addUnique(category, b);
                return self.save();
            }).then(function() {
                self.trigger("change:" + modified_trait.get(category));
                return Parse.Promise.as(modified_trait);
            });

        }
    } );

    // Returns the Model class
    return Model;

} );