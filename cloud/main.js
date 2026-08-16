/* global Parse */
var _ = require('lodash');
var pretty = require('./prettyprint').pretty;
var Vampire = Parse.Object.extend("Vampire");
var Patronage = Parse.Object.extend("Patronage");
var Troupe = require('./Troupe.js').Troupe;
var Image = require("jimp");
var request = require("request");
var Promise = global.Promise;
var moment = require("moment");

/* FIXME Shouldn't just paste this class in here. Still need a way to sync between
   the require world and the node world */

// Use Parse.Cloud.define to define as many cloud functions as you want.
// For example:
Parse.Cloud.define("hello", function(request, response) {
  response.success("Hello world!");
});

var create_thumbnail = function(portrait, input_image, size) {
    var promise = new Promise(
        function(resolve, reject) {
            var cb = function(err, buffer) {
                    if (err) reject(err);
                    else resolve(buffer);
                }
            var img = input_image.getBuffer(Image.MIME_JPEG, cb);
        }
    );
    return promise.then(function (buffer) {
        return Image.read(buffer);
    }).then(function(image) {
        return new Promise(
            function(resolve, reject) {
                var cb = function(err, unused) {
                    if (err) reject(err);
                    else resolve(image);
                }
                var img = image.scaleToFit(size, size, cb);
            }
        );
    }).then(function (image) {
        return new Promise(
            function (resolve, reject) {
                var cb = function (err, buffer) {
                    if (err) reject(err);
                    else resolve(buffer);
                }
                var img = image.getBuffer(Image.MIME_JPEG, cb);
            }
        );
    }).then(function (buffer) {
        var base64 = buffer.toString("base64");
        var cropped = new Parse.File("thumbnail_" + size + ".jpg", {base64: base64});
        return cropped.save();
    }).then(function(cropped) {
        portrait.set("thumb_" + size, cropped);
    });
}

var crop_and_thumb = function(req, res) {
    var portrait = req.object;
    var THUMBNAIL_SIZES = [32, 64, 128, 256];
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
        res.success();
        return;
    }

    Image.read(portrait.get("original").url()).then(function (image) {
        // Crop the image to the smaller of width or height.
        var size = Math.min(image.bitmap.width, image.bitmap.height);
        return image.crop(
            (image.bitmap.width - size) / 2,
            (image.bitmap.height - size) / 2,
            size,
            size
        );
    }).then(function (image) {
        var promises = [];
        _.each(THUMBNAIL_SIZES, function (size) {
            promises.push(create_thumbnail(portrait, image, size))
        })
        return Parse.Promise.when(promises);
    }).then(function () {
        res.success();
    }, function (error) {
        res.error(error);
    });
};

Parse.Cloud.beforeSave("TroupePortrait", function(request, response) {
    crop_and_thumb(request, response);
});

Parse.Cloud.beforeSave("CharacterPortrait", function(request, response) {
    crop_and_thumb(request, response);
});

Parse.Cloud.beforeSave("ReferendumPortrait", function(request, response) {
    crop_and_thumb(request, response);
});

var get_vampire_change_acl = function(vampire) {
    var acl = new Parse.ACL();
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

    var daString = vampire.get("acl_to_json");
    if (!_.isUndefined(daString) && daString) {
        try {
            var given_permissions_by_id = JSON.parse(daString);
            _.each(given_permissions_by_id, function (permissions, key) {
                if (key.indexOf("role:") === 0) {
                    var roleName = key.replace("role:", "");
                    acl.setRoleReadAccess(roleName, true);
                    acl.setRoleWriteAccess(roleName, false);
                } else if (key !== "*") {
                    acl.setReadAccess(key, true);
                    acl.setWriteAccess(key, false);
                }
            });
        } catch (e) {
            console.log("Failed to parse acl_to_json: " + e.message);
        }
    }
    return acl;
};

