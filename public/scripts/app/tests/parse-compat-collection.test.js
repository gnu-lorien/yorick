/**
 * Contract tests for the Parse.Collection compatibility layer.
 *
 * Behaviour is taken from `parse-1.5.0.js:6502` and its `fetch`. These run
 * against the repo's real Backbone 1.1.2 rather than a stand-in, so anything
 * Marionette relies on (comparator ordering, add/reset events, the `models`
 * array) is exercised for real. Only `Parse.Query` is stubbed.
 *
 * Runs under Karma via RequireJS.
 */
/* global expect, beforeAll, jasmine */

define([
    "underscore",
    "backbone",
    "parse-compat/promise",
    "parse-compat/collection"
], function (
    _,
    Backbone,
    CompatPromise,
    makeParseCollection
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    /** A Parse.Query stand-in that records how it was called. */
    function stubParse(results, opts) {
        var calls = [];
        function Query(model) { this.model = model; calls.push({ construct: model }); }
        Query.prototype.find = function (findOptions) {
            calls.push({ find: findOptions });
            if (opts && opts.reject) return Promise.reject(opts.reject);
            return Promise.resolve(results);
        };
        function PObject(attrs) { Backbone.Model.call(this, attrs); }
        PObject.prototype = Object.create(Backbone.Model.prototype);
        return { Parse: { Query: Query, Object: PObject }, calls: calls };
    }

    function tick() {
        return new Promise(function (resolve) { setTimeout(resolve, 5); });
    }

    describe("Parse.Collection compat", function () {
        it("the shim really is a Backbone.Collection", function () {
            var Parse = stubParse([]).Parse;
            var C = makeParseCollection(Parse);
            var c = new C();
            expect(c instanceof Backbone.Collection).toBe(true);
        });

        it("comparator ordering works, which is what nine CollectionViews rely on", function () {
            var Parse = stubParse([]).Parse;
            var C = makeParseCollection(Parse).extend({
                comparator: function (m) { return m.get('name'); }
            });
            var c = new C([{ name: 'c' }, { name: 'a' }, { name: 'b' }]);
            expect(c.map(function (m) { return m.get('name'); })).toEqual(['a', 'b', 'c']);
        });

        it("fetch resolves with the COLLECTION, not the results array", function (done) {
            var Parse = stubParse([{ id: 1 }, { id: 2 }]).Parse;
            var C = makeParseCollection(Parse);
            var c = new C();
            var resolved = null;
            c.fetch().then(function (v) { resolved = v; });
            setTimeout(function () {
                expect(resolved).toBe(c, 'callers do .then(function (collection) {...})');
                expect(c.length).toBe(2);
                done();
            }, 50);
        });

        it("fetch resets by default", function (done) {
            var Parse = stubParse([{ id: 'new' }]).Parse;
            var C = makeParseCollection(Parse);
            var c = new C([{ id: 'stale' }]);
            var events = [];
            c.on('reset', function () { events.push('reset'); });
            c.on('add', function () { events.push('add'); });
            c.fetch();
            setTimeout(function () {
                expect(events).toEqual(['reset'], 'default is reset, not add');
                expect(c.length).toBe(1);
                expect(c.at(0).id).toBe('new', 'the stale model is gone');
                done();
            }, 50);
        });

        it("fetch({add:true}) adds instead of resetting", function (done) {
            var Parse = stubParse([{ id: 'b' }]).Parse;
            var C = makeParseCollection(Parse);
            var c = new C([{ id: 'a' }]);
            var events = [];
            c.on('reset', function () { events.push('reset'); });
            c.on('add', function () { events.push('add'); });
            c.fetch({ add: true });
            setTimeout(function () {
                expect(events).toEqual(['add']);
                expect(c.length).toBe(2, 'the existing model survives');
                done();
            }, 50);
        });

        it("fetch uses this.query when set, and does not construct one", function (done) {
            var sp = stubParse([]);
            var Parse = sp.Parse;
            var C = makeParseCollection(Parse);
            var c = new C();
            var preset = new Parse.Query('PRESET');
            sp.calls.length = 0;
            c.query = preset;
            c.fetch();
            setTimeout(function () {
                expect(sp.calls.filter(function (x) { return x.construct; })).toEqual(
                    [], 'no new Query was built');
                done();
            }, 50);
        });

        it("fetch builds a Query from this.model when no query is set", function (done) {
            var sp = stubParse([]);
            var Parse = sp.Parse;
            var C = makeParseCollection(Parse).extend({ model: 'MyModel' });
            var c = new C();
            c.fetch();
            setTimeout(function () {
                expect(sp.calls[0]).toEqual({ construct: 'MyModel' });
                done();
            }, 50);
        });

        it("fetch forwards useMasterKey and sessionToken to find()", function (done) {
            var sp = stubParse([]);
            var Parse = sp.Parse;
            var C = makeParseCollection(Parse);
            var c = new C();
            c.fetch({ useMasterKey: true, sessionToken: 'tok' });
            setTimeout(function () {
                var findCall = sp.calls.find(function (x) { return x.find; });
                expect(findCall.find.useMasterKey).toBe(true);
                expect(findCall.find.sessionToken).toBe('tok');
                done();
            }, 50);
        });

        it("a rejected query rejects the fetch, and .fail sees it", function (done) {
            var boom = new Error('query failed');
            var Parse = stubParse(null, { reject: boom }).Parse;
            var C = makeParseCollection(Parse);
            var c = new C();
            var caught = null;
            c.fetch().fail(function (e) { caught = e; });
            setTimeout(function () {
                expect(caught).toBe(boom, 'the failure is not swallowed into an empty collection');
                expect(c.length).toBe(0);
                done();
            }, 50);
        });

        it("fetch returns a Parse.Promise-compatible thenable, not a bare native one", function (done) {
            var Parse = stubParse([]).Parse;
            var C = makeParseCollection(Parse);
            var c = new C();
            var p = c.fetch();
            expect(typeof p.then).toBe('function');
            expect(typeof p.fail).toBe('function', 'callers chain .fail off fetch');
            expect(typeof p.always).toBe('function');
            expect(CompatPromise.is(p)).toBe(true);
            setTimeout(function () { done(); }, 50);
        });

        it("_byCid indexes members by cid, as Parse.Collection did", function () {
            var Parse = stubParse([]).Parse;
            var C = makeParseCollection(Parse);
            var c = new C([{ n: 1 }, { n: 2 }]);
            var index = c._byCid;
            expect(Object.keys(index).length).toBe(2);
            c.models.forEach(function (m) {
                expect(index[m.cid]).toBe(m, 'each member is reachable by its cid');
            });
        });

        it("_byCid tracks the collection rather than caching a stale copy", function () {
            var Parse = stubParse([]).Parse;
            var C = makeParseCollection(Parse);
            var c = new C([{ n: 1 }]);
            var first = c.models[0];
            expect(c._byCid[first.cid]).toBeTruthy();
            c.remove(first);
            expect(c._byCid[first.cid]).toBeUndefined(
                'a removed model leaves the index');
        });
    });
});
