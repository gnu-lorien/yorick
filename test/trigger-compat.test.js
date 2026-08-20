/**
 * The before-trigger seam's own tests.
 *
 * `cloud/trigger-compat.js` has four branches: no-response, caught throw,
 * returned thenable, and plain return. The last three ran thousands of times
 * across Step 6's seven gates, because parse-server 2.8.4 drives them on every
 * save the suite makes.
 *
 * The fourth -- `if (!response) return handler(request)` -- has executed ZERO
 * times, by construction. 2.8.4 always calls a before-trigger as
 * `trigger(request, response)` (node_modules/parse-server/lib/triggers.js:447),
 * so `response` is always defined and that branch is unreachable until the bump
 * makes it the only reachable one. It is the single line of Step 6 that Step 13
 * depends on and Step 6 could not test. So it is tested hardest here.
 *
 * WHAT IS REAL AND WHAT IS FAKE
 *
 *   real   `parse@1.11.1` (`require('parse/node')`). This is the node-side SDK
 *          the repo already runs and, since parse-server 2.8.4 has no nested
 *          copy of its own, the exact one 2.8.4 resolves -- so `Parse.Error`
 *          here is the same class `getResponseObject.error` tests with
 *          `instanceof`, and `Parse.Promise` here is the real thenable these
 *          hook chains are actually made of.
 *   real   `cloud/trigger-compat.js`, driven through its public
 *          `beforeSave`/`beforeDelete` exports rather than a private handle.
 *   real   `cloud/main.js`, loaded once against a capturing `Parse.Cloud` so
 *          the `require_a_user` tests drive the hooks as registered instead of
 *          a copy of them.
 *   fake   `Parse.Cloud`, which only has to remember what was registered.
 *   fake   the `request`/`response` pair. `fakeResponse` is a deliberate
 *          line-for-line replica of 2.8.4's `getResponseObject`
 *          (triggers.js:231-265), minus the afterFind arm a before-trigger can
 *          never reach. It is a replica and not the real thing because
 *          importing parse-server drags in a whole server for two closures;
 *          `the replica still matches the installed parse-server` below pins it
 *          to the source text so it cannot drift away silently.
 *
 * Not imported: parse-server itself.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const Parse = require('parse/node');

// ---------------------------------------------------------------------------
// Registration capture
//
// The seam's exports end in `Parse.Cloud.beforeSave(className, wrapped)`, so
// the only way to get at the wrapped function is to be the thing that receives
// it. `global.Parse` is what cloud code reads (parse-server injects it at boot
// via addParseCloud()); here the test supplies it.
// ---------------------------------------------------------------------------

const registered = { beforeSave: new Map(), beforeDelete: new Map() };

Parse.Cloud = {
  beforeSave: (className, fn) => registered.beforeSave.set(className, fn),
  beforeDelete: (className, fn) => registered.beforeDelete.set(className, fn),
  // main.js registers these too. Nothing in this file drives them; they exist
  // so requiring main.js does not throw.
  define: () => {},
  afterSave: () => {},
  afterDelete: () => {}
};

global.Parse = Parse;

const compat = require('../cloud/trigger-compat.js');

let probeSeq = 0;

/** Register `handler` through the seam and hand back the function the server would call. */
function seam(handler, kind) {
  const which = kind || 'beforeSave';
  const className = 'SeamProbe' + ++probeSeq;
  compat[which](className, handler);
  const wrapped = registered[which].get(className);
  assert.strictEqual(typeof wrapped, 'function', 'compat.' + which + ' registered nothing');
  return wrapped;
}

// ---------------------------------------------------------------------------
// The fakes
// ---------------------------------------------------------------------------

/**
 * Stands in for `request.object`, a `Parse.Object` under the real server.
 *
 * Only the two members the settlement path touches are modelled: `equals`,
 * which 2.8.4 uses to decide whether a `success(value)` argument is a
 * replacement save (triggers.js:244), and `_getSaveJSON`, which is what a
 * ZERO-ARGUMENT success resolves the save with (:249) -- the mechanism by which
 * a hook's mutations to `request.object` persist.
 */
