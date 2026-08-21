/**
 * Contract tests for the "decoy clone" defect, against the REAL vendored SDK.
 *
 * Backbone 1.1.2 asks `attrs instanceof Model` to decide whether it has been
 * handed a model or a raw attribute hash (`backbone.js:690` and `:916`). Parse
 * 1.5's objects were Backbone models, so both tests passed. A parse@8
 * `ParseObject` fails them, so `_prepareModel` replaced every object added to
 * or reset into a `Parse.Collection` with `new this.model(theParseObject)` --
 * the Parse object used as an attribute bag. Its `id` was copied across, so the
 * decoy's junk SetOps landed on the real row: 768 `Invalid field name:
 * _compatPending.` in one run of the server log.
 *
 * These tests deliberately do NOT use the stand-in from
 * `parse-compat-collection.test.js`. That stub does
 * `PObject.prototype = Object.create(Backbone.Model.prototype)`, i.e. the stub
 * IS a Backbone.Model, so it passes `instanceof` and can never reproduce this.
 * That is exactly why 74 green contract tests missed an eight-test defect.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

global._ = require('../public/scripts/lib/lodash.js');
const Backbone = require('../public/scripts/lib/backbone.js');
global.Backbone = Backbone;

// The real SDK. Its UMD tail does `globalThis.Parse = Parse`, so requiring it
// for effect and reading the global is how you get the namespace.
require('../public/scripts/lib/parse-8.6.0.js');
const Parse = global.Parse;

const install = require('../public/scripts/lib/parse-compat/index');

Parse.initialize('test-app-id', 'test-js-key');
Parse.serverURL = 'http://127.0.0.1:1/parse';
install(Parse);

const Thing = Parse.Object.extend('CompatDecoyThing');

/** A saved object: has an objectId and clean server data, like a query result. */
function savedThing(id, attrs) {
  const o = new Thing();
  o._finishFetch(Object.assign({ objectId: id }, attrs || {}));
  return o;
}

// --- item 1: the objects a collection holds are the objects you gave it ---

test('add() keeps the Parse.Object itself, not a clone of its innards', () => {
  const c = new Parse.Collection([], { model: Thing });
  const obj = savedThing('abc123', { name: 'Brujah' });

  c.add(obj);

  assert.strictEqual(c.models[0], obj,
    'Backbone built a decoy with `new this.model(obj)` instead of storing obj');
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c.models[0].get('name'), 'Brujah');
});

test('add() keeps an UNSAVED Parse.Object too', () => {
  const c = new Parse.Collection([], { model: Thing });
  const obj = new Thing();
  obj.set('name', 'unsaved');

  c.add(obj);

  assert.strictEqual(c.models[0], obj);
  assert.strictEqual(c.models[0].get('name'), 'unsaved');
});

test('reset() keeps the Parse.Objects, which is the path fetch() takes', () => {
  const c = new Parse.Collection([], { model: Thing });
  const a = savedThing('id-a', { name: 'a' });
  const b = savedThing('id-b', { name: 'b' });

  c.reset([a, b]);

  assert.strictEqual(c.length, 2);
  assert.strictEqual(c.models[0], a);
  assert.strictEqual(c.models[1], b);
});

test('reset() leaves nothing dirty, so no junk field is PUT to the server', () => {
  const c = new Parse.Collection([], { model: Thing });
  const obj = savedThing('abc123', { name: 'Brujah' });

  c.reset([obj]);

  // _getSaveJSON is what the SDK sends. Anything in here after a plain reset
  // is a field the row never asked for.
  const save = obj._getSaveJSON();
  assert.deepStrictEqual(Object.keys(save), [],
    'reset() dirtied the object: ' + JSON.stringify(save));

  for (const junk of ['className', '_objCount', '_localId', '_compatPending',
    'changed', '_compatPrevious', '__compatEventsApplied']) {
    assert.ok(!(junk in save), 'compat/SDK internal leaked as an attribute: ' + junk);
  }
});

test('the id is not smeared onto a second object', () => {
  const c = new Parse.Collection([], { model: Thing });
  const obj = savedThing('sharedid', { name: 'x' });
  c.add(obj);
  assert.strictEqual(c.models[0].id, 'sharedid');
  assert.strictEqual(c.get('sharedid'), obj);
});

// --- the arithmetic those decoys silently broke ---

