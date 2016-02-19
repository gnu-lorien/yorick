var pretty = require('cloud/prettyprint.js').pretty;
var _ = require('underscore');
var Vampire = Parse.Object.extend("Vampire");
var Image = require("parse-image");

// Use Parse.Cloud.define to define as many cloud functions as you want.
// For example:
Parse.Cloud.define("hello", function(request, response) {
  response.success("Hello world!");
});

var create_thumbnail = function(portrait, input_image, size) {
    return input_image.data().then(function (data) {
        var image = new Image;
        return image.setData(data);
    }).then(function(image) {
        return image.scale({
            width: size,
            height: size
        });
    }).then(function(image) {
        return image.setFormat("JPEG");
    }).then(function(image) {
        return image.data();
    }).then(function(buffer) {
        var base64 = buffer.toString("base64");
        var cropped = new Parse.File("thumbnail_" + size + ".jpg", { base64: base64 });
        return cropped.save();
    }).then(function(cropped) {
        portrait.set("thumb_" + size, cropped);
    });
}

var crop_and_thumb = function(request, response) {
    var portrait = request.object;
    var THUMBNAIL_SIZES = [32, 64,128, 256];
    var needed_sizes = [];

    if (portrait.dirty("original")) {
        _.each(THUMBNAIL_SIZES, function (size) {
            portrait.set("thumb_" + size, undefined);
        });
    }

    _.each(THUMBNAIL_SIZES, function (size) {
        if (!portrait.get("thumb_" + size)) {
            needed_sizes.push(size);
        }
    })

    if (0 == needed_sizes.length) {
        response.success();
        return;
    }

    Parse.Cloud.httpRequest({
        url: portrait.get("original").url()
    }).then(function(response) {
        var image = new Image();
        return image.setData(response.buffer);
    }).then(function(image) {
        // Crop the image to the smaller of width or height.
        var size = Math.min(image.width(), image.height());
        return image.crop({
            left: (image.width() - size) / 2,
            top: (image.height() - size) / 2,
            width: size,
            height: size
        });
    }).then(function(image) {
        var promises = [];
        _.each(THUMBNAIL_SIZES, function(size) {
            promises.push(create_thumbnail(portrait, image, size))
        })
        return Parse.Promise.when(promises);
    }).then(function() {
        response.success();
    }, function(error) {
        response.error(error);
    });
};

Parse.Cloud.beforeSave("TroupePortrait", function(request, response) {
    crop_and_thumb(request, response);
});

Parse.Cloud.beforeSave("CharacterPortrait", function(request, response) {
    var portrait = request.object;
    var THUMBNAIL_SIZES = [32, 64,128, 256];
    var needed_sizes = [];

    if (portrait.dirty("original")) {
        _.each(THUMBNAIL_SIZES, function (size) {
            portrait.set("thumb_" + size, undefined);
        });
    }

    _.each(THUMBNAIL_SIZES, function (size) {
        if (!portrait.get("thumb_" + size)) {
            needed_sizes.push(size);
        }
    })

    if (0 == needed_sizes.length) {
        response.success();
        return;
    }

    Parse.Cloud.httpRequest({
        url: portrait.get("original").url()
    }).then(function(response) {
        var image = new Image();
        return image.setData(response.buffer);
    }).then(function(image) {
        // Crop the image to the smaller of width or height.
        var size = Math.min(image.width(), image.height());
        return image.crop({
            left: (image.width() - size) / 2,
            top: (image.height() - size) / 2,
            width: size,
            height: size
        });
    }).then(function(image) {
        var promises = [];
        _.each(THUMBNAIL_SIZES, function(size) {
            promises.push(create_thumbnail(portrait, image, size))
        })
        return Parse.Promise.when(promises);
    }).then(function() {
        response.success();
    }, function(error) {
        response.error(error);
    });
});

var get_vampire_change_acl = function(vampire) {
    var daString = vampire.get("acl_to_json");
    if (_.isUndefined(daString)) {
        var acl = new Parse.ACL;
        acl.setPublicReadAccess(false);
        acl.setPublicWriteAccess(false);
        var owner = vampire.get("owner");
        if (!_.isUndefined(owner)) {
            // Archived characters have no owner
            acl.setReadAccess(owner, true);
            acl.setWriteAccess(owner, false);
        }
        acl.setRoleReadAccess("Administrator", true);
        acl.setRoleWriteAccess("Administrator", true);
        return acl;
    }
    var acl = new Parse.ACL;
    var given_permissions_by_id = JSON.parse(daString);
    _.each(given_permissions_by_id, function (permissions, key) {
        acl.setReadAccess(key, true);
        acl.setWriteAccess(key, false);
    });
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    acl.setRoleReadAccess("Administrator", true);
    acl.setRoleWriteAccess("Administrator", false);
    return acl;
}

