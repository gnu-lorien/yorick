<!--
Written 2026-08-21, to be handed to a fresh session.

State at the time of writing: the E2E gate PASSES. 448 of 448 baseline tests
still pass, 0 regressions, 0 lost, 0 flaky, recorded in runs/s11-verify-2.json.
The unit suite is 249 tests, 248 passing.

NOTHING IN THIS DOCUMENT IS A FAILING TEST. Everything here is a test that does
not run, or runs only because a failure is being forgiven.

Branch: topic/parse8-migration, at b463087 or later.
-->

# The tests that are not really running

## Read this first: "skipped" here does not mean "broken"

Three E2E tests are skipped. They are **two unrelated situations**, and only one
of them is a test problem:

| test | what it actually is |
|---|---|
| `creation-werewolf.spec.js :: 212 Renown allocation` | a test for a feature **that was never built** |
| `lifecycle-werewolf.spec.js :: 350 Change 7 - raise Renown` | same |
| `character-sheet.spec.js :: SimpleTrait Edit View` | **a genuine test defect.** Fixable today. |

The two Renown tests are not defective and were skipped on purpose. Their own
comments say so:

> DEFERRED FEATURE, not a defect. Renown (Glory/Honor/Wisdom) has no trait
> category, no seed data and no sheet rendering today, so there is nothing to
> test yet. Skipped rather than pinned red: `test.fail()` asserts "this is
> broken", and this is simply unbuilt. Unskip when it lands.

Verified independently for this document: the string `Renown` appears **nowhere**
in `public/scripts/app/` except one Jasmine spec file. No wizard step, no
Description rows, no sheet section. **"Fixing" those two means building Renown**,
which is a product decision and not test work. If that is what you want, they are
a specification of the acceptance criteria and a good place to start — but go in
knowing it is a feature, not a repair.

**So the actionable item is one test, and it is section 1.**

Sections 2 to 4 are other places where green means less than it looks. They are
independent; do any one without the others.

---

## 1. `SimpleTrait Edit View` has never run, on any stack

**Effort: small. This is the real one.**

`e2e/character-sheet.spec.js:107` skips itself at runtime:

```js
if (!traitId) {
  test.skip('No trait ID available for trait edit test');
  return;
}
```

`traitId` is set in `beforeAll` from a freshly created character:

```js
const attributes = v.get('attributes') || [];
const firstAttr = attributes.length > 0 ? attributes[0].id : null;
```

And the character comes from `Vampire.create_test_character`, which is
(`public/scripts/app/models/Vampire.js:427-431`) **just `Model.create(name)`** —
a bare character with no traits on it at all.

So `attributes` is always empty, `firstAttr` is always null, and the test has
**always** skipped. It has never executed a single assertion, on the old stack or
the new one. The SimpleTrait edit view — sliders, save, remove — has no E2E
coverage whatsoever, and the suite has been reporting that as a skip rather than
as a gap.

### What to do

1. Give the setup a trait to edit. The character exists; it just has nothing on
   it. Either add one in `beforeAll` after `create_test_character` resolves, or
   fetch the character's `attributes` relation properly if creation is supposed
   to populate defaults. **Find out which of those is true before choosing** —
   if a new character is meant to start with default attributes and does not,
   that is an app bug and a much more interesting finding than the test.
2. Delete the `if (!traitId)` guard once a trait is guaranteed. Leaving it means
   the test can silently go back to not running.
3. Run just that spec:
   ```bash
   npx playwright test e2e/character-sheet.spec.js --project=chromium
   ```
4. Expect the assertions to be wrong in small ways — `input.value-slider`,
   `button.save`, `button.remove` have never been checked against the real DOM.

### The thing to watch for

**The baseline expects 3 skipped tests.** Unskipping one makes it 2, and the gate
compares skip counts. That is a difference, not a regression — read the gate's
output rather than assuming you broke something. `runs/s10-baseA.json` is the
baseline and it records `skipped: 3`.

---

## 2. Two tests are being forgiven, and probably no longer need to be

**Effort: minutes, spread over several gate runs.**

`gate.js` carries a QUARANTINE list: named tests whose failures are forgiven, but
only when they fail with a byte-identical recorded signature.

- `admin-referendums.spec.js :: 49 A third user votes ... tally reaches 2` —
  harness noise, identical signature on both stacks.
