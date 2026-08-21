# Parse 8 migration — session handoff

**Read this first, then start working. Do not summarise it back.**

Branch `claude/office-hours-upgrade-plan-092d60`, worktree at
`C:/prj/yorick/.claude/worktrees/office-hours-upgrade-plan-092d60`.

The browser-side migration continued on
`worktree-bridge-cse_01KkdkFXDZi8Xq9zuYYqZdgV`, seventeen commits on top of
`b10cb2d`, and is **done**: the suite matches the legacy baseline exactly.

---

## How to work in this repo

**Keep going until the work is done or you are genuinely blocked.** The previous
session's failure mode was stopping every 20 minutes to write a status report.
Do not do that. Commit as you go; the commit log IS the report.

These are NOT reasons to stop and ask:

- you finished one fix and there are more
- the context is getting long (the harness summarises; keep working)
- you want to check the plan is still right
- a change did not improve the number (say so in the commit, move on)
- you have been working a long time

These ARE reasons to stop:

- a change would touch production data, credentials, or deploy config
- the differential harness reports a regression you cannot explain after two attempts
- the work needs a product decision only the owner can make (e.g. "should this
  error toast now fire, when it never did before?")

**Report at the end, not throughout.**

### You have both ends of the codebase. Use that.

**Do not spend hours emulating a Parse 1.5 behaviour in the shim when the
application code can be changed to something both SDKs support.** The old SDK,
the new SDK and the app are all in this tree. A compatible change to the app is
very often cheaper, smaller and more durable than a faithful emulation — and it
leaves behind less to carry.

The rule of thumb: **if you are on your second attempt at emulating an SDK
behaviour, stop and look at the application side instead.**

This is not "never shim". It is a cost comparison, made honestly:

| Situation | Shim | Change the app |
|---|---|---|
| `Parse.Promise`, 456 call sites | ✅ ~200 lines | ✗ 456 hand edits |
| `Parse.Collection`, 12 subclasses feeding Marionette | ✅ ~80 lines | ✗ rewrite the data layer |
| `__super__` / repeated-className inheritance | ✗ **cost 32 tests** | ✅ **5 lines** |
| `{success, error}` callbacks, 4 sites | ✗ pointless | ✅ 4 small edits |

The third row is the cautionary one. Parse 1.5 turned a repeated className into
inheritance, and the previous session spent two full attempts reproducing that
inside `extend` — a hand-rolled subclass constructor (regressed the suite from
68 to 36 passing) and then a pre-merge prototype snapshot (recursed infinitely).
parse@8 cannot support it at all: `extend` short-circuits on
`if (classMap[adjustedClassName])` before it ever chooses a parent prototype.

The actual fix was on the application side and took five lines: expose
`Character.baseMethods` and have each venue do
`_.defaults(instance_methods, Character.baseMethods)`. That is compatible with
BOTH SDKs — it would have worked identically under 1.5 — so it is a real
improvement to the app rather than scaffolding that has to be maintained until
the codemod lands.

That is the shape to look for: **a change that is correct under both SDKs.**
Those are not migration debt. They are the migration paying for itself.

When you do reach for the app side, keep the change faithful. Preserving
behaviour is still the goal — the point is that you have two ways to preserve
it, not that behaviour is now negotiable.

### The loop that works

1. Read the failure out of the captured JSON (never guess at a cause)
2. Reproduce it in a standalone browser probe (fast: ~40s vs 4 min for the suite)
3. Fix
4. Verify the probe
5. Full suite + diff
6. Commit with the mechanism written down

Each cycle is roughly 10 minutes. Thirteen defects were fixed this way.

### Commands

```bash
# Full suite, recorded. ~3-4 min, 8 workers.
E2E_RUN_NAME=mine npx playwright test

# Compare against the legacy baseline. 0 NEW-FAIL is the goal.
node diff-runs.js runs/baseline.json runs/mine.json

# One spec, one worker, much faster
E2E_WORKERS=1 npx playwright test e2e/xp-history.spec.js --grep "75 "

# Compat-layer contract tests (103, all green — keep them that way)
npm run test:node

# Jasmine in headless Chrome (166 run, 140 pass; the 26 are stale, see below)
npm test
```

### The probe pattern

Standalone Playwright script, run from the repo root so module resolution works.
This is how nearly every defect below was found:

```js
const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('[err] ' + String(e.stack || e).split('\n').slice(0,5).join('\n')));
  await p.goto('http://127.0.0.1:1337/', { waitUntil: 'load' });
  // Wait for the APP, not just for Parse — Parse.initialize runs later.
  await p.waitForFunction(() => window.jQuery && window.jQuery.mobile
    && window.Parse && window.Parse.applicationId, null, { timeout: 30000 });
  await p.evaluate(async () => { await window.Parse.User.logIn('devuser','thedumbness'); });
  // ... drive the app, inspect via p.evaluate ...
  await b.close();
})();
```

Start the server yourself first: `YORICK_ALLOW_SEED=1 node index.js &`
(seeding is opt-in; see `seedingAllowed` in `seed_db.js`).

---

## State

| | |
|---|---|
| Legacy baseline | `runs/baseline.json` — 447 tests, verified clean-vs-clean |
| parse@8 run | `runs/m18.json` — **447 same-pass, 0 NEW-FAIL** |
| Was | `runs/parse8s.json` — 67 passing, 18 regressions |
| Started at | 2 passing |
| Compat contract tests | 103, green |
| Commits | 24 + 17 |

The 18 are gone, and so is everything they were hiding. The passing count went
67 → 138 → 198 → 274 → 333 → 447 while NEW-FAIL went 18 → 16 → 15 → 12 → 7 →
0, because most of the 18 were one early defect standing in front of hundreds
of tests. What each of them turned out to be is in
`docs/runbooks/parse8-remaining-queue.md`.

The compatibility layer is `public/scripts/lib/parse-compat/`: `promise`,
`collection`, `events`, `router`, `storage`, `thenable`, assembled by `index.js`
and installed by `parse.js` (the module RequireJS resolves `"parse"` to).

**`public/scripts/lib/parse-1.5.0.js` is still in the tree and is the
specification.** Every behaviour question was settled by reading it. Do the same
rather than reasoning about what "should" happen — that mistake cost a full
cycle (see `always()` below).

---

## Start here: S10

The browser side is finished. Everything below is still true and still worth
reading before touching this code, but there is no queue of known regressions
left to work through. The next piece is S10, further down.

If you are picking it up because something regressed, the loop is unchanged:
read the failure out of the captured JSON, reproduce it in a standalone probe,
fix, verify the probe, full suite, diff. And check `logs/parse-server.err.*` —
it is still the cheapest signal in the repo.

## What the 18 taught, in one line each

- **Read `parse-1.5.0.js`. Do not reason about what promises "should" do.** The
  two biggest finds were both places where this layer had implemented the
  sensible modern semantics instead of the shipped 1.5 ones: `.fail` recovering
  a chain (1.5 runs non-A+, `:3892`, and rejects with the handler's return
  value at `:4126`), and construction validating (1.5's constructor sets
  `{silent: true}` at `:4526`, and `_validate` returns early when silent at
  `:5917`).
- **Ten of the 18 were "something silently stopped happening".** Missing
  events, dropped arguments, guards that used to be true. None threw.
- **Four of the last six were not Parse at all** — rendering races the legacy
  stack won on timing. They are real defects for a player too.
- **A test that passes at four workers and fails at eight is telling you
  something is re-rendering underneath an interaction.** That was test 54.

## S10, untouched

`cloud/main.js` — 13 Cloud functions and 14 hooks still on the
`(request, response)` signature parse-server 3.0 removed, plus 60
`response.success`/`response.error` calls and 37 legacy-promise uses. Then
parse-server 2.8.4 → 9.10.0, node-side `parse` 1.11 → 8.6, MongoDB 8.2.6
in-memory (the binary is already cached), `jimp` 0.2 → modern, and replacing
`request`.

---

## Traps. Do not re-discover these.

**Read the error before instrumenting.** Three prior sessions added diagnostics
to lines the failure never reached — 355b's elaborate table-state diagnostic
wraps the re-render wait, but the test dies on the hash wait above it, so it
never once fired. Get the stack out of the JSON first.

**TrackJS ate stacks.** Now disabled for loopback (`public/index.html`). If a
page error ever reads `at wrapError (tracker.js)` with no app frames, that guard
has regressed.

**Four modules register className `"Vampire"` on purpose** — Character, Vampire,
Werewolf, ChangelingBetaSlice all share one Mongo table. **Never give them
distinct classNames.** Parse 1.5 turned the repeated className into inheritance
(`parse-1.5.0.js:6127` → `OldClassObject._extend(...)`; `_extend` sets
`child.__super__ = parent.prototype` at `:1327`). parse@8 cannot: `extend`
short-circuits on `if (classMap[adjustedClassName])` **before** choosing a parent
prototype. Building a real chain anyway was tried and cost 32 tests. The fix that
worked is explicit composition — `Character.baseMethods` plus
`_.defaults(instance_methods, Character.baseMethods)` in each venue.

That was only half of it, and the other half was invisible until the first
half landed. The repeated className also meant the three venues shared one
constructor, so `Model.create = ...` in three modules was three writes to one
slot: measured, `Vampire.create === Werewolf.create`, and
`Vampire.all_text_attributes()` returned the Changeling list. And 1.5's
`Parse.Query` kept the CLASS, not just the name (`:8129`, `obj = new
self.objectClass()` at `:8277`), which is what made
`new Parse.Query(Werewolf).get(id)` come back with Werewolf's methods.
`app/helpers/VenueClass.js` restores both — a per-module identity, and a
`__compatCast` the query shim in `lib/parse-compat/query.js` applies to
results. One registered class, three identities.

**`always()` is `then(cb, cb)`** (`parse-1.5.0.js:4169`), and it propagates the
callback's return value. It does **not** convert a rejection to fulfilment —
the earlier version of this note said it did, and was wrong. 1.5 runs with
`_isPromisesAPlusCompliant: false` (`:3892`), so the rejection branch ends at
`promise.reject(result[0])` (`:4126`): the chain stays rejected, carrying the
callback's return value. The `.always(...).fail(...)` chains in `mobileRouter`
are live, and `show_character_helper`'s redirect-on-denial depends on it.

The corollary is a real trap: **put `always(hide)` LAST in a chain.** Anywhere
above a `.fail`, it replaces the rejection reason with `undefined`, and the
handler below reports "An unknown error occurred." That regressed test 201b
once already.

**`Parse.Cloud.run` is a non-configurable getter.** Assigning to it throws during
install and kills bootstrap. `thenable.js` shadows it on a delegating object
whose prototype is the original, using `defineProperty` (plain assignment walks
the chain to the setter-less getter and throws).

**Copying property descriptors off SDK namespaces breaks bootstrap.** Delegate
via the prototype chain instead.

**parse@8's attribute bag is `Object.create(null)`** — never call
`attrs.hasOwnProperty(k)`.

**This layer runs with unique instances**, because 1.5 had no object registry:
every query built its results with `new self.objectClass()`. `install()` calls
`Parse.Object.disableSingleInstance()` first, before any subclass is registered.
Two consequences worth knowing before you debug something: the same row read
twice gives two objects, and a save response's bare pointers would unfetch what
you already have — which is why `_handleSaveResponse` is wrapped to put the
fetched objects back, exactly as `_finishSave` did at `parse-1.5.0.js:5100`.

**The noise floor is low but not zero** (~1 bad run in 7, tests 49 and 114). A
small NEW-FAIL count means re-run before believing it. See
`docs/runbooks/harness-noise-floor.md`. `runs/m17.json` is a fresh example: one
NEW-FAIL in test 49, and the immediately following run of identical code was
clean at 447.

**26 Jasmine specs fail** because they predate the R1–R51 security work and hit
`require_a_user` / CLP guards. That is a separate, known piece of work.

---

## Not in scope without asking

- Anything touching production, `greensboro`, or deploy config
- The deployed `serverURL` values in `siteconfig.js` — they need the same `/1`
  the localhost one got, but changing them changes where a build points
- The production CLP remediation in `docs/runbooks/production-clp-remediation.md`
  (deferred by the owner)
