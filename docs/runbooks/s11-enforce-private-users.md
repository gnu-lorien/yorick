<!--
Produced 2026-08-20, immediately after S10's blocker M was decided.

Owner decision, 2026-08-20: keep `enforcePrivateUsers` at 9.10.0's default
(true) and move the browser's reads of other people's `_User` rows behind Cloud
functions, rather than pinning the option false for a release and deferring.
That decision was taken twice -- once on a two-site estimate, and again after
the real surface was measured and reported back.

`index.js` now pins the option explicitly. NOTHING ELSE IN THIS DOCUMENT HAS
LANDED. It is a specification, produced by three independent designs scored by
three independent judges and then synthesised, with every load-bearing claim
re-verified against the installed parse-server 9.10.0 and parse 8.6.0 and
against the tree. Section 0 reframes the problem and should be read before
anything is scheduled.

Section 6 was six open decisions when this was drafted. ALL SIX ARE NOW
SETTLED - D1 by inspection, D2 through D5 by the owner on 2026-08-20, D6
deliberately deferred. Where an answer changes the design, section 6 says so and
the body above was left as drafted: READ SECTION 6 AS THE AUTHORITY. In
particular D3 withdraws clause 6, so no real user loses a capability, and D5
records why parse-dashboard is unaffected plus a dashboard deployment gap that
nothing else in the repo owns.

No suite run and no gate run was performed while writing this.
-->
# S11 — `enforcePrivateUsers`: moving the browser's `_User` reads behind Cloud functions

**Spine:** the MINIMAL TOUCH design (delete the includes, hydrate the surviving pointers in place, zero template edits). **Grafted in:** the storage-layer closure from design 2 (without it the refactor closes nothing), design 2's as-caller entitlement query, design 3's private-user seed fixture and named policy constants, plus three defects I found while verifying that none of the three designs caught.

## 0. Read this first — three facts that reframe the work

**0.1 The flag is already on.** `enforcePrivateUsers` defaults to `true` in the installed server (`node_modules/parse-server/lib/Options/Definitions.js:265-270`). The option appears nowhere in this repo outside `docs/`, so the degradation described below **has been live in every environment running 9.10.0 since the bump landed** — "pinning" it writes a default down rather than changing anything. `index.js` now pins it explicitly. This was open when the spec was drafted and is settled here (§6, D1); the consequence is that C1-C7 are urgent rather than preparatory.

**0.2 The refactor alone closes nothing.** `enforcePrivateUsers` is read at exactly one place — `node_modules/parse-server/lib/RestWrite.js:1380`, inside the `_User` *create* branch, and only when the write supplies no ACL. Nothing rewrites existing rows. Production carries 382 users (`docs/runbooks/production-clp-remediation.md:33`), every one keeping `_rperm: ['*']` forever, and `database_seed/_SCHEMA.json` line 19 gives `_User` `find: {"*": true}` with no `requiresAuthentication`. So moving reads into Cloud functions changes the exposure for **zero of 382 existing accounts**. §4 C8/C9 are the half that actually closes it, and they are separable and separately signed off.

**0.3 A green suite is not evidence for anything in this document.** `seed_db.js:63-70` writes `_rperm: ['*', u.id]` and `_acl` with `'*': {r:true}` through the raw Mongo driver, never touching `RestWrite.js:1380`, and `seedTestUsers` runs on every boot (`seed_db.js:53-83`). No seeded account is ever private. No seeded account has an `email` or a `realname` (`seed_db.js:40-45`). No E2E spec completes a signup. Every correctness claim here was reached by reading the installed server and SDK, plus the in-process experiments recorded in §5.1 — never by running the suite. Do not cite a green run as proof of any clause.

### What I verified myself (the mechanism, in one paragraph)

`handleInclude` returns immediately when nothing is included (`RestQuery.js:915-917`), and `replacePointers` — which turns an unreadable include target into `undefined` (`RestQuery.js:1161-1164`, `return replace[object.objectId]`) — is reachable only through `includePath`. **So deleting `include("owner")` makes the raw pointer survive**, and I confirmed in-process that a surviving bare pointer decodes to a real `Parse.User` with `.id` set, that `has("owner")` is true, that `_.isUndefined(owner)` is false, and that `new Parse.ACL().setReadAccess(pointer, true)` yields `{"u44":{"read":true}}`. That single deletion repairs, with no sentinel code:

- `mobileRouter.js:1269-1272` silently dropping live characters off a troupe roster (an absent owner means *archived*, `models/Character.js:930-934`);
- the `playable` filter dropping the same rows (`CharactersSummarizeListView.js:344-348`, `CharactersSelectToPrintView.js:348-352` — note `CharactersSelectToPrintView.js` defaults `playable: true`);
- `models/Character.js:111-118` `get_me_acl` handing a player's traits to whoever opened the sheet (it runs on every trait save, `Character.js:198`, and every experience notation, `:606`);
- `mobileRouter.js:1536-1544` `_check_character_mismatch` silently ceasing to fire.

Only the owner's **name** needs a Cloud function.

---

## 1. The authorization rule

Seven clauses. Each names the thing already in the tree it is derived from. Only clause 6 is a decision rather than a discovery, and it is labelled as one.

**Clause 1 — Self, always, with no Cloud function in the way.**
The caller sees their own row in full, including `email`. `RestWrite.js:1387-1390` writes `ACL[objectId] = {read:true, write:true}` unconditionally even under the flag, and `DatabaseController.js:284` exempts the row owner from `protectedFields`. Every `Parse.User.current()` read in the app stays untouched. **Consequence that matters:** `helpers/UserWreqr.js`'s `("user","get")` handler answers from `Parse.User.current()` before consulting the collection — see §3.1. Without this, `#profile` breaks: `views/UserSettingsProfileView.js:173-181` renders a `PatronagesView` → `PatronageListView.js:26-28` → `templates/patronage-list-item.html:6`, which prints `<h2><%= owner.objectId %> User object missing</h2>` on a miss. Every paying member would see that string on their own profile.

**Clause 2 — Administrators see the whole directory.** Membership is decided server-side from **direct** `Parse.Role` membership in `Administrator` or `SiteAdministrator`, never from `request.params`, and never from `admininterface`. `admininterface` is written by the *browser* onto the user's own row (`mobileRouter.js:1470-1482`), `_User` grants `update` to `'*'` (`_SCHEMA.json:19`), and the row's own ACL grants its owner write — so any player can set it true. `enforce_admin` (`mobileRouter.js:1503-1513`) reads only that cached flag and its own comment at `:1494-1502` says it is presentation. The server-side mechanism to copy is `require_administrator` (`cloud/main.js:1086-1104`).

**Clause 3 — Holders of any `LST_<troupeId>` role also see the whole directory.** `LST_<troupe_id>` is precisely the role `change_troupe_staff` already demands to *complete* the action the account picker starts (`cloud/main.js:1206`, `:1240-1249`). Anyone else browsing the picker today is browsing toward a refusal. **Match on the `LST_` prefix only, never the bare generic role `LST`** — `cloud/main.js:1252-1257` shows `change_troupe_staff` adding users to `troupe.get_generic_roles()` as well, so every current *and former* lead storyteller org-wide holds the bare `LST` role (`database_seed/_Role.json`, id `FIGcCM2shU`).

**Clause 4 — Whoever may read a character may be told who owns it.** Not "storytellers see players": literally the character's read entitlement, evaluated by re-running the character query **as the caller**. `models/Character.js:107-126` is the app's one principled, server-enforced statement of who may see a player's sheet — owner, `Administrator`, `LST_<t>` and `AST_<t>` per troupe, pointedly not `Narrator_<t>` — and `cloud/main.js:934-941` independently requires the same pair to approve. Deriving identity from that ACL rather than restating it means the two cannot diverge, **and it inherits role-graph expansion**, which matters more than any design assumed: I resolved `database_seed/_Join roles _Role.json` and found `Administrator` is a member role of every `LST_<t>`, `AST_<t>` *and* `Narrator_<t>`, and `LST_<t>` is a member of `AST_<t>` which is a member of `Narrator_<t>`. A hand-written `_.includes(names, "LST_" + t)` test returns **false** for an administrator who nevertheless has ACL read on that troupe's characters. The as-caller query cannot get this wrong.

