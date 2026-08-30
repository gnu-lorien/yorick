/**
 * Contract tests for the Parse.Object change-event compatibility layer.
 *
 * Semantics come from `parse-1.5.0.js:5770-5805`. Tests use a minimal
 * stand-in so the contract is exercised without any SDK installed.
 *
 * Runs under Karma via RequireJS.
 */
/* global expect, beforeAll, jasmine */

define([
    "underscore",
    "backbone",
    "parse-compat/events"
], function (
    _,
    Backbone,
    applyEvents
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    /** Minimal ParseObject-shaped class: attributes bag, get/set/unset, no events. */
    function makeBareParseObject() {
        function PObject(attrs) {
            this.attributes = Object.assign({}, attrs || {});
        }
        PObject.prototype.get = function (k) { return this.attributes[k]; };
        PObject.prototype.set = function (key, value) {
            if (key !== null && typeof key === 'object') {
                Object.assign(this.attributes, key);
            } else {
                this.attributes[key] = value;
            }
            return this;
        };
        PObject.prototype.unset = function (k) { delete this.attributes[k]; return this; };
        return PObject;
    }

    describe("Parse.Object events compat", function () {
        it("a bare ParseObject has no events until the shim is applied", function () {
            var P = makeBareParseObject();
            expect(typeof P.prototype.on).toBe('undefined');
            applyEvents(P);
            expect(typeof P.prototype.on).toBe('function');
            expect(typeof P.prototype.listenTo).toBe('function', 'views use listenTo, not on');
        });

        it("set fires change:<attr> then change", function () {
            var P = applyEvents(makeBareParseObject());
            var m = new P({ name: 'old' });
            var order = [];
            m.on('change:name', function (model, value) { order.push(['change:name', value]); });
            m.on('change', function () { order.push(['change']); });
            m.set('name', 'new');
            expect(order).toEqual([['change:name', 'new'], ['change']]);
        });

        it("change:<attr> receives (model, value, options)", function () {
            var P = applyEvents(makeBareParseObject());
            var m = new P({ n: 1 });
            var args = null;
            m.on('change:n', function () { args = Array.prototype.slice.call(arguments); });
            m.set('n', 2, { from: 'test' });
            expect(args[0]).toBe(m);
            expect(args[1]).toBe(2);
            expect(args[2].from).toBe('test');
        });

        it("setting an attribute to its existing value fires nothing", function () {
            var P = applyEvents(makeBareParseObject());
            var m = new P({ n: 1 });
            var fired = 0;
            m.on('change', function () { fired++; });
            m.set('n', 1);
            expect(fired).toBe(0, 'only real changes fire');
        });

        it("a multi-attribute set fires one change:<attr> each and a SINGLE change", function () {
            var P = applyEvents(makeBareParseObject());
            var m = new P({ a: 1, b: 1 });
            var attrEvents = [];
            var changes = 0;
            m.on('change:a', function () { attrEvents.push('a'); });
            m.on('change:b', function () { attrEvents.push('b'); });
            m.on('change', function () { changes++; });
            m.set({ a: 2, b: 2 });
            attrEvents.sort();
            expect(attrEvents).toEqual(['a', 'b']);
            expect(changes).toBe(1, 'one change event for the batch, not one per attribute');
        });

        it("{silent:true} suppresses the events", function () {
            var P = applyEvents(makeBareParseObject());
            var m = new P({ n: 1 });
            var fired = 0;
            m.on('change', function () { fired++; });
            m.set('n', 2, { silent: true });
            expect(fired).toBe(0);
            expect(m.get('n')).toBe(2, 'but the value did change');
        });

        it("a silent change is reported by the next non-silent set", function () {
            // parse-1.5.0 kept silent changes in _pending and flushed them on the next
            // real change. seed_db and several views rely on that not losing an update.
            var P = applyEvents(makeBareParseObject());
            var m = new P({ a: 1, b: 1 });
            var seen = [];
            m.on('change:a', function () { seen.push('a'); });
            m.on('change:b', function () { seen.push('b'); });
            m.set('a', 2, { silent: true });
            expect(seen).toEqual([], 'nothing yet');
            m.set('b', 2);
            seen.sort();
            expect(seen).toEqual(['a', 'b'], 'the held-back change comes through too');
        });

        it("unset fires change for the removed attribute", function () {
            var P = applyEvents(makeBareParseObject());
            var m = new P({ gone: 'x' });
            var seen = [];
            m.on('change:gone', function (model, v) { seen.push(v); });
            m.unset('gone');
            expect(seen).toEqual([undefined]);
        });

        it("listenTo and stopListening work, which is what views actually use", function () {
            var P = applyEvents(makeBareParseObject());
            var m = new P({ n: 1 });
            var listener = Object.assign({}, Backbone.Events);
            var fired = 0;
            listener.listenTo(m, 'change', function () { fired++; });
            m.set('n', 2);
            expect(fired).toBe(1);
            listener.stopListening(m);
            m.set('n', 3);
            expect(fired).toBe(1, 'stopListening detaches, so a re-registered view does not double-fire');
        });

        it("changed and previousAttributes track the last batch", function () {
            var P = applyEvents(makeBareParseObject());
            var m = new P({ n: 1 });
            m.set('n', 2);
            expect(m.changed).toEqual({ n: 2 });
            expect(m.previous('n')).toBe(1);
            expect(m.hasChanged('n')).toBe(true);
        });

        it("applying twice does not double-fire", function () {
            // A module reachable by two RequireJS paths would otherwise wrap set twice
            // and emit everything in duplicate, which reads as a render loop.
            var P = makeBareParseObject();
            applyEvents(P);
            applyEvents(P);
            var m = new P({ n: 1 });
            var fired = 0;
            m.on('change', function () { fired++; });
            m.set('n', 2);
            expect(fired).toBe(1);
        });

        it("a null-prototype attributes bag does not break the shim", function () {
            // parse@8 builds its attribute bag with Object.create(null), so it has no
            // hasOwnProperty of its own. Calling attrs.hasOwnProperty(k) threw
            // "attrs.hasOwnProperty is not a function" from inside setACL, several frames
            // from anything that looked related. The original stand-in used a plain {},
            // which inherits one, so the whole suite passed while the app was broken.
            function NullProtoObject(attrs) {
                this.attributes = Object.assign(Object.create(null), attrs || {});
            }
            NullProtoObject.prototype.get = function (k) { return this.attributes[k]; };
            NullProtoObject.prototype.set = function (key, value) {
                if (key !== null && typeof key === 'object') Object.assign(this.attributes, key);
                else this.attributes[key] = value;
                return this;
            };
            NullProtoObject.prototype.unset = function (k) { delete this.attributes[k]; return this; };

            applyEvents(NullProtoObject);
            var m = new NullProtoObject({ n: 1 });
            var seen = [];
            m.on('change:n', function (model, v) { seen.push(v); });
            m.set('n', 2);
            expect(seen).toEqual([2]);
            expect(m.hasChanged('n')).toBe(true);
        });

        it("extend keeps a protoProps initialize, which parse@8 drops", function () {
            // parse@8's Parse.Object.extend consumes `initialize` and never attaches the
            // caller's. Measured: a subclass declaring customMethod AND initialize gets
            // the first only. BNSCTDBS_ChangelingCosts relies on its initialize
            // returning a promise; without it, character creation dies three files away
            // with "Cannot read properties of undefined (reading 'then')".
            function Base(attrs) { this.attributes = Object.assign({}, attrs || {}); }
            Base.prototype.get = function (k) { return this.attributes[k]; };
            Base.prototype.set = function (k, v) { this.attributes[k] = v; return this; };
            Base.prototype.initialize = function () { return 'SDK NO-OP'; };
            // An extend that drops initialize, exactly like the real one.
            Base.extend = function (className, protoProps) {
                function Sub() { Base.apply(this, arguments); }
                Sub.prototype = Object.create(Base.prototype);
                Sub.prototype.constructor = Sub;
                Object.keys(protoProps || {}).forEach(function (k) {
                    if (k === 'initialize') return;
                    Sub.prototype[k] = protoProps[k];
                });
                return Sub;
            };

            applyEvents(Base);

            var Sub = Base.extend('Probe', {
                initialize: function () { return 'FROM PROTO PROPS'; },
                other: function () { return 'other'; }
            });
            var s = new Sub();
            expect(s.initialize()).toBe('FROM PROTO PROPS', 'the declared initialize survives extend');
            expect(s.other()).toBe('other', 'and normal members still work');
        });

        it("objects get a stable, unique cid, or Backbone collections collapse", function () {
            // Backbone's _addReference does this._byId[model.cid] = model, and get()
            // checks this._byId[obj.cid]. With every cid undefined they all collide and
            // each add after the first is merged as a duplicate. Measured against the
            // real app: 49 clans iterated, collection length 1.
            var P = applyEvents(makeBareParseObject());
            var a = new P({ n: 1 });
            var b = new P({ n: 2 });
            expect(!!a.cid).toBe(true, 'has a cid');
            expect(a.cid).toBe(a.cid, 'stable across reads');
            expect(a.cid).not.toBe(b.cid, 'unique per object');
        });

        it("cid is non-enumerable, so it stays out of attribute iteration", function () {
            var P = applyEvents(makeBareParseObject());
            var m = new P({ n: 1 });
            void m.cid;
            expect(Object.keys(m).indexOf('cid')).toBe(-1);
            expect(Object.keys(m).indexOf('__compatCid')).toBe(-1);
        });

        it("extend sets __super__ to the parent prototype, Backbone-style", function () {
            // parse@8 reads __super__ (to pick the parent prototype) but never sets it.
            // ChangelingBetaSlice calls self.constructor.__super__.update_text.apply(...)
            // in four places, and a second-level subclass silently reparents to
            // ParseObject without it.
            function Base(attrs) { this.attributes = Object.assign({}, attrs || {}); }
            Base.prototype.get = function (k) { return this.attributes[k]; };
            Base.prototype.set = function (k, v) { this.attributes[k] = v; return this; };
            Base.extend = function (className, protoProps) {
                function Sub() { Base.apply(this, arguments); }
                Sub.prototype = Object.create(this.prototype);
                Sub.prototype.constructor = Sub;
                Object.keys(protoProps || {}).forEach(function (k) { Sub.prototype[k] = protoProps[k]; });
                Sub.extend = Base.extend;
                return Sub;
            };

            applyEvents(Base);

            var Parent = Base.extend('Parent', { greet: function () { return 'parent'; } });
            expect(Parent.__super__).toBe(Base.prototype, 'first level points at the base prototype');

            var Child = Parent.extend('Child', {
                greet: function () { return this.constructor.__super__.greet.apply(this) + '+child'; }
            });
            expect(Child.__super__).toBe(Parent.prototype, 'second level points at its immediate parent');
            expect(new Child().greet()).toBe('parent+child', 'the super call actually reaches the parent');
        });
    });
});
