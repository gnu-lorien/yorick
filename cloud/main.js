/* global Parse */
var _ = require('lodash');
var pretty = require('./prettyprint').pretty;
var Vampire = Parse.Object.extend("Vampire");
var Patronage = Parse.Object.extend("Patronage");
var Troupe = require('./Troupe.js').Troupe;
// jimp 1.x exports a namespace, not the class: `require("jimp")` used to BE the
// constructor, and is now `{ Jimp, JimpMime, rgbaToInt, ... }`. The MIME
// constants moved with it - `Image.MIME_JPEG` is gone, `JimpMime.jpeg` is the
// same "image/jpeg" string.
var { Jimp: Image, JimpMime } = require("jimp");
var Promise = global.Promise;
var moment = require("moment");
var compat = require('./trigger-compat.js');

/* FIXME Shouldn't just paste this class in here. Still need a way to sync between
   the require world and the node world */

var create_thumbnail = function(portrait, input_image, size) {
    // The three hand-rolled callback-to-promise wrappers this function used to
    // carry are gone: on jimp 1.x `getBuffer` returns a promise, and
    // `scaleToFit` mutates in place and returns the same instance. The shape of
    // the chain, and every step in it, is otherwise unchanged.
    //
    // The round trip out to a buffer and back through `Image.read` is NOT
    // redundant, on either version. `scaleToFit` mutates, and all four sizes
    // are built concurrently from the same `input_image`; decoding a fresh
    // instance per size is what stops them resizing each other's pixels.
    return input_image.getBuffer(JimpMime.jpeg).then(function (buffer) {
        return Image.read(buffer);
    }).then(function(image) {
        // `{w, h}` replaces the positional (width, height) arguments.
        return image.scaleToFit({ w: size, h: size });
    }).then(function (image) {
        return image.getBuffer(JimpMime.jpeg);
    }).then(function (buffer) {
        var base64 = buffer.toString("base64");
        var cropped = new Parse.File("thumbnail_" + size + ".jpg", {base64: base64});
        // With the master key. This is the server writing a derived file on its
        // own behalf, inside beforeSave("CharacterPortrait"), so it has no user
        // and no session token -- and parse-server 9 gates POST /files, where
        // 2.8.4 did not gate it at all. Left bare, all four thumbnail writes
        // are refused with `File upload by public is disabled.` (code 130) and
        // the portrait hook fails, while the player's OWN upload a moment
        // earlier succeeded: the 201 makes it look as though uploading works
        // and only the hook is broken.
        return cropped.save({useMasterKey: true});
    }).then(function(cropped) {
        portrait.set("thumb_" + size, cropped);
    });
}

var crop_and_thumb = function(req) {
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
        // Returns `undefined`, not a promise, and that is intended on both
        // versions: the seam calls `response.success()` for a non-thenable, and
        // parse-server 9 ignores a returned `undefined`. There is nothing to
        // wait for - every thumbnail already exists.
        return;
    }

    var original_url = portrait.get("original").url();

    return Image.read(original_url).catch(function (err) {
        // jimp rejects properly. It does not always reject legibly: a body
        // whose type cannot be sniffed - the .txt of test 124, a JSON error
        // page, an empty response - rejects with "Could not find MIME for
        // Buffer <null>" and no URL in it at all. Only the non-200 shape names
        // the URL ("HTTP Status 404 for url ..."). Re-attach it here so every
        // failure of this fetch says which portrait it was reading, which is
        // the property that made the previous version's TypeError diagnosable.
        //
        // Both message shapes were re-measured on 1.6.1 against a local server
        // and are byte-identical to 0.22.x's, so this handler did not need to
        // change with the upgrade.
        var reason = (err && err.message) || String(err);
        throw new Error(
            "could not read the uploaded image back from " + original_url +
            " - " + reason
        );
    }).then(function (image) {
        // Kept, and now expected never to fire.
        //
        // jimp 0.2.28 could settle this promise with NOTHING and call it success:
        // its throwError did `if ("string" == typeof error) error = console.error(error)`,
        // console.error returns undefined, and so a string-valued failure reached
        // Jimp.read's `if (err) reject(err); else resolve(image)` with err falsy
        // and image never passed. The next line then read .bitmap off undefined
        // and produced "Cannot read properties of undefined (reading 'bitmap')" -
        // an error naming neither the portrait, nor the URL, nor the reason,
        // which was misread once as a failure of an unrelated test in
        // assets-rename-portrait.spec.js.
        //
        // 0.22.12 rejects with a real Error for every one of those shapes -
        // measured against a local server: a 404, an empty 200, a JSON 200, a
        // text/plain 200 and a truncated JPEG all reject. So this branch is
        // unreachable on the version we now ship, and the .catch above is what
        // handles the failures that used to land here. Re-measured on 1.6.1:
        // same rejections, same messages, still unreachable.
        //
        // It stays because it is cheap and because the failure it describes is a
        // property of the promise contract, not of one library: anything that
        // resolves this chain without an image lands on the next line otherwise.
        // If it ever does fire, that is news, and the message says so.
        if (!image) {
            throw new Error(
                "could not read the uploaded image back from " + original_url +
                " - jimp resolved without one. This should be unreachable on " +
                "jimp 1.x, which rejects instead; if you are seeing it, the " +
                "read path is not the one this guard was written against."
            );
        }

        // Crop the image to the smaller of width or height.
        //
        // jimp 1.x takes an options object here; the positional
        // `crop(x, y, w, h)` form is not merely deprecated but rejected, with a
        // zod "invalid_type: expected object, received number" error.
        var size = Math.min(image.bitmap.width, image.bitmap.height);
        return image.crop({
            x: (image.bitmap.width - size) / 2,
            y: (image.bitmap.height - size) / 2,
            w: size,
            h: size
        });
    }).then(function (image) {
        var promises = [];
        _.each(THUMBNAIL_SIZES, function (size) {
            promises.push(create_thumbnail(portrait, image, size))
        })
        return Promise.all(promises);
    });
};

