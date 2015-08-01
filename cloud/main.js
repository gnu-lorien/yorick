var pretty = require('cloud/prettyprint.js').pretty;
var _ = require('underscore');
var Vampire = Parse.Object.extend("Vampire");

// Use Parse.Cloud.define to define as many cloud functions as you want.
// For example:
Parse.Cloud.define("hello", function(request, response) {
  response.success("Hello world!");
});

Parse.Cloud.beforeSave("Vampire", function(request, response) {
    var tracked_texts = ["clan", "state", "archetype"];
    var v = request.object;
    var serverData = _.clone(v._serverData);
    var desired_changes = _.intersection(tracked_texts, v.dirtyKeys());
    if (0 === desired_changes.length) {
        response.success();
        return;
    }
    Parse.Cloud.useMasterKey();
    var new_values = {};
    _.each(v.dirtyKeys(), function(k) {
        new_values[k] = v.get(k);
    })
    var vToFetch = new Vampire({id: v.id});
    vToFetch.fetch().then(function(vampire) {
        return Parse.Object.saveAll(_.map(_.pairs(new_values), function(a) {
            var attribute = a[0], val = a[1];
            var vc = new Parse.Object("VampireChange");
            vc.set({
                "name": attribute,
                "category": "core",
                "old_text": serverData[attribute],
                "new_text": val,
                "owner": vampire,
                "type": serverData[attribute] === undefined ? "core_define" : "core_update",
            });
            return vc;
        }));
    }).then(function () {
        return response.success();
    }).fail(function (error) {
        console.log(error.message);
        response.error();
    })
});

Parse.Cloud.afterSave("VampireChange", function(request) {
    /*
    var vc = request.object;
    if ("experience_points" == vc.get("experience_points")) {
        return;
    }
    var cost_mod = parseInt(vc.get("cost")) - parseInt(vc.get("old_cost"));
    var vampire;
    vc.get("owner").fetch().then(function (v) {
        vampire = v;
        return Parse.Object.fetchAll(vampire.get("experience_points"));
    }).then(function (traits) {
        // Get spent XP
        // Add the cost_mod to it
    });
    */
});

Parse.Cloud.beforeSave("SimpleTrait", function(request, response) {
    Parse.Cloud.useMasterKey();
    var vc = new Parse.Object("VampireChange");
    var modified_trait = request.object;
    var serverData = modified_trait._serverData;
    vc.set({
        "name": modified_trait.get("name"),
        "category": modified_trait.get("category"),
        "owner": modified_trait.get("owner"),
        "old_value": serverData.value,
        "value": modified_trait.get("value"),
        "type": serverData.value === undefined ? "define" : "update",
        "free_value": modified_trait.get("free_value"),
        "old_cost": serverData.cost,
        "cost": modified_trait.get("cost"),
        "old_text": serverData.name,
    });
    vc.save().then(function () {
        response.success();
    }, function(error) {
        console.log("Failed to save change for", request.object.id, "because of", pretty(error));
        response.error();
    });
});

Parse.Cloud.afterDelete("SimpleTrait", function(request) {
    Parse.Cloud.useMasterKey();
    var vc = new Parse.Object("VampireChange");
    var trait = request.object;
    var serverData = trait._serverData;
    vc.set({
        "name": trait.get("name"),
        "category": trait.get("category"),
        "owner": trait.get("owner"),
        "old_value": serverData.value,
        "value": trait.get("value"),
        "free_value": trait.get("free_value"),
        "type": "remove",
        "old_cost": serverData.cost
    });
    vc.save().then(function () {
    }, function (error) {
        console.log("Failed to save delete for", request.object.id, "because of", pretty(error));
    });
});