**Clause 5 — `email` is never returned to anyone but the row's owner, and is never selected.**
This is a **no-op that must be stated to stay a no-op**. parse-server 9.10.0 defaults `protectedFields` to `{_User: {'*': ['email']}}` (`Definitions.js:493-501`) and computes it only for non-master callers (`DatabaseController.js:1215`, `:1222`), so every template printing another user's email renders blank today — which `views/AdministrationUserView.js:104-110` and `cloud/main.js:1105-1111` both record discovering the hard way. A master-key read bypasses that filter **and** the `authData` strip: `filterSensitiveData` returns at `DatabaseController.js:297-299` (`if (!isUserClass || isMaster) return object;`) *before* `delete object.authData` at `:303`, and `public/scripts/app/helpers/FacebookLogin.js:19` reads `authData.facebook.access_token`. Handing back a fetched row would newly ship both. **A third leak nobody flagged:** `request.user` in a Cloud function carries `sessionToken` in its server data — I verified `Auth.js:219` sets `obj['sessionToken']` before `Parse.Object.fromJSON`, on both the cache-hit and cache-miss paths, and that `getSessionToken()` reads it back. Returning `request.user` or anything derived from a fetched row would leak a live session token. This is why `identity_of` **constructs** the result field by field from an allowlist instead of filtering a fetched object.

**Clause 6 — Everyone else logged in gets exactly one row: their own. Logged out gets an error.** *Stated as a decision, not a discovery.* There is no principled rule in the tree: today's behaviour is "every logged-in account can enumerate every account's username and realname", produced by an ungated view (`views/UsersView.js:21-24`) behind an ungated route (`mobileRouter.js:2126-2132`, `enforce_logged_in` only), and `_User` `create` is `{"*": true}`, so "logged in" is one signup away from anonymous. The privilege filter that was evidently meant to be the policy — `helpers/UserWreqr.js:20-30`, `is_ad || is_st` else *a collection containing only yourself* — runs in the browser **after** the network already carried all 382 rows. **This clause moves that exact filter to the server.** It is the app's own stated policy, finally enforced. It is deliberately a *tier*, not a rejection, because a rejection kills `#profile` and `#patronage/:id` for every player (clause 1).

**Clause 7 — What is explicitly NOT changed.** `_Role` queries constrained *by* a user pointer (`mobileRouter.js:311`, `:1471-1474`, `views/AdministrationUserView.js:68-71`) are join-table lookups that never read a `_User` row back; leaving them alone is what keeps the admin and storyteller gates working. `owner` on `SimpleTrait`, `VampireChange`, `ExperienceNotation`, `LongText` and `VampireApproval` points at a Vampire, and on `ReferendumBallot` at a Referendum — do not convert those. `approver` is rendered from its raw objectId and never included.

### What a user can see today and will not see after this

1. **Ordinary players, ASTs and Narrators lose the account directory.** `#troupe/:id/staff/add` currently hands every logged-in account all 382 usernames and realnames. After this it shows one entry — themselves — with an on-screen note saying why. This is the single biggest visible removal, and it is deliberately loud rather than silent. Mitigating: the picker is already half-broken for those callers, since `change_troupe_staff` refuses anyone outside `LST_<troupe_id>` on submit (`cloud/main.js:1206`, `:1240-1249`).
2. **`views/PatronageView.js:32-38`'s owner `<select>` shows one entry for a non-admin, non-LST caller on `#patronage/:id`.** No regression in practice: `reqres.request('all')` already returns a one-element collection for those callers (`UserWreqr.js:24-29`), and `Patronage` `update` is `role:Administrator` (`_SCHEMA.json:8`), so they could never save.
3. **A character owner nobody can resolve renders `(unknown)` instead of a blank.** See §3.4 — this is a deliberate, arity-preserving replacement for a defect the CSV templates already have.

Nothing else a user can see is removed. `email` is not removed: it is already blank (clause 5), and `IDENTITY_INCLUDES_EMAIL` exists to settle that in one line if the deployed config differs.

---

## 2. The Cloud functions

Append to **`cloud/main.js`**, immediately after `require_administrator` (`cloud/main.js:1104`). No new file, no new convention: house arity-2 `(request, response)`, matching all ten existing definitions, each settling through the house two-armed tail `response.error(_.isString(error) ? error : error.message)` (`cloud/main.js:1122-1124`). `Troupe` and `_` are already required at `cloud/main.js:6` and `:2`.

`require_administrator` is **not** refactored — it answers a narrower question and two shipped functions depend on it; `caller_scope` below is the single role reader for the new code.

```js
// ---------------------------------------------------------------------------
// S11. The `_User` reads the browser is no longer allowed to make.
//
// parse-server 9.10.0 defaults `enforcePrivateUsers` to true
// (node_modules/parse-server/lib/Options/Definitions.js:265-270). On a `_User`
// CREATE with no ACL supplied, `ACL['*'] = {read:true}` is written only when the
// flag is OFF (RestWrite.js:1380); `ACL[objectId] = {read:true,write:true}` is
// written unconditionally after it. Existing rows are never rewritten, so the
// app degrades one signup at a time. The browser has no master key, so every
// read of somebody else's row moves here.
//
// ARITY. Arity-2 to match the other ten. The arity-2 arm at
// FunctionsRouter.js:341-350 sends NOTHING if a body neither settles `response`
// nor returns a value - the hang cloud/main.js:823-834 records already hitting
// once - so every body below ends in a two-armed `.then(ok, err)` whose `ok`
// arm does nothing but call response.success.
// ---------------------------------------------------------------------------

/**
 * Everything about a `_User` that is allowed to leave this server.
 *
 * `massmailauthorization` and `acceptedtos` are here because
 * forms/UserForm.js:11-14 renders both as (disabled) checkboxes on
 * `#administration/user/:id` and character-summarize-list-item-csv.html:6
 * prints the first. Dropping them would blank two admin surfaces silently.
 */
var IDENTITY_FIELDS = ["username", "realname", "massmailauthorization", "acceptedtos"];

/**
 * Whether `email` may be returned. Left FALSE.
 *
 * parse-server already withholds `email` from every non-owner read by default
 * (Definitions.js:493-501; protectedFields is computed only for non-master
 * callers, DatabaseController.js:1215,1222), so no browser caller can see
 * another user's address TODAY - which views/AdministrationUserView.js:104-110
 * and cloud/main.js:1105-1111 both record discovering the hard way. Returning it
 * under the master key would be an EXPANSION of exposure dressed as a migration.
 *
 * It is a named constant rather than an omission so the question is one line and
 * one deploy: if an admin export that had addresses yesterday has none today,
 * the deployed server was overriding protectedFields and this is the line to
 * flip. Do not flip it to make a template look tidier.
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
 * row. That distinction is the whole point: a master-key read bypasses
 * protectedFields (DatabaseController.js:1215) AND the authData strip
 * (filterSensitiveData returns at :297-299, BEFORE `delete object.authData` at
 * :303), and helpers/FacebookLogin.js:19 shows that field carries a live
 * Facebook access token. `request.user` is worse still - Auth.js:219 puts the
 * caller's SESSION TOKEN into its server data. Constructing the result means no
 * field escapes by accident, only by someone editing IDENTITY_FIELDS.
 *
 * `Parse.Object.fromJSON`, never `new Parse.User(...)` + `.set(...)`: the result
 * must be CLEAN. Verified in-process against the installed SDK - fromJSON here
 * yields `dirty() === false`, `constructor === ParseUser`, populated
 * `_getServerData()`, and encodes as
 *   {"username":"sam","realname":"Sam R","objectId":"...","__type":"Object",
 *    "className":"_User"}
 * A single `.set()` afterwards flips it to a bare attribute-less
 * {"__type":"Pointer",...} (encode.js:29 tests `value.dirty()`), which the
 * browser would render as blanks with no error anywhere. That is why `extra`
 * (the per-troupe role label) is smuggled into the JSON rather than set on the
 * object - and it is why cloud/Troupe.js#get_staff, which does
 * `user.set("role", title)` at :26, must NOT be lifted for this.
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
 * `admininterface` / `storytellerinterface` are UI caches the BROWSER writes onto
 * the user's own row (mobileRouter.js:311-319, :1470-1482), and `_User` grants
 * `update` to '*' (database_seed/_SCHEMA.json:19), so a player can set either.
 * Nothing here reads them.
 *
 * DIRECT membership only - `equalTo("users", u)` does not expand the role graph.
 * Resolving `database_seed/_Join roles _Role.json` shows `Administrator` is a
 * member ROLE of every LST_*/AST_*/Narrator_*, and LST_<t> of AST_<t> of
 * Narrator_<t>. So an administrator NEVER appears here as a lead storyteller and
 * every clause must short-circuit on is_admin first - the same ordering
 * cloud/main.js:924-941 already uses.
 *
 * The "LST_" prefix, not the bare generic role "LST": cloud/main.js:1252-1257
 * shows change_troupe_staff adding users to troupe.get_generic_roles() too, so
 * every current and FORMER lead storyteller org-wide holds bare "LST".
 */
