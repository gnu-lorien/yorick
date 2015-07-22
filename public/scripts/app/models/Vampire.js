// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse",
    "../models/SimpleTrait",
    "../models/VampireChange"
], function( $, Parse, SimpleTrait, VampireChange ) {

    // The Model constructor
    var Model = Parse.Object.extend( "Vampire", {
        remove_trait: function (trait) {
            var self = this;
            var serverData = _.clone(trait._serverData);
            self.remove(trait.get("category"), trait);
            return self.save().then(function () {
                // Injected server side beforeSave
                var vc = new VampireChange;
                vc.set({
                    "name": trait.get("name"),
                    "category": trait.get("category"),
                    "owner": self,
                    "old_value": serverData.value,
                    "type": "remove"
                });
                vc.save().then(function () {
                    console.log("Saved vc");
                }, function (error) {
                    console.log("Failed to save vc", error);
                });
                // End injected server side beforeSave
                return trait.destroy({wait: true});
            });
        },
        update_trait: function(nameOrTrait, value, category) {
            var self = this;
            var modified_trait, name, trait, serverData;
            if (!_.isString(nameOrTrait)) {
                trait = nameOrTrait;
                category = trait.get("category");
            } else {
                name = nameOrTrait;
            };
            return Parse.Object.fetchAllIfNeeded(self.get(category)).then(function(list) {
                if (!_.isString(nameOrTrait)) {
                    var trait = nameOrTrait;
                    if (!_.contains(list, trait)) {
                        throw "Provided trait not already in Vampire as expected";
                    }
                    serverData = _.clone(trait._serverData);
                    return trait.save();
                } else {
                    var b = new SimpleTrait;
                    _.each(self.get(category), function (st) {
                        if (_.isEqual(st.get("name"), name)) {
                            b = st;
                        }
                    });
                    b.set({"name": name, "value": value, "category": category, "owner": self});
                    serverData = _.clone(b._serverData);
                    return b.save();
                }
                return undefined;
            }).then(function (st) {
                modified_trait = st;

                // Injected server side beforeSave
                var vc = new VampireChange;
                vc.set({
                    "name": st.get("name"),
                    "category": st.get("category"),
                    "owner": self,
                    "old_value": serverData.value,
                    "value": st.get("value"),
                    "type": serverData.value === undefined ? "define" : "update"
                });
                vc.save().then(function () {
                    console.log("Saved vc");
                }, function(error) {
                    console.log("Failed to save vc", error);
                });
                // End injected server side beforeSave

                self.addUnique(category, st);
                return self.save();
            }).then(function () {
                self.trigger("change:" + modified_trait.get(category));
                return Parse.Promise.as(modified_trait);
            });
        }

    } );

    // Returns the Model class
    return Model;

} );