/**
 * Refuse a write that has nobody attached to it.
 *
 * Characters, the rows hanging off them, and uploads all belong to somebody, so
 * a request carrying neither a user nor the master key has no business writing
 * one. This is not theoretical: these classes granted create to "*", and a bare
 * REST POST carrying only the public application id - no session token, no user
 * - was accepted. Measured on a live server, an anonymous request could write a
 * SimpleTrait and an ExperienceNotation onto a named player's character, and
 * that player then saw both on their own sheet.
 *
 * database_seed/_SCHEMA.json asks for requiresAuthentication on create as well,
 * but that is only a second line of defence: seed_db.js imports the schema file
 * solely when the database has no users at all, so an already-seeded deployment
 * keeps whatever class-level permissions its live _SCHEMA collection was
 * created with. This guard is what protects those, and it runs ahead of the
 * class-level check either way.
 *
 * It also settles requests that were previously answered badly or not at all.
 * Omitting owner used to hang beforeSave("SimpleTrait") indefinitely - it walks
 * off the missing pointer and calls neither response.success nor
 * response.error - and an anonymous portrait POST with no file crashed
 * crop_and_thumb, returning HTTP 500 or resetting the connection. Guarding at
 * the top of each hook settles the request before the body can wander.
 *
 * No legitimate write path is affected. The character models
 * (public/scripts/app/models/) only ever run for a logged-in user, building
 * each row's ACL out of the character's own owner, and every save cloud code
 * makes on a character's behalf passes useMasterKey, which sets request.master.
 *
 * Throws when it refuses, so callers read as one line at the top of the hook:
 *
 *     require_a_user(request, "Traits");
 *
 * @throws {Parse.Error} SCRIPT_FAILED, when the request carries neither a user
 *     nor the master key
 */
var require_a_user = function(request, noun) {
    if (!request.master && !request.user) {
        throw new Parse.Error(
            Parse.Error.SCRIPT_FAILED,
            noun + " can only be changed by a logged in user."
        );
    }
};

compat.beforeSave("TroupePortrait", function(request) {
    require_a_user(request, "Troupe portraits");
    return crop_and_thumb(request);
});