test('XP propagation over a one-member collection totals, rather than NaN', () => {
  // `Character._propagate_experience_notation_change`, Character.js:521-524,
  // reduced right over `experience_notations.models`. With decoys in the
  // collection `en.get("alteration_earned")` is undefined and the running total
  // goes NaN -- a wrong number, not an exception.
  const EN = Parse.Object.extend('CompatDecoyEN');
  const en = new EN();
  en._finishFetch({
    objectId: 'en1', alteration_earned: 30, alteration_spent: 0,
    earned: 0, spent: 0
  });

  const ens = new Parse.Collection([], { model: EN });
  ens.reset([en]);

  const zero = new EN();
  zero.set('earned', 0);
  zero.set('spent', 0);

  const final_en = global._.reduceRight(
    global._.slice(ens.models, 0, 1),
    function (previous_en, e) {
      e.set('earned', e.get('alteration_earned') + previous_en.get('earned'), { silent: true });
      e.set('spent', e.get('alteration_spent') + previous_en.get('spent'), { silent: true });
      return e;
    },
    zero
  );

  assert.strictEqual(final_en.get('earned'), 30);
  assert.strictEqual(final_en.get('spent'), 0);
});

// --- the patch itself ---

test('instanceof Backbone.Model accepts a Parse.Object and still rejects junk', () => {
  assert.ok(savedThing('x') instanceof Backbone.Model);
  assert.ok(new Backbone.Model() instanceof Backbone.Model);
  assert.ok(!({} instanceof Backbone.Model));
  assert.ok(!(null instanceof Backbone.Model));
  assert.ok(!(undefined instanceof Backbone.Model));
  assert.ok(!('a string' instanceof Backbone.Model));
  assert.ok(!(7 instanceof Backbone.Model));
});

test('instanceof on a Backbone.Model SUBCLASS is untouched', () => {
  // Backbone's `extend` copies statics with `_.extend`, which takes own STRING
  // keys, so the Symbol.hasInstance descriptor is not inherited. A Parse.Object
  // must not start passing for someone's Backbone subclass.
  const Sub = Backbone.Model.extend({});
  assert.ok(new Sub() instanceof Sub);
  assert.ok(new Sub() instanceof Backbone.Model);
  assert.ok(!(savedThing('y') instanceof Sub));
  assert.ok(!(new Backbone.Model() instanceof Sub));
});

test('set(aParseObject) takes its attributes, not its internals', () => {
  const source = savedThing('src', { name: 'source', rank: 3 });
  const target = new Thing();

  target.set(source);

  assert.strictEqual(target.get('name'), 'source');
  assert.strictEqual(target.get('rank'), 3);
  assert.strictEqual(target.get('className'), undefined);
  assert.strictEqual(target.get('_objCount'), undefined);
  assert.strictEqual(target.get('__compatEventsApplied'), undefined);
});

// --- item 2: getByCid ---

test('getByCid returns the member, by cid and by object', () => {
  const c = new Parse.Collection([], { model: Thing });
  const obj = savedThing('gbc', { name: 'n' });
  c.add(obj);

  assert.strictEqual(c.getByCid(obj.cid), obj);
  assert.strictEqual(c.getByCid({ cid: obj.cid }), obj);
  assert.strictEqual(c.getByCid('c-nope'), undefined);
  assert.strictEqual(c.getByCid(undefined), undefined);
});

// --- item 3: _serverData / _previousAttributes ---

test('_serverData is the live server bag, and deleting a key purges it', () => {
  // `Character.update_troupe_acls`, Character.js:920-921.
  const obj = savedThing('sd1', { troupes: [1, 2], name: 'keep' });

  assert.strictEqual(typeof obj._serverData, 'object');
  assert.deepStrictEqual(obj.get('troupes'), [1, 2]);

  delete obj._serverData.troupes;

  assert.strictEqual(obj.get('troupes'), undefined,
    'the delete has to reach the bag estimateAttributes reads');
  assert.strictEqual(obj.get('name'), 'keep');
});

test('_previousAttributes exists and is deletable', () => {
  const obj = savedThing('pa1', { troupes: 'x' });
  obj.set('troupes', 'y');

  assert.strictEqual(typeof obj._previousAttributes, 'object');
  assert.notStrictEqual(obj._previousAttributes, null);
  assert.doesNotThrow(function () { delete obj._previousAttributes.troupes; });
});