var caller_scope = function (request) {
    if (request.master) {
        return Promise.resolve({id: null, is_admin: true, is_lead: true});
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
            is_lead: _.some(names, function (n) { return _.startsWith(n, "LST_"); })
        };
    });
};

/**
 * Options that make a Cloud query run with EXACTLY the caller's read
 * permissions - ACLs, role-graph expansion and all.
 *
 * Auth.js:219 puts the session token on the auth user before building it, and
 * ParseServerRESTController.js:19-42 authenticates a query carrying one as that
 * user. Verified: `request.user.getSessionToken()` is populated on both the
 * cache-hit and cache-miss paths. Note the failure mode is SAFE - a query with
 * no options bag authenticates as NOBODY (ParseServerRESTController.js:36-40),
 * so a forgotten bag returns nothing rather than everything.
 */
var as_caller = function (request) {
    var token = request.user && request.user.getSessionToken();
    if (!token) {
        return Promise.reject("Unauthorized: No session on this request.");
    }
    return Promise.resolve({sessionToken: token});
};

/**
 * Which of `ids` this caller may be told about. Clauses 1-4.
 *
 * The character arm is clause 4: the entitlement to see who owns a character IS
 * the entitlement to read the character, so this re-runs the character query as
 * the caller rather than recomputing roles. It cannot over-return (a character
 * the caller cannot read is simply absent), it cannot drift from
 * models/Character.js:107-126 because it IS that ACL, and it gets role-graph
 * expansion for free. "Vampire" covers all three venues: Werewolf.js:293 and
 * ChangelingBetaSlice.js:492 both register className "Vampire" on purpose.
 */
