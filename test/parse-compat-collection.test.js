/**
 * Contract tests for the Parse.Collection compatibility layer.
 *
 * Behaviour is taken from `parse-1.5.0.js:6502` and its `fetch`, not invented.
 * These run against the repo's real Backbone 1.1.2 rather than a stand-in, so
 * anything Marionette relies on (comparator ordering, add/reset events, the
 * `models` array) is exercised for real. Only `Parse.Query` is stubbed, because
 * the point is the fetch contract, not the network.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Backbone 1.1.2 finds underscore on the global in a CommonJS context.
//
// `underscore` is also a real devDependency because of the line below it:
// `public/scripts/lib/backbone.js:24` does `require('underscore')` when loaded
// under CommonJS, so the npm package has to be installed even though the app
// itself is served the vendored copy. It was undeclared and these five test
// files passed anyway, resolving it out of a stale `node_modules` in the
// enclosing checkout; reinstalling that tree took the whole compat suite down
// with "Cannot find module 'underscore'" and dropped the run from 291 tests to
// 211. Declared now, at 1.13.8 -- 1.13.7 and earlier carry GHSA-qpx9-hpmf-5gmw.
global._ = require('../public/scripts/lib/lodash.js');
const Backbone = require('../public/scripts/lib/backbone.js');
const CompatPromise = require('../public/scripts/lib/parse-compat/promise');

const makeParseCollection = require('../public/scripts/lib/parse-compat/collection');

/** A Parse.Query stand-in that records how it was called. */
function stubParse(results, opts) {
  const calls = [];
  function Query(model) {
    this.model = model;
    calls.push({ construct: model });
  }
  Query.prototype.find = function (findOptions) {
    calls.push({ find: findOptions });
    if (opts && opts.reject) return Promise.reject(opts.reject);
    return Promise.resolve(results);
  };
  function PObject(attrs) { Backbone.Model.call(this, attrs); }
  PObject.prototype = Object.create(Backbone.Model.prototype);
  return { Parse: { Query, Object: PObject }, calls };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

test('the shim really is a Backbone.Collection', () => {
  const { Parse } = stubParse([]);
  const C = makeParseCollection(Parse);
  const c = new C();
  assert.ok(c instanceof Backbone.Collection);
});

test('comparator ordering works, which is what nine CollectionViews rely on', () => {
  const { Parse } = stubParse([]);
  const C = makeParseCollection(Parse).extend({
    comparator: function (m) { return m.get('name'); }
  });
  const c = new C([{ name: 'c' }, { name: 'a' }, { name: 'b' }]);
  assert.deepStrictEqual(c.map((m) => m.get('name')), ['a', 'b', 'c']);
});

test('fetch resolves with the COLLECTION, not the results array', async () => {
  const { Parse } = stubParse([{ id: 1 }, { id: 2 }]);
  const C = makeParseCollection(Parse);
  const c = new C();
  let resolved = null;
  c.fetch().then((v) => { resolved = v; });
  await tick();
  assert.strictEqual(resolved, c, 'callers do .then(function (collection) {...})');
  assert.strictEqual(c.length, 2);
});

test('fetch resets by default', async () => {
  const { Parse } = stubParse([{ id: 'new' }]);
  const C = makeParseCollection(Parse);
  const c = new C([{ id: 'stale' }]);
  const events = [];
  c.on('reset', () => events.push('reset'));
  c.on('add', () => events.push('add'));
  c.fetch();
  await tick();
  assert.deepStrictEqual(events, ['reset'], 'default is reset, not add');
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c.at(0).id, 'new', 'the stale model is gone');
});

test('fetch({add:true}) adds instead of resetting', async () => {
  const { Parse } = stubParse([{ id: 'b' }]);
  const C = makeParseCollection(Parse);
  const c = new C([{ id: 'a' }]);
  const events = [];
  c.on('reset', () => events.push('reset'));
  c.on('add', () => events.push('add'));
  c.fetch({ add: true });
  await tick();
  assert.deepStrictEqual(events, ['add']);
  assert.strictEqual(c.length, 2, 'the existing model survives');
});

test('fetch uses this.query when set, and does not construct one', async () => {
  const { Parse, calls } = stubParse([]);
  const C = makeParseCollection(Parse);
  const c = new C();
  const preset = new Parse.Query('PRESET');
  calls.length = 0;
  c.query = preset;
  c.fetch();
  await tick();
  assert.deepStrictEqual(calls.filter((x) => x.construct), [], 'no new Query was built');
});

test('fetch builds a Query from this.model when no query is set', async () => {
  const { Parse, calls } = stubParse([]);
  const C = makeParseCollection(Parse).extend({ model: 'MyModel' });
  const c = new C();
  calls.length = 0;
  c.fetch();
  await tick();
  assert.deepStrictEqual(calls[0], { construct: 'MyModel' });
});

test('fetch forwards useMasterKey and sessionToken to find()', async () => {
  const { Parse, calls } = stubParse([]);
  const C = makeParseCollection(Parse);
  const c = new C();
  calls.length = 0;
  c.fetch({ useMasterKey: true, sessionToken: 'tok' });
  await tick();
  const find = calls.find((x) => x.find);
  assert.strictEqual(find.find.useMasterKey, true);
  assert.strictEqual(find.find.sessionToken, 'tok');
});

test('a rejected query rejects the fetch, and .fail sees it', async () => {
  const boom = new Error('query failed');
  const { Parse } = stubParse(null, { reject: boom });
  const C = makeParseCollection(Parse);
  const c = new C();
  let caught = null;
  c.fetch().fail((e) => { caught = e; });
  await tick();
  assert.strictEqual(caught, boom, 'the failure is not swallowed into an empty collection');
  assert.strictEqual(c.length, 0);
});

test('fetch returns a Parse.Promise-compatible thenable, not a bare native one', async () => {
  const { Parse } = stubParse([]);
  const C = makeParseCollection(Parse);
  const c = new C();
  const p = c.fetch();
  assert.strictEqual(typeof p.then, 'function');
  assert.strictEqual(typeof p.fail, 'function', 'callers chain .fail off fetch');
  assert.strictEqual(typeof p.always, 'function');
  assert.strictEqual(CompatPromise.is(p), true);
  await tick();
});

test('_byCid indexes members by cid, as Parse.Collection did', () => {
  // Backbone 1.1.2 has no _byCid at all -- it folded that into _byId, keyed by
  // both id and cid. Character.js:548 reads `ens._byCid[model.cid]` inside
  // add_experience_notation, and without this every character creation dies
  // with "Cannot read properties of undefined (reading 'undefined')".
  const { Parse } = stubParse([]);
  const C = makeParseCollection(Parse);
  const c = new C([{ n: 1 }, { n: 2 }]);
  const index = c._byCid;
  assert.strictEqual(Object.keys(index).length, 2);
  c.models.forEach((m) => {
    assert.strictEqual(index[m.cid], m, 'each member is reachable by its cid');
  });
});

test('_byCid tracks the collection rather than caching a stale copy', () => {
  const { Parse } = stubParse([]);
  const C = makeParseCollection(Parse);
  const c = new C([{ n: 1 }]);
  const first = c.models[0];
  assert.ok(c._byCid[first.cid]);
  c.remove(first);
  assert.strictEqual(c._byCid[first.cid], undefined, 'a removed model leaves the index');
});