function fakeObject(json) {
  const object = {
    json: json || { name: 'unchanged' },
    equals(other) { return other === object; },
    _getSaveJSON() { return Object.assign({}, object.json); }
  };
  return object;
}

function fakeRequest(overrides) {
  return Object.assign({ object: fakeObject(), master: false, user: undefined }, overrides || {});
}

/**
 * A replica of parse-server 2.8.4's `getResponseObject` (triggers.js:231-265).
 *
 * Faithful to the source in the two places that carry weight:
 *
 *   success  a truthy argument that is not the request's own object replaces
 *            the save (:244-246); anything else -- and `undefined` in
 *            particular -- falls through to `{object: request.object
 *            ._getSaveJSON()}` (:247-250).
 *   error    one argument that is a `Parse.Error` rejects with that instance
 *            verbatim (:255-257); one argument that is anything else becomes
 *            `new Parse.Error(SCRIPT_FAILED, value)` (:258-263).
 *
 * The afterFind arm (:233-241) is omitted: `triggerName` is beforeSave or
 * beforeDelete here and can never reach it.
 *
 * `calls` records what the seam did. `outcomes` records what the save would
 * have been settled with. Both are needed: the first proves the seam's contract
 * (zero-argument success), the second proves what reaches the client.
 */
function fakeResponse(request) {
  const calls = [];
  const outcomes = [];

  const response = {
    success: function (value) {
      calls.push({ kind: 'success', argc: arguments.length, args: Array.prototype.slice.call(arguments) });
      if (value && !request.object.equals(value)) {
        outcomes.push({ settled: 'resolve', value: value, replacedSave: true });
        return;
      }
      outcomes.push({
        settled: 'resolve',
        value: { object: request.object._getSaveJSON() },
        replacedSave: false
      });
    },
    error: function (code, message) {
      calls.push({ kind: 'error', argc: arguments.length, args: Array.prototype.slice.call(arguments) });
      if (!message) {
        if (code instanceof Parse.Error) {
          outcomes.push({ settled: 'reject', value: code });
          return;
        }
        message = code;
        code = Parse.Error.SCRIPT_FAILED;
      }
      outcomes.push({ settled: 'reject', value: new Parse.Error(code, message) });
    }
  };

  return { request, response, calls, outcomes };
}

/** Drive `handler` the way parse-server 2.8.4 does: `trigger(request, response)`. */
function callLegacy(handler, requestOverrides, kind) {
  const request = fakeRequest(requestOverrides);
  const rec = fakeResponse(request);
  rec.returned = seam(handler, kind)(request, rec.response);
  return rec;
}

/** Drive `handler` the way parse-server 9 does: `trigger(request)`, nothing else. */
function callModern(handler, requestOverrides, kind) {
  const request = fakeRequest(requestOverrides);
  return { request, returned: seam(handler, kind)(request) };
}

// `setImmediate`, not `setTimeout`: Parse.Promise defers its callbacks with
// `process.nextTick` when it can (parse/lib/node/ParsePromise.js:205-208), and
// nextTick drains ahead of the check phase -- so one immediate is already past
// any pending Parse.Promise continuation.
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Wait until `n` settlements have been recorded, or give up. */
async function awaitSettlements(rec, n) {
  for (let i = 0; i < 200 && rec.calls.length < n; i++) await tick();
  return rec.calls;
}

/** Wait long enough that a second settlement would have shown up if one were coming. */
async function letSettleAgain() {
  for (let i = 0; i < 20; i++) await tick();
}

// ---------------------------------------------------------------------------
// 1. The modern path -- the branch that has never run
// ---------------------------------------------------------------------------

