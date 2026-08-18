# Parse 8 migration — session handoff

**Read this first, then start working. Do not summarise it back.**

Branch `claude/office-hours-upgrade-plan-092d60`, worktree at
`C:/prj/yorick/.claude/worktrees/office-hours-upgrade-plan-092d60`.

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

# Compat-layer contract tests (74, all green — keep them that way)
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
| parse@8 run | `runs/parse8s.json` — 67 passing, 18 regressions |
| Started at | 2 passing |
| Compat contract tests | 74, green |
| Commits on branch | 24 |

The compatibility layer is `public/scripts/lib/parse-compat/`: `promise`,
`collection`, `events`, `router`, `storage`, `thenable`, assembled by `index.js`
and installed by `parse.js` (the module RequireJS resolves `"parse"` to).

**`public/scripts/lib/parse-1.5.0.js` is still in the tree and is the
specification.** Every behaviour question was settled by reading it. Do the same
rather than reasoning about what "should" happen — that mistake cost a full
cycle (see `always()` below).

---

## Start here: the creation cluster (7 of the 18)

Fully diagnosed, not yet fixed.

```
toJSON → encode → toPointer → "Cannot create a pointer to an unsaved ParseObject"
```

**parse@8 refuses to encode a parent that references an unsaved child. Parse 1.5
tolerated it.**

Inside `Character.update_trait` (`public/scripts/app/models/Character.js:144`),
a new `SimpleTrait` is created and linked to the character, and the character is
then encoded before that child has been saved.

Evidence:

- `update_trait('Academics', 0, 'skills', 0)` **succeeds** on a freshly fetched character
- the identical call **fails** on the character the wizard view holds
- at rest that character has **zero** unsaved pointers, so the child is created
  during the call
- `get_category_for_fetch` already filters on `id`, so it is not the array
  element itself — it is a nested attribute

It surfaces as seven `waitForHashToLeave` timeouts because
`CharacterCreateSimpleTraitNewView.clicked`'s `.fail` handler only does
`console.log(error.message)` — the hash never moves and nothing is reported.

**Fix shape:** save the child before the parent is encoded.

**Be careful here.** `update_trait` is what XP arithmetic runs through, and
errors in it are silent wrong numbers rather than exceptions. Test 341 in
`e2e/lifecycle-vampire.spec.js` was written specifically to catch that class of
bug (it is mutation-checked — capping the refund in `Character.remove_trait`
fails it). Run it after any change here:

```bash
E2E_WORKERS=1 npx playwright test e2e/lifecycle-vampire.spec.js --grep "341"
```

## Then: the remaining 11

A parallel diagnosis pass produced an ordered queue — see
`docs/runbooks/parse8-remaining-queue.md` if present. Otherwise the clusters are:

- 3x deep-equality on "New character form creates a …"
- 2x `toBeVisible` in the XP notation UI, plus 1x "a freshly completed Vampire starts at 30/0/30"
- 2x `toHaveText` (patronage creation, long-text non-recording)
- 1x admin Storyteller toggle
- 1x `#troupe` page not becoming active
- 1x "sampast now appears on staff"

## After that: S10, untouched

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

**`always()` is `then(cb, cb)`** (`parse-1.5.0.js:4169`). It propagates the
callback's return value AND converts rejections to fulfilment — so every
`.always(...).fail(...)` chain in `mobileRouter` has dead `.fail` handlers. That
is preserved deliberately. Making them fire is a behaviour change, not a fix.

**`Parse.Cloud.run` is a non-configurable getter.** Assigning to it throws during
install and kills bootstrap. `thenable.js` shadows it on a delegating object
whose prototype is the original, using `defineProperty` (plain assignment walks
the chain to the setter-less getter and throws).

**Copying property descriptors off SDK namespaces breaks bootstrap.** Delegate
via the prototype chain instead.

**parse@8's attribute bag is `Object.create(null)`** — never call
`attrs.hasOwnProperty(k)`.

**The noise floor is low but not zero** (~1 bad run in 7, tests 49 and 114). A
small NEW-FAIL count means re-run before believing it. See
`docs/runbooks/harness-noise-floor.md`.

**26 Jasmine specs fail** because they predate the R1–R51 security work and hit
`require_a_user` / CLP guards. That is a separate, known piece of work.

---

## Not in scope without asking

- Anything touching production, `greensboro`, or deploy config
- The deployed `serverURL` values in `siteconfig.js` — they need the same `/1`
  the localhost one got, but changing them changes where a build points
- The production CLP remediation in `docs/runbooks/production-clp-remediation.md`
  (deferred by the owner)