- `assets-rename-portrait.spec.js :: 114 Renaming to collide with an existing
  character name succeeds` — a jQuery Mobile transition-lock flake.

Both documented in `docs/runbooks/harness-noise-floor.md`. **In the latest run
both passed**, and the gate said so itself: `now: passed this run -- consider
removing the quarantine`.

This matters more than it sounds: test 114's quarantine forgives a serial tail of
**14 tests** — the entire Parse File surface. While it is quarantined, a run where
it fails is inconclusive rather than clean and those fourteen go unmeasured.

### What to do

1. Run the gate three or four times and confirm both pass every time. One passing
   run is not evidence a flake is gone.
2. If they hold, delete their entries from the `QUARANTINE` constant in `gate.js`.
3. Run the gate again with the entries gone; it must still exit 0.
4. Record in `harness-noise-floor.md` when they stopped flaking and on what
   evidence.

**Do not otherwise touch `gate.js`, and do not touch `diff-runs.js` at all.**
They are what everything else is judged by; `gate.js` carries 42 self-tests plus
these pins. Deleting a quarantine entry is the one edit the file documents as
expected. If either test flakes during step 1, stop — a quarantine removed and
then needed again is worse than one left in place, because the next failure reads
as a regression.

---

## 3. The Jasmine suite has never run against the new stack

**Effort: one line to load it, unknown after that. Biggest upside on this page.**

`npm run test:staging` runs a Karma/Jasmine suite — 14 spec files under
`public/scripts/app/tests/`. It is pointed at the wrong Parse client:

```
public/scripts/app/tests/test-main.js:67    parse: "parse-1.5.0"
public/scripts/app.js                       parse: "parse-compat/parse"
```

It would exercise a 2026 server through a 2015 client. Repointing `test-main.js`
is the one-line change that makes it test what the app actually runs.

**Why bother:** six Cloud functions have no automated coverage of any kind —
nothing in the Playwright suite calls them. This suite is the only place they
could get an oracle, and `public/scripts/app/tests/troupe-test.js` already calls
`Parse.Cloud.run` directly, so the pattern exists.

### What to do

1. Change `test-main.js:67` to `parse: "parse-compat/parse"` and add
   `"parse-sdk": "parse-8.6.0"` beside it, matching `public/scripts/app.js`.
2. Run `npm run test:staging` and triage. It has not run in years; expect
   breakage unrelated to that line.

### Two traps

**`public/scripts/app/testsiteconfig.js` is already written for the modern SDK
and is deliberately wrong for the current harness.** Both its `serverURL` values
carry `/parse/1`. SDK 1.5 appended the version segment itself, so under today's
`parse-1.5.0` mapping those URLs are one segment too long and every request 404s.
**That file becomes correct the moment you fix `test-main.js`.** Do not "fix" it
by removing the `/1` — there is a comment in it saying exactly this.

**Do not quote the suite's historical pass/fail numbers.** They were never
reconciled against a static count of the spec files, so any figure in an older
document is unverified.

---

## 4. One unit test self-skips, and that one is correct

**Effort: none. Listed so nobody "fixes" it.**

`npm run test:node` reports 249 / 248 / 1 skipped. The skip is
`test/trigger-compat.test.js:629`:

```
parse-server is 9.10.0; the legacy arm of the seam is dead and so is this check
```

Correct behaviour, not a broken test. Leave it. Do not delete the legacy arm it
guards either — it is still fully unit-tested elsewhere, and one of those tests
is the only thing pinning the no-double-settle guarantee.

---

## Before you start, and how to know you did no harm

Record the current green state so you can tell your breakage from inherited
breakage:

```bash
npm run test:node
node gate.js --name before-my-changes --baseline runs/s10-baseA.json
```

The second takes a while and starts eight backends. **Only exit code 0 means
proceed** — `1` is a regression, `2` means the run did not happen, `3` means it
could not tell. Never branch on `1` alone; a check that treats only `1` as
failure reads "did not run" as success, which is the hole the gate exists to
close.

When you are done, the same command must still exit 0.

### One thing learned the hard way in the session that wrote this

Driving a change in a browser, or with `curl`, proves the path you just wrote
works. It proves nothing about the paths you did not touch.

That exact gap let a role-stripping bug through: a permission change broke five
places, four of them in files nobody had opened, and every hand-check passed
because it only exercised the fifth. The gate found all ten failures in one run.

Run the gate. It is slow and it is the point.