test('modern: called with only a request, the handler still runs, synchronously', () => {
  let sawArgc = -1;
  let ran = false;
  const { request, returned } = callModern(function (req) {
    ran = true;
    sawArgc = arguments.length;
    req.object.json.name = 'mutated';
  });

  assert.strictEqual(ran, true, 'the handler must run in the same tick as the call');
  assert.strictEqual(sawArgc, 1, 'the handler must be handed the request and nothing else');
  assert.strictEqual(request.object.json.name, 'mutated',
    'request.object mutations must land before the trigger call returns');
  assert.strictEqual(returned, undefined);
});

test('modern: the handler is passed the very request object the server handed in', () => {
  let seen = null;
  const { request } = callModern((req) => { seen = req; });
  assert.strictEqual(seen, request, 'no wrapping, no copying -- parse-server 9 owns this object');
});

test('modern: the handler return value is what settles, returned by identity', () => {
  const sentinel = { object: { name: 'replacement' } };
  const { returned } = callModern(() => sentinel);
  assert.strictEqual(returned, sentinel,
    'parse-server 9 inspects the returned thenable for {object: ...}; adopting it ' +
    'into a fresh promise would hide that shape and insert a tick');
});

test('modern: a returned promise is handed back unadopted and resolves to its value', async () => {
  const promise = Promise.resolve('allowed');
  const { returned } = callModern(() => promise);
  assert.strictEqual(returned, promise, 'same promise, not a wrapper');
  assert.strictEqual(await returned, 'allowed');
});

test('modern: a returned Parse.Promise is handed back unadopted', async () => {
  const p = Parse.Promise.as('allowed');
  const { returned } = callModern(() => p);
  assert.strictEqual(returned, p);
  assert.strictEqual(await returned, 'allowed');
});

test('modern: a synchronous throw propagates out of the trigger call, unchanged', () => {
  const boom = new Parse.Error(Parse.Error.SCRIPT_FAILED, 'refused');
  let thrown = null;
  try {
    callModern(() => { throw boom; });
  } catch (error) {
    thrown = error;
  }
  assert.strictEqual(thrown, boom,
    'the seam must not catch on this path -- parse-server 9 calls the trigger ' +
    'inside its own promise chain, so a throw is how a hook refuses');
});

test('modern: a returned rejected promise stays rejected, with the same value', async () => {
  const boom = new Parse.Error(Parse.Error.SCRIPT_FAILED, 'refused');
  const { returned } = callModern(() => Promise.reject(boom));
  await assert.rejects(returned, (error) => error === boom);
});

test('modern: a returned rejected Parse.Promise stays rejected, with the same value', async () => {
  // A bare string is what `Parse.Promise.error(...)` rejects with in
  // beforeSave("VampireApproval"), and the hook's own normaliser is what turns
  // it into a Parse.Error. The seam must not get in the way of either.
  const boom = 'Unauthorized: Players cannot approve their own character changes';
  const { returned } = callModern(() => Parse.Promise.error(boom));

  let settled = null;
  await Promise.resolve(returned).then(
    (value) => { settled = { kind: 'resolved', value: value }; },
    (error) => { settled = { kind: 'rejected', error: error }; }
  );

  assert.strictEqual(settled.kind, 'rejected');
  assert.strictEqual(settled.error, boom);
});

test('modern: a rejection is NOT recovered into a resolution', async () => {
  // The Step 6 hazard, restated for the branch that has never run. Under 2.8.4
  // the danger was a rejection handler that returned normally and recovered the
  // chain, allowing a write the hook had just refused. The seam must not become
  // that handler: on this path it adds no `.then` at all.
  const boom = new Error('refused');
  const { returned } = callModern(() => Promise.reject(boom));

  let settled = null;
  await returned.then(
    (value) => { settled = { kind: 'resolved', value: value }; },
    (error) => { settled = { kind: 'rejected', error: error }; }
  );

  assert.strictEqual(settled.kind, 'rejected');
  assert.strictEqual(settled.error, boom);
});