compat.beforeSave("CharacterPortrait", function(request) {
    require_a_user(request, "Character portraits");
    return crop_and_thumb(request);
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

compat.beforeSave("Vampire", function(request) {
    // Werewolf and ChangelingBetaSlice are both Parse.Object.extend("Vampire",
    // ...) over this same underlying class, so this covers all three creature
    // types.
    require_a_user(request, "Characters");

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
        return;
    }
    
    var modified_vampire = request.object;
    if (_.isUndefined(modified_vampire.id)) {
        console.log("Creating a new vampire named " + request.object.get("name"));
        return;
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
    return vToFetch.fetch({useMasterKey: true}).then(function(vampire) {
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
    }).catch(function (error) {
        console.log(error.message);
        // See beforeDelete("SimpleTrait"): a `.catch` handler that returns
        // normally recovers the chain, and would allow a character save whose
        // audit rows failed to write.
        throw error;
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

compat.beforeSave("SimpleTrait", function(request) {
    // Ahead of everything else: this hook copies the trait into a
    // VampireChange audit row, so an unguarded anonymous write did not merely
    // land a trait on somebody's sheet, it also wrote itself into the log the
    // approvals workflow reads.
    require_a_user(request, "Traits");

    console.log("beforeSave SimpleTrait");
    var vc = new Parse.Object("VampireChange");
    var modified_trait = request.object;
    if (_.isUndefined(modified_trait.id)) {
        var flow_promise = Promise.resolve({});
        console.log("beforeSave simpleTrait Setting blank flow promise");
    } else {
        var flow_promise = new Parse.Query("SimpleTrait").get(modified_trait.id, {useMasterKey: true}).then(function (st) {
            console.log("beforeSave simpleTrait Calling _getServerData()");
            return st._getServerData();
        });
        console.log("beforeSave simpleTrait Setting fetch flow promise");
    }
    return flow_promise.then(function(serverData) {
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
            // `return` ends this callback only, not the chain - the remaining
            // `.then()`s still run, and they must: the promise this hook
            // returns is what allows the save, so it has to be the promise for
            // the whole chain. Hand them `undefined` and let them short-circuit
            // explicitly, rather than letting `vampire.id` throw and turn a
            // no-op into a refusal.
            return;
        }

        console.log("beforeSave SimpleTrait Sending query for the vampire " + vc.get("owner").id + " because " + (modified_trait.id ? modified_trait.get("name") : modified_trait.id));
        return new Parse.Query("Vampire").get(vc.get("owner").id, {useMasterKey: true});
    }).then(function(vampire) {
        if (_.isUndefined(vampire)) {
            // The change was not meaningful; nothing left to record. Keep
            // resolving - reaching the end of this chain is what allows the
            // save now that nothing settles early.
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
        // See beforeDelete("SimpleTrait"): returning normally from a rejection
        // handler recovers the chain, which would allow a save this hook has
        // just decided to refuse.
        throw error;
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
    // Returned, not fired and forgotten. parse-server absorbs an afterSave's
    // rejection - 2.8.4 does `triggerPromise.then(resolve, resolve)`
    // (triggers.js:450-451) and discards the resolved value (`RestWrite.js:111`
    // chains straight past it) - so returning the chain is what gives this
    // rejection an owner. Unreturned it is orphaned: silent today, because a
    // `Parse.Promise` has no unhandled-rejection tracking, and fatal under
    // parse@8 + node 24, where the chain is native and an unhandled rejection
    // reaches parse-server's own uncaughtException handler and exits.
    //
    // The cost is that the SimpleTrait write now waits for the back-reference
    // before it answers the client, closing a read-after-write window that has
    // been open on every trait save. It cannot refuse the save: the row is
    // already written by the time an afterSave runs, and `runAfterTrigger`'s
    // result is not part of the response.
    return q.get(modified_trait.get("definition_change").id, {useMasterKey: true}).then(function (vc) {
        return vc.save({"simple_trait_id": modified_trait.id}, {useMasterKey: true});
    }, function (error) {
        console.log("Error trying to find vc for " + modified_trait.id + " with id " +
            modified_trait.get("definition_change").id + ": " +
            ((error && error.message) ? error.message : JSON.stringify(error)));
        // See beforeSave("Vampire") and beforeDelete("SimpleTrait"): returning
        // normally from a rejection handler RECOVERS the chain. That is what
        // this handler used to do, so the `.then` below read `.id` off
        // `undefined` and a TypeError replaced the real reason the lookup
        // failed - the one thing worth knowing here. Rethrow, and the reason
        // survives to the line above and the chain stays rejected.
        throw error;
    }).then(function (vc) {
        console.log("afterSave SimpleTrait Added simple_trait_id " + modified_trait.id + " to change " + vc.id);
    });
});

compat.beforeDelete("SimpleTrait", function(request) {
    require_a_user(request, "Traits");

    var vc = new Parse.Object("VampireChange");
    var trait = request.object;
    console.log("beforeDelete SimpleTrait Getting the server trait data " + trait.id);
    return (new Parse.Query("SimpleTrait").get(trait.id, {useMasterKey: true})).then(function(st) {
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
    }, function (error) {
        var failStr = "beforeDelete SimpleTrait Failed to delete for trait " + request.object.id + " because of " + pretty(error);
        console.log(failStr);
        error.message = failStr;
        // The `throw` is load-bearing, not decoration. A rejection handler that
        // returns normally RECOVERS the chain (parse@1.11.1 is A+ compliant;
        // node_modules/parse/lib/node/ParsePromise.js:171-190), so deleting the
        // old `response.error(error)` and leaving this handler otherwise empty
        // would resolve the promise this hook returns - and allow a delete that
        // today is refused. Silently, and it inverts a security decision.
        throw error;
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
        return Promise.resolve(null);
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
// and the write is dispatched but deliberately NOT awaited: the promise the
// hook returns must not contain it. A failed record is logged and nothing else;
// the operation still stands.
//
// That wording used to be "dispatched behind the response", which was literally
// true when the hooks called `response.success()` on the line above the
// dispatch. Since the Step 6 conversion there is no response to be behind, and
// the property that mattered was never the ordering of those two lines - it was
// that the hook does not wait. Both hooks call this and then return undefined,
// so the seam settles them without ever seeing this promise.
var record_experience_notation = function (notation, type, user) {
    save_experience_notation_change(
        notation,
        experience_notation_change(notation, type, {}, user)
    ).catch(function (error) {
        console.log("Failed to record an ExperienceNotation " + type + ": " +
            ((error && error.message) ? error.message : JSON.stringify(error)));
    });
};

// The dispatch cannot refuse an operation it has already allowed.
//
// This restores, for one line, a guarantee the old shape got for free.
// `response.success()` used to have settled the trigger before the dispatch ran,
// so a SYNCHRONOUS throw out of `record_experience_notation` was swallowed - the
// executor's promise was already resolved and the reject was a no-op. Now the
// dispatch happens before the hook returns, so an unguarded throw would
// propagate out of the hook and refuse the save or delete.
//
// Nothing throws synchronously today: `save_experience_notation_change` guards
// `!owner || !owner.id` before touching anything, and `Parse.Query#get` does not
// throw synchronously. This is not for today. It was for the two steps that
// followed - `Parse.Promise.as(null)` in that guard and `.fail` above it are
// now `Promise.resolve(null)` and `.catch`, and that replacement is exactly the
// kind of edit that turns a fire-and-forget into a synchronous throw. An audit
// trail must not be able to break the thing it observes; that has to keep being
// true while the code underneath it is being replaced.
var dispatch_experience_notation_record = function (notation, type, user) {
    try {
        record_experience_notation(notation, type, user);
    } catch (error) {
        console.log("Failed to dispatch an ExperienceNotation " + type + ": " +
            ((error && error.message) ? error.message : JSON.stringify(error)));
    }
};

// ExperienceNotation is the one with teeth among the character's child rows:
// an anonymous write to it was measured landing 99999 earned XP on another
// player's character, visible to that player on their own sheet. The guard runs
// first, ahead of the audit record - refusing the write and then recording it
// would be worse than not recording it at all.
compat.beforeSave("ExperienceNotation", function(request) {
    require_a_user(request, "Experience entries");

    var notation = request.object;
    var is_new = _.isUndefined(notation.id);

    // Propagation re-saves every row above an edited one to correct its
    // running balance; only `earned`/`spent` change there. Recording those
    // would bury the operation that caused them under its own bookkeeping.
    if (!is_new && 0 === _.intersection(EXPERIENCE_NOTATION_TRACKED, notation.dirtyKeys()).length) {
        return;
    }

    dispatch_experience_notation_record(notation, is_new ? "define" : "update", request.user);
});

compat.beforeDelete("ExperienceNotation", function(request) {
    // A delete is a write. The incoming security work guarded the save; the
    // same argument applies here, and this hook did not exist to guard when it
    // was written.
    require_a_user(request, "Experience entries");

    dispatch_experience_notation_record(request.object, "remove", request.user);
});

// The remaining character child rows. Each is created client-side by the
// character models as the logged-in owner, and touched by cloud code only with
// the master key, so the guard is the whole of the hook - there is no existing
// behaviour here to sit in front of, unlike SimpleTrait, Vampire and
// ExperienceNotation. Since the Step 6 conversion that is literally all these
// two are: the guard throws to refuse, and falling off the end allows.

compat.beforeSave("LongText", function(request) {
    require_a_user(request, "Character texts");
});

compat.beforeSave("VampireCreation", function(request) {
    require_a_user(request, "Character creation records");
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
    }, {useMasterKey: true}).catch(function (error) {
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
    patronage.save({}, {useMasterKey: true}).catch(function (error) {
        console.log("afterSave PaymentPaypal Failed to save patronage " + error.message);
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


Parse.Cloud.define("get_expected_vampire_ids", function(request, response) {
    var character_id = request.params.character;
    var results = {
        SimpleTrait: [],
        ExperienceNotation: [],
        VampireChange: []
    };
    var v = new Parse.Object("Vampire", {id: character_id});
    Promise.all(_.map(["SimpleTrait", "ExperienceNotation", "VampireChange"], function (class_name) {
         var q = new Parse.Query(class_name)
            .equalTo("owner", v)
            .select("id");
         return q.each(function (t) {
             results[class_name].push(t.id);
         }, {useMasterKey: true});
    })).then(function () {
        response.success(results);
    }).catch(function (error) {
        response.error(error);
    })
});



var add_administrator_to_everything = function(model) {
    var acl = model.getACL();
    if (_.isUndefined(acl)) {
        // Not completely defined for some reason
        return Promise.resolve([]);
    }
    acl.setRoleReadAccess("Administrator", true);
    acl.setRoleWriteAccess("Administrator", true);
    model.setACL(acl);
    return model.save();
}

Parse.Cloud.define("check_user_password", function(request, response)
{
    var password = request.params.password;

    // The `{success, error}` callbacks bag was dropped at SDK 2.0. Under
    // parse@8 the third argument is an OPTIONS bag ({useMasterKey,
    // installationId, ...}) and `success`/`error` are simply unrecognised
    // keys -- so neither callback ever fires, `response` is never settled, and
    // the request HANGS. Not an error: a hang. Nothing exercises this function,
    // so there is no E2E oracle and no log signal for it; the only symptom
    // would have been a client timeout in production.
    //
    // Returned rather than fire-and-forget so the legacy arm of
    // FunctionsRouter (`theFunction.length >= 2`) still has a promise to
    // settle. Semantics are preserved exactly, including the deliberate one: a
    // wrong password answers success(false), it does not raise an error.
    return Parse.User.logIn(request.user.getUsername(), password).then(function () {
        response.success(true);
    }, function () {
        response.success(false);
    });
});

Parse.Cloud.define("submit_facebook_profile_data", function(request, response) {
    var r = request.params;
    new Parse.Query("UserFacebookData")
        .equalTo("owner", request.user)
        .first({useMasterKey: true})
    .then(function (s) {
        if (s) {
            return Promise.resolve(s);
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
            return Promise.resolve(storage);
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
            return Promise.reject("Administrator role not found.");
        }
        role.getUsers().add(request.user);
        return role.save({}, {useMasterKey: true});
    }).then(function (s) {
        response.success(s.id);
    }, function(error) {
        response.error(error);
    });
});

compat.beforeSave("VampireApproval", function(request) {
    if (!request.user) {
        throw new Parse.Error(Parse.Error.SCRIPT_FAILED,
            "Unauthorized: Must be logged in to create approvals.");
    }
    var approval = request.object;
    var character = approval.get("owner");
    if (!character) {
        throw new Parse.Error(Parse.Error.SCRIPT_FAILED,
            "Approval must have an associated character owner.");
    }

    var charQuery = new Parse.Query("Vampire");
    charQuery.include("owner");
    return charQuery.get(character.id, {useMasterKey: true}).then(function (vampire) {
        var owner = vampire.get("owner");
        var isOwner = owner && owner.id === request.user.id;

        var roleQuery = new Parse.Query(Parse.Role);
        roleQuery.equalTo("users", request.user);
        return roleQuery.find({useMasterKey: true}).then(function (roles) {
            var roleNames = _.map(roles, function (r) { return r.get("name"); });
            var isAdmin = _.includes(roleNames, "Administrator") || _.includes(roleNames, "SiteAdministrator");

            if (isOwner && !isAdmin) {
                return Promise.reject("Unauthorized: Players cannot approve their own character changes.");
            }

            if (isAdmin) {
                return Promise.resolve(true);
            }

            var troupeRelation = vampire.relation("troupes");
            return troupeRelation.query().find({useMasterKey: true}).then(function (troupes) {
                var canApprove = _.some(troupes, function (troupe) {
                    return _.includes(roleNames, "AST_" + troupe.id) || _.includes(roleNames, "LST_" + troupe.id);
                });

                if (!canApprove) {
                    return Promise.reject("Unauthorized: Approver does not have Storyteller role for this troupe.");
                }
                return Promise.resolve(true);
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
    }, function (error) {
        // Do not simplify this normalisation. It is what turns the bare strings
        // `Promise.reject(...)` rejects with above into a client-visible
        // message, and those two messages are asserted verbatim by four
        // `toContain`s in approvals.spec.js. Wrapping in a Parse.Error here is
        // exactly what 2.8.4's getResponseObject.error did with the bare string
        // it used to be handed (triggers.js:253), so the wire is unchanged:
        // same code 141, same message, same JSON.
        var msg = error && error.message ? error.message : (typeof error === "string" ? error : "Approval rejected.");
        throw new Parse.Error(Parse.Error.SCRIPT_FAILED, msg);
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
        return Promise.reject("Couldn't find referendum " + referendum_id + " because of " + JSON.stringify(error));
    }).then(function (found) {
        if (_.isUndefined(found) || !found) {
            return Promise.reject("No patronage found");
        }
        patronage = found;

        var expiredSeconds = new Date(patronage.get("expiresOn")).getTime();
        var nowSeconds = new Date().getTime();
        if (expiredSeconds < nowSeconds) {
            return Promise.reject("Latest patronage is expired");
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
            return Promise.reject("Existing ballot found." + JSON.stringify(found));
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
        // With the master key, because ReferendumBallot's class-level
        // permissions now refuse create to everyone. This function is where the
        // patronage requirement and the one-ballot-per-user check above
        // actually live, and while the class granted create to "*" a client
        // could skip all of it and POST a ballot directly - any choice, any
        // caster, any ACL, as many times as it liked. Making this the only
        // writer is the point; saving as the user again would reopen the hole.
        //
        // The interleaved `.fail()` that used to sit here is gone with R11: it
        // returned a plain value, which resolves a Parse.Promise, so it turned
        // a refusal back into a success part-way down the chain. The single
        // terminal handler below reports every failure now.
        return ballot.save({}, {useMasterKey: true});
    }).then(function (saved) {
        console.log("Ballot saved");
        response.success("Ballot has been cast");
    }, function (error) {
        console.log("Ballot was not cast: " + JSON.stringify(error));
        response.error(_.isString(error) ? error : ((error && error.message) ? error.message : JSON.stringify(error)));
    });
});

/** Resolve to `true` only for a master-key call or a member of an admin role. */
var require_administrator = function (request) {
    if (request.master) {
        return Promise.resolve(true);
    }
    if (!request.user) {
        return Promise.reject("Unauthorized: Must be logged in.");
    }
    return new Parse.Query(Parse.Role)
        .equalTo("users", request.user)
        .find({useMasterKey: true})
        .then(function (roles) {
            var isAdmin = _.some(roles, function (r) {
                return _.includes(["Administrator", "SiteAdministrator"], r.get("name"));
            });
            if (!isAdmin) {
                return Promise.reject("Unauthorized: Administrator access is required.");
            }
            return Promise.resolve(true);
        });
};

// ---------------------------------------------------------------------------
// S11. The `_User` reads the browser is no longer allowed to make.
//
// parse-server 9.10.0 defaults `enforcePrivateUsers` true. On a `_User` CREATE
// with no ACL supplied, `ACL['*'] = {read:true}` is written only when the flag
// is OFF; `ACL[objectId] = {read:true,write:true}` is written unconditionally
// after it. Existing rows are never rewritten, so the app degrades one signup
// at a time. The browser has no master key, so every read of somebody else's
// row moves here.
//
// Measured against a private fixture row (seed_db.js `sampprivate`): reading it
// as an ADMINISTRATOR returns {"code":101,"error":"Object not found."}. A real
// signup grants only the row's own id, so nothing about being an admin exempts
// a browser-side read. That is the fact every clause below is built on.
//
// ARITY. Arity-2 `(request, response)` to match the other ten definitions in
// this file. parse-server's arity-2 arm sends NOTHING if a body neither settles
// `response` nor returns a value -- the hang recorded at :823-834 -- so every
// body below ends in a two-armed `.then(ok, err)` whose `ok` arm does nothing
// but call response.success.
//
// `require_administrator` above is deliberately NOT refactored: it answers a
// narrower question and two shipped functions depend on it. `caller_scope` is
// the single role reader for the new code.
// ---------------------------------------------------------------------------

/**
 * Everything about a `_User` that is allowed to leave this server.
 *
 * `massmailauthorization` and `acceptedtos` are here because forms/UserForm.js
 * renders both as checkboxes on `#administration/user/:id`, and
 * character-summarize-list-item-csv.html prints the first. Dropping them would
 * blank two admin surfaces silently.
 */
var IDENTITY_FIELDS = ["username", "realname", "massmailauthorization", "acceptedtos"];

/**
 * Whether `email` may be returned. FALSE, and it must stay false unless
 * somebody deliberately decides to widen what the app exposes.
 *
 * The reasoning is easy to get backwards, so it is written out. parse-server
 * withholds `email` from every non-owner read on its own: `protectedFields`
 * defaults to {_User: {'*': ['email']}} and is computed only for non-master
 * callers. So no browser caller can see another member's address TODAY, and
 * none could before the migration either -- views/AdministrationUserView.js and
 * the R51 note below both record discovering that the hard way.
 *
 * These functions read under the MASTER KEY, which bypasses that filter
 * entirely. Setting this true would therefore hand out addresses that are not
 * available through any route the app has now: an EXPANSION dressed as a
 * migration. Owner decision, 2026-08-20, stated plainly: no new capabilities
 * around email that do not exist today.
 *
 * A member's own address is unaffected and always was -- the caller's own row
 * is read from Parse.User.current(), never through here.
 *
 * If an admin export is ever meant to carry addresses, that is a deliberate
 * product change and this is the line, but it needs deciding on its own terms
 * and not to make a template look tidier.
 */
var IDENTITY_INCLUDES_EMAIL = false;

/** Nobody may ask about more accounts than this in one call. */
var MAX_IDENTITY_IDS = 200;

/** The projection actually sent to Mongo. Defence in depth with identity_of. */
var identity_select = function () {
    return IDENTITY_INCLUDES_EMAIL ? IDENTITY_FIELDS.concat(["email"]) : IDENTITY_FIELDS;
};

/**
 * The ONLY user-shaped value this file returns.
 *
 * Built field by field from an allowlist rather than filtered out of a fetched
 * row, and the distinction is the whole point: a master-key read bypasses
 * `protectedFields` AND the authData strip (filterSensitiveData returns early
 * for master, BEFORE `delete object.authData`), and helpers/FacebookLogin.js
 * shows that field carries a live access token. `request.user` is worse still --
 * its server data holds the caller's SESSION TOKEN. Constructing the result
 * means no field escapes by accident, only by someone editing IDENTITY_FIELDS.
 *
 * `Parse.Object.fromJSON`, never `new Parse.User(...)` + `.set(...)`: the
 * result must be CLEAN. fromJSON yields `dirty() === false` and a populated
 * server data bag; a single `.set()` afterwards flips the encoded form to a
 * bare attribute-less Pointer, because the encoder tests `value.dirty()`. The
 * browser would render that as blanks, with no error anywhere. That is also why
 * `extra` is smuggled into the JSON rather than set on the object, and why
 * cloud/Troupe.js#get_staff -- which does `user.set("role", title)` -- must NOT
 * be lifted for this.
 */
var identity_of = function (user, extra) {
    var json = {className: "_User", objectId: user.id};
    _.each(identity_select(), function (field) {
        var value = user.get(field);
        if (!_.isUndefined(value) && !_.isNull(value)) {
            json[field] = value;
        }
    });
    _.each(extra || {}, function (value, key) {
        json[key] = value;
    });
    return Parse.Object.fromJSON(json);
};

/** Master-keyed projection read of the named ids, chunked past the page size. */
var read_identities = function (ids) {
    var wanted = _.compact(_.uniq(ids));
    if (0 === wanted.length) {
        return Promise.resolve([]);
    }
    return Promise.all(_.map(_.chunk(wanted, 100), function (chunk) {
        var q = new Parse.Query(Parse.User);
        q.containedIn("objectId", chunk);
        q.select(identity_select());
        q.limit(chunk.length);   // without this, find() caps at 100
        return q.find({useMasterKey: true});
    })).then(function (batches) {
        return _.map(_.flatten(batches), function (u) { return identity_of(u); });
    });
};

/**
 * What the caller is. Decided here, never from anything the browser sent.
 *
 * `admininterface` / `storytellerinterface` are UI caches the BROWSER writes
 * onto the user's own row, and `_User` grants `update` to '*', so a player can
 * set either on themselves. Nothing here reads them.
 *
 * `is_staff` is "holds any troupe role", by owner decision 2026-08-20 -- the
 * account directory stays open to every storyteller rather than narrowing to
 * lead storytellers, so no existing user loses a capability they have today.
 *
 * Match the PREFIXED roles only, never the bare generic "LST" / "AST" /
 * "Narrator": change_troupe_staff also adds users to the troupe's generic
 * roles, so every current AND FORMER storyteller org-wide holds the bare names.
 * Matching those would hand the directory to people who have not staffed a
 * troupe in years.
 *
 * DIRECT membership only -- `equalTo("users", u)` does not expand the role
 * graph. `Administrator` is a member ROLE of every prefixed troupe role, so
 * an administrator never appears here as a storyteller and every clause must
 * short-circuit on is_admin first, the same ordering :924-941 already uses.
 */
var caller_scope = function (request) {
    if (request.master) {
        return Promise.resolve({id: null, is_admin: true, is_staff: true});
    }
    if (!request.user) {
        return Promise.reject("Unauthorized: Must be logged in.");
    }
    var q = new Parse.Query(Parse.Role);
    q.equalTo("users", request.user);
    q.limit(1000);
    return q.find({useMasterKey: true}).then(function (roles) {
        var names = _.map(roles, function (r) { return r.get("name"); });
        return {
            id: request.user.id,
            is_admin: _.some(names, function (n) {
                return "Administrator" === n || "SiteAdministrator" === n;
            }),
            is_staff: _.some(names, function (n) {
                return _.startsWith(n, "LST_") ||
                       _.startsWith(n, "AST_") ||
                       _.startsWith(n, "Narrator_");
            })
        };
    });
};

/**
 * Options that make a Cloud query run with EXACTLY the caller's read
 * permissions -- ACLs, role-graph expansion and all.
 *
 * The auth user carries its session token, and a query carrying one is
 * authenticated as that user. Note the failure mode is SAFE: a query with no
 * options bag authenticates as NOBODY, so a forgotten bag returns nothing
 * rather than everything.
 */
var as_caller = function (request) {
    var token = request.user && request.user.getSessionToken();
    if (!token) {
        return Promise.reject("Unauthorized: No session on this request.");
    }
    return Promise.resolve({sessionToken: token});
};

/**
 * Which of `ids` this caller may be told about.
 *
 * The character arm is the interesting one: the entitlement to see who owns a
 * character IS the entitlement to read the character, so this re-runs the
 * character query AS THE CALLER rather than recomputing roles. It cannot
 * over-return (a character the caller cannot read is simply absent), it cannot
 * drift from models/Character.js#get_me_acl because it IS that ACL, and it gets
 * role-graph expansion for free. "Vampire" covers all three venues: Werewolf
 * and ChangelingBetaSlice both register className "Vampire" on purpose.
 */
var allowed_identity_ids = function (request, scope, ids) {
    var allowed = {};
    if (scope.is_admin || scope.is_staff) {
        _.each(ids, function (id) { allowed[id] = true; });
        return Promise.resolve(allowed);
    }
    if (scope.id) { allowed[scope.id] = true; }
    var others = _.without(ids, scope.id);
    if (0 === others.length) {
        return Promise.resolve(allowed);
    }
    return as_caller(request).then(function (options) {
        var q = new Parse.Query("Vampire");
        q.containedIn("owner", _.map(others, function (id) {
            return new Parse.User({id: id});
        }));
        q.select("owner");
        // `each`, not find+limit: find() truncates silently at its limit, and a
        // silently short answer here renders as "(unknown)", i.e. a lie.
        return q.each(function (character) {
            var owner = character.get("owner");
            if (owner && owner.id) { allowed[owner.id] = true; }
        }, options);
    }).then(function () {
        return allowed;
    });
};

/**
 * The account directory. Replaces collections/Users.js's sweep AND the second,
 * independent sweep in views/UsersView.js.
 *
 * params:  {}
 * returns: { scope: "all" | "self", users: [Parse.User] }
 * errors:  "Unauthorized: Must be logged in."
 *
 * `scope` is returned so the browser can SAY why a list is short instead of
 * rendering a mysteriously empty picker, and so the deployed policy is visible
 * in devtools. The "self" tier is not a rejection on purpose: #profile and
 * #patronage/:id are login-only routes that legitimately need the caller's own
 * row, and it reproduces exactly the filter helpers/UserWreqr.js already
 * applies in the browser -- moved to where it can actually withhold anything.
 */
Parse.Cloud.define("list_users", function (request, response) {
    var scope;
    caller_scope(request).then(function (s) {
        scope = s;
        if (!scope.is_admin && !scope.is_staff) {
            return read_identities([scope.id]);
        }
        var rows = [];
        var q = new Parse.Query(Parse.User);
        q.select(identity_select());
        // `each` pages server-side and cannot truncate. `find` would cap at 100
        // and silently lose most of the production accounts.
        return q.each(function (user) {
            rows.push(identity_of(user));
        }, {useMasterKey: true}).then(function () {
            return rows;
        });
    }).then(function (users) {
        response.success({
            scope: (scope.is_admin || scope.is_staff) ? "all" : "self",
            users: users
        });
    }, function (error) {
        response.error(_.isString(error) ? error : error.message);
    });
});

/**
 * Resolve a bounded set of ids the caller already holds. This is the workhorse:
 * it replaces every include("owner"), the include("caster"), and the three
 * by-id gets. It cannot be used to enumerate -- you must already know the ids.
 *
 * params:  { ids: [objectId] }         at most MAX_IDENTITY_IDS
 * returns: { users: [Parse.User], withheld: [objectId] }
 * errors:  "Unauthorized: Must be logged in."
 *          "`ids` must be an array of objectIds."
 *          "Ask about at most 200 accounts per call."
 *
 * `withheld` deliberately CONFLATES "you may not see this" with "no such row".
 * Reporting them separately would make this an existence oracle for arbitrary
 * objectIds; the browser has no use for the distinction, and the one place that
 * cared -- "archived" vs "hidden" -- is answered by the pointer's presence, not
 * by this call, because archiving unsets `owner` outright.
 */
Parse.Cloud.define("get_users_by_id", function (request, response) {
    var ids = request.params.ids;
    if (!_.isArray(ids)) {
        response.error("`ids` must be an array of objectIds.");
        return;
    }
    var requested = _.uniq(_.filter(ids, _.isString));
    if (MAX_IDENTITY_IDS < requested.length) {
        response.error("Ask about at most " + MAX_IDENTITY_IDS + " accounts per call.");
        return;
    }
    if (0 === requested.length) {
        response.success({users: [], withheld: []});
        return;
    }
    caller_scope(request).then(function (scope) {
        return allowed_identity_ids(request, scope, requested);
    }).then(function (allowed) {
        return read_identities(_.filter(requested, function (id) {
            return allowed[id];
        }));
    }).then(function (users) {
        var found = {};
        _.each(users, function (u) { found[u.id] = true; });
        response.success({
            users: users,
            withheld: _.filter(requested, function (id) { return !found[id]; })
        });
    }, function (error) {
        response.error(_.isString(error) ? error : error.message);
    });
});

/**
 * A troupe's staff, each carrying their per-troupe title. Replaces
 * public/scripts/app/models/Troupe.js#get_staff, whose relation query carried
 * NO options at all -- an ordinary ACL-filtered client read that degrades to a
 * SHORT list with no marker, re-creating exactly the "this troupe has no staff"
 * confusion views/TroupeView.js documents fighting.
 *
 * Any logged-in caller, for any troupe -- today's behaviour, and the one place
 * where universal visibility reads as intent: #troupe/:id is gated only by
 * enforce_logged_in, TroupeView renders the roster for every viewer regardless
 * of `writable`, troupe rows are public by construction on both sides, and the
 * troupe already publishes a `staffemail` to everyone. The roster answers the
 * question the page exists to answer.
 *
 * `role` is smuggled through identity_of's `extra` rather than set on the
 * object: a `.set()` would dirty it and the encoder would ship a bare pointer.
 * Order is fixed LST, AST, Narrator -- the browser-side version iterated an
 * object whose key order came from promise resolution.
 *
 * params:  { troupe_id: string }
 * returns: { staff: [Parse.User] }   each with a `role` attribute
 * errors:  "No troupe was named." / "Unauthorized: Must be logged in."
 */
Parse.Cloud.define("get_troupe_staff", function (request, response) {
    var troupe_id = request.params.troupe_id;
    if (!troupe_id) {
        response.error("No troupe was named.");
        return;
    }
    caller_scope(request).then(function () {
        return new Troupe({id: troupe_id}).get_roles();
    }).then(function (roles) {
        var staff = [];
        return Promise.all(_.map(["LST", "AST", "Narrator"], function (title) {
            var role = roles[title];
            if (!role) {                       // a troupe missing one of its roles
                return Promise.resolve();
            }
            var q = role.getUsers().query();
            q.select(identity_select());
            return q.each(function (user) {
                staff.push(identity_of(user, {role: title}));
            }, {useMasterKey: true});
        })).then(function () {
            return staff;
        });
    }).then(function (staff) {
        response.success({staff: staff});
    }, function (error) {
        response.error(_.isString(error) ? error : error.message);
    });
});

// R51, second half. Parse never returns another user's `email` to a client -
// it is private to that user - so `AdministrationUserView`'s reset button read
// an empty address off its own copy of the record and failed with "you must
// provide an email" even once an adapter was configured. An administrator does
// not need to see the address to reset it, so the lookup happens here under the
// master key and the address is never sent to the browser.
Parse.Cloud.define("request_password_reset_for", function(request, response) {
    var user_id = request.params.user_id;
    require_administrator(request).then(function () {
        if (!user_id) {
            return Promise.reject("No user was named.");
        }
        return new Parse.Query(Parse.User).get(user_id, {useMasterKey: true});
    }).then(function (user) {
        var email = user.get("email");
        if (!email) {
            return Promise.reject("That user has no email address on file.");
        }
        return Parse.User.requestPasswordReset(email);
    }).then(function () {
        response.success(true);
    }, function (error) {
        response.error(_.isString(error) ? error : error.message);
    });
});

// Only while the in-memory capture adapter is in use - see index.js and
// cloud/MemoryEmailAdapter.js - and only for administrators even then, because
// the captured bodies carry live password-reset links. With a real mail
// provider configured this function does not exist at all.
if (global.__yorickCapturedEmail) {
    Parse.Cloud.define("get_captured_emails", function(request, response) {
        require_administrator(request).then(function () {
            response.success(global.__yorickCapturedEmail.captured());
        }, function (error) {
            response.error(_.isString(error) ? error : error.message);
        });
    });
}

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
    return uq.get(user_id, {useMasterKey: true}).then(function (user) {
        console.log("Matched a user in the role! " + role.get("name") + " " + user.get("username"));
        return Promise.resolve(user);
    }, function (error) {
        if (0 == remaining_roles_to_check.length) {
            return Promise.reject("Couldn't find user in appropriate roles");
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
            return s.save({}, {useMasterKey: true}).catch(function (error) {
                console.log("Failed to save role " + s.get("name") + " with " + JSON.stringify(error));
            });
        })
        return Promise.all(promises);
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
        return troupe.get_roles()
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
});

// ---------------------------------------------------------------------------
// Testing surface.
//
// parse-server `require`s this file and reads only the registrations above, so
// exporting is inert at runtime. It exists because `identity_of` is the single
// line standing between a master-key read and a credential leak, and a function
// that can only be reached through a Cloud call over HTTP against a seeded
// database is a function nobody writes a leak test for.
//
// Export nothing here that is not needed by test/user-directory.test.js.
// ---------------------------------------------------------------------------
module.exports = {
    identity_of: identity_of,
    identity_select: identity_select,
    IDENTITY_FIELDS: IDENTITY_FIELDS,
    IDENTITY_INCLUDES_EMAIL: IDENTITY_INCLUDES_EMAIL,
    MAX_IDENTITY_IDS: MAX_IDENTITY_IDS
};
