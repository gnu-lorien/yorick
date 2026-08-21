<!--
Rewritten 2026-08-21. The version this replaces described four gaps and asked a
fresh session to close them. Three are closed; the fourth was correct as it
stood and is unchanged. What is here now is the state that resulted, the two
places the old document was wrong, and what is genuinely left.

Verified at the time of writing:
  npm run test:node   250 tests, 249 pass, 1 skipped, 0 fail
  npm test            167 specs, 166 pass, 1 skipped, 0 fail   (Karma/Jasmine)
  node gate.js        PASS, exit 0, 448/448, nothing forgiven  (runs/no-quarantine-1.json)

Branch: topic/parse8-migration.
-->

# The tests that are not really running

## Where this stands

| was | now |
|---|---|
| `character-sheet.spec.js :: SimpleTrait Edit View` skipped itself at runtime, always | runs, and is pinned so it cannot silently stop |
| `gate.js` forgave two flaky tests, stranding up to 14 more behind one of them | QUARANTINE is empty; nothing is forgiven |
| the Karma/Jasmine suite could not run at all | 166 of 167 pass; the 1 skip is deliberate |
| one unit test self-skips, correctly | unchanged, still correct, still leave it alone |

Two Werewolf tests remain skipped and **should stay that way**. See the last
section: they are a specification for a feature that was never built.

---

## First: install dependencies in this worktree

```bash
npm ci
```

Do this before running anything. It is a setup step, not a diagnosis, and it
takes about ten seconds.

**Why it is not optional.** `node_modules` is gitignored, and a new git worktree
does not get one. Node then resolves modules by walking UP the directory tree
and finds `C:/prj/yorick/node_modules` — which belongs to the main clone, and
carries whatever branch that clone last had installed. If that is a branch with
different pins, this worktree silently runs against those packages instead of
its own.

**This is a property of the directory, never of the branch.** `topic/parse8-migration`
is on the far side of the Parse 8 / parse-server 9 migration, and its
`package.json` and `package-lock.json` pin `parse@8.6.0` and
`parse-server@9.10.0` correctly and always have. Nothing about the branch is
stale. Only an uninstalled working directory is.

**The symptom, if you skip it.** `npm run test:node` reports one FAILING test
rather than one skipped:

```
✖ the replica still matches the installed parse-server
  Error: ENOENT ... node_modules/parse-server/lib/triggers.js
```

Read that failure carefully, because it says exactly what went wrong. The test
skips itself unless the *resolved* parse-server is 2.8.4, and then reads its
source from a hardcoded repo-relative path,
`<repo>/node_modules/parse-server/lib/triggers.js`. So a failure means both
things at once: resolution returned 2.8.4 (or it would have skipped), and there
is no `node_modules` beside this file (or it would have found it). Together
those are precisely "the packages came from another directory".

Note the test would still pass at the path it expects if this worktree really
were on 2.8.4 — it uses `path.join(__dirname, '..')` rather than
`require.resolve`. That is harmless today, since the version guard makes the
whole check dead on any modern stack, but it is why the symptom appears as a
confusing ENOENT rather than as a clear version mismatch.

After `npm ci`, it reports 250 tests / 249 pass / 1 skipped, and that one skip
is the intended one. Nothing in the repo detects the uninstalled case on its
own, so the check is: if `test:node` does not look like that, stop and install
before believing any other number on this page.

---

## 1. `SimpleTrait Edit View` — fixed

`e2e/character-sheet.spec.js` used to skip this test at runtime whenever
`traitId` was null, and `traitId` was *always* null: it was read from
`v.get('attributes')` on a character straight out of
`Vampire.create_test_character`, and that helper is `Vampire.create`, which
seeds Humanity, three health levels and Willpower — and nothing in `attributes`.

**That is not an application bug.** A character that has never entered the
creation wizard correctly has no attributes; they are chosen in the wizard,
which is what `attributes_7_remaining` / `_5_` / `_3_` on `VampireCreation`
exist to meter. The fixture was wrong, not the app.

What changed:

- `beforeAll` now buys the character one `attributes` trait and re-reads it, and
  **throws** if no trait id results. A broken fixture is now a loud failure
  instead of a skip.
- The `if (!traitId) test.skip(...)` guard is gone, so the test cannot quietly
  stop running again.