test('_previousAttributes tracks the last non-silent set', () => {
  const obj = savedThing('pa2', { rank: 1 });
  obj.set('rank', 2);
  assert.strictEqual(obj._previousAttributes.rank, 1);
  assert.strictEqual(obj.previous('rank'), 1);
});

test('neither getter shows up as an attribute', () => {
  const obj = savedThing('enum1', { name: 'n' });
  void obj._serverData;
  void obj._previousAttributes;
  assert.deepStrictEqual(Object.keys(obj._getSaveJSON()), []);
});

// --- addUnique's third argument, which parse@8 dropped ---

test('addUnique({silent: true}) suppresses the change event, as 1.5 did', () => {
  // `parse-1.5.0.js:5409` forwarded options; `parse-8.6.0.js:43642` takes two
  // arguments and drops them. The live call site is
  // `Character.update_trait` (app/models/Character.js:229), which adds an
  // UNSAVED trait to the character -- so a change event there re-renders a
  // Marionette region, `serializeModel` calls toJSON(), and parse@8 refuses to
  // encode a pointer to an object with no objectId.
  const obj = savedThing('au1', { list: [] });
  const fired = [];
  obj.on('change', () => fired.push('change'));
  obj.on('change:list', () => fired.push('change:list'));

  obj.addUnique('list', 'a', { silent: true });

  assert.deepStrictEqual(fired, []);
  assert.deepStrictEqual(obj.get('list'), ['a']);
});

test('addUnique without options still fires change', () => {
  const obj = savedThing('au2', { list: [] });
  const fired = [];
  obj.on('change', () => fired.push('change'));

  obj.addUnique('list', 'a');

  assert.deepStrictEqual(fired, ['change']);
});

test('a silent addUnique does not leak its options into the next set', () => {
  const obj = savedThing('au3', { list: [], other: 1 });
  obj.addUnique('list', 'a', { silent: true });

  const fired = [];
  obj.on('change', () => fired.push('change'));
  obj.set('other', 2);

  // The held-back `list` change is reported alongside `other`, which is what
  // 1.5's _silent/_pending pair did.
  assert.deepStrictEqual(fired, ['change']);
  assert.strictEqual(obj.get('other'), 2);
});

// --- the `saved` event, which parse@8 has no equivalent for ---

test('a completed save fires "saved", as parse-1.5.0.js:5112 did', () => {
  // Five sub-views of the creation wizard re-render on this event
  // (CharacterCreateViewNew.js:230, 257, 284, 322, 361), which is how the
  // pool counters move. `_handleSaveResponse` is parse@8's `_finishSave`.
  const obj = savedThing('sv1', { remaining: 3 });
  const seen = [];
  obj.on('saved', (m) => seen.push(m));

  obj._handleSaveResponse({ objectId: 'sv1', remaining: 2 }, 200);

  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0], obj, 'the event carries the object, as 1.5 did');
});

test('"saved" fires after the response has been merged, not before', () => {
  const obj = savedThing('sv2', { remaining: 3 });
  let atFireTime = null;
  obj.on('saved', () => { atFireTime = obj.get('remaining'); });

  obj._handleSaveResponse({ objectId: 'sv2', remaining: 2 }, 200);

  assert.strictEqual(atFireTime, 2,
    'a listener that re-renders must see the saved values, not the old ones');
});

test('an object nobody saved never fires "saved"', () => {
  const obj = savedThing('sv3', { remaining: 3 });
  let fired = 0;
  obj.on('saved', () => { fired++; });
  obj.set('remaining', 1);
  assert.strictEqual(fired, 0);
});

// --- options.changes, which 1.5's change listeners read ---

test('a change event carries which attributes moved, in options.changes', () => {
  // `Character.on_update_experience_notation` (Character.js:495) opens with
  // `var c = changes.changes; if (c.entered) {...}` on the collection's
  // forwarded change event. parse-1.5.0.js:5347 filled that hash.
  const obj = savedThing('ch1', { entered: 1, reason: 'a' });
  let seen = null;
  obj.on('change', (m, options) => { seen = options; });

  obj.set('entered', 2);

  assert.ok(seen, 'the change event fired');
  assert.deepStrictEqual(seen.changes, { entered: true });
});