Parse.Cloud.beforeSave("Vampire", function(request, response) {
    var tracked_texts = ["clan", "state", "archetype", "faction", "title", "sect"];
    var v = request.object;
    var serverData = _.clone(v._serverData);
    var desired_changes = _.intersection(tracked_texts, v.dirtyKeys());
    if (0 === desired_changes.length) {
        response.success();
        return;
    }
    // TODO: Update the history permissions if troupes has changed
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
                "instigator": request.user
            });
            var acl = get_vampire_change_acl(vampire);
            vc.setACL(acl);
            return vc;
        }));
    }).then(function () {
        return response.success();
    }).fail(function (error) {
        console.log(error.message);
        response.error();
    })
});

var isMeaningfulChange = function (vc) {
    var changed = true;
    if ("update" == vc.get("type")) {
        changed = false;
        if (vc.get("old_value") != vc.get("value")) {
            changed = true;
        }
        if (vc.get("old_cost") != vc.get("cost")) {
            changed = true;
        }
        if (vc.get("old_text") != vc.get("name")) {
            changed = true;
        }
        if (vc.get("free_value") != vc.get("old_free_value")) {
            changed = true;
        }
    }

    return changed;
}

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
        "old_free_value": serverData.free_value,
        "free_value": modified_trait.get("free_value"),
        "old_cost": serverData.cost,
        "cost": modified_trait.get("cost"),
        "old_text": serverData.name,
        "simple_trait_id": modified_trait.id,
        "instigator": request.user
    });

    if (!isMeaningfulChange(vc)) {
        console.log("Update does not actually encode a change");
        response.success();
        return;
    }

    var vToFetch = new Vampire({id: vc.get("owner").id});
    vToFetch.fetch().then(function(vampire) {
        var acl = get_vampire_change_acl(vampire);
        vc.setACL(acl);

        return vc.save();
    }).then(function () {
        response.success();
    }, function (error) {
        console.log(error.message);
        console.log("Failed to save change for", request.object.id, "because of", pretty(error));
        response.error();
    });
});

Parse.Cloud.beforeDelete("SimpleTrait", function(request, response) {
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
        "old_free_value": serverData.free_value,
        "free_value": trait.get("free_value"),
        "type": "remove",
        "old_cost": serverData.cost,
        "simple_trait_id": trait.id,
        "instigator": request.user
    });
    var vToFetch = new Vampire({id: vc.get("owner").id});
    vToFetch.fetch().then(function(vampire) {
        var acl = get_vampire_change_acl(vampire);
        vc.setACL(acl);
        return vc.save();
    }).then(function () {
        response.success();
    }, function (error) {
        console.log("Failed to save delete for" + request.object.id + "because of" + pretty(error));
        response.error();
    });
});

Parse.Cloud.define("removeRedundantHistory", function(request, response) {
    Parse.Cloud.useMasterKey();
    var allHistory = new Parse.Query("VampireChange");
    var redundant = [];
    allHistory.each(function (vc) {
        if (!isMeaningfulChange(vc)) {
            vc.set("marked_redundant", true);
            redundant.push(vc);
        }
    }).then(function() {
        return Parse.Object.destroyAll(redundant);
    }).then(function () {
        response.success();
    }, function(error) {
        response.error(error);
    });
})

var fix_character_ownership = function(v) {
    var acl = get_vampire_change_acl(v);
    Parse.Cloud.useMasterKey();
    return new Parse.Query("VampireChange").equalTo("owner", v).each(function (vc) {
        vc.setACL(acl);
        return vc.save();
    });
};

Parse.Cloud.define("update_vampire_change_permissions_for", function(request, response) {
    var character_id = request.params.character;
    var tmp = new Vampire({id: character_id});
    tmp.fetch().then(function (v) {
        return fix_character_ownership(v);
    }).then(function() {
        response.success("Successfully updated permissions.");
    }, function(error) {
        if (error.code === Parse.Error.AGGREGATE_ERROR) {
            for (var i = 0; i < error.errors.length; i++) {
                response.error("Couldn't fix " + error.errors[i].object.id + "due to " + error.errors[i].message);
            }
        } else {
            response.error("Update permissions because of " + error.message);
        }
        console.log(pretty(error));
    });
});

Parse.Cloud.job("fixuserownership", function(request, response) {
    Parse.Cloud.useMasterKey();
    var q = new Parse.Query(Parse.User);
    q.each(function (user) {
        var acl = new Parse.ACL;
        acl.setPublicReadAccess(true);
        acl.setPublicWriteAccess(false);
        acl.setWriteAccess(user, true);
        user.setACL(acl);
        return user.save();
    }).then(function() {
        response.success();
    }, function(error) {
        if (error.code === Parse.Error.AGGREGATE_ERROR) {
            for (var i = 0; i < error.errors.length; i++) {
                response.error("Couldn't fix " + error.errors[i].object.id + "due to " + error.errors[i].message);
            }
        } else {
            response.error("Couldn't fix user ownership " + error.message);
        }
        console.log(pretty(error));
    })
})