- Two assertions were added so it asserts something rather than merely
  rendering: the slider carries the seeded value, and the view names the trait
  it is editing.

Proven rather than assumed: with the expected trait name changed to one that
does not exist, the test **fails**. A revived test that has never been seen to
fail is not yet a test.

### Where the old document was wrong

It said the SimpleTrait edit view "has no E2E coverage whatsoever". It has a
lot. `traits-lifecycle.spec.js:820-858` clicks `.remove` and asserts the refund;
`e2e/helpers/lifecycle.js:230` does the same; `openTraitChange` is used across
six spec files; `setTraitChangeSliders` and `saveTraitChange` are used
throughout. The sliders, save and remove were all covered before this change.

The real problem was narrower and worth fixing anyway: **a test that reports
itself as skipped rather than as a gap**. The suite said "skipped" for years
where the honest word was "never ran".

---

## 2. The two forgiven tests — quarantine removed

`gate.js`'s `QUARANTINE` is now `{}`. Tests 49 and 114 are judged like anything
else, and the 14 tests that used to go unmeasured behind test 114 — the whole
Parse File surface — are back under the gate.

Evidence, and the reason "first attempt" matters more than "passed", is recorded
as the fourth correction in `docs/runbooks/harness-noise-floor.md`: 22
consecutive full eight-worker runs with both tests passing without a retry, then
a 23rd with the quarantine gone that exits 0.

**One thing the old document did not warn about, and it would have bitten.**
`test/gate.test.js` pinned QUARANTINE to exactly two entries and named both
tests. Deleting the entries alone breaks six of its 42 self-tests — two of them
as TypeErrors rather than clean assertion failures. The old text said "nothing
else in this file names these tests", which is true of `gate.js` and not true of
its self-tests. They were moved to `RETIRED_QUARANTINE` in the test file rather
than deleted, so the machinery is still tested against a real recorded failure
with a real signature, a real foreign-worktree `errorLocation`, and a real
14-test serial tail.

---

## 3. The Karma/Jasmine suite — running, and green

`npm test` (not `test:staging` — that points at a remote staging server) now
runs 167 specs against a local Parse server: **166 pass, 1 deliberately
skipped.** It was previously unable to run at all.

Repointing `test-main.js` at `parse-compat/parse` was the one-line change the
old document described, and it was necessary but nowhere near sufficient. What
else had to happen:

**A harness bug that made `$` not be jQuery.** `test-main.js` wrapped `define`
to append `.js` to relative dependencies, but its wrapper was declared
`function (deps, callback)` and forwarded exactly those two arguments. jQuery
registers itself as `define("jquery", [], factory)` — three arguments, the first
a name — so the wrapper bound `deps` to the string `"jquery"`, `callback` to the
empty array, and dropped the factory. RequireJS treats a non-function value as
the module's value, so `"jquery"` resolved to `undefined` and every
`define([... "jquery" ...], function ($) {` in the application received a `$`
that was not a function.

Nothing surfaced until a spec drove the app down a failure path, because `$` is
only *called* in a few places. `helpers/ReportError.js:130` is one — so the
first refused trait purchase died with `TypeError: $ is not a function` from
inside the error reporter: an error about reporting the error, masking the real
one. The shim now passes every argument through and rewrites only the array.

**Werewolves were being sold Vampire backgrounds.** The parameterised
"A <creature>'s traits" describes bought into `"backgrounds"` for every creature
type. Werewolf's category is `wta_backgrounds`; Changeling's is
`ctdbs_backgrounds`. A venue's cost engine returns a cost only for a category it
has a rule for, and `update_trait` refuses outright when the cost is not finite
— the guard that stopped `wta_rites` being silently free. Ten specs were failing
on a correct refusal. `character_types` entries now carry a
`background_category`, mirroring `VENUE_BACKGROUND_CATEGORY` in
`e2e/helpers/characters.js`.

**Four "security" specs used an administrator as their stranger.** "doesn't show
her vampire to everybody" logged in as `devuser` — who is seeded `admin: true`,
and every character is created with `setRoleReadAccess("Administrator", true)`.
An admin who *could not* read it would be the bug. They now use `sampstranger`.