test('a multi-attribute set reports every attribute that moved', () => {
  const obj = savedThing('ch2', { a: 1, b: 1, c: 1 });
  let seen = null;
  obj.on('change', (m, options) => { seen = options; });

  obj.set({ a: 2, b: 2 });

  assert.deepStrictEqual(seen.changes, { a: true, b: true });
});

test('a held-back silent change is reported in options.changes when it lands', () => {
  const obj = savedThing('ch3', { a: 1, b: 1 });
  let seen = null;
  obj.on('change', (m, options) => { seen = options; });

  obj.set('a', 2, { silent: true });
  assert.strictEqual(seen, null, 'silent means silent');

  obj.set('b', 2);
  assert.deepStrictEqual(seen.changes, { a: true, b: true },
    'the silent change is reported alongside the next real one, as 1.5 did');
});

test('change:<attr> gets the same options object as change', () => {
  const obj = savedThing('ch4', { a: 1 });
  let fromAttr = null;
  let fromChange = null;
  obj.on('change:a', (m, value, options) => { fromAttr = options; });
  obj.on('change', (m, options) => { fromChange = options; });

  obj.set('a', 2);

  assert.strictEqual(fromAttr, fromChange);
  assert.deepStrictEqual(fromAttr.changes, { a: true });
});

// --- a save response must not unfetch what was already fetched ---

test('a save that echoes bare pointers keeps the fetched objects', () => {
  // parse-1.5.0.js:5100: "Look for any objects that might have become
  // unfetched and fix them by replacing their values with the previously
  // observed values." parse@8 leans on single-instance state for this, and
  // this layer turns single-instance off because 1.5 did not have it.
  const Trait = Parse.Object.extend('CompatReattachTrait');
  const child = new Trait();
  child._finishFetch({ objectId: 't1', name: 'Physical', value: 5 });

  const parent = savedThing('p1', {});
  parent.set('traits', [child]);
  assert.strictEqual(parent.get('traits')[0].get('name'), 'Physical');

  // What the server echoes after a save: a pointer, with no data.
  parent._handleSaveResponse({
    objectId: 'p1',
    traits: [{ __type: 'Pointer', className: 'CompatReattachTrait', objectId: 't1' }]
  }, 200);

  const after = parent.get('traits')[0];
  assert.strictEqual(after.get('name'), 'Physical',
    'the trait was replaced by a dataless pointer');
  assert.strictEqual(after.get('value'), 5);
  assert.strictEqual(after, child, 'and it is the same object the view is holding');
});

test('a pointer to something never fetched is left alone', () => {
  const parent = savedThing('p2', {});
  parent._handleSaveResponse({
    objectId: 'p2',
    other: { __type: 'Pointer', className: 'CompatReattachTrait', objectId: 'never' }
  }, 200);

  const ptr = parent.get('other');
  assert.strictEqual(ptr.id, 'never');
  assert.strictEqual(ptr.get('name'), undefined);
});

// --- the destroy event, which is how a collection drops a row ---

test('destroy() fires "destroy" and the collection drops the model', () => {
  // parse-1.5.0.js:5699. Backbone's Collection._onModelEvent does
  // `if (event === 'destroy') this.remove(model, options)` (backbone.js:945),
  // which is the only thing that takes a destroyed row out of a live list.
  const c = new Parse.Collection([], { model: Thing });
  const obj = savedThing('gone1', { name: 'x' });
  c.add(obj);
  assert.strictEqual(c.length, 1);

  let fired = null;
  obj.on('destroy', (m) => { fired = m; });

  // Optimistic, as 1.5 was: the event is fired before the request, so this
  // does not need the request to succeed.
  // `.fail` no longer recovers a chain (see parse-compat/promise.js), so the
  // rejection is absorbed by handing back a fresh promise rather than a value.
  obj.destroy().fail(() => Parse.Promise.as());

  assert.strictEqual(fired, obj);
  assert.strictEqual(c.length, 0, 'the collection removed it');
});

test('destroy({wait: true}) holds the event until the request succeeds', async () => {
  const c = new Parse.Collection([], { model: Thing });
  const obj = savedThing('gone2', { name: 'x' });
  c.add(obj);

  const settled = new Promise((resolve) => {
    obj.destroy({ wait: true }).always(() => resolve());
  });
  assert.strictEqual(c.length, 1, 'still there while the request is in flight');
  await settled;
});
