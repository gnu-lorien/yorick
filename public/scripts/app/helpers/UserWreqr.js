define([
    "jquery",
    "underscore",
    "parse",
    "backbone",
    "marionette",
    "../collections/Users",
], function( $, _, Parse, Backbone, Marionette, Users ) {

    /**
     * A pointer nothing could resolve.
     *
     * It is a VALUE and not a blank because the three CSV templates emit their
     * identity columns only INSIDE `if (e.get("owner").get("username"))` -- see
     * character-summarize-list-item-csv.html -- so a falsy username makes them
     * emit NO columns at all, shifting every later column in the row. That
     * branch is unreachable today and becomes reachable the moment a hydrate is
     * missed, so this is the guard against a silent CSV corruption rather than
     * decoration.
     */
    var UNRESOLVED_USER = {username: "(unknown)", realname: "", email: ""};

    var UserHelper = Backbone.Model.extend({
        initialize: function() {
            var self = this;

            self.channel = Backbone.Wreqr.radio.channel('user');
            self.users = new Users;
            // Ids the server has already been asked about, whether or not it
            // answered. Caching the MISSES is what stops a roster full of
            // unreadable owners re-asking on every render.
            self.asked = {};

            // The caller's own row is always readable -- parse-server writes
            // ACL[objectId] = {read:true,write:true} even under
            // enforcePrivateUsers -- and Parse.User.current() already holds it.
            // Answering from there means #profile needs no directory call at
            // all: its patronage rows resolve identity through THIS handler,
            // and patronage-list-item.html prints "<objectId> User object
            // missing" on a miss, which every paying member would otherwise see
            // on their own profile.
            Backbone.Wreqr.radio.reqres.setHandler("user", "get", function (id) {
                var current = Parse.User.current();
                if (current && current.id === id) { return current; }
                return self.users.get(id);
            })
            Backbone.Wreqr.radio.reqres.setHandler("user", "all", function () {
                var is_st = Parse.User.current().get("storytellerinterface");
                var is_ad = Parse.User.current().get("admininterface");
                if (is_ad || is_st) {
                    return self.users;
                } else {
                    var onlyone = new Users;
                    onlyone.models.push(self.users.get(Parse.User.current().id))
                    return onlyone;
                }
            })
        },
        get_users: function() {
            var self = this;
            var options = options || {};
            _.defaults(options, {update: true});
            return self.users.fetch();
        },

        /**
         * Ask the server about ids the registry has never asked about.
         *
         * Batched at the Cloud function's own cap. Ids that come back withheld
         * are still marked asked, so an unreadable owner costs one request per
         * page load rather than one per render.
         */
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
         * This is what replaces `include("owner")`. parse-server only deletes an
         * unreadable pointer when it was asked to EXPAND it, so dropping the
         * include leaves the raw pointer intact and this puts the names back.
         *
         * `_finishFetch` is an SDK private and it is used on purpose: it is the
         * exact step `Parse.Object.fromJSON` performs when the SDK itself
         * decodes an included pointer, so this REPRODUCES what the include used
         * to do rather than imitating it. It writes only serverData and
         * objectCache and creates no pending ops.
         *
         * Do not "simplify" it to `.set()`. Verified in-process against the
         * installed SDK, and this is the hinge of the whole design:
         *
         *     _finishFetch -> parent dirty false, unsavedChildren 0
         *     .set()       -> parent dirty false, unsavedChildren 1   <-- trap
         *
         * `unsavedChildren` collects any DIRTY child that has an id, so a
         * `.set()` here would make the next character.save() deep-save the
         * `_User` row and take a 403 -- on a save the user did not make, about a
         * row they cannot write.
         *
         * `_finishFetch` fires no Backbone change event, so EVERY CALLER MUST
         * HYDRATE BEFORE `collection.reset(...)`.
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
                    // omit sessionToken: Parse.User.current().toJSON() carries it,
                    // and the self-answer above can hand back exactly that object.
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

        get_latest_patronage: function(user) {
            var q = new Parse.Query("Patronage")
                .equalTo("owner", user)
                .descending("expiresOn");
            var patronage;
            return q.first().then(function (p) {
                patronage = p;
            }).always(function () {
                return Parse.Promise.as(patronage);
            })
        },
    });

    return new UserHelper;
} );