**Two `change_troupe_staff` specs asserted nothing at all.** They sent
`{troupe, user, title, action}`; the Cloud function reads `{troupe_id,
user_to_change_id, roles_to_add, roles_to_remove}`. Every name was wrong, so the
call died fetching a troupe with no id, long before reaching the authorization
check — and the specs asserted only `expect(error).toBeDefined()`, which any
failure satisfies. **They would have stayed green if a regular member could
promote themselves to AST.** They now send the real parameters, the member case
reads the staff list back to confirm nothing was granted, and the
unauthenticated case pins the exact refusal text.

This matters beyond the suite: `check_user_password` and `make_me_admin` have no
caller anywhere in the application and no Playwright coverage. **These specs are
their only automated test**, and the Jasmine suite is not part of
`npm run gate` — so it has to be run deliberately.

### Two things added to make this maintainable

- **`TEST_SPEC`** — `TEST_SPEC=troupe npm test` runs one spec file. Without it
  the suite is all-or-nothing against a real server, and one hanging `beforeAll`
  costs the whole run while naming nothing. It refuses to run if the filter
  matches no files, because "Executed 0 of 0 SUCCESS" is the most dangerous
  thing a harness can say.
- **`browserNoActivityTimeout: 300000`** — Karma's default is 30s. A single
  `beforeAll` here creates a character and saves a dozen traits against a real
  server, emitting nothing meanwhile, and the browser was being killed mid-setup
  with 0 of 166 executed. This is not the same knob as Jasmine's per-spec
  timeout: that fails one spec, this kills the whole run.

### What is still not covered

`submit_facebook_profile_data` is the one Cloud function with no automated
coverage of any kind — the app calls it only from the Facebook OAuth path, and
neither suite has any Facebook anything. The old document's "six Cloud functions
have no automated coverage" was an overcount: the others are all reached, most
through real UI actions in the Playwright suite.

---

## 4. One unit test self-skips, and that one is correct

Unchanged, and listed again so nobody "fixes" it. `test/trigger-compat.test.js`
skips when parse-server is not 2.8.4:

```
parse-server is 9.10.0; the legacy arm of the seam is dead and so is this check
```

Correct behaviour. Leave it. Do not delete the legacy arm it guards either — it
is still fully unit-tested elsewhere, and one of those tests is the only thing
pinning the no-double-settle guarantee.

---

## The two Renown tests: still skipped, deliberately

`creation-werewolf.spec.js :: 212` and `lifecycle-werewolf.spec.js :: 350` are
skipped because **Renown was never built**. No trait category, no cost rule, no
seeded Descriptions, nothing on the sheet or the printable sheet. There is a
third one now: `creature-types-test.js` had a Jasmine spec buying into a `glory`
category, which was failing for the same reason and is now `xit` carrying the
same explanation. The Rites half of that spec was split out and still runs,
because an unbuilt feature must not take a built one down with it.

Unskipping any of them means building Renown — deciding what Glory, Honor and
Wisdom cost, how they are earned, and how they render. That is a game-content
decision, not test work. The tests are a decent statement of the acceptance
criteria if you want one; they are not a repair waiting to happen.

---

## How to know you did no harm

```bash
npm ci
```

```bash
npm run test:node
```

```bash
npm test
```

```bash
node gate.js --name before-my-changes --baseline runs/s10-baseA.json
```

**Only exit code 0 from the gate means proceed.** `1` is a regression, `2` means
the run did not happen, `3` means it could not tell. Never branch on `1` alone;
a check that treats only `1` as failure reads "did not run" as success, which is
the hole the gate exists to close.

The gate no longer forgives anything, so a flake now reads as a FAIL. If tests
49 or 114 fail again, that is real information — read `harness-noise-floor.md`
before assuming you broke something, then re-run.

### Two ways to waste an afternoon, both learned here

**Never run two gates at once.** `e2e/ports.js` gives every worker a fixed port,
and a second run's sweep kills the first run's servers mid-test. It produced one
run reporting 4 NEW-FAIL across four unrelated spec files plus 61 LOST, which
looks exactly like a real regression and is not. The tell is `stats.startTime`:
two runs one second apart. If you script repeated runs, serialise them — and if
you kill the script, kill the `node gate.js` children too, because stopping the
supervising shell does not stop them.

**Driving a change in a browser proves only the path you drove.** That gap let a
role-stripping bug through: a permission change broke five places, four of them
in files nobody had opened, and every hand-check passed because it exercised the
fifth. The gate found all ten failures in one run.

Run the gate. It is slow and it is the point.