test('modern: returning undefined is a permit, not a hang', async () => {
  // crop_and_thumb's early-out returns `undefined` on purpose when every
  // thumbnail already exists. parse-server 9 ignores a returned undefined and
  // allows the save; there must be nothing to await.
  const { returned } = callModern(() => undefined);
  assert.strictEqual(returned, undefined);
});

// ---------------------------------------------------------------------------
// 2. The legacy path -- 2.8.4's shape
// ---------------------------------------------------------------------------

test('legacy: a handler that returns normally calls success with ZERO arguments', () => {
  const rec = callLegacy(() => undefined);

  assert.strictEqual(rec.calls.length, 1);
  assert.strictEqual(rec.calls[0].kind, 'success');
  assert.strictEqual(rec.calls[0].argc, 0,
    'zero-argument success is load-bearing: it is what sends 2.8.4 down the ' +
    "response['object'] = request.object._getSaveJSON() path (triggers.js:249), " +
    'which is how a hook mutation persists');
});

test('legacy: zero-argument success resolves the save with the mutated object', () => {
  const rec = callLegacy((request) => { request.object.json.name = 'mutated'; });

  assert.deepStrictEqual(rec.outcomes, [{
    settled: 'resolve',
    value: { object: { name: 'mutated' } },
    replacedSave: false
  }]);
});

test('legacy: a returned non-thenable value is ignored, not forwarded to success', () => {
  // 2.8.4 treats a success argument as a replacement save. Every converted hook
  // returns to mean "allow", so the seam must swallow the value; forwarding it
  // would let `return someObject` silently overwrite the row being saved.
  const rec = callLegacy(() => ({ object: { name: 'hijacked' } }));

  assert.strictEqual(rec.calls[0].argc, 0);
  assert.strictEqual(rec.outcomes[0].replacedSave, false);
  assert.deepStrictEqual(rec.outcomes[0].value, { object: { name: 'unchanged' } });
});

test('legacy: the handler runs synchronously inside the trigger call', () => {
  let ran = false;
  const rec = callLegacy(function (request) {
    ran = true;
    assert.strictEqual(arguments.length, 1, 'the handler must never see the response');
    request.object.json.name = 'mutated';
  });

  assert.strictEqual(ran, true);
  assert.strictEqual(rec.request.object.json.name, 'mutated');
  assert.strictEqual(rec.returned, undefined, 'the legacy arm settles; it returns nothing');
});

test('legacy: a resolving thenable settles with success, once, asynchronously', async () => {
  const rec = callLegacy(() => Parse.Promise.as('whatever'));

  assert.strictEqual(rec.calls.length, 0, 'not settled before the chain finishes');
  await awaitSettlements(rec, 1);
  assert.strictEqual(rec.calls.length, 1);
  assert.strictEqual(rec.calls[0].kind, 'success');
  assert.strictEqual(rec.calls[0].argc, 0, 'still zero-argument, even from a chain');
});

test('legacy: a resolving native promise settles with success too', async () => {
  const rec = callLegacy(() => Promise.resolve('whatever'));
  await awaitSettlements(rec, 1);
  assert.deepStrictEqual(rec.calls.map((c) => c.kind), ['success']);
});

test('legacy: a synchronous throw reaches response.error with the same value', () => {
  const boom = new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Traits can only be changed by a logged in user.');
  const rec = callLegacy(() => { throw boom; });

  assert.strictEqual(rec.calls.length, 1);
  assert.strictEqual(rec.calls[0].kind, 'error');
  assert.strictEqual(rec.calls[0].args[0], boom, 'passed through, not re-wrapped');
  assert.strictEqual(rec.returned, undefined);
});

test('legacy: a rejected thenable reaches response.error with the same value', async () => {
  const boom = new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Existing ballot found.');
  const rec = callLegacy(() => Parse.Promise.error(boom));

  await awaitSettlements(rec, 1);
  assert.strictEqual(rec.calls[0].kind, 'error');
  assert.strictEqual(rec.calls[0].args[0], boom);
});