var allowed_identity_ids = function (request, scope, ids) {
    var allowed = {};
    if (scope.is_admin || scope.is_lead) {
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
 * The account directory. Replaces collections/Users.js:42-51 AND the second,
 * independent sweep at views/UsersView.js:21-24.
 *
 * params:  {}
 * returns: { scope: "all" | "self", users: [Parse.User] }
 * errors:  "Unauthorized: Must be logged in."
 *
 * `scope` is returned so the browser can SAY why a list is short instead of
 * rendering a mysteriously empty picker, and so the deployed policy is visible
 * in devtools. The "self" tier is not a rejection on purpose: #profile and
 * #patronage/:id are login-only routes that legitimately need the caller's own
 * row, and it reproduces exactly the filter helpers/UserWreqr.js:20-30 already
 * applies in the browser - moved to where it can actually withhold anything.
 */
Parse.Cloud.define("list_users", function (request, response) {
    var scope;
    caller_scope(request).then(function (s) {
        scope = s;
        if (!scope.is_admin && !scope.is_lead) {
            return read_identities([scope.id]);
        }
        var rows = [];
        var q = new Parse.Query(Parse.User);
        q.select(identity_select());
        // `each` pages server-side and cannot truncate. `find` would cap at 100
        // (REST default; `maxLimit` has no default, Definitions.js) and silently
        // lose 282 of the 382 production accounts.
        return q.each(function (user) {
            rows.push(identity_of(user));
        }, {useMasterKey: true}).then(function () {
            return rows;
        });
    }).then(function (users) {
        response.success({
            scope: (scope.is_admin || scope.is_lead) ? "all" : "self",
            users: users
        });
    }, function (error) {
        response.error(_.isString(error) ? error : error.message);
    });
});

/**
 * Resolve a bounded set of ids the caller already holds. This is the workhorse:
 * it replaces all nine include("owner") calls, the include("caster"), and the
 * three by-id gets. It cannot be used to enumerate - you must already know the
 * objectIds.
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
 * cared - "archived" vs "hidden" - is answered by the pointer's presence, not by
 * this call (models/Character.js:930-934 unsets `owner` outright on archive).
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
 * public/scripts/app/models/Troupe.js:21-37, whose q.each at :28 carried NO
 * options at all - an ordinary ACL-filtered client read that degrades to a
 * SHORT list with no marker, re-creating exactly the "this troupe has no staff"
 * confusion views/TroupeView.js:105-148 documents fighting.
 *
 * Clause: any logged-in caller, for any troupe - today's behaviour, and the one
 * place where universal visibility reads as intent. #troupe/:id is gated only by
 * enforce_logged_in (mobileRouter.js:2144), TroupeView.js:146-150 renders the
 * roster for every viewer regardless of `writable`, troupe rows are public by
 * construction on both sides (cloud/Troupe.js:9-14, models/Troupe.js:11-16,
 * _SCHEMA.json:11), and the troupe already publishes a `staffemail` to everyone.
 * The roster answers the question the page exists to answer.
 *
 * `role` is smuggled through identity_of's `extra` rather than set on the object:
 * a `.set()` would dirty it and encode.js:29 would ship a bare pointer.
 * Order is fixed LST, AST, Narrator - models/Troupe.js:24-33 iterated an object
 * whose key order came from promise resolution.
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
        return new Troupe({id: troupe_id}).get_roles();   // cloud/Troupe.js:36-49
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
```

### What the browser sees for each error

Every rejection above is a bare string. `response.error` hands it to `triggers.resolveError` (`FunctionsRouter.js:148`), which turns a string into `new Parse.Error(SCRIPT_FAILED /* 141 */, message)` (`triggers.js:613-616`), and `middlewares.js:588-601` returns **HTTP 400** with body `{code: 141, error: "<the message>"}`. Cloud-function messages are **not** sanitized — `createSanitizedError` (`Error.js:20-28`) is on the CLP path only. So `helpers/PromiseFailReport` and `mobileRouter.js:1516-1525`'s `admin_route_failed` show the real sentence, which is what makes a policy refusal legible in production instead of a blank page.

| call | caller | result |
|---|---|---|
| `list_users` | logged out | 400 `{141, "Unauthorized: Must be logged in."}` |
| `list_users` | admin / `LST_*` | `{scope:"all", users:[382]}` |
| `list_users` | anyone else | `{scope:"self", users:[1]}` |
| `get_users_by_id` | `ids` not an array | 400 `{141, "`ids` must be an array of objectIds."}` |
| `get_users_by_id` | >200 ids | 400 `{141, "Ask about at most 200 accounts per call."}` |
| `get_users_by_id` | player, ids include a stranger | that id appears in `withheld`, not in `users` |
| `get_troupe_staff` | no `troupe_id` | 400 `{141, "No troupe was named."}` |
| `get_troupe_staff` | any logged-in caller | `{staff:[…]}` |

---

## 3. Client integration

### 3.1 The one new primitive — `public/scripts/app/helpers/UserWreqr.js`

Three additions to the existing module singleton (`helpers/UserWreqr.js:10-50`). No new file: this file is already the app-wide user registry.

**(a) The self-answer.** Replace `UserWreqr.js:17-19`:

```js
// BEFORE
Backbone.Wreqr.radio.reqres.setHandler("user", "get", function (id) {
    return self.users.get(id);
})

// AFTER
// The caller's own row is always readable - RestWrite.js:1387-1390 writes
// ACL[objectId] = {read:true,write:true} even under enforcePrivateUsers - and
// Parse.User.current() already holds it. Answering from there means #profile
// needs no directory call at all: its patronage rows resolve identity through
// THIS handler (views/PatronageListView.js:26-28 ->
// templates/patronage-list-item.html:6, which prints
// "<objectId> User object missing" on a miss), and every one of those rows is
// owned by the caller (UserSettingsProfileView.js:198).
Backbone.Wreqr.radio.reqres.setHandler("user", "get", function (id) {
    var current = Parse.User.current();
    if (current && current.id === id) { return current; }
    return self.users.get(id);
})
```

**(b) `prime` and `hydrate`.** Add to the `UserHelper` body, and add `self.asked = {};` beside `self.users = new Users;` at `UserWreqr.js:15`:

```js
/**
 * A pointer nothing could resolve.
 *
 * It is a VALUE and not a blank because the three CSV templates emit their
 * identity columns only INSIDE `if (e.get("owner").get("username"))` - see
 * character-summarize-list-item-csv.html:3-9 - and a falsy username makes them
 * emit NO columns at all, shifting every later column in the row. That branch is
 * unreachable today and becomes reachable the moment a hydrate is missed, so the
 * sentinel is the guard against a silent CSV corruption, not decoration.
 */
var UNRESOLVED_USER = {username: "(unknown)", realname: "", email: ""};
```

```js
/** Ask the server about ids the registry has never asked about. */
prime: function (ids) {
    var self = this;
    var current = Parse.User.current();
    var need = _.filter(_.uniq(_.compact(ids)), function (id) {
        return !_.has(self.asked, id) && !(current && current.id === id);
    });
    if (0 === need.length) { return Parse.Promise.as(self.users); }
    var p = Parse.Promise.as();
    _.each(_.chunk(need, 200), function (batch) {
        p = p.then(function () {
            return Parse.Cloud.run("get_users_by_id", {ids: batch}).then(function (payload) {
                _.each(payload.users, function (u) { self.users.add(u); });
                _.each(batch, function (id) { self.asked[id] = true; });
            });
        });
    });
    return p.then(function () { return Parse.Promise.as(self.users); });
},

/**
 * Fill in the display fields of the `key` pointers on `objects`, IN PLACE.
 *
 * `_finishFetch` is an SDK private and it is used on purpose: it is the exact
 * step Parse.Object.fromJSON performs at
 * node_modules/parse/lib/browser/ParseObject.js:1803 -> :372 when the SDK itself
 * decodes an included pointer, so this REPRODUCES what include("owner") used to
 * do rather than imitating it. It commits through commitServerChanges
 * (ObjectStateMutations.js:230-248), which writes only serverData and
 * objectCache and creates NO pending ops.
 *
 * Verified in-process against the installed SDK, because this is the hinge of
 * the whole design:
 *     hydrated -> parent dirty false, unsavedChildren 0
 *     .set()   -> parent dirty false, unsavedChildren 1     <-- the trap
 * unsavedChildren collects any DIRTY child that has an id
 * (unsavedChildren.js:29, :51), so a `.set()` here would make the next
 * character.save() (Character.js:198, :606, Vampire.js:335) deep-save the _User
 * row and take a 403. `_finishFetch` does not.
 *
 * `_finishFetch` fires no Backbone change event (parse-compat/events.js wraps
 * `set` and `_handleSaveResponse`, not this), so EVERY CALLER MUST HYDRATE
 * BEFORE `collection.reset(...)`.
 */
hydrate: function (objects, key, missing) {
    var self = this;
    var models = objects.models || objects;
    var pointers = _.compact(_.map(models, function (o) { return o.get(key); }));
    if (0 === pointers.length) { return Parse.Promise.as(objects); }
    return self.prime(_.map(pointers, function (p) { return p.id; })).then(function () {
        _.each(pointers, function (p) {
            if (p.get("username")) { return; }
            var known = self.channel.reqres.request("get", p.id);
            // omit sessionToken: Parse.User.current().toJSON() carries it.
            p._finishFetch(known ? _.omit(known.toJSON(), "ACL", "sessionToken")
                                 : (missing || UNRESOLVED_USER));
        });
        return Parse.Promise.as(objects);
    });
},

/** One user, fresh, with today's reject-on-missing shape. */
get_user: function (id) {
    return Parse.Cloud.run("get_users_by_id", {ids: [id]}).then(function (payload) {
        var user = _.first(payload.users);
        if (!user) {
            return Parse.Promise.error(new Parse.Error(
                Parse.Error.OBJECT_NOT_FOUND, "That account is not available to you."));
        }
        return Parse.Promise.as(user);
    });
},
```

`Parse.Cloud.run` returns a `.then/.fail/.always` thenable: `parse-compat/thenable.js:56` lists `Cloud: ['run', …]` and the "stubborn delegate" at `:145-188` exists specifically because `Parse.Cloud.run` is a non-configurable getter. Eight call sites already rely on it.

`self.users.add(u)` is safe with a decoded `Parse.User` because `parse-compat/collection.js:182-196` patches `Backbone.Model[Symbol.hasInstance]`, so `_prepareModel` never reaches `new this.model(rawHash)` — the documented "768 `Invalid field name: _compatPending`" failure.

### 3.2 KIND 1 — the two full-table sweeps (→ `list_users`)

**Complete list:** `collections/Users.js:34-63`, `views/UsersView.js:17-30`, plus the eight `UserChannel.get_users()` callers at `mobileRouter.js:374, 390, 908, 976, 1011, 1046, 1073, 2309`.

**Worked example — `public/scripts/app/collections/Users.js:34-63`:**

```js
// BEFORE
fetch: function (options) {
    var self = this;
    var options = options || {};
    _.defaults(options, {add: true, update: true,
                         select: ["id", "username", "realname", "email"]});
    var q = new Parse.Query(self.model);
    if (options.update && 0 != self.models.length) {
        var allCreateds = _.map(self.models, "createdAt");
        allCreateds = _.sortBy(allCreateds);
        q.greaterThan("createdAt", _.last(allCreateds));
    }
    q.select.apply(q, options.select);
    var latest = [];
    return q.each(function (patronage) { latest.push(patronage); }).then(function () {
        if (options.add) { _.each(latest, function (l) { self.add(l); }); }
        else { self.reset(latest); }
        return Parse.Promise.as(self);
    })
}

// AFTER
// The createdAt watermark goes with the query. It derived its high-water mark
// from rows ALREADY LOADED (was :43-47), so the moment new signups became
// invisible it froze at the newest visible user and re-scanned an empty window
// forever - it could not even notice it was missing anyone.
// `self.scope` records which tier the server was willing to serve, so a caller
// can say WHY a list is short instead of rendering a mysterious blank.
fetch: function (options) {
    var self = this;
    options = options || {};
    _.defaults(options, {add: true});
    return Parse.Cloud.run("list_users").then(function (payload) {
        self.scope = payload.scope;
        if (options.add) {
            _.each(payload.users, function (u) { self.add(u); });
        } else {
            self.reset(payload.users);
        }
        return Parse.Promise.as(self);
    })
}
```

Also delete `self.query = new Parse.Query(self.model);` at `Users.js:13` — nothing reads it, and leaving it lets a stray `Parse.Collection.prototype.fetch` sweep `_User` again.

This one edit repairs all eight roster routes and therefore `PatronageListView.js:26-28`, `PatronageCSVListView.js:22-24` and `PatronageView.js:32-38` **with no edit to any of them**.

**`views/UsersView.js:17-30`** — delete the second sweep and say why the list is short:

```js
register: function (click_template) {
    var self = this;
    self.click_template = _.template(click_template);
    self.collection = [];
    return UserChannel.get_users().then(function (users) {
        self.collection = users.models;
        self.render();
        if ("all" !== users.scope) {
            // Was `console.log("No users? " + error.message)` at :28 - a refusal
            // that rendered an empty picker and said nothing.
            self.$el.find("div[role='main']").prepend(
                "<p class='message'>Only administrators and lead storytellers " +
                "can browse the account directory.</p>");
        }
    }, function (error) {
        self.$el.find("div[role='main']").text(error.message);
    })
}
```
Add `"../helpers/UserWreqr"` to its `define` list (`UsersView.js:2-7`). Both call sites (`mobileRouter.js:885-891`, `:2126-2132`) keep their `register("…<%= id %>")` contract unchanged.

**`mobileRouter.js:373-374`** — delete the `UserChannel.get_users()` call from `profile`:

```js
// BEFORE
self.enforce_logged_in().then(function () {
    return UserChannel.get_users();
}).then(function () {

// AFTER
// The directory sweep is gone. UserSettingsProfileView binds only
// Parse.User.current() (:27), and its patronage rows are all owned by the
// caller (:198) - which the ("user","get") handler now answers from
// Parse.User.current() with no network call. This removes one full-table _User
// sweep from the app's most-visited page.
self.enforce_logged_in().then(function () {
```

### 3.3 KIND 2 — the three by-id gets that REJECT the whole route

`Parse.Query.get()` is `equalTo('objectId', …)` + `first()` (`ParseQuery.js`), so it rejects with `OBJECT_NOT_FOUND` when the row is unreadable and the route dies before `changePage`.

**Complete list:** `mobileRouter.js:906` (`administration_user` — the click does nothing at all), `:940` (`administration_user_patronages` — bounces to home via `admin_route_failed`), `:2102` (`troupeeditstaff` — dead click, `.fail` only console.logs).

**Worked example — `mobileRouter.js:904-909`:**

```js
// BEFORE
self.enforce_logged_in().then(function () {
    return Parse.Promise.when(
        new Parse.Query("User").get(id),
        self.get_patronages(),
        UserChannel.get_users());
}).then(function (user, patronages, users) {

// AFTER
self.enforce_logged_in().then(function () {
    return Parse.Promise.when(
        UserChannel.get_user(id),
        self.get_patronages(),
        UserChannel.get_users());
}).then(function (user, patronages, users) {
```

`get_user` deliberately hits the server rather than reading the cached directory, for two reasons: it returns a **fresh** object, and `AdministrationUserView.register` dirties what it is handed (`user.set("admininterface", …)`, `AdministrationUserView.js:69`). Handing it the shared directory member would make a later `patronage.set("owner", users.get(id))` + `save()` drag a dirty `_User` into `unsavedChildren` and 403. It also preserves the `OBJECT_NOT_FOUND` rejection shape `mobileRouter.js:964`'s user-visible `admin_route_failed` tail depends on.

Identical substitution at `:940` and `:2102`.

### 3.4 KIND 3 — the nine `include("owner")` and the one `include("caster")`

**Delete the include; hydrate in the same function, before `reset`.** I grepped every `.include(` in `public/scripts/app` and confirmed these ten are the only `_User`-valued ones — everything else is `portrait` or a trait category.

**Complete list:** `mobileRouter.js:1265` (`get_troupe_characters`), `:1296` + `:1311` (`get_troupe_summarize_characters` — **one** hydrate after **both** queries), `:1345` + `:1354` (`get_administrator_characters` — one hydrate after both), `:1382` (`get_administrator_summarize_characters`), `models/Vampire.js:326`, `models/Werewolf.js:307`, `models/ChangelingBetaSlice.js:506`, `collections/ReferendumBallots.js:31`.

**Worked example — `mobileRouter.js:1262-1283`:**

```js
// BEFORE
var q = new Parse.Query(Vampire);
q.equalTo("troupes", troupe);
q.include("portrait");
q.include("owner");
p = q.each(function (character) {
    var shouldinclude = true;
    console.log(JSON.stringify(options));
    if (!options.includedeleted) {
        if (!character.has("owner")) { shouldinclude = false; }
    }
    if (shouldinclude) { c.push(character); }
}).then(function () {
    self.troupeCharacters.collection.reset(c);
})

// AFTER
var q = new Parse.Query(Vampire);
q.equalTo("troupes", troupe);
q.include("portrait");
// No include("owner"). parse-server DELETES an unreadable included pointer from
// the response (RestQuery.js:1161-1164 returns replace[objectId], which is
// undefined when the sub-query - run with the SAME auth, RestQuery.js:1082-1090
// - could not read it), and that erases the objectId too. Which makes a live
// character indistinguishable from an archived one three lines below, since
// `archive` is exactly "unset the owner" (models/Character.js:930-934).
// Left un-included the pointer survives intact, so has("owner") means only what
// it always meant; `hydrate` fills in the display fields from get_users_by_id.
p = q.each(function (character) {
    var shouldinclude = true;
    if (!options.includedeleted) {
        if (!character.has("owner")) { shouldinclude = false; }
    }
    if (shouldinclude) { c.push(character); }
}).then(function () {
    return UserChannel.hydrate(c, "owner");     // BEFORE reset - fires no event
}).then(function () {
    self.troupeCharacters.collection.reset(c);
})
```

**`get_troupe_summarize_characters` (`mobileRouter.js:1285-1332`) is the trap.** It feeds **one** array `c` from **two** sequential queries (`:1296` Werewolf, `:1311` Vampire) and resets once at `:1324`. Hydrate after the first query only and the Vampire half of every troupe summarize renders `(unknown)`, with no error and no failing test. The hydrate goes in the `p = p.then(...)` immediately before `collection.reset(c)`. Same shape for `get_administrator_characters` (`:1334-1368`).

**The three venue models — `public/scripts/app/models/Vampire.js:322-332`** (identical at `Werewolf.js:303-313`, `ChangelingBetaSlice.js:502-512`):

```js
// BEFORE
var q = new Parse.Query(Model);
q.include("portrait");
q.include("owner");
q.include("backgrounds");
q.include("extra_in_clan_disciplines");
return q.get(id).then(function(m) {
    character_cache._character = m;
    return Model.get_character(id, categories, character_cache);
});

// AFTER
var q = new Parse.Query(Model);
q.include("portrait");
q.include("backgrounds");
q.include("extra_in_clan_disciplines");
return q.get(id).then(function(m) {
    // Hydrate before caching: this path SAVES the character
    // (:337 `character_cache._character.save()`), so the owner pointer must
    // stay clean - see UserWreqr#hydrate.
    return UserChannel.hydrate([m], "owner").then(function () {
        character_cache._character = m;
        return Model.get_character(id, categories, character_cache);
    });
});
```
Add `"../helpers/UserWreqr"` to each model's `define` list.

**`collections/ReferendumBallots.js:27-39`** — the `caster`, with the sentinel that keeps the CSV byte-identical:

```js
// The literal marker at templates/referendum/options.html:26 is selected by
// `_.isUndefined(ballot.get("caster"))`, which is FALSE for a surviving
// pointer - so without this sentinel that line would print five columns of
// empty quotes instead of its own "USER DELETED" row.
var DELETED_CASTER = {username: "USER DELETED",
                      realname: "USER REALNAME DELETED",
                      email:    "USER EMAIL DELETED"};
...
var q = new Parse.Query(self.model).equalTo("owner", referendum);
// q.include("caster") deleted
var latest = [];
return q.each(function (ballot) { latest.push(ballot); }).then(function () {
    return UserChannel.hydrate(latest, "caster", DELETED_CASTER);
}).then(function () {
    self.reset(latest);
    return Parse.Promise.as(self);
})
```
Add `"../helpers/UserWreqr"` to its `define` list.

**Zero templates change.** `character-list-item.html:24-30`, `single-character-list-item.html:21-27`, `character-summarize-list-item.html:22-28`, both CSVs, `choose-user.html:8`, `troupe-staff-list.html:3`, `patronage-list-item.html`, `patronage-list-item-csv.html` and `referendum/options.html` are all untouched. This is deliberate and it is what protects `#characters?all`: `get_user_characters` (`mobileRouter.js:1232-1250`) **never had an `include("owner")`**, so today `has("owner")` is true, `get("owner").get("username")` is falsy, the `else` at `character-list-item.html:28` binds to the *outer* `if`, and nothing renders. Any design that rewrites those templates to add a marker prints it under every character of every player on the app's primary list. This one does not touch them.

### 3.5 KIND 4 — five `_Role`→`_User` relation reads. **Four need no Cloud code.**

`role.getUsers().query()` is a `_User` find: it is ACL-filtered, and under the C8 CLP closure it is refused outright — **including the two the surveys marked "safe because they scope to your own id"**. A relation query is still a `find`. All five must move.

| site | today | after |
|---|---|---|
| `models/Troupe.js:21-37` | 3 relation walks, no options bag | `Parse.Cloud.run("get_troupe_staff", …)` |
| `views/TroupeEditStaffView.js:74-98` | 3 `count()`s through the relation | one `_Role` query |
| `views/AdministrationUserView.js:180-190` | one relation sub-query **per role in the system** | one `_Role` query |
| `helpers/RoleWreqr.js:32-42` | same N+1, own id | one `_Role` query |
| `views/UserSettingsProfileView.js:184-194` | same N+1, own id | one `_Role` query |

**`models/Troupe.js:21-37`:**

```js
get_staff: function() {
    var self = this;
    return Parse.Cloud.run("get_troupe_staff", {troupe_id: self.id})
        .then(function (payload) {
            return Parse.Promise.as(payload.staff);
        });
},
```
`views/TroupeView.js:146-150` and `templates/troupe-staff-list.html` are unchanged — `get_troupe_staff` already stamps `role` into the returned JSON.

**`views/TroupeEditStaffView.js:74-98`** — the worst bug in the whole surface. A `count()` of an unreadable relation row returns 0, `:88-96` reads that as "not in this role", `:98` displays "Not on Staff", and an unchanged submit sends `roles_to_remove = ["LST","AST","Narrator"]` (`:139-151`), stripping a real storyteller of every role.

```js
// BEFORE
var roles = {};
return Parse.Promise.when(self.troupe.get_roles()).then(function (inroles) {
    roles = inroles;
    var promises = _.map(self.troupe.title_options, function (title) {
        var u = roles[title].getUsers();
        var q = u.query();
        q.equalTo("objectId", self.user.id);
        return q.count().then(function (count) { roles[title] = count; })
    });
    return Parse.Promise.when(promises);
}).then(function () {
    var role = _.findKey(roles, function (count) { ... });
    return Parse.Promise.as(role);
}).then(function (role) {
    self.user.set("role", role || "None");
    ...

// AFTER
// Ask _Role which titles this user holds, instead of asking each title's _User
// relation whether it contains them. Same answer for direct membership - which
// is exactly what change_troupe_staff manipulates (cloud/main.js:1214-1222) -
// but it reads no _User row, so enforcePrivateUsers is irrelevant to it. Same
// shape as views/AdministrationUserView.js:68-70 and mobileRouter.js:1471-1474.
// _Role is world-readable: _SCHEMA.json:17 grants find/get/count to '*' and
// every seeded row carries '*' in _rperm (database_seed/_Role.json).
var titles = self.troupe.title_options;      // ["LST","AST","Narrator"]
var names = _.map(titles, function (t) { return t + "_" + self.troupe.id; });
var q = new Parse.Query(Parse.Role);
q.containedIn("name", names);
q.equalTo("users", self.user);
return q.find().then(function (found) {
    var held = _.map(found, function (r) { return r.get("name").split("_")[0]; });
    // Fixed title order, not promise-resolution order: _.findKey over a
    // promise-populated object (was :88-96) picked nondeterministically for a
    // user holding two roles in one troupe.
    var role = _.find(titles, function (t) { return _.includes(held, t); });
    return Parse.Promise.as(role);
}).then(function (role) {
    self.user.set("role", role || "None");
    ...
```
Everything from `self.form = new Backform.Form({...})` onward, and the submit at `:139-151`, is unchanged.

**`views/AdministrationUserView.js:180-190`, `helpers/RoleWreqr.js:32-42`, `views/UserSettingsProfileView.js:184-194`** all collapse to the same three lines (shown for `AdministrationUserView`; the other two substitute `Parse.User.current()` for `user` and their own collection for `self.roles`):

```js
// BEFORE: one relation sub-query per role in the entire system
var q = new Parse.Query(Parse.Role);
q.each(function (role) {
    var users_relation = role.getUsers();
    var uq = users_relation.query();
    uq.equalTo("objectId", user.id);
    return uq.each(function (user) { self.roles.add(role); })
        .fail(function (error) { console.log("Failed in promise for " + role.get("name")); });
});

// AFTER: one query, no _User read
var q = new Parse.Query(Parse.Role);
q.equalTo("users", user);
q.each(function (role) { self.roles.add(role); })
 .fail(function (error) {
     console.log("Couldn't list this user's roles: " + error.message);
 });
```

### 3.6 KIND 5 — one write-path fix, unrelated to the roster

**`mobileRouter.js:1078`:**

```js
// BEFORE - `users.get(userid)` is undefined for any user the roster did not
// contain, which saved a Patronage with NO owner and no error. And when it IS
// found it is the shared, possibly-dirty directory member, which
// unsavedChildren then deep-saves into _User on patronage.save().
patronage.set("owner", users.get(userid));

// AFTER - the route parameter is the authority; the roster never was.
patronage.set("owner", new Parse.User({id: userid}));
```
Verified: `new Parse.User({id})` is not dirty and is skipped by `unsavedChildren`; `views/PatronageView.js:85` already uses this idiom.

### 3.7 Explicitly untouched

`Parse.User.current()` reads app-wide; `_Role` queries constrained by a user pointer at `mobileRouter.js:311`, `:1471-1474`, `views/AdministrationUserView.js:68-71`; `cloud/Troupe.js#get_staff` (still has no server-side caller — leave it dead; lifting it would return dirty users, i.e. bare pointers).

---

## 4. Landing order

Eleven commits. C1–C7 are the refactor; C8–C10 are the closure and need separate sign-off; C11 is the pin and belongs to whoever owns `index.js`.

**Deliberately not touched anywhere in this plan** (concurrently edited): `index.js`, `gulpfile.js`, `public/scripts/app/siteconfig.js`, `public/scripts/app/testsiteconfig.js`, `audit_db_permissions.js`, `test/gate.test.js`, `docs/runbooks/s10-post-migration-handoff.md`.

| # | commit | files | revertible from | why here |
|---|---|---|---|---|
| **C0** | `test(seed): a _User row that is actually private` | `seed_db.js` | delete one array entry | **First and alone.** The only oracle this refactor can have. |
| **C1** | `feat(cloud): user identity behind three master-keyed functions` | `cloud/main.js` (append after `:1104`), `test/user-directory.test.js` (new) | delete the block | Nothing calls them. Deploy is a literal no-op. |
| **C2** | `refactor(client): the user directory comes from list_users` | `helpers/UserWreqr.js`, `collections/Users.js`, `views/UsersView.js`, `mobileRouter.js:374` | one file group | Highest leverage: three files repair eight roster routes, both patronage list templates, the CSV and the owner `<select>` untouched. |
| **C3** | `refactor(client): resolve character owners out of band, not by include()` | `mobileRouter.js` (6 deletions, 4 hydrates), `models/Vampire.js`, `Werewolf.js`, `ChangelingBetaSlice.js` | back to includes | **The load-bearing commit.** Also the one that repairs `get_me_acl`, the roster drop, the playable filter and `_check_character_mismatch`. Depends on C1+C2. |
| **C4** | `refactor(client): the three by-id user reads` | `mobileRouter.js:906, 940, 2102` | three lines | Turns three dead routes into three legible refusals. |
| **C5** | `refactor(client): role membership stops reading _User` | `models/Troupe.js`, `TroupeEditStaffView.js`, `AdministrationUserView.js`, `RoleWreqr.js`, `UserSettingsProfileView.js` | one file group | Ships a fix on its own: TroupeEditStaffView stops silently stripping a real storyteller of every role. |
| **C6** | `refactor(client): the referendum ballot caster` | `collections/ReferendumBallots.js` | one file | Keeps `referendum/options.html:26` byte-identical via the sentinel. |
| **C7** | `fix(routes): a new patronage takes its owner from the route` | `mobileRouter.js:1078` | one line | Independent; removes an ownerless-write and a deep-save. |
| **C8** | `build(schema): close _User find and count to clients` | `database_seed/_SCHEMA.json` line 19 | rewrite the CLP | **Lands after all client work** so a `_User` query I failed to find shows up as a functional bug in staging while it is still recoverable, rather than as a sanitized "Permission denied" naming neither class nor reason. **Needs sign-off.** |
| **C9** | `chore(ops): close public read on existing _User rows` | `close_user_acls.js` (new, repo root beside `seed_db.js`), `docs/runbooks/enforce-private-users.md` (new) | the snapshot collection **only** | The step that actually closes the exposure for the 382 existing accounts. **Needs sign-off. Irreversible without the snapshot.** |
| **C10** | ops: reconcile the CLP into production | none | rewrite the CLP | `seed_db.js:114` imports `database_seed/` only into an empty `_User`, so C8 never reaches production by itself — the failure mode `docs/runbooks/production-clp-remediation.md:13-30` documents. Use the existing CLP reconciler; I did not read it (concurrently owned) so this step is **named, not specified**. |
| **C11** | `feat(server): enforcePrivateUsers pinned` | `index.js`, one line, alone | one line | **Sequence with the workflow that owns `index.js`; do not fold it into their commit.** If the flag is already at its default, this is documentation and the whole ladder above is already load-bearing today. |

**C0 in detail.** Add a fifth entry to `TEST_USERS` (`seed_db.js:40-45`) — `sampprivate`, with a `realname` and an `email` — and branch `seedTestUsers` (`:57-70`) so that account is written with `_rperm: [u.id]` and `_acl: {[u.id]: {w:true,r:true}}` and **no `'*'` entry**. Give it one character in the seeded troupe. It reproduces the whole failure class **with the flag off**, because the ACL is written by the raw driver rather than through `RestWrite`. Land it alone and run the full suite on it: any spec asserting an exact account count in the picker or the admin user list will fail, and that is the fixture doing its job. Fixing those counting specs belongs in C0, not in C3 where the same failure would be indistinguishable from a missed include.

**C9 in detail — the irreversible one.** For every `_User` row: snapshot `{_id, _rperm, _wperm, _acl}` into `_yorick_user_acl_backup` **first**, then remove `'*'` from `_rperm` and from `_acl`, ensuring `_rperm` still contains the row's own objectId (matching `RestWrite.js:1387-1390`). Idempotent; `--dry-run` prints counts and changes nothing, and its output goes in the runbook before the real run. **The failure mode if the rewrite drops the row's own id is total and silent, and I traced it:** login's sanitizing re-fetch goes through `rest.get` under a non-master auth built from that user (`UsersRouter.js:303-315`); the ACL denies it; `:321-333` falls through to `filteredUser = { objectId: user.objectId }` and attaches the session token anyway — the source comment says *"The session token is still attached below so login succeeds."* Every account is then simultaneously logged in with an attribute-less current user: `Parse.User.current().get("admininterface")` is undefined, every gate closes, and it presents as a client bug. **The snapshot is not optional.**

**C8 in detail — what stays open.** Set `"find": {}` and `"count": {}`. Leave `get`, `create`, `update`, `delete`, `addField` **exactly as they are.** Verified safe: login's user lookup runs under `Auth.maintenance` (`UsersRouter.js:116`) and its re-fetch through `rest.get`, i.e. the `get` CLP — **closing `get` triggers the objectId-only-login catastrophe above**; signup POSTs to `users` (create); own-row saves PUT to `classes/_User/:id` (update); `Parse.User.current().fetch()` is a `get`; Facebook/authData login calls `config.database.find('_User', …)` with no auth argument (`Auth.js:494-498`), which `DatabaseController` treats as master; and master-keyed Cloud code bypasses CLP entirely (`DatabaseController.js:1215`).

---

## 5. What can be tested here, and what cannot

### 5.1 What I proved by running code (not by the suite)

These are the in-process results against the installed SDKs. Re-run them if anyone doubts the design; they take seconds.

```
Parse.Object.fromJSON({className:'_User',objectId:'abc',username:'sam',realname:'Sam R'})
  -> ctor ParseUser, instanceof Parse.User true, dirty false,
     serverData {"username":"sam","realname":"Sam R"}
  -> Parse._encode gives {"username":...,"realname":...,"objectId":...,
                          "__type":"Object","className":"_User"}
  -> after one .set(): {"__type":"Pointer","className":"_User","objectId":"abc"}
     (the silent-blank failure, encode.js:29)

character with a BARE owner pointer:
  has("owner") true, _.isUndefined(owner) false,
  new Parse.ACL().setReadAccess(owner,true) -> {"u44":{"read":true}}
  pointer._finishFetch({username:...}) -> pointer dirty false,
                                          parent dirty false, unsavedChildren 0
  pointer.set("username",...)           -> unsavedChildren 1   <-- the 403

Parse.Object.fromJSON({...,sessionToken:'r:tok'}).getSessionToken() -> 'r:tok'
  (so request.user.getSessionToken() is populated; and so a returned
   request.user would leak it)
```

### 5.2 What the suites CAN grade

- **The projection, which is the single line that turns a master-key read into a leak.** Use the harness that already exists — `test/trigger-compat.test.js:61-72` loads cloud code against a capturing fake `Parse.Cloud` with `define: () => {}`. In `test/user-directory.test.js`, drive `identity_of` with an input object carrying `email`, `authData`, `password`, `sessionToken`, `ACL` and `_hashed_password`, and assert the returned key set is **exactly** `{objectId, username, realname, massmailauthorization, acceptedtos}` (plus `role` where applicable). This asserts a **shape, not a value**, so it works despite no seeded account having an email. It is the only mechanical guard against a future leak.
- **`caller_scope` role-name parsing**, driven with a fake role list: bare `"LST"`/`"AST"`/`"Narrator"` give `is_lead === false`; `"LST_x"` gives true; a caller holding only `"Administrator"` gives `is_admin true, is_lead false`, forcing every clause through the short-circuit.
- **Arity**: `assert.strictEqual(fn.length, 2)` on each registered function, pinned to the comment about `FunctionsRouter.js:341-350`. Cheap, and it stops someone "simplifying" the signature back into the hang.
- **The rehydration round trip**, in Karma: after `UserChannel.hydrate(chars, "owner")`, assert `pointer.get("username")` answers, `character.dirty() === false`, and **`character.dirty("owner") === false`**. That last one is the guard against someone later "simplifying" `_finishFetch` into `set`.
- **CSV column arity**: compile each of `character-summarize-list-item-csv.html`, `-csv-header-grouped.html` and `patronage-list-item-csv.html` against a resolved owner, the `UNRESOLVED_USER` sentinel, and an absent owner, and assert identical quoted-field counts across all three. Nothing else in the suite guards this, and it is the one change that can break a downstream spreadsheet.
- **Each clause, per role**, via `Parse.Cloud.run` from the browser suite — the tree already does exactly this at `public/scripts/app/tests/troupe-test.js:81`. `list_users` returns `scope:"all"` for `devuser` and `scope:"self"` with one row for `sampmem`/`sampstranger`; logged out rejects; `get_users_by_id` with `ids: 'nope'` and with 201 ids returns the two parameter errors.
- **With C0's fixture**: as `sampast`, `#troupe/:id/characters/all` **contains** `sampprivate`'s character (proving the include deletion fixed the vanishing at `mobileRouter.js:1269-1272`) and shows the owner's name (proving clause 4); as `sampmem`, it does not appear (the character ACL, unchanged). Label it in the spec as a **fabricated** fixture, not a real signup.

### 5.3 What can ONLY be hand-tested against a deployed backend

These are the only evidence for the parts nothing here can reach. Do them in this order; each line says what it proves and nothing more.

1. **Does the running server strip `email`?** Log in as `sampmem`, evaluate `new Parse.Query(Parse.User).get('<devuser id>')` **before C8 lands**, and look at whether `email` comes back. *Proves:* whether clause 5 is a no-op or a visible removal from four admin exports. The suite cannot settle this — no seeded account has an email — and I could not settle it by reading, because `index.js` is off-limits. **Repeat against greensboro**, which has diverged from `main` since Jan 2020.
2. **Does a real signup actually go private?** Sign up through `views/SignupView.js:53` on a running server, then read that row from a **different** session. *Proves:* `RestWrite.js:1373-1392` behaves as read. Nothing in the suite completes a signup; this is the only exercise of the flag itself.
3. **The highest-value single check.** Give the account from (2) a character, put it in a troupe. From a different session, as a **storyteller of that troupe**, open `#troupe/:id/characters/all`. *Proves:* before C3 the character is **absent**; after C3 it is present with the owner's name. This one surface exercises the include deletion and the hydrator together.
4. **The silent, destructive one.** As that storyteller, open the same character's sheet and edit one trait. Then confirm the **player** can still open their own sheet. *Proves:* `get_me_acl` (`Character.js:111-118`) is no longer rewriting the trait ACL to the storyteller. Invisible to every automated check the suite can run.
5. **`#troupe/:id/staff/edit/:uid`** for a staffer who signed up after the flag: the select shows their **actual** role, not "Not on Staff". Then submit unchanged and confirm they still hold it. *Proves:* C5 fixed the role-stripping at `TroupeEditStaffView.js:139-151`.
6. **`#troupe/:id`** as an ordinary player: the staff list is populated. *Proves:* `get_troupe_staff` replaced the client-side relation walk correctly.
7. **`#profile`** as an ordinary paying player: patronage rows show their name, **not** `<objectId> User object missing`. *Proves:* the clause-1 self-answer works and that deleting the `profile` directory sweep was safe. This is the surface two of the three candidate designs would have broken permanently.
8. **`--dry-run` of `close_user_acls.js` against production**, output pasted into the runbook. *Proves:* the gradual-degradation premise — that the 382 legacy rows really do carry `_rperm: ['*']`. I could not confirm the real dump's shape; `toimport/` is off-limits and `seed_db.js:64` only fabricates it for tests.
9. **After C8, in staging**, as `sampmem`: `new Parse.Query(Parse.User).find()` rejects with code 119, `count()` likewise, **and** `Parse.User.current().fetch()` still succeeds, **and** a fresh login returns a user carrying `username`. *Proves:* the CLP closed `find` without triggering the objectId-only-login catastrophe. Add all four as assertions in `e2e/access-control.spec.js`.

### 5.4 Accepted risks, stated plainly

- **`hydrate` is enforced by convention.** A character query added later renders `(unknown)` with no error and no failing test. Mitigated by putting the hydrate in the same function that lost the include (so a route reusing `get_troupe_characters` gets it free) and by the sentinel preserving CSV arity, but not eliminated. The stricter alternative — moving the character queries into Cloud code — costs ten query sites and gives up client-side ACL filtering of the character rows. Not done.
- **`_finishFetch` is an SDK private**, and it lives in `helpers/UserWreqr.js` rather than in `public/scripts/lib/parse-compat/`, where this repo documents its other SDK privates. That is a minimal-touch choice, not the tidier one; moving it is a fifteen-line follow-up.
- **`prime` caches negatively for the page's lifetime.** If a role is granted mid-session the caller keeps seeing `(unknown)` until reload. Chosen over an unbounded retry loop across a 2,857-row list.
- **`allowed_identity_ids` lets a plain player force a bounded `Vampire` scan** (≤200 owner pointers, ACL-filtered). Acceptable; it is also the least-exercised path in the design and has no fixture.
- **`list_users` has no pagination.** At 382 accounts and four short fields that is tens of kilobytes; the incremental watermark was deleted because it was broken, not fixed. That judgement expires as the table grows.

---

## 6. Owner decisions — SETTLED 2026-08-20

All six are answered. D1 was settled by inspection; D2 through D5 by the owner;
D6 is deferred and named. Where an answer changes the design above, the change
is stated here and the section above has NOT been rewritten to match — read this
section as the authority.

**D1. Is `enforcePrivateUsers` already on? — YES, settled by inspection.**
The option appears nowhere in the repo outside `docs/`, and the installed server
defaults it `true` (`Options/Definitions.js:265-270`). The degradation has been
live in every environment running 9.10.0 since the bump landed, so **C1-C7 are
urgent rather than preparatory**. `index.js` now pins it explicitly at `214f962`,
which writes the behaviour down without changing it.

**D2. Email in the exports — NO. `IDENTITY_INCLUDES_EMAIL` stays FALSE.**

Answered "restore them" first, then corrected by the owner once the mechanism
was clear: *"I did not mean to create any new capabilities around email that do
not exist today."* The correction is the decision.

The premise of the first answer was that these exports used to carry addresses
and had lost them. They did not. parse-server withholds `email` from every
non-owner read on its own — `protectedFields` defaults to
`{_User: {'*': ['email']}}` and is computed only for non-master callers — so no
browser caller can see another member's address today, and none could before the
migration either. The Cloud functions read under the master key, which bypasses
that filter, so returning `email` would have handed out addresses no route in
the app currently exposes. An expansion, not a restoration.

A member's own address is unaffected and always was: the caller's own row comes
from `Parse.User.current()`, never through these functions.

If an admin export is ever meant to carry addresses, that is a deliberate
product change, and `IDENTITY_INCLUDES_EMAIL` is the one line — but it wants
deciding on its own terms.

**D3. Who sees the account directory — ANY STORYTELLER, not just leads.**
Owner decision, and it **overrides clause 3 and clause 6 as written above.**
Take the alternative §6 offered: in `caller_scope`, `is_lead` becomes
`is_admin || <holder of any troupe role>` — Administrator, SiteAdministrator,
`LST_*`, `AST_*` and `Narrator_*` all get the full directory.

What this means for the rest of the design:

- **Clause 6 is withdrawn.** No real user loses the account picker. The one
  capability removal in the whole plan is gone, which also removes the need for
  the explanatory note on a one-entry picker.
- **Only plain players lose the directory**, and they never had a legitimate use
  for it — today any logged-in player can pull all 382 members with real names,
  gated only in the browser (`helpers/UserWreqr.js`).
- **Still match on the `_` prefix**, never the bare generic roles. `LST`, `AST`
  and `Narrator` without a troupe suffix are held by every current AND FORMER
  storyteller org-wide (`cloud/main.js` adds them via `get_generic_roles()`), so
  matching them would hand the directory to people who have not staffed a troupe
  in years. `LST_*` / `AST_*` / `Narrator_*` is the test.
- Clause 4 is unaffected: who may be told a character's owner is still derived
  from who may read the character, by re-running the query as the caller.

**D4. The production ACL backfill (C9) — APPROVED.** Close public read on the
existing 382 rows, so the population ends up uniform and a bug reproduces for
everyone or for no one, rather than the table slowly splitting into old-public
and new-private. Approved **with the discipline in §4 intact and not optional**:
snapshot `{_id, _rperm, _wperm, _acl}` into `_yorick_user_acl_backup` first,
`--dry-run` before that with its output pasted into the runbook, and the rewrite
must leave each row's own objectId in `_rperm`. §4's C9 note traces what happens
if it does not: login still succeeds and hands back an attribute-less user, every
gate closes, and it presents as a client bug.

**D5. The `_User` CLP closure (C8) — APPROVED.** Owner asked the right question
first: *does parse-dashboard still work?* **Yes, and it is unaffected by C8, C9
and D2 alike.** parse-dashboard authenticates with the master key, and in the
installed server the master key skips all three gates on the same `find` path in
`DatabaseController.js`:

- the CLP check - `isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, op)`
- the ACL filter - `if (!isMaster) { query = addReadACL(query, aclGroup); }`, so no `_rperm` term is added
- the `email` strip - `filterSensitiveData` returns early: `if (!isUserClass || isMaster) { return object; }`

`isMaster` is `acl === undefined`, which is what a master-key request produces.
`/serverInfo`, which the dashboard probes on connect, is still routed in 9.10.0
(`Routers/FeaturesRouter.js`) behind `promiseEnforceMasterKeyAccess`.

The dashboard is being updated separately, on its own track — it deploys as
`greensboro-dashboard`, a second Heroku app running from `ProcfileDashboard`
(`web: npm run dashboard`), and that upgrade is not a prerequisite for anything
in this document. Recorded only so the next reader knows the master-key answer
above was checked against a dashboard that is in live use, not a hypothetical
one.

**D6. Is `#patronage/:id` meant to be player-visible? — DEFERRED, not decided.**
It stays login-only in this plan. `views/PatronageView.js` is an
owner-select-plus-save editor a player can never save, since `Patronage` `update`
is `role:Administrator`. Making it admin-only is one line; giving players a
read-only view is separate work. Neither is a prerequisite for C1-C11.
