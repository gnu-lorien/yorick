/**
 * Contract tests for the Parse.Promise compatibility layer.
 *
 * Every expectation here was read out of the original implementation in
 * `public/scripts/lib/parse-1.5.0.js` (`Parse.Promise.when` at line 3949 and
 * the prototype above it), not inferred from how native promises behave. The
 * three that matter are the ones where a native mapping is silently wrong
 * rather than loudly wrong:
 *
 *   - `when` resolves with separate arguments, not an array
 *   - `when` waits for every input to settle, then rejects with an array of
 *     errors, where `Promise.all` rejects on the first one with a single error
 *   - `.always` IS `then(callback, callback)`, so it both propagates the
 *     callback's return value and converts a rejection into a fulfilment
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const P = require('../public/scripts/lib/parse-compat/promise');

// --------------------------------------------------------------------------
// as / error / is
// --------------------------------------------------------------------------

test('as() resolves with a single value', async () => {
  const seen = [];
  P.as(7).then((v) => seen.push(v));
  await tick();
  assert.deepStrictEqual(seen, [7]);
});

test('as() resolves with MULTIPLE values, delivered as separate arguments', async () => {
  let got = null;
  P.as('a', 'b', 'c').then(function () {
    got = Array.prototype.slice.call(arguments);
  });
  await tick();
  assert.deepStrictEqual(got, ['a', 'b', 'c']);
});

test('as() with no arguments resolves with none', async () => {
  let argc = -1;
  P.as().then(function () { argc = arguments.length; });
  await tick();
  assert.strictEqual(argc, 0);
});

test('error() rejects', async () => {
  let err = null;
  P.error(new Error('nope')).fail((e) => { err = e; });
  await tick();
  assert.strictEqual(err.message, 'nope');
});

test('is() recognises its own promises and not arbitrary thenables', () => {
  assert.strictEqual(P.is(P.as(1)), true);
  assert.strictEqual(P.is(Promise.resolve(1)), false, 'a bare native promise is not a Parse.Promise');
  assert.strictEqual(P.is(null), false);
  assert.strictEqual(P.is({}), false);
});

// --------------------------------------------------------------------------
// when — the three traps
// --------------------------------------------------------------------------

test('TRAP 1: when(a, b) resolves with SEPARATE arguments, not an array', async () => {
  // The live caller this protects reads `.then(function (troupe, user) {...})`.
  // Under Promise.all, `troupe` would be the whole array and `user` undefined,
  // with nothing anywhere reporting a problem.
  let troupe, user;
  P.when(P.as('TROUPE'), P.as('USER')).then(function (t, u) {
    troupe = t;
    user = u;
  });
  await tick();
  assert.strictEqual(troupe, 'TROUPE');
  assert.strictEqual(user, 'USER', 'the second value must arrive as the second argument');
});

test('TRAP 1 contrast: Promise.all would have bound them wrongly', async () => {
  let first, second;
  await Promise.all([Promise.resolve('TROUPE'), Promise.resolve('USER')]).then(function (a, b) {
    first = a;
    second = b;
  });
  assert.deepStrictEqual(first, ['TROUPE', 'USER'], 'Promise.all passes one array');
  assert.strictEqual(second, undefined, 'and nothing as the second argument');
});

test('TRAP 2: when waits for every input to settle before rejecting', async () => {
  const settled = [];
  const slowOk = new P();
  const fastFail = new P();

  const result = P.when(fastFail, slowOk);
  let rejectedWith = null;
  result.fail((e) => { rejectedWith = e; });

  fastFail.reject(new Error('first'));
  await tick();
  assert.strictEqual(rejectedWith, null, 'must not reject while another input is still pending');

  settled.push('slow');
  slowOk.resolve('ok');
  await tick();
  assert.ok(rejectedWith, 'now it rejects, once everything has settled');
});

test('TRAP 2: when rejects with an ARRAY of errors, indexed to the inputs', async () => {
  const e1 = new Error('one');
  const e2 = new Error('two');
  let rejectedWith = null;
  P.when(P.error(e1), P.as('fine'), P.error(e2)).fail((e) => { rejectedWith = e; });
  await tick();
  assert.ok(Array.isArray(rejectedWith), 'the rejection value is an array');
  assert.strictEqual(rejectedWith[0], e1);
  assert.strictEqual(rejectedWith[1], undefined, 'the successful slot is empty, not collapsed away');
  assert.strictEqual(rejectedWith[2], e2);
});

test('TRAP 3: when accepts an array as its single argument', async () => {
  // models/Troupe.js:49 does exactly this: Parse.Promise.when(promises).
  let got = null;
  P.when([P.as(1), P.as(2), P.as(3)]).then(function () {
    got = Array.prototype.slice.call(arguments);
  });
  await tick();
  assert.deepStrictEqual(got, [1, 2, 3]);
});

test('TRAP 3: when accepts varargs', async () => {
  let got = null;
  P.when(P.as(1), P.as(2)).then(function () {
    got = Array.prototype.slice.call(arguments);
  });
  await tick();
  assert.deepStrictEqual(got, [1, 2]);
});

test('when([]) resolves immediately with no values', async () => {
  let argc = -1;
  P.when([]).then(function () { argc = arguments.length; });
  await tick();
  assert.strictEqual(argc, 0);
});

test('when passes non-promise values straight through, in position', async () => {
  let got = null;
  P.when(P.as('a'), 'plain', P.as('c')).then(function () {
    got = Array.prototype.slice.call(arguments);
  });
  await tick();
  assert.deepStrictEqual(got, ['a', 'plain', 'c']);
});

// --------------------------------------------------------------------------
// always — then(callback, callback), verified against parse-1.5.0.js:4169
// --------------------------------------------------------------------------

test('always() runs on success, and its return value REPLACES the value', async () => {
  // Because always is then(cb, cb), the downstream value is whatever the
  // callback returned -- not the original. Callbacks that return nothing
  // therefore hand `undefined` onward, which is fine for the
  // $.mobile.loading("hide") ones and load-bearing for the few that return.
  const calls = [];
  let downstream = 'NOT SET';
  P.as('v').always(() => { calls.push('always'); return 'replaced'; })
    .then(function (v) { downstream = v; });
  await tick();
  assert.deepStrictEqual(calls, ['always']);
  assert.strictEqual(downstream, 'replaced');
});

test('always() runs on rejection and leaves the chain rejected', () => {
  // `always` is `then(callback, callback)` (parse-1.5.0.js:4169), and the
  // rejection branch of 1.5's `then` ends at `promise.reject(result[0])`
  // (:4126) because `_isPromisesAPlusCompliant` is false (:3892) and nothing
  // in this app turns it on. So the callback runs, its return value becomes
  // the new rejection reason, and a `.fail` after it DOES fire.
  //
  // An earlier version of this shim treated the rejection as recovered, on the
  // reasoning that `then(cb, cb)` "absorbs" it. That is what `.catch` does; it
  // is not what 1.5 did, and it made `mobileRouter`'s redirect-on-denial
  // handlers dead code.
  const calls = [];
  let reachedFail = false;
  return new Promise((resolve, reject) => {
    P.error(new Error('boom'))
      .always(() => calls.push('always'))
      .fail(() => { reachedFail = true; })
      .always(() => {
        try {
          assert.deepStrictEqual(calls, ['always']);
          assert.strictEqual(reachedFail, true,
            '.fail after .always is live, as it is in parse-1.5.0.js');
          resolve();
        } catch (err) { reject(err); }
      });
  });
});

test('always() propagates its callback return value', () => {
  // Character.add_experience_notation does
  //   .always(function () { return self.get_experience_notations(); })
  //   .then(function (ens) { ens.add(...) })
  // and fails with "Cannot read properties of undefined (reading 'add')" if
  // the returned value is dropped.
  let received = 'NOT SET';
  return P.as('ignored')
    .always(() => 'passed-through')
    .then((v) => { received = v; })
    .then(() => assert.strictEqual(received, 'passed-through'));
});

test('the real chain shape from mobileRouter: done -> always -> fail', () => {
  const order = [];
  return new Promise((resolve, reject) => {
    P.error(new Error('nope'))
      .done(() => order.push('done'))
      .always(() => order.push('always'))
      .fail(() => order.push('fail'))
      .always(() => {
        try {
          assert.deepStrictEqual(order, ['always', 'fail'],
            'done is skipped; always runs, and the rejection survives it to reach fail');
          resolve();
        } catch (err) { reject(err); }
      });
  });
});

// --------------------------------------------------------------------------
// then semantics
// --------------------------------------------------------------------------

test('a rejection handler that returns a value does NOT recover the chain', async () => {
  // parse-1.5.0.js:4126, non-A+ mode: `promise.reject(result[0])`. The
  // handler's return value becomes the next rejection reason.
  let resolvedWith = null;
  let rejectedWith = 'untouched';
  P.error(new Error('x'))
    .fail(() => 'not a recovery')
    .then((v) => { resolvedWith = v; }, (e) => { rejectedWith = e; });
  await tick();
  assert.strictEqual(resolvedWith, null, 'the chain did not resolve');
  assert.strictEqual(rejectedWith, 'not a recovery',
    'it stays rejected, carrying the handler return value');
});

test('a rejection handler that returns a PROMISE does recover the chain', async () => {
  // The one branch 1.5 takes before the reject: `if (Parse.Promise.is(result[0]))`
  // adopts it (parse-1.5.0.js:4116-4122). This is what keeps
  // `.always(function () { return self.get_experience_notations(); })` usable.
  let recovered = null;
  P.error(new Error('x')).fail(() => P.as('recovered')).then((v) => { recovered = v; });
  await tick();
  assert.strictEqual(recovered, 'recovered');
});

test('a throw inside a handler rejects the next promise', async () => {
  let err = null;
  P.as(1).then(() => { throw new Error('thrown'); }).fail((e) => { err = e; });
  await tick();
  assert.strictEqual(err.message, 'thrown');
});

test('returning a promise from a handler adopts it', async () => {
  let got = null;
  P.as(1).then(() => P.as('inner')).then((v) => { got = v; });
  await tick();
  assert.strictEqual(got, 'inner');
});

test('a missing handler passes the outcome straight through', async () => {
  let got = null;
  let err = null;
  P.as('v').fail(() => 'not called').then((v) => { got = v; });
  P.error(new Error('e')).done(() => 'not called').fail((e) => { err = e; });
  await tick();
  assert.strictEqual(got, 'v');
  assert.strictEqual(err.message, 'e');
});

// --------------------------------------------------------------------------
// native interop, which is the whole point of the migration
// --------------------------------------------------------------------------

test('a native promise returned from a handler is adopted', async () => {
  let got = null;
  P.as(1).then(() => Promise.resolve('from-native')).then((v) => { got = v; });
  await tick();
  assert.strictEqual(got, 'from-native');
});

test('when() accepts native promises alongside its own', async () => {
  let got = null;
  P.when(Promise.resolve('native'), P.as('compat')).then(function () {
    got = Array.prototype.slice.call(arguments);
  });
  await tick();
  assert.deepStrictEqual(got, ['native', 'compat']);
});

test('toNative() hands back a real promise, awaitable', async () => {
  const v = await P.as('x').toNative();
  assert.strictEqual(v, 'x');
});

test('toNative() on a multi-value promise yields the array', async () => {
  const v = await P.as('a', 'b').toNative();
  assert.deepStrictEqual(v, ['a', 'b']);
});

test('toNative() rejects', async () => {
  await assert.rejects(() => P.error(new Error('r')).toNative(), /r/);
});

test('from() adopts a native promise', async () => {
  let got = null;
  P.from(Promise.resolve('adopted')).then((v) => { got = v; });
  await tick();
  assert.strictEqual(got, 'adopted');
});

// --------------------------------------------------------------------------
// deferred construction, the `new Parse.Promise()` form (2 live sites)
// --------------------------------------------------------------------------

test('new Promise() then resolve() later', async () => {
  const p = new P();
  let got = null;
  p.then((v) => { got = v; });
  await tick();
  assert.strictEqual(got, null, 'nothing before it resolves');
  p.resolve('later');
  await tick();
  assert.strictEqual(got, 'later');
});

test('resolving twice is ignored', async () => {
  const p = new P();
  const seen = [];
  p.then((v) => seen.push(v));
  p.resolve('first');
  p.resolve('second');
  await tick();
  assert.deepStrictEqual(seen, ['first']);
});

/** Let the microtask queue drain. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
