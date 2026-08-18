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

test('a real, installed Parse SDK gains working change events', (t) => {
  let Parse;
  let version;
  try {
    Parse = require('parse/node');
    version = require('parse/package.json').version;
  } catch (err) {
    t.skip('no parse package installed in this checkout');
    return;
  }

  // Say out loud which SDK this actually exercised. The migration targets
  // 8.6.0; what is installed here today is 1.11.1, via parse-server@2.8.4.
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