test('legacy: a rejected native promise reaches response.error with the same value', async () => {
  const boom = new Error('refused');
  const rec = callLegacy(() => Promise.reject(boom));

  await awaitSettlements(rec, 1);
  assert.strictEqual(rec.calls[0].kind, 'error');
  assert.strictEqual(rec.calls[0].args[0], boom);
});

test('legacy: beforeDelete goes through the same seam', async () => {
  const allowed = callLegacy(() => undefined, undefined, 'beforeDelete');
  assert.deepStrictEqual(allowed.calls.map((c) => c.kind), ['success']);
  assert.strictEqual(allowed.calls[0].argc, 0);

  const boom = new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Traits can only be changed by a logged in user.');
  const refused = callLegacy(() => { throw boom; }, undefined, 'beforeDelete');
  assert.deepStrictEqual(refused.calls.map((c) => c.kind), ['error']);
  assert.strictEqual(refused.calls[0].args[0], boom);
});

// ---------------------------------------------------------------------------
// 3. It cannot double-settle, and it cannot swallow a throw
// ---------------------------------------------------------------------------

test('no double-settle: a resolving chain settles exactly once', async () => {
  const rec = callLegacy(() => Parse.Promise.as('ok'));
  await awaitSettlements(rec, 1);
  await letSettleAgain();
  assert.deepStrictEqual(rec.calls.map((c) => c.kind), ['success']);
});

test('no double-settle: a rejecting chain never also calls success', async () => {
  const rec = callLegacy(() => Parse.Promise.error('refused'));
  await awaitSettlements(rec, 1);
  await letSettleAgain();
  assert.deepStrictEqual(rec.calls.map((c) => c.kind), ['error']);
});

test('no double-settle: a synchronous throw never also calls success', async () => {
  const rec = callLegacy(() => { throw new Error('refused'); });
  await letSettleAgain();
  assert.deepStrictEqual(rec.calls.map((c) => c.kind), ['error']);
});

test('no double-settle: the guarantee lives in Parse.Promise, which refuses a second settlement', async () => {
  // Worth being precise about where the safety is. The seam calls `.then` on
  // the returned value itself and passes one callback to each arm; it has no
  // guard of its own against a thenable that calls both. It does not need one,
  // because these chains are Parse.Promises and node-side parse@1.11.1 THROWS
  // on a second settlement (ParsePromise.js:80, :106) rather than quietly
  // calling through twice. Under parse-server 9 that stops mattering entirely:
  // there is no `response` left to settle twice.
  const p = new Parse.Promise();
  const rec = callLegacy(() => p);

  p.resolve('first');
  assert.throws(() => p.resolve('second'), /already been resolved/);
  assert.throws(() => p.reject('too late'), /already been resolved/);

  await awaitSettlements(rec, 1);
  await letSettleAgain();
  assert.deepStrictEqual(rec.calls.map((c) => c.kind), ['success']);
  assert.strictEqual(rec.calls[0].argc, 0);
});

test('no double-settle: a native promise settled twice still settles the trigger once', async () => {
  // The other thenable shape a converted hook can return -- crop_and_thumb's
  // chain starts in native promise land. Here a second settlement is ignored
  // rather than thrown, and the trigger must still see exactly one.
  const rec = callLegacy(() => new Promise((resolve, reject) => {
    resolve('first');
    resolve('second');
    reject('too late');
  }));

  await awaitSettlements(rec, 1);
  await letSettleAgain();
  assert.deepStrictEqual(rec.calls.map((c) => c.kind), ['success']);
});

test('cannot swallow a throw: legacy reports it, modern re-throws it, neither allows', async () => {
  const boom = new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Characters can only be changed by a logged in user.');

  const legacy = callLegacy(() => { throw boom; });
  assert.deepStrictEqual(legacy.calls.map((c) => c.kind), ['error']);
  assert.strictEqual(legacy.outcomes[0].settled, 'reject');

  assert.throws(() => callModern(() => { throw boom; }), (error) => error === boom);
});

