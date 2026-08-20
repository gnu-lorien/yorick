/**
 * Contract tests for the Parse.Object change-event compatibility layer.
 *
 * Semantics come from `parse-1.5.0.js:5770-5805`. Most tests use a minimal
 * stand-in so the contract is exercised without any SDK installed; the last one
 * runs against whatever real `parse` package resolves, because a shim that only
 * works on a hand-made object proves nothing.
 *
 * Note the version it resolves. This tree has `parse@1.11.1` in node_modules
 * (pulled in by `parse-server@2.8.4`), NOT the 8.6.0 the migration targets --
 * and 1.11.1 already has no `on`/`trigger` on ParseObject, so it is a valid
 * event-less subject even though it is not the target version. The test asserts
 * that premise rather than assuming it, and reports the version it actually
 * loaded so this cannot quietly drift into testing the wrong thing.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

global._ = require('../public/scripts/lib/lodash.js');
const applyEvents = require('../public/scripts/lib/parse-compat/events');

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

test('a bare ParseObject has no events until the shim is applied', () => {
  const P = makeBareParseObject();
  assert.strictEqual(typeof P.prototype.on, 'undefined');
  applyEvents(P);
  assert.strictEqual(typeof P.prototype.on, 'function');
  assert.strictEqual(typeof P.prototype.listenTo, 'function', 'views use listenTo, not on');
});

test('set fires change:<attr> then change', () => {
  const P = applyEvents(makeBareParseObject());
  const m = new P({ name: 'old' });
  const order = [];
  m.on('change:name', (model, value) => order.push(['change:name', value]));
  m.on('change', () => order.push(['change']));
  m.set('name', 'new');
  assert.deepStrictEqual(order, [['change:name', 'new'], ['change']]);
});

test('change:<attr> receives (model, value, options)', () => {
  const P = applyEvents(makeBareParseObject());
  const m = new P({ n: 1 });
  let args = null;
  m.on('change:n', function () { args = Array.prototype.slice.call(arguments); });
  m.set('n', 2, { from: 'test' });
  assert.strictEqual(args[0], m);
  assert.strictEqual(args[1], 2);
  assert.strictEqual(args[2].from, 'test');
});

test('setting an attribute to its existing value fires nothing', () => {
  const P = applyEvents(makeBareParseObject());
  const m = new P({ n: 1 });
  let fired = 0;
  m.on('change', () => { fired++; });
  m.set('n', 1);
  assert.strictEqual(fired, 0, 'only real changes fire');
});

test('a multi-attribute set fires one change:<attr> each and a SINGLE change', () => {
  const P = applyEvents(makeBareParseObject());
  const m = new P({ a: 1, b: 1 });
  const attrEvents = [];
  let changes = 0;
  m.on('change:a', () => attrEvents.push('a'));
  m.on('change:b', () => attrEvents.push('b'));
  m.on('change', () => { changes++; });
  m.set({ a: 2, b: 2 });
  assert.deepStrictEqual(attrEvents.sort(), ['a', 'b']);
  assert.strictEqual(changes, 1, 'one change event for the batch, not one per attribute');
});

test('{silent:true} suppresses the events', () => {
  const P = applyEvents(makeBareParseObject());
  const m = new P({ n: 1 });
  let fired = 0;
  m.on('change', () => { fired++; });
  m.set('n', 2, { silent: true });
  assert.strictEqual(fired, 0);
  assert.strictEqual(m.get('n'), 2, 'but the value did change');
});

test('a silent change is reported by the next non-silent set', () => {
  // parse-1.5.0 kept silent changes in _pending and flushed them on the next
  // real change. seed_db and several views rely on that not losing an update.
  const P = applyEvents(makeBareParseObject());
  const m = new P({ a: 1, b: 1 });
  const seen = [];
  m.on('change:a', () => seen.push('a'));
  m.on('change:b', () => seen.push('b'));
  m.set('a', 2, { silent: true });
  assert.deepStrictEqual(seen, [], 'nothing yet');
  m.set('b', 2);
  assert.deepStrictEqual(seen.sort(), ['a', 'b'], 'the held-back change comes through too');
});

test('unset fires change for the removed attribute', () => {
  const P = applyEvents(makeBareParseObject());
  const m = new P({ gone: 'x' });
  const seen = [];
  m.on('change:gone', (model, v) => seen.push(v));
  m.unset('gone');
  assert.deepStrictEqual(seen, [undefined]);
});

test('listenTo and stopListening work, which is what views actually use', () => {
  const P = applyEvents(makeBareParseObject());
  const m = new P({ n: 1 });
  const listener = Object.assign({}, require('../public/scripts/lib/backbone.js').Events);
  let fired = 0;
  listener.listenTo(m, 'change', () => { fired++; });
  m.set('n', 2);
  assert.strictEqual(fired, 1);
  listener.stopListening(m);
  m.set('n', 3);
  assert.strictEqual(fired, 1, 'stopListening detaches, so a re-registered view does not double-fire');
});

test('changed and previousAttributes track the last batch', () => {
  const P = applyEvents(makeBareParseObject());
  const m = new P({ n: 1 });
  m.set('n', 2);
  assert.deepStrictEqual(m.changed, { n: 2 });
  assert.strictEqual(m.previous('n'), 1);
  assert.strictEqual(m.hasChanged('n'), true);
});

test('applying twice does not double-fire', () => {
  // A module reachable by two RequireJS paths would otherwise wrap set twice
  // and emit everything in duplicate, which reads as a render loop.
  const P = makeBareParseObject();
  applyEvents(P);
  applyEvents(P);
  const m = new P({ n: 1 });
  let fired = 0;
  m.on('change', () => { fired++; });
  m.set('n', 2);
  assert.strictEqual(fired, 1);
});

test('a null-prototype attributes bag does not break the shim', () => {
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
  const m = new NullProtoObject({ n: 1 });
  const seen = [];
  m.on('change:n', (model, v) => seen.push(v));
  m.set('n', 2);
  assert.deepStrictEqual(seen, [2]);
  assert.strictEqual(m.hasChanged('n'), true);
});

test('a real, installed Parse SDK gains working change events', (t) => {
  let Parse;
  let version;
  try {
    Parse = require('parse/node');
    // NOT `require('parse/package.json')`. parse@8 declares an `exports` map
    // that does not list `./package.json`, so that require throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED -- which the catch below read as "no parse
    // installed" and turned into a skip. This test asserts its own premise
    // (that the SDK has no emitter); silently skipping it on the exact SDK the
    // migration targets is the one outcome it must not have. Resolve the entry
    // point and read the manifest off disk instead, which works on both.
    var path = require('path');
    var fs = require('fs');
    version = JSON.parse(
      fs.readFileSync(path.join(path.dirname(require.resolve('parse/node')), 'package.json'), 'utf8')
    ).version;
  } catch (err) {
    t.skip('no parse package installed in this checkout');
    return;
  }

  // Say out loud which SDK this actually exercised.
  t.diagnostic('exercised against parse@' + version);

  // Confirm the premise rather than assuming it: this SDK really has no events.
  assert.strictEqual(
    typeof Parse.Object.prototype.trigger,
    'undefined',
    'parse@' + version + ' unexpectedly has an emitter; the shim needs revisiting'
  );
  assert.strictEqual(typeof Parse.Object.prototype.on, 'undefined');

  applyEvents(Parse.Object);
  const Thing = Parse.Object.extend('CompatEventsProbe');
  const t1 = new Thing();

  const seen = [];
  t1.on('change:title', (model, value) => seen.push(['attr', value]));
  t1.on('change', () => seen.push(['change']));
  t1.set('title', 'hello');

  assert.deepStrictEqual(seen, [['attr', 'hello'], ['change']]);
  assert.strictEqual(t1.get('title'), 'hello', 'and the SDK still stored the value');
});

test('extend keeps a protoProps initialize, which parse@8 drops', () => {
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

  const Sub = Base.extend('Probe', {
    initialize: function () { return 'FROM PROTO PROPS'; },
    other: function () { return 'other'; }
  });
  const s = new Sub();
  assert.strictEqual(s.initialize(), 'FROM PROTO PROPS', 'the declared initialize survives extend');
  assert.strictEqual(s.other(), 'other', 'and normal members still work');
});

test('objects get a stable, unique cid, or Backbone collections collapse', () => {
  // Backbone's _addReference does this._byId[model.cid] = model, and get()
  // checks this._byId[obj.cid]. With every cid undefined they all collide and
  // each add after the first is merged as a duplicate. Measured against the
  // real app: 49 clans iterated, collection length 1.
  const P = applyEvents(makeBareParseObject());
  const a = new P({ n: 1 });
  const b = new P({ n: 2 });
  assert.ok(a.cid, 'has a cid');
  assert.strictEqual(a.cid, a.cid, 'stable across reads');
  assert.notStrictEqual(a.cid, b.cid, 'unique per object');
});

test('cid is non-enumerable, so it stays out of attribute iteration', () => {
  const P = applyEvents(makeBareParseObject());
  const m = new P({ n: 1 });
  void m.cid;
  assert.strictEqual(Object.keys(m).indexOf('cid'), -1);
  assert.strictEqual(Object.keys(m).indexOf('__compatCid'), -1);
});

test('extend sets __super__ to the parent prototype, Backbone-style', () => {
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

  const Parent = Base.extend('Parent', { greet: function () { return 'parent'; } });
  assert.strictEqual(Parent.__super__, Base.prototype, 'first level points at the base prototype');

  const Child = Parent.extend('Child', {
    greet: function () { return this.constructor.__super__.greet.apply(this) + '+child'; }
  });
  assert.strictEqual(Child.__super__, Parent.prototype, 'second level points at its immediate parent');
  assert.strictEqual(new Child().greet(), 'parent+child', 'the super call actually reaches the parent');
});
