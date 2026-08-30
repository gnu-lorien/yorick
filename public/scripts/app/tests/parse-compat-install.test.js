/**
 * Contract tests for the assembled compatibility layer.
 *
 * The individual shims have their own suites; this covers what only shows up
 * when they are installed together onto one Parse namespace -- ordering,
 * idempotence, and not shadowing anything the real SDK still provides.
 *
 * Runs under Karma via RequireJS.
 */
/* global expect, beforeAll, jasmine */

define([
    "underscore",
    "backbone",
    "parse-compat/index"
], function (
    _,
    Backbone,
    install
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    /** A parse@8-shaped namespace: an event-less Object with extend, a Query. */
    function makeModernParse() {
        function PObject(attrs) {
            this.attributes = Object.assign({}, attrs || {});
        }
        PObject.prototype.get = function (k) { return this.attributes[k]; };
        PObject.prototype.set = function (key, value) {
            if (key !== null && typeof key === 'object') Object.assign(this.attributes, key);
            else this.attributes[key] = value;
            return this;
        };
        PObject.prototype.unset = function (k) { delete this.attributes[k]; return this; };
        PObject.extend = function () {
            function Sub() { PObject.apply(this, arguments); }
            Sub.prototype = Object.create(PObject.prototype);
            Sub.prototype.constructor = Sub;
            return Sub;
        };

        function Query(model) { this.model = model; }
        Query.prototype.find = function () { return Promise.resolve([]); };

        return { Object: PObject, Query: Query };
    }

    describe("Parse.compat install", function () {
        it("install() adds exactly the four things parse@8 dropped", function () {
            var Parse = makeModernParse();
            expect(Parse.Promise).toBeUndefined();
            expect(Parse.Collection).toBeUndefined();
            expect(Parse.Router).toBeUndefined();
            expect(typeof Parse.Object.prototype.on).toBe('undefined');

            install(Parse);

            expect(typeof Parse.Promise).toBe('function');
            expect(typeof Parse.Collection).toBe('function');
            expect(typeof Parse.Router).toBe('function');
            expect(typeof Parse.history).toBe('object');
            expect(typeof Parse.Object.prototype.on).toBe('function');
        });

        it("events reach subclasses made by Parse.Object.extend AFTER install", function () {
            // Ordering: events wrap Parse.Object.prototype.set, so a subclass created
            // later must inherit the wrapped one.
            var Parse = install(makeModernParse());
            var Vampire = Parse.Object.extend('Vampire');
            var v = new Vampire({ name: 'old' });
            var seen = [];
            v.on('change:name', function (m, value) { seen.push(value); });
            v.set('name', 'new');
            expect(seen).toEqual(['new']);
        });

        it("events also reach subclasses made BEFORE install", function () {
            // mobileRouter and the models module both call Parse.Object.extend at load
            // time, which can run before install() depending on RequireJS ordering.
            // Prototype mutation is what makes that safe.
            var Parse = makeModernParse();
            var Vampire = Parse.Object.extend('Vampire');
            install(Parse);
            var v = new Vampire({ n: 1 });
            var fired = 0;
            v.on('change', function () { fired++; });
            v.set('n', 2);
            expect(fired).toBe(1, 'a subclass created before install still gains events');
        });

        it("Parse.Collection is wired to the same namespace it was installed on", function (done) {
            var Parse = install(makeModernParse());
            var C = Parse.Collection.extend({ model: 'Thing' });
            var c = new C();
            var resolved = null;
            c.fetch().then(function (v) { resolved = v; });
            setTimeout(function () {
                expect(resolved).toBe(c);
                done();
            }, 50);
        });

        it("install is idempotent and does not double-fire events", function () {
            var Parse = makeModernParse();
            install(Parse);
            install(Parse);
            var v = new (Parse.Object.extend('X'))({ n: 1 });
            var fired = 0;
            v.on('change', function () { fired++; });
            v.set('n', 2);
            expect(fired).toBe(1);
        });

        it("install does NOT shadow anything the SDK already provides", function () {
            // If a future parse ships its own Promise or routing, the shim must step
            // aside rather than quietly replacing a supported implementation.
            var Parse = makeModernParse();
            var sentinelPromise = function () {};
            var sentinelRouter = function () {};
            Parse.Promise = sentinelPromise;
            Parse.Router = sentinelRouter;

            install(Parse);

            expect(Parse.Promise).toBe(sentinelPromise, 'existing Promise left alone');
            expect(Parse.Router).toBe(sentinelRouter, 'existing Router left alone');
        });

        it("Parse.Promise round-trips through the installed namespace", function (done) {
            var Parse = install(makeModernParse());
            var got = null;
            Parse.Promise.when(Parse.Promise.as('a'), Parse.Promise.as('b')).then(function (x, y) {
                got = [x, y];
            });
            setTimeout(function () {
                expect(got).toEqual(['a', 'b'], 'multi-arg resolution survives assembly');
                done();
            }, 50);
        });

        it("install throws rather than silently no-oping on a missing namespace", function () {
            try { install(null); } catch (e) {
                expect(e.message.indexOf('no Parse namespace given')).not.toBe(-1);
            }
        });
    });
});