Parse.Cloud.job("fixcharacterownerships", function(request, response) {
    Parse.Cloud.useMasterKey();
    var allCharacters = new Parse.Query("Vampire");
    allCharacters.each(function (character) {
        var acl = new Parse.ACL;
        acl.setPublicReadAccess(false);
        acl.setPublicWriteAccess(false);
        var owner = character.get("owner");
        if (!_.isUndefined(owner)) {
            // Archived characters have no owner
            acl.setWriteAccess(owner, true);
            acl.setReadAccess(owner, true);
        }
        acl.setRoleReadAccess("Administrator", true);
        acl.setRoleWriteAccess("Administrator", true);
        character.setACL(acl);
        return character.save();
    }).then(function() {
        response.success();
    }, function(error) {
        if (error.code === Parse.Error.AGGREGATE_ERROR) {
            for (var i = 0; i < error.errors.length; i++) {
                response.error("Couldn't fix " + error.errors[i].object.id + "due to " + error.errors[i].message);
            }
        } else {
            response.error("Fix character ownership because of " + error.message);
        }
        console.log(pretty(error));
    })
})

Parse.Cloud.job("fixcharacterchangeownerships", function(request, response) {
    Parse.Cloud.useMasterKey();
    var allCharacters = new Parse.Query("Vampire");
    allCharacters.each(function (character) {
        var allChanges = new Parse.Query("VampireChange");
        allChanges.equalTo("owner", character);
        return allChanges.each(function (change) {
            var acl = get_vampire_change_acl(character);
            change.setACL(acl);
            return change.save();
        })
    }).then(function() {
        response.success();
    }, function(error) {
        if (error.code === Parse.Error.AGGREGATE_ERROR) {
            for (var i = 0; i < error.errors.length; i++) {
                response.error("Couldn't fix " + error.errors[i].object.id + "due to " + error.errors[i].message);
            }
        } else {
            response.error("Couldn't fix character change ownership " + error.message);
        }
        console.log(pretty(error));
    })
})

var add_administrator_to_everything = function(model) {
    var acl = model.getACL();
    if (_.isUndefined(acl)) {
        // Not completely defined for some reason
        return Parse.Promise.as([]);
    }
    acl.setRoleReadAccess("Administrator", true);
    acl.setRoleWriteAccess("Administrator", true);
    model.setACL(acl);
    return model.save();
}

Parse.Cloud.job("add_administrator_to_many_things", function (request, response) {
    Parse.Cloud.useMasterKey();
    new Parse.Query("SimpleTrait").each(add_administrator_to_everything).then(function () {
         return new Parse.Query("VampireCreation").each(add_administrator_to_everything);
    }).then(function() {
         return new Parse.Query("ExperienceNotation").each(add_administrator_to_everything);
    }).then(function() {
         return new Parse.Query("VampireChange").each(add_administrator_to_everything);
    }).then(function() {
        response.success();
    }).fail(function(error) {
        if (error.code === Parse.Error.AGGREGATE_ERROR) {
            for (var i = 0; i < error.errors.length; i++) {
                response.error("Couldn't delete " + error.errors[i].object.id + "due to " + error.errors[i].message);
            }
        } else {
            response.error("Add administrator broken of " + error.message);
        }
        console.log(pretty(error));
    });
});

Parse.Cloud.job("deletetestcharacters", function(request, response) {
    Parse.Cloud.useMasterKey();
    var allTestCharacters = new Parse.Query("Vampire");
    var ids = [];
    var subids = [];
    allTestCharacters.startsWith("name", "karmacharactertest");
    allTestCharacters.each(function (v) {
        ids.push(v);
    });
    new Parse.Query("SimpleTrait").containedIn("owner", ids).each(function (vc) {
        return vc.destroy();
    }).then(function () {
         return new Parse.Query("VampireCreation").containedIn("owner", ids).each(function (vc) {
            return vc.destroy();
        });
    }).then(function() {
         return new Parse.Query("ExperienceNotation").containedIn("owner", ids).each(function (vc) {
            return vc.destroy();
        });
    }).then(function() {
         return new Parse.Query("VampireChange").containedIn("owner", ids).each(function (vc) {
            return vc.destroy();
        });
    }).then(function() {
        return Parse.Object.destroyAll(ids);
    }).then(function() {
        response.success();
    }).fail(function(error) {
        if (error.code === Parse.Error.AGGREGATE_ERROR) {
            for (var i = 0; i < error.errors.length; i++) {
                response.error("Couldn't delete " + error.errors[i].object.id + "due to " + error.errors[i].message);
            }
        } else {
            response.error("Delete aborted because of " + error.message);
        }
        console.log(pretty(error));
    });
})