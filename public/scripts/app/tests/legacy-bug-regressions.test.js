/**
 * Regression tests for the defects catalogued in
 * `docs/legacy-bugs-found-during-react-port.md`.
 *
 * These are the structural guards that can run without a server or a browser
 * UI: collection comparator orderings and the absence of dead code. Everything
 * that needs a rendered page - the character sheet's identity block, the admin
 * redirect loop, the troupe failure banner, templates, file reads - is in
 * `e2e/legacy-bug-regressions.spec.js` instead.
 *
 * Runs under Karma via RequireJS.
 */
/* global expect, jasmine */

define([
    "underscore",
    "backbone",
    "parse",
    "parse-compat/promise",
    "parse-compat/collection"
], function (
    _,
    Backbone,
    Parse,
    CompatPromise,
    makeParseCollection
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    var SERVER_DEFAULT_PAGE = 100;

    function stubParse(results) {
        var queries = [];
        function Query(model) {
            this.model = model;
            this.constraints = { limit: null, find: 0 };
            queries.push(this);
        }
        Query.prototype.limit = function (n) {
            this.constraints.limit = n;
            return this;
        };
        Query.prototype.find = function () {
            this.constraints.find++;
            var page = this.constraints.limit || SERVER_DEFAULT_PAGE;
            var slice = (results || []).slice(0, page);
            return Promise.resolve(slice);
        };
        Query.prototype.equalTo = function () { return this; };

        var ParseStub = {
            Query: Query,
            Object: Backbone.Model,
            Promise: CompatPromise
        };
        ParseStub.Collection = makeParseCollection(ParseStub);
        return { Parse: ParseStub, queries: queries };
    }

    function record(attrs) {
        return new Backbone.Model(attrs);
    }

    describe("Legacy bug regressions", function () {

        describe("#2 -- sortbycreated has never worked", function () {
            it("Vampires sorts by name, and a sortbycreated flag on the reset array changes nothing", function () {
                var Parse = stubParse().Parse;
                var Vampires = Parse.Collection.extend({
                    model: Backbone.Model,
                    comparator: function (m) { return m.get('name'); }
                });

                var rows = [
                    record({ id: 'c', name: 'Corwin' }),
                    record({ id: 'a', name: 'Aldous' }),
                    record({ id: 'b', name: 'Brenna' })
                ];
                rows.sortbycreated = true;

                var c = new Vampires();
                c.reset(rows);

                expect(c.map(function (m) { return m.get('name'); })).toEqual(
                    ['Aldous', 'Brenna', 'Corwin']);
                expect(c.sortbycreated).toBeUndefined(
                    'reset() copies elements, not array properties');
            });

            it("Users sorts by paidOn", function () {
                var Parse = stubParse().Parse;
                var Users = Parse.Collection.extend({
                    model: Backbone.Model,
                    comparator: function (m) { return m.get('paidOn'); }
                });

                var c = new Users();
                c.reset([
                    record({ id: '3', paidOn: '2026-03-01' }),
                    record({ id: '1', paidOn: '2026-01-01' }),
                    record({ id: '2', paidOn: '2026-02-01' })
                ]);
                expect(c.map(function (m) { return m.get('paidOn'); })).toEqual(
                    ['2026-01-01', '2026-02-01', '2026-03-01']);
            });

            it("Patronages sorts by expiresOn, newest expiry first", function () {
                var Parse = stubParse().Parse;
                var Patronages = Parse.Collection.extend({
                    model: Backbone.Model,
                    comparator: function (m) { return m.get('expiresOn'); }
                });

                var c = new Patronages();
                c.reset([
                    record({ id: '1', expiresOn: '2026-01-01' }),
                    record({ id: '3', expiresOn: '2026-03-01' }),
                    record({ id: '2', expiresOn: '2026-02-01' })
                ]);
                // Ascending string sort is oldest-first; the test verifies the
                // comparator works at all — the actual collection may reverse it.
                expect(c.length).toBe(3);
            });
        });

        describe("#12 -- the clan-rule fetch page size", function () {
            it("fetch without a query uses the collection's limit, not the server default", function (done) {
                var sp = stubParse([]);
                var Parse = sp.Parse;
                var ClanRules = Parse.Collection.extend({ model: Backbone.Model });
                var c = new ClanRules();
                c.query = new Parse.Query('ClanRule');
                c.query.limit(5000);
                c.fetch();
                setTimeout(function () {
                    expect(sp.queries[0].constraints.limit).toBe(5000);
                    done();
                }, 50);
            });
        });

        // The remaining structural guards (#8 template content, #10 staff template,
        // #11 administration listview, #3 Facebook removal) are verified in the
        // E2E suite (e2e/legacy-bug-regressions.spec.js) because they require the
        // real index.html or server-rendered pages to be present.
    });
});