test('cannot swallow a rejection: a rejected chain never resolves on either path', async () => {
  const boom = new Error('refused');

  const legacy = callLegacy(() => Promise.reject(boom));
  await awaitSettlements(legacy, 1);
  assert.strictEqual(legacy.outcomes[0].settled, 'reject');

  const modern = callModern(() => Promise.reject(boom));
  await assert.rejects(modern.returned, (error) => error === boom);
});

// ---------------------------------------------------------------------------
// 4. What reaches the client: Parse.Error vs a bare string
// ---------------------------------------------------------------------------

test('a Parse.Error passes through with its code and message intact', () => {
  const boom = new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Players cannot approve their own character changes');
  const rec = callLegacy(() => { throw boom; });

  const outcome = rec.outcomes[0];
  assert.strictEqual(outcome.settled, 'reject');
  assert.strictEqual(outcome.value, boom, '2.8.4 rejects with the instance itself (triggers.js:255-257)');
  assert.strictEqual(outcome.value.code, 141);
  assert.strictEqual(outcome.value.message, 'Players cannot approve their own character changes');
});

test('a bare string becomes Parse.Error SCRIPT_FAILED with that string as the message', () => {
  // Read off the installed parse-server, not assumed: `error(code, message)`
  // called with one argument that is not a Parse.Error does
  // `message = code; code = SCRIPT_FAILED` and rejects
  // `new Parse.Error(code, message)` (triggers.js:253-263). That is exactly what
  // every `response.error("...")` in main.js produced before the conversion, so
  // a hook that now throws `new Parse.Error(SCRIPT_FAILED, msg)` puts the same
  // thing on the wire.
  const rec = callLegacy(() => { throw 'Unauthorized: Approver does not have Storyteller role for this troupe'; });

  const outcome = rec.outcomes[0];
  assert.strictEqual(outcome.settled, 'reject');
  assert.ok(outcome.value instanceof Parse.Error);
  assert.strictEqual(outcome.value.code, Parse.Error.SCRIPT_FAILED);
  assert.strictEqual(outcome.value.code, 141);
  assert.strictEqual(outcome.value.message, 'Unauthorized: Approver does not have Storyteller role for this troupe');
});

test('a bare string and the equivalent Parse.Error are indistinguishable on the wire', () => {
  const message = 'Traits can only be changed by a logged in user.';
  const asString = callLegacy(() => { throw message; }).outcomes[0].value;
  const asError = callLegacy(() => { throw new Parse.Error(Parse.Error.SCRIPT_FAILED, message); }).outcomes[0].value;

  // This equivalence is the whole reason the conversion of require_a_user from
  // `response.error(string)` to `throw new Parse.Error(...)` is faithful: 141
  // and the same text either way, which is what approvals.spec.js's `toContain`
  // assertions read off the wire.
  assert.ok(asString instanceof Parse.Error);
  assert.ok(asError instanceof Parse.Error);
  assert.strictEqual(asString.code, asError.code);
  assert.strictEqual(asString.message, asError.message);
  assert.deepStrictEqual(
    { code: asString.code, message: asString.message },
    { code: asError.code, message: asError.message }
  );
});

test('the replica still matches the installed parse-server', (t) => {
  const version = require('parse-server/package.json').version;
  if (version !== '2.8.4') {
    t.skip('parse-server is ' + version + '; the legacy arm of the seam is dead and so is this check');
    return;
  }

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'node_modules', 'parse-server', 'lib', 'triggers.js'),
    'utf8'
  );

  // The three lines fakeResponse models. If a parse-server bump moves them, the
  // replica is stale and everything above it means less than it claims.
  assert.ok(
    source.includes("response['object'] = request.object._getSaveJSON();"),
    'the zero-argument success path is not where the replica thinks it is'
  );
  assert.ok(
    source.includes('if (code instanceof _node2.default.Error) {'),
    'the Parse.Error pass-through is not where the replica thinks it is'
  );
  assert.ok(
    source.includes('var triggerPromise = trigger(request, response);'),
    '2.8.4 no longer calls before-triggers with a response, which would make the ' +
    'legacy arm of the seam unreachable'
  );
});