Parse.Cloud.beforeSave("Vampire", function(request, response) {
    var tracked_texts = [
        "name",
        "clan",
        "state",
        "archetype",
        "archetype_2",
        "faction",
        "title",
        "sect",
        "antecedence",
        "wta_breed",
        "wta_auspice",
        "wta_tribe",
        "wta_camp",
        "wta_faction",
        // R47a. Vampire and Werewolf text attributes were tracked from the
        // start; the Changeling ones were simply never added, so a Changeling
        // owned no `core` log row at all until it was renamed. That is an
        // oversight of this allowlist, not a design choice - the log's purpose
        // is a backend record of what really happened, in every venue.
        //
        // Long texts stay off this list deliberately (R47c): they can be large
        // enough that logging them would bloat the trail, and
        // `update_long_text` never calls `Vampire#save()` either, so this hook
        // would not fire for them anyway. Belt and braces, both intended.
        "ctdbs_kith",
        "ctdbs_fealty_court",
        "ctdbs_kith_group_type"
    ];
    var v = request.object;
    var desired_changes = _.intersection(tracked_texts, v.dirtyKeys());
    if (0 === desired_changes.length) {
        console.log("Saving vampire (" + v.id + ") and there are no changes we track here");
        return response.success();
    }
    
    var modified_vampire = request.object;
    if (_.isUndefined(modified_vampire.id)) {
        console.log("Creating a new vampire named " + request.object.get("name"));
        return response.success();
    }
    
    // TODO: Update the history permissions if troupes has changed
    
    // `desired_changes`, not `dirtyKeys()`.
    //
    // This used to write a `core` row for *every* dirty key once any tracked
    // one was among them, so a single save that happened to touch a text
    // attribute also logged `change_count`, the trait arrays, and everything
    // else in flight - as `old_text`/`new_text` pairs holding stringified
    // objects. `tracked_texts` is an allowlist and has to govern what gets
    // written, not merely whether anything does. Latent until R47a added the
    // Changeling texts, which made a Changeling's creation picks trip the gate
    // and produced 32 core rows where the venue expects a handful.
    var new_values = {};
    _.each(desired_changes, function(k) {
        new_values[k] = v.get(k);
    })
    var vToFetch = new Vampire({id: v.id});
    vToFetch.fetch({useMasterKey: true}).then(function(vampire) {
        return Parse.Object.saveAll(_.map(_.toPairs(new_values), function(a) {
            var attribute = a[0], val = a[1];
            var vc = new Parse.Object("VampireChange");
            vc.set({
                "name": attribute,
                "category": "core",
                "old_text": vampire.get(attribute),
                "new_text": val,
                "owner": vampire,
                "type": vampire.has(attribute) ? "core_update" : "core_define",
                "instigator": request.user
            });
            var acl = get_vampire_change_acl(vampire);
            vc.setACL(acl);
            return vc;
        }), {useMasterKey: true});
    }).then(function () {
        return response.success();
    }).fail(function (error) {
        console.log(error.message);
        response.error(error);
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
    console.log("beforeSave SimpleTrait");
    var vc = new Parse.Object("VampireChange");
    var modified_trait = request.object;
    if (_.isUndefined(modified_trait.id)) {
        var flow_promise = Parse.Promise.as({});
        console.log("beforeSave simpleTrait Setting blank flow promise");
    } else {
        var flow_promise = new Parse.Query("SimpleTrait").get(modified_trait.id, {useMasterKey: true}).then(function (st) {
            console.log("beforeSave simpleTrait Calling _getServerData()");
            return st._getServerData();
        });
        console.log("beforeSave simpleTrait Setting fetch flow promise");
    }
    flow_promise.then(function(serverData) {
        console.log("beforeSave simpleTrait Starting with serverdata response " + JSON.stringify(modified_trait));
        console.log(JSON.stringify(serverData));
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
            console.log("Update does not actually encode a change for trait " + (modified_trait.id ? modified_trait.get("name") : modified_trait.id));
            response.success();
            // `return` ends this callback only, not the chain - the
            // remaining `.then()`s still run. Hand them `undefined` and let
            // them short-circuit explicitly, rather than letting
            // `vampire.id` throw into the error handler and call
            // `response.error()` after we have already succeeded.
            return;
        }

        console.log("beforeSave SimpleTrait Sending query for the vampire " + vc.get("owner").id + " because " + (modified_trait.id ? modified_trait.get("name") : modified_trait.id));
        return new Parse.Query("Vampire").get(vc.get("owner").id, {useMasterKey: true});
    }).then(function(vampire) {
        if (_.isUndefined(vampire)) {
            // Already responded above; nothing left to record.
            return;
        }
        console.log("beforeSave SimpleTrait Getting acl vampire " + vampire.id);
        var acl = get_vampire_change_acl(vampire);
        vc.setACL(acl);

        console.log("beforeSave SimpleTrait Sending save acl vampire " + vampire.id);
        return vc.save({}, {useMasterKey: true});
    }).then(function (vc) {
        if (_.isUndefined(vc)) {
            return;
        }
        request.object.set("definition_change", vc);
        response.success();
        if (!request.object.id) {
            console.log("Successfully beforeSave new SimpleTrait " + modified_trait.get("name") + " for " + modified_trait.get("owner").id + " with vc id " + vc.id);
        } else {
            console.log("Successfully beforeSave SimpleTrait " + request.object.id + " " + modified_trait.get("name") + " for " + modified_trait.get("owner").id);
        }
    }, function (error) {
        var failStr;
        if (!request.object.id) {
            failStr = "Failed to beforeSave new SimpleTrait " + modified_trait.get("name") + " for " + modified_trait.get("owner").get("name") + " because of " + error.message;
        } else {
            failStr = "Failed to beforeSave SimpleTrait " + request.object.id + " " + modified_trait.get("name")  + " for " + modified_trait.get("owner").id + " because of " + error.message;
        }
        console.log(failStr);
        error.message = failStr;
        response.error(error);
    });
});

Parse.Cloud.afterSave("SimpleTrait", function(request) {
    console.log("afterSave SimpleTrait");
    var q = new Parse.Query("VampireChange");
    var modified_trait = request.object;
    if (!modified_trait.has("definition_change"))
    {
        console.log("afterSave SimpleTrait older change that wasn't really updated and doesn't have new source value");
        return;
    }
    q.get(modified_trait.get("definition_change").id, {useMasterKey: true}).then(function (vc) {
        return vc.save({"simple_trait_id": modified_trait.id}, {useMasterKey: true});
    }, function (error) {
        console.log("Error trying to find vc for " + modified_trait.id + " with id " + modified_trait.get("definition_change").id);
    }).then(function (vc) {
        console.log("afterSave SimpleTrait Added simple_trait_id " + modified_trait.id + " to change " + vc.id);
    });
});

Parse.Cloud.beforeDelete("SimpleTrait", function(request, response) {
    var vc = new Parse.Object("VampireChange");
    var trait = request.object;
    console.log("beforeDelete SimpleTrait Getting the server trait data " + trait.id);
    (new Parse.Query("SimpleTrait").get(trait.id, {useMasterKey: true})).then(function(st) {
        return st._getServerData();
    }).then(function(serverData) {
        console.log(pretty(serverData));
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

        console.log("beforeDelete SimpleTrait Getting the vampire owner " + vc.get("owner").id + " for trait " + trait.id);
        return new Parse.Query("Vampire").get(vc.get("owner").id, {useMasterKey: true});
    }).then(function(vampire) {
        var acl = get_vampire_change_acl(vampire);
        vc.setACL(acl);
        return vc.save({}, {useMasterKey: true});
    }).then(function () {
        console.log("beforeDelete SimpleTrait saved trait " + trait.id + " for " + vc.get("owner").id);
        response.success();
    }, function (error) {
        var failStr = "beforeDelete SimpleTrait Failed to delete for trait " + request.object.id + " because of " + pretty(error);
        console.log(failStr);
        error.message = failStr;
        response.error(error);
    });
});

// R47b - the audit trail for experience.
//
// Nothing hooked `ExperienceNotation` and the XP fields are absent from
// `tracked_texts`, so an add, an edit and a delete together produced zero log
// rows - and a hand-written XP award is the thing a storyteller does most
// often. The log is immutable by design, so an *edited* notation appends a new
// row rather than amending the original, which is the right shape anyway: the
// point is to show what really happened.
//
// Only these four fields count as an operation. `earned` and `spent` are the
// running balances, and `Character._propagate_experience_notation_change`
// re-saves every row above an edited one to keep them correct; logging those
// re-saves would bury the operation that caused them under its own bookkeeping.
var EXPERIENCE_NOTATION_TRACKED = [
    "reason",
    "entered",
    "alteration_earned",
    "alteration_spent"
];

// Only the values the operation carries. The previous values would need a
// read-back of the stored row, and doing that inline is exactly what broke
// propagation - see the note above the hooks. What the ruling asks for is the
// operation, its reason and its deltas, and all three are on the object here.
var experience_notation_change = function (notation, type, serverData, user) {
    var vc = new Parse.Object("VampireChange");
    vc.set({
        "name": notation.get("reason"),
        "category": "experience",
        "owner": notation.get("owner"),
        "type": type,
        "old_value": serverData.alteration_earned,
        "value": notation.get("alteration_earned"),
        "old_cost": serverData.alteration_spent,
        "cost": notation.get("alteration_spent"),
        "old_text": serverData.reason,
        "new_text": notation.get("reason"),
        "instigator": user
    });
    return vc;
};

var save_experience_notation_change = function (notation, vc) {
    var owner = notation.get("owner");
    if (!owner || !owner.id) {
        // Nothing to attach the record to, and no ACL to derive.
        return Parse.Promise.as(null);
    }
    return new Parse.Query("Vampire").get(owner.id, {useMasterKey: true}).then(function (vampire) {
        vc.set("owner", vampire);
        vc.setACL(get_vampire_change_acl(vampire));
        return vc.save({}, {useMasterKey: true});
    });
};

// The audit record is written *after* the hook has already let the operation
// through, never before it.
//
// The first cut of this did the recording inline - fetch the stored row, write
// the VampireChange, then `response.success()`. That reliably broke XP
// propagation: editing a notation's date re-saves every row above it in one
// `Parse.Object.saveAll`, and holding each of those saves open on a
// round-trip of its own left the running balances unwritten. The whole ledger
// went stale on a single date edit (xp-history 60 caught it).
//
// An audit trail must not be able to break the thing it observes, so the
// decision is made here - `dirtyKeys()` is only available in `beforeSave` -
// and the write is dispatched behind the response. A failed record is logged
// and nothing else; the operation still stands.
var record_experience_notation = function (notation, type, user) {
    save_experience_notation_change(
        notation,
        experience_notation_change(notation, type, {}, user)
    ).fail(function (error) {
        console.log("Failed to record an ExperienceNotation " + type + ": " +
            ((error && error.message) ? error.message : JSON.stringify(error)));
    });
};

Parse.Cloud.beforeSave("ExperienceNotation", function(request, response) {
    var notation = request.object;
    var is_new = _.isUndefined(notation.id);

    // Propagation re-saves every row above an edited one to correct its
    // running balance; only `earned`/`spent` change there. Recording those
    // would bury the operation that caused them under its own bookkeeping.
    if (!is_new && 0 === _.intersection(EXPERIENCE_NOTATION_TRACKED, notation.dirtyKeys()).length) {
        return response.success();
    }

    response.success();
    record_experience_notation(notation, is_new ? "define" : "update", request.user);
});

Parse.Cloud.beforeDelete("ExperienceNotation", function(request, response) {
    response.success();
    record_experience_notation(request.object, "remove", request.user);
});

Parse.Cloud.afterSave("Patronage", function(request) {
    var patronage = request.object;
    var user = patronage.get("owner");
    console.log("afterSave Patronage Input user is " + JSON.stringify(user));
    console.log("afterSave Patronage Input user is " + user.id);
    var new_expiration = patronage.get("expiresOn");
    console.log("afterSave Patronage new expiration" + JSON.stringify(new_expiration));
    var q = new Parse.Query("Vampire").equalTo("owner", user).select(["owner", "expiresOn"]);
    var updated = [];
    q.each(function (vampire) {
        console.log("afterSave Patronage Updating vampire " + vampire.id + " expiresOn " + new_expiration);
        vampire.set("expiresOn", new_expiration);
        return vampire.save({}, {useMasterKey: true});
    }, {useMasterKey: true}).fail(function (error) {
        if (_.isArray(error)) {
            _.each(error, function (e) {
                console.error("afterSave Patronage " + e.message);
            })
        } else {
            console.error("afterSave Patronage " + error.message);
        }
    });
});

Parse.Cloud.afterSave("PaymentPaypal", function (request) {
    var payment = request.object;
    var item_name = payment.get("item_name");
    console.log("afterSave PaymentPaypal Received a paypal payment");
    if (!_.eq(payment.get("payment_status"), "Completed")) {
        console.log("afterSave PaymentPaypal Payment status isn't completed");
        return;
    }
    if (!_.eq(item_name, "Underground Theater Yearly Yorick")) {
        console.log("afterSave PaymentPaypal Item name doesn't match");
        return;
    }

    var patronage = new Patronage;
    console.log("afterSave PaymentPaypal Parsing date");
    var paidOn = moment(payment.get("payment_date"), "HH:mm:ss MMM DD, YYYY z");
    console.log("afterSave PaymentPaypal Adding a year");
    var expiresOn = moment(paidOn).add(1, 'year');
    console.log(paidOn.format());
    console.log(expiresOn.format());
    patronage.set({
        paidOn: paidOn.toDate(),
        expiresOn: expiresOn.toDate(),
        owner: new Parse.User({id: payment.get("custom")})
    });
    var acl = new Parse.ACL;
    acl.setPublicReadAccess(true);
    acl.setPublicWriteAccess(false);
    acl.setRoleReadAccess("Administrator", true);
    acl.setRoleWriteAccess("Administrator", true);
    patronage.setACL(acl);
    patronage.save({}, {useMasterKey: true}).fail(function (error) {
        console.log("afterSave PaymentPaypal Failed to save patronage " + error.message);
    });
})

Parse.Cloud.define("removeRedundantHistory", function(request, response) {
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


var fix_all_vampire_change_acl_for_character = function(v) {
    var acl = get_vampire_change_acl(v);
    var batch = [];
    return new Parse.Query("VampireChange").equalTo("owner", v).each(function (vc) {
        vc.setACL(acl);
        batch.push(vc);
    }, {useMasterKey: true}).then(function () {
        return Parse.Object.saveAll(batch, {useMasterKey: true});
    });
};


Parse.Cloud.define("update_vampire_change_permissions_for", function(request, response) {
    var character_id = request.params.character;
    (new Parse.Query("Vampire").get(character_id, {useMasterKey: true})).then(function (v) {
        return fix_all_vampire_change_acl_for_character(v);
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


Parse.Cloud.define("update_indv_vc_permissions_for", function(request, response) {
    var character_id = request.params.character;
    var vc_id = request.params.change;
    var acl;
    (new Parse.Query("Vampire").get(character_id, {useMasterKey: true})).then(function (v) {
        console.log("Got vamp. Getting the ACL");
        acl = get_vampire_change_acl(v);
        var q = new Parse.Query("VampireChange");
        return q.get(vc_id);
    }).then(function(vc) {
        vc.setACL(acl);
        return vc.save();
    }).then(function() {
        response.success("Successfully updated acl on " + vc_id + " for " + character_id);
    }, function(error) {
        if (error.code === Parse.Error.AGGREGATE_ERROR) {
            for (var i = 0; i < error.errors.length; i++) {
                response.error("Couldn't fix " + error.errors[i].object.id + "due to " + error.errors[i].message);
            }
        } else {
            response.error("Update acl because of " + error.message);
        }
        console.log(pretty(error));
    });
});


Parse.Cloud.define("get_expected_vampire_ids", function(request, response) {
    var character_id = request.params.character;
    var results = {
        SimpleTrait: [],
        ExperienceNotation: [],
        VampireChange: []
    };
    var v = new Parse.Object("Vampire", {id: character_id});
    Parse.Promise.when(_.map(["SimpleTrait", "ExperienceNotation", "VampireChange"], function (class_name) {
         var q = new Parse.Query(class_name)
            .equalTo("owner", v)
            .select("id");
         return q.each(function (t) {
             results[class_name].push(t.id);
         }, {useMasterKey: true});
    })).then(function () {
        response.success(results);
    }).fail(function (error) {
        response.error(error);
    })
});



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

Parse.Cloud.define("check_user_password", function(request, response)
{
    var password = request.params.password;

    Parse.User.logIn(request.user.getUsername(), password, {
        success: function(results)
        {
            response.success(true);
        },
        error: function() {
            response.success(false);
        }
    });
});

Parse.Cloud.define("submit_facebook_profile_data", function(request, response) {
    var r = request.params;
    new Parse.Query("UserFacebookData")
        .equalTo("owner", request.user)
        .first({useMasterKey: true})
    .then(function (s) {
        if (s) {
            return Parse.Promise.as(s);
        } else {
            var storage = new Parse.Object("UserFacebookData");
            var acl = new Parse.ACL;
            acl.setPublicReadAccess(false);
            acl.setPublicWriteAccess(false);
            acl.setReadAccess(request.user, true);
            acl.setWriteAccess(request.user, true);
            acl.setRoleReadAccess("Administrator", true);
            acl.setRoleWriteAccess("Administrator", true);
            storage.setACL(acl);
            return Parse.Promise.as(storage);
        }
    })
    .then(function (storage) {
        _.each(_.keys(r), function (e) {
            if (e == "id") {
                storage.set("external_id", r[e]);
            } else {
                storage.set(e, r[e]);
            }
        });
        storage.set("owner", request.user);
        return storage.save({}, {useMasterKey: true});
    })
    .then(function (s) {
        response.success(s.id);
    }, function(error) {
        response.error(error);
    });
});

Parse.Cloud.define("make_me_admin", function(request, response) {
    var secret = process.env.ADMIN_SECRET_KEY;
    if (!request.master && (!secret || request.params.secret_key !== secret)) {
        return response.error("Unauthorized: Invalid or missing administrator secret key.");
    }
    if (!request.user) {
        return response.error("Unauthorized: User not authenticated.");
    }
    (new Parse.Query(Parse.Role)).equalTo("name", "Administrator").first({useMasterKey: true}).then(function (role) {
        if (!role) {
            return Parse.Promise.error("Administrator role not found.");
        }
        role.getUsers().add(request.user);
        return role.save({}, {useMasterKey: true});
    }).then(function (s) {
        response.success(s.id);
    }, function(error) {
        response.error(error);
    });
});

Parse.Cloud.beforeSave("VampireApproval", function(request, response) {
    if (!request.user) {
        return response.error("Unauthorized: Must be logged in to create approvals.");
    }
    var approval = request.object;
    var character = approval.get("owner");
    if (!character) {
        return response.error("Approval must have an associated character owner.");
    }

    var charQuery = new Parse.Query("Vampire");
    charQuery.include("owner");
    charQuery.get(character.id, {useMasterKey: true}).then(function (vampire) {
        var owner = vampire.get("owner");
        var isOwner = owner && owner.id === request.user.id;

        var roleQuery = new Parse.Query(Parse.Role);
        roleQuery.equalTo("users", request.user);
        return roleQuery.find({useMasterKey: true}).then(function (roles) {
            var roleNames = _.map(roles, function (r) { return r.get("name"); });
            var isAdmin = _.includes(roleNames, "Administrator") || _.includes(roleNames, "SiteAdministrator");

            if (isOwner && !isAdmin) {
                return Parse.Promise.error("Unauthorized: Players cannot approve their own character changes.");
            }

            if (isAdmin) {
                return Parse.Promise.as(true);
            }

            var troupeRelation = vampire.relation("troupes");
            return troupeRelation.query().find({useMasterKey: true}).then(function (troupes) {
                var canApprove = _.some(troupes, function (troupe) {
                    return _.includes(roleNames, "AST_" + troupe.id) || _.includes(roleNames, "LST_" + troupe.id);
                });

                if (!canApprove) {
                    return Parse.Promise.error("Unauthorized: Approver does not have Storyteller role for this troupe.");
                }
                return Parse.Promise.as(true);
            });
        });
    }).then(function () {
        var acl = new Parse.ACL();
        acl.setPublicReadAccess(true);
        acl.setPublicWriteAccess(false);
        acl.setRoleReadAccess("Administrator", true);
        acl.setRoleWriteAccess("Administrator", true);
        acl.setReadAccess(request.user, true);
        acl.setWriteAccess(request.user, true);
        approval.setACL(acl);
        response.success();
    }, function (error) {
        var msg = error && error.message ? error.message : (typeof error === "string" ? error : "Approval rejected.");
        response.error(msg);
    });
});

Parse.Cloud.define("vote_for_referendum", function(request, response) {
    var referendum_id = request.params.referendum_id;
    if (_.isUndefined(request.user)) {
        console.log("Cannot vote for a referendum unless logged in");
        response.error("Cannot vote for a referendum unless logged in");
        return;
    }
    console.log("The referendum_id " + referendum_id);
    console.log("The user " + JSON.stringify(request.user));
    
    // Get the referendum
    // Check their patronage
    // Check for existing vote (not perfect will have to filter them in the results section)
    // Cast the ballot!
    /*
    var referendum, patronage;
    new Parse.Query("Referendum").get(referendum_id).then(function (found) {
        referendum = found;
        var q = new Parse.Query("Patronage")
            .equalTo("owner", request.user)
            .descending("expiresOn");
        return q.first();
    }, function (error) {
        response.error("Couldn't find referendum " + referendum_id + " because of " + JSON.stringify(error));
    }).then(function (found) {
        patronage = found;
        console.log("Patronage " + JSON.stringify(found));
        response.success("I ate all of the cupcakes");
    }, function (error) {
        response.error("Couldn't find patronage " + JSON.stringify(error));
    })
    */
    
    // Every refusal below returns a *rejected* promise so that it actually
    // terminates the chain.
    //
    // The previous shape was a run of `.then(...).fail(...)` pairs in which a
    // refusal did `response.error(msg); return;`. That ends only its own
    // callback: the next `.then()` still ran, received `undefined`, read that
    // as "no existing ballot", and saved one - with `casterpatronagestatus`
    // hardcoded `true`. A non-patron was told their vote was refused and had
    // it recorded anyway, as though they were a patron. The interleaved
    // `.fail()` handlers made it worse: each returned a plain value, which
    // resolves a Parse.Promise, so a genuine error was converted back into a
    // success part-way down the chain.
    var referendum, patronage, ballot, caster_is_patron = false;

    new Parse.Query("Referendum").get(referendum_id).then(function (found) {
        referendum = found;
        var q = new Parse.Query("Patronage")
            .equalTo("owner", request.user)
            .descending("expiresOn");
        return q.first({useMasterKey: true});
    }, function (error) {
        return Parse.Promise.error("Couldn't find referendum " + referendum_id + " because of " + JSON.stringify(error));
    }).then(function (found) {
        if (_.isUndefined(found) || !found) {
            return Parse.Promise.error("No patronage found");
        }
        patronage = found;

        var expiredSeconds = new Date(patronage.get("expiresOn")).getTime();
        var nowSeconds = new Date().getTime();
        if (expiredSeconds < nowSeconds) {
            return Parse.Promise.error("Latest patronage is expired");
        }
        // Recorded from the check that just passed, rather than asserted.
        caster_is_patron = true;

        var q = new Parse.Query("ReferendumBallot")
            .equalTo("owner", referendum)
            .equalTo("caster", request.user);
        return q.first({useMasterKey: true});
    }).then(function (found) {
        console.log("Hunted for referendums and now seeing what I found " + JSON.stringify(found));
        if (!_.isUndefined(found) && found) {
            return Parse.Promise.error("Existing ballot found." + JSON.stringify(found));
        }

        console.log("Creating the ballot");
        ballot = new Parse.Object("ReferendumBallot");
        var acl = new Parse.ACL;
        acl.setPublicReadAccess(false);
        acl.setPublicWriteAccess(false);
        acl.setRoleReadAccess("Administrator", true);
        acl.setRoleWriteAccess("Administrator", true)
        acl.setReadAccess(request.user, true);
        acl.setWriteAccess(request.user, false);
        ballot.setACL(acl);
        ballot.set("owner", referendum);
        ballot.set("caster", request.user);
        ballot.set("casterpatronagestatus", caster_is_patron);
        ballot.set("choice", request.params.ballot_option);

        console.log("Saving the ballot");
        return ballot.save();
    }).then(function (saved) {
        console.log("Ballot saved");
        response.success("Ballot has been cast");
    }, function (error) {
        console.log("Ballot was not cast: " + JSON.stringify(error));
        response.error(_.isString(error) ? error : ((error && error.message) ? error.message : JSON.stringify(error)));
    });
});

Parse.Cloud.define("get_my_patronage_status", function(request, response) {
    if (_.isUndefined(request.user)) {
        console.log("Cannot request patronage status unless logged in");
        response.error("Cannot request patronage status unless loggen in");
        return;
    }
    
    var patronage;
    var q = new Parse.Query("Patronage")
        .equalTo("owner", request.user)
        .descending("expiresOn");
    // Same flaw R11 fixes in `vote_for_referendum`: an interleaved `.fail()`
    // that returns a plain value resolves the chain, so a genuine query
    // error used to produce `response.error(...)` *and* then
    // `response.success(false)` from the following `.then()`.
    q.first({useMasterKey: true}).then(function (found) {
        if (_.isUndefined(found) || !found) {
            return response.success(false);
        }
        patronage = found;

        var expiredSeconds = new Date(patronage.get("expiresOn")).getTime();
        var nowSeconds = new Date().getTime();
        response.success(expiredSeconds >= nowSeconds);
    }, function (error) {
        response.error("Error finding patronage " + JSON.stringify(error));
    });
});

function matchUserInRoles(all_roles_to_check, user_id) {
    var role = _.first(all_roles_to_check);
    var remaining_roles_to_check = _.tail(all_roles_to_check);
    var users_relation = role.getUsers();
    var uq = users_relation.query();
    uq.equalTo("objectId", user_id);
    return uq.get(user_id).then(function (user) {
        console.log("Matched a user in the role! " + role.get("name") + " " + user.get("username"));
        return Parse.Promise.as(user);
    }, function (error) {
        if (0 == remaining_roles_to_check.length) {
            return Parse.Promise.error("Couldn't find user in appropriate roles");
        } else {
            return matchUserInRoles(remaining_roles_to_check, user_id);
        }
    })
}

Parse.Cloud.define("change_troupe_staff", function(request, response) {
    if (_.isUndefined(request.user)) {
        console.log("Cannot change staff without logging in");
        response.error("Cannot change staff without logging in");
        return;
    }
    var troupe_id = request.params.troupe_id;
    var user_to_change_id = request.params.user_to_change_id;
    var user_to_change = new Parse.User({id: user_to_change_id});
    var roles_to_remove = request.params.roles_to_remove;
    var roles_to_add = request.params.roles_to_add;
    
    var necessary_role_name = "LST_" + troupe_id;
    
    console.log("Require role: " + necessary_role_name);
    
    var alter_roles = function (roles) {
        _.each(roles_to_remove, function (title) {
            var u = roles[title].getUsers();
            u.remove(user_to_change);
        });
        _.each(roles_to_add, function (title) {
            roles[title].getUsers().add(user_to_change);
        })
        var to_save = _.values(roles);
        var promises = _.map(to_save, function (s) {
            return s.save({}, {useMasterKey: true}).fail(function (error) {
                console.log("Failed to save role " + s.get("name") + " with " + JSON.stringify(error));
            });
        })
        return Parse.Promise.when(promises);
    }
    
    var all_roles_to_check = [];
    var troupe = new Troupe({id: troupe_id});
    troupe.fetch({useMasterKey: true}).then(function(t) {
        return user_to_change.fetch({useMasterKey: true});
    }).then(function (u) {
        var hasNecessaryRole = false;
        var q = new Parse.Query(Parse.Role);
        q.equalTo("name", necessary_role_name);
        return q.first({useMasterKey: true});
    }).then(function (role) {
        all_roles_to_check.push(role);
        var roles_relation = role.getRoles();
        var rq = roles_relation.query();
        return rq.each(function (r) {
            all_roles_to_check.push(r);
            var rr = r.getRoles();
            var rq2 = rr.query();
            return rq2.each(function (twodeeprole) {
                all_roles_to_check.push(twodeeprole);
            });
        });
    }).then(function () {
        return matchUserInRoles(all_roles_to_check, request.user.id);
    }).then(function (user) {
        console.log("Got user for relation " + user.get("username"));
        return Parse.Promise
            .when(troupe.get_roles())
            .then(alter_roles)
            .then(function () {
                return troupe.get_generic_roles();
            })
            .then(alter_roles)
    }).then(function() {
        response.success();
    }, function (error) {
        console.log(JSON.stringify(error));
        response.error(error);
    });
    return;
    var markHasNecessaryOnRole = function (role) {
        var users_relation = role.getUsers();
        var uq = users_relation.query();
        uq.equalTo("objectId", request.id);
        return uq.each(function (user) {
            roles.add(role);
        }).fail(function (error) {
            console.log("Failed in promise for " + role.get("name"));
        });
    };
    q.each(function (role) {
        var users_relation = role.getUsers();
        var uq = users_relation.query();
        uq.equalTo("objectId", request.id);
        return uq.each(function (user) {
            roles.add(role);
        }).fail(function (error) {
            console.log("Failed in promise for " + role.get("name"));
        });
    }).fail(PromiseFailReport);
});