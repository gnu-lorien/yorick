/**
 * Contract tests for the assembled compatibility layer.
 *
 * The individual shims have their own suites; this covers what only shows up
 * when they are installed together onto one Parse namespace -- ordering,
 * idempotence, and not shadowing anything the real SDK still provides.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

global._ = require('../public/scripts/lib/lodash.js');
const Backbone = require('../public/scripts/lib/backbone.js');
global.Backbone = Backbone;

const install = require('../public/scripts/lib/parse-compat/index');

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

  return { Object: PObject, Query };
}

test('install() adds exactly the four things parse@8 dropped', () => {
  const Parse = makeModernParse();
  assert.strictEqual(Parse.Promise, undefined);
  assert.strictEqual(Parse.Collection, undefined);
  assert.strictEqual(Parse.Router, undefined);
  assert.strictEqual(typeof Parse.Object.prototype.on, 'undefined');

  install(Parse);

  assert.strictEqual(typeof Parse.Promise, 'function');
  assert.strictEqual(typeof Parse.Collection, 'function');
  assert.strictEqual(typeof Parse.Router, 'function');
  assert.strictEqual(typeof Parse.history, 'object');
  assert.strictEqual(typeof Parse.Object.prototype.on, 'function');
});

test('events reach subclasses made by Parse.Object.extend AFTER install', () => {
  // Ordering: events wrap Parse.Object.prototype.set, so a subclass created
  // later must inherit the wrapped one.
  const Parse = install(makeModernParse());
  const Vampire = Parse.Object.extend('Vampire');
  const v = new Vampire({ name: 'old' });
  const seen = [];
  v.on('change:name', (m, value) => seen.push(value));
  v.set('name', 'new');
  assert.deepStrictEqual(seen, ['new']);
});

test('events also reach subclasses made BEFORE install', () => {
  // mobileRouter and the models module both call Parse.Object.extend at load
  // time, which can run before install() depending on RequireJS ordering.
  // Prototype mutation is what makes that safe.
  const Parse = makeModernParse();
  const Vampire = Parse.Object.extend('Vampire');
  install(Parse);
  const v = new Vampire({ n: 1 });
  let fired = 0;
  v.on('change', () => { fired++; });
  v.set('n', 2);
  assert.strictEqual(fired, 1, 'a subclass created before install still gains events');
});

test('Parse.Collection is wired to the same namespace it was installed on', async () => {
  const Parse = install(makeModernParse());
  const C = Parse.Collection.extend({ model: 'Thing' });
  const c = new C();
  let resolved = null;
  c.fetch().then((v) => { resolved = v; });
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(resolved, c);
});

test('install is idempotent and does not double-fire events', () => {
  const Parse = makeModernParse();
  install(Parse);
  install(Parse);
  const v = new (Parse.Object.extend('X'))({ n: 1 });
  let fired = 0;
  v.on('change', () => { fired++; });
  v.set('n', 2);
  assert.strictEqual(fired, 1);
});

test('install does NOT shadow anything the SDK already provides', () => {
  // If a future parse ships its own Promise or routing, the shim must step
  // aside rather than quietly replacing a supported implementation.
  const Parse = makeModernParse();
  const sentinelPromise = function () {};
  const sentinelRouter = function () {};
  Parse.Promise = sentinelPromise;
  Parse.Router = sentinelRouter;

  install(Parse);

  assert.strictEqual(Parse.Promise, sentinelPromise, 'existing Promise left alone');
  assert.strictEqual(Parse.Router, sentinelRouter, 'existing Router left alone');
});

test('Parse.Promise round-trips through the installed namespace', async () => {
  const Parse = install(makeModernParse());
  let got = null;
  Parse.Promise.when(Parse.Promise.as('a'), Parse.Promise.as('b')).then(function (x, y) {
    got = [x, y];
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepStrictEqual(got, ['a', 'b'], 'multi-arg resolution survives assembly');
});

test('install throws rather than silently no-oping on a missing namespace', () => {
  assert.throws(() => install(null), /no Parse namespace/);
});