// ---------------------------------------------------------------------------
// 5. require_a_user, as actually registered
//
// Loading cloud/main.js against the capturing Parse.Cloud above registers the
// real hooks into `registered`, so these drive the guard as shipped rather than
// a re-implementation of it. Before Step 6, require_a_user took a `response`
// and called `response.error(noun + " can only be changed by a logged in
// user.")` with a bare string; it now throws
// `new Parse.Error(SCRIPT_FAILED, <the same string>)`. Both reach the client as
// code 141 with that message -- see the wire-equivalence test above.
// ---------------------------------------------------------------------------

require('../cloud/main.js');

const GUARDED = [
  ['beforeSave', 'TroupePortrait', 'Troupe portraits'],
  ['beforeSave', 'CharacterPortrait', 'Character portraits'],
  ['beforeSave', 'Vampire', 'Characters'],
  ['beforeSave', 'SimpleTrait', 'Traits'],
  ['beforeDelete', 'SimpleTrait', 'Traits'],
  ['beforeSave', 'ExperienceNotation', 'Experience entries'],
  ['beforeDelete', 'ExperienceNotation', 'Experience entries'],
  ['beforeSave', 'LongText', 'Character texts'],
  ['beforeSave', 'VampireCreation', 'Character creation records']
];

for (const [kind, className, noun] of GUARDED) {
  test('require_a_user: ' + className + '/' + kind + ' refuses an anonymous write as "' + noun + '"', () => {
    const wrapped = registered[kind].get(className);
    assert.strictEqual(typeof wrapped, 'function', className + '/' + kind + ' is not registered');

    const request = fakeRequest();       // no user, no master: the refused case
    const rec = fakeResponse(request);
    wrapped(request, rec.response);

    assert.deepStrictEqual(rec.calls.map((c) => c.kind), ['error'],
      'the guard must refuse before the body can wander');
    const thrown = rec.calls[0].args[0];
    assert.ok(thrown instanceof Parse.Error);
    assert.strictEqual(thrown.code, Parse.Error.SCRIPT_FAILED);
    assert.strictEqual(thrown.message, noun + ' can only be changed by a logged in user.');
    assert.strictEqual(rec.outcomes[0].value.message, noun + ' can only be changed by a logged in user.');
  });
}

test('require_a_user: the master key satisfies the guard', () => {
  // Every save cloud code makes on a character's behalf passes useMasterKey,
  // which sets request.master. If the guard refused those, the hooks would
  // refuse their own writes.
  const wrapped = registered.beforeSave.get('LongText');
  const request = fakeRequest({ master: true });
  const rec = fakeResponse(request);
  wrapped(request, rec.response);

  assert.deepStrictEqual(rec.calls.map((c) => c.kind), ['success']);
  assert.strictEqual(rec.calls[0].argc, 0);
});

test('require_a_user: a logged-in user satisfies the guard', () => {
  const wrapped = registered.beforeSave.get('LongText');
  const request = fakeRequest({ user: { id: 'someUserId' } });
  const rec = fakeResponse(request);
  wrapped(request, rec.response);

  assert.deepStrictEqual(rec.calls.map((c) => c.kind), ['success']);
});

test('require_a_user: under parse-server 9 the same refusal is a throw', () => {
  // The same guard, on the branch that has never run. It must still refuse, and
  // it must refuse by throwing -- there is no response to call.
  const wrapped = registered.beforeSave.get('Vampire');
  const request = fakeRequest();

  assert.throws(
    () => wrapped(request),
    (error) =>
      error instanceof Parse.Error &&
      error.code === Parse.Error.SCRIPT_FAILED &&
      error.message === 'Characters can only be changed by a logged in user.'
  );
});
