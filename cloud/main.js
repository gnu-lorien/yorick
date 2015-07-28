var pretty = require('cloud/prettyprint.js').pretty;

// Use Parse.Cloud.define to define as many cloud functions as you want.
// For example:
Parse.Cloud.define("hello", function(request, response) {
  response.success("Hello world!");
});

Parse.Cloud.beforeSave("SimpleTrait", function(request, response) {
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
        "free_value": modified_trait.get("free_value")
    });
    vc.save().then(function () {
        response.success();
    }, function(error) {
        console.log("Failed to save change for", request.object.id, "because of", pretty(error));
        response.error();
    });
});

Parse.Cloud.afterDelete("SimpleTrait", function(request) {
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
        "type": "remove"
    });
    vc.save().then(function () {
    }, function (error) {
        console.log("Failed to save delete for", request.object.id, "because of", pretty(error));
    });
});