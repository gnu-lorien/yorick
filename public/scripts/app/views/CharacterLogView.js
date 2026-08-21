// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "moment",
    "../models/VampireChange",
    "../collections/VampireChangeCollection",
    "../models/Vampire"
], function( $, Backbone, moment, VampireChange, VampireChangeCollection, Vampire) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            var self = this;
            this.collection = new VampireChangeCollection;
            self.listenTo(self.collection, "add", self.render);
            self.listenTo(self.collection, "reset", self.render);

            self.start = 0;
            self.changeBy = 10;
        },

        /**
         * The page this view is *supposed* to be showing, read from the URL.
         *
         * `this.start` is memoised across registrations and cannot be trusted
         * on its own. Two registrations can be in flight at once - a reload
         * replays whatever hash the page loaded with, and an explicit
         * navigation adds a second - and because each one kicks off an async
         * fetch, the later-resolving one wins even when it is the stale one.
         * Observed live: `register(start=0)` then `register(start=20)` 9ms
         * apart while the hash read `/log/0/10`, leaving `this.start` at 20
         * with page 0 in the URL. The Next button then computed 20 + 10 and
         * navigated to page 3.
         *
         * The hash is the one thing that is unambiguously current, so paging
         * is computed from it and falls back to the memoised value only when
         * the current route is not a log route at all.
         */
        startFromUrl: function() {
            var m = /#character\/[^\/]+\/log\/(\d+)\/(\d+)/.exec(window.location.hash || "");
            return m ? _.parseInt(m[1]) : this.start;
        },

        /** Whether the current hash is a log route at all. */
        isLogRoute: function() {
            return /#character\/[^\/]+\/log\/(\d+)\/(\d+)/.test(window.location.hash || "");
        },

        changeByFromUrl: function() {
            var m = /#character\/[^\/]+\/log\/(\d+)\/(\d+)/.exec(window.location.hash || "");
            return m ? _.parseInt(m[2]) : this.changeBy;
        },

        register: function(character, start, changeBy) {
            var self = this;
            var changed = false;
            start = _.parseInt(start);
            changeBy = _.parseInt(changeBy);

            // Drop a registration the URL has already moved past.
            //
            // Two registrations can be in flight at once. A full reload
            // replays whatever hash the document loaded with, and an explicit
            // navigation immediately afterwards adds a second - so the router
            // can call this with the *old* page after it has already called it
            // with the new one. Observed live: start=0 then start=20, 9ms
            // apart, with the hash reading /log/0/10 throughout. The stale
            // call won, so the table rendered page 2 underneath a page-0 URL
            // and the Next button paged from 20 instead of 0.
            //
            // The hash is authoritative. If this call disagrees with it, the
            // route it came from is no longer the current one, so honouring it
            // would be showing the user a page they have already navigated
            // away from.
            // Two ways this call can be superseded, and both must be caught.
            //
            // The first `isLogRoute()`-gated version of this guard only caught
            // the case where the URL is still a log route but names a different
            // page. It did nothing when the user had navigated somewhere else
            // entirely, which is the more damaging case: a stale log
            // registration arriving while the hash reads
            // `#character/<id>/rename` still ran, still fetched, and still
            // re-rendered - and `render()` calls `enhanceWithin()`, which
            // touches jQuery Mobile in the middle of the rename transition.
            // That is how a navigation ends up with its hash updated and the
            // log still on screen.
            if (!self.isLogRoute()) {
                // The current route is not the log at all, so this handler's
                // route has already been navigated away from.
                return self;
            }
            if (start !== self.startFromUrl()) {
                // Still the log, but a page the URL has moved past.
                return self;
            }

            if (start != self.start) {
                self.start = start;
                changed = true;
            }

            if (changeBy != self.changeBy) {
                self.changeBy = changeBy;
                changed = true;
            }

            if (character !== self.character) {
                if (self.character)
                    self.stopListening(self.character);
                self.character = character;
                self.listenTo(self.character, "change:change_count", self.update_collection_query_and_fetch);
                changed = true;
            }

            // R30: this used to refetch only `if (changed)` - that is, only
            // when `start`, `changeBy` or the character reference differed from
            // last time. "Read the log, act, read the log again" passes the
            // identical parameters both times, so the second read silently
            // returned the rows from before the action. Entering the log page
            // is a request to see the log as it is now; always ask.
            self.update_collection_query_and_fetch();

            return self;
        },

        events: {
            "click .previous": "previous",
            "click .next": "next",
            "click .hackupdateowner": "hackupdateowner",
            "click .hackdeleteoriginal": "hackdeleteoriginal"
        },

        previous: function() {
            var self = this;
            var changeBy = self.changeByFromUrl();
            var incr = self.startFromUrl() - changeBy;
            this.start = _.max([0, incr]);
            window.location.hash = "#character/" + self.character.id + "/log/" + this.start + "/10";
            $.mobile.loading("show");
            this.update_collection_query_and_fetch().then(function() {
                $.mobile.loading("hide");
            })
        },

        next: function() {
            var self = this;
            this.start = self.startFromUrl() + self.changeByFromUrl();
            window.location.hash = "#character/" + self.character.id + "/log/" + this.start + "/10";
            $.mobile.loading("show");
            this.update_collection_query_and_fetch().then(function() {
                $.mobile.loading("hide");
            })
        },

        hackupdateowner: function() {
            var self = this;
            var suspects = [];
            var thisd = moment(new Date("Sat Jun 18 2016 09:27:53 GMT -400 (Eastern Daylight Time)"));
            _.forEachRight(self.collection.models, function (vc, i) {
                var ca = moment(vc.createdAt);
                if (ca.isSame(thisd, 'day')) {
                    suspects.push(vc);
                }
            });
            self.collection.reset(suspects);
            Vampire.get_character("RT8FXNL8P2").then(function (newOwner) {
                _.each(suspects, function (s) {
                    s.set("owner", newOwner);
                });
                return Parse.Object.saveAll(suspects);
            }).then(function () {
                console.log("Saved");
            }).fail(function (error) {
                console.error(error.message);
            });
            /*
            Parse.Object.saveAll(suspects).then(function () {
                console.log("Saved");
            }).fail(function (error) {
                console.error(error.message);
            })
            */
        },

        hackdeleteoriginal: function() {
            var self = this;
            var suspects = [];
            var thisd = moment(new Date("Sat Jun 18 2016 09:27:53 GMT -400 (Eastern Daylight Time)"));
            _.forEachRight(self.collection.models, function (vc, i) {
                var ca = moment(vc.createdAt);
                if (ca.isSame(thisd, 'day')) {
                    suspects.push(vc);
                }
            });
            self.collection.reset(suspects);
            Parse.Object.destroyAll(suspects).then(function () {
                console.log("Deleted");
            }).fail(function (error) {
                console.error(error.message);
            });
            /*
            Parse.Object.saveAll(suspects).then(function () {
                console.log("Saved");
            }).fail(function (error) {
                console.error(error.message);
            })
            */
        },

        update_collection_query_and_fetch: function () {
            var self = this;
            var options = {reset: true};
            var q = new Parse.Query(VampireChange);
            q.equalTo("owner", self.character).addDescending("createdAt");
            q.skip(self.start);
            q.limit(self.changeBy);
            self.collection.query = q;
            return self.collection.fetch(options);
        },

        format_entry: function(log, entry) {
            // See CharacterApprovalView.format_entry: a recorded 0 must not
            // render as an empty cell.
            if (log.has(entry)) {
                var v = log.get(entry);
                return _.isDate(v) ? moment(v).format('lll') : v;
            }
            var attr = log[entry];
            if (_.isDate(attr)) {
                return moment(attr).format('lll');
            }
            return attr;
        },

        // Renders all of the Category models on the UI
        render: function() {
            // Sets the view's template property
            this.template = _.template(
                $( "script#characterLogView" ).html())(
                { "character": this.character,
                  "logs": this.collection.models,
                  "format_entry": this.format_entry} );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );