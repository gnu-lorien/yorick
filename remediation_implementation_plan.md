# Yorick Application Remediation Plan

**51 numbered fixes across 7 phases, every one tied to an existing test or a named decision.**

This plan fixes defects found by the E2E suite built in `testing_implementation_plan.md`. It is
written to be executed from a **fresh session** with no prior context: everything needed is here or
named precisely enough to find.

---

## 1. Start Here — Context For A Fresh Session

### What already exists

The repository has a 444-test Playwright E2E suite on branch `topic/massive-upgrades` (17 commits,
`a37637e`..`8c350a1`). It currently reports **443 passed, 1 skipped** in ~41 minutes. Do not be misled
by "443 passed": Playwright counts a `test.fail()` test as passing when it fails *as declared*.

**Roughly 40 of those tests are pinned red against the defects in this plan.** They are the acceptance
criteria. Each fix below names the test that must flip from `test.fail()` to a genuine pass.

### How to run things

Start the server — **never by hand**, because Playwright's `webServer` config sets `PUBLIC_SERVER_URL`,
without which every portrait upload fails with an opaque `[object Object]`:

```bash
npx playwright test e2e/creation-vampire.spec.js
```

Other useful invocations:

```bash
node e2e/check-syntax.js
```

```bash
npx playwright test --project=admin
```

```bash
npx playwright test
```

The database is an in-memory MongoDB seeded at startup from `database_seed/` plus `seed_extra.js`.
It is disposable — restarting the server gives a clean database. Test accounts:
`devuser`/`thedumbness` (admin + storyteller), `sampmem`/`sampmem` (plain member), `sampast`/`sampast`
(storyteller), `sampstranger`/`sampstranger` (no roles, no troupe).

### The rule that governs this work

**When you fix a defect, flip its pinned test from `test.fail()` to a normal `test()`. Never delete a
test to make a suite green, and never weaken an assertion.** If a fix turns some *other* test red,
that is information — investigate before adjusting either.

Several tests deliberately pin *current, wrong* behaviour as a measured value rather than as
`test.fail()` (the discipline cost cap, the creation pool badge). Those will go red when you fix the
underlying bug. That is intended; the comment above each explains what to change it to.

### What is out of scope

- **Anonymous `Vampire` creation** — an unauthenticated REST POST can create a character, and
  `#characternew` has no `enforce_logged_in()` gate. **Another session owns this.** R38 below is the
  related route gate; coordinate before touching `Vampire` class permissions.
- **Patronage world-readability is intended, not a defect.** Patron status must be publicly
  verifiable so anyone can confirm a character is backed by a paid Patron. Test 384b asserts this
  positively. Do not "fix" it.

---

## 2. The Cross-Cutting Problem

Nearly every defect below is one bug wearing different clothes: **the application discards its own
errors.**

```js
.fail(console.log)                       // EditRules.js — save 404s, UI shows nothing
a.save().then(ok)                        // CharacterApprovalView — refusal has nowhere to go
response.error(msg); return;             // cloud/main.js — inside a .then(), does not stop the chain
if (!_.isFinite(cost)) cost = 0;         // Character.js — an undefined cost silently becomes free
catch (e) { /* already gone */ }         // (was in the test harness too, now fixed)
```

The consequences are not cosmetic. A rule that cannot be saved looks saved. A vote that was refused is
recorded anyway. A trait with no cost formula is free. **A user cannot distinguish success from
failure, and neither can a developer reading the screen.**

Phase 1 therefore builds the reporting path first. Every later phase depends on failures being
visible, and several later fixes are one-liners once they are.

---

## Phase 1 — Make Failures Visible

*Foundation. Do this first; the rest of the plan assumes errors can reach a user.*

**R1. Add a shared error-reporting helper.** There is no single way to surface a failure today; each
view improvises or ignores. Create one module (suggested: `public/scripts/app/helpers/ReportError.js`)
exposing a function that takes a Parse error or exception plus a context string, logs it, and renders
it where the user is looking — a jQuery Mobile popup or an inline `.error` region. Model the message
on what already works: `admin-patronage.spec.js` proves the Backform `.status` / `.error` path renders
correctly when a view uses it.
*Verify:* no test yet; R2–R9 verify it in use.

**R2. `EditRules.js` — surface save failures.** Its per-row `.fail(console.log)` swallows every
error, which is why R10's broken save was invisible for so long.
*Verify:* tests 17, 24, 26, 28, 30 (with R10).

**R3. `CharacterApprovalView.approve_change:95` — handle save failure.** It calls `a.save().then(...)`
with no failure handler, so the refusal raised by `beforeSave("VampireApproval")`
(`cloud/main.js:608`) produces no client-visible outcome at all. A player clicking Approve on their own
character sees nothing happen and is told nothing — the server does refuse (Parse code 141,
"Players cannot approve their own character changes"), but only a direct probe can observe it. Add a
failure handler and surface the message.
*Verify:* `approvals.spec.js` test 94 currently asserts the *absence* of feedback; update it to assert
the refusal message once this lands.

**R4. `characterlog` and `characterexperience` routes — add `.fail()` handlers.** Both lack one
entirely, so a denied fetch leaves `ui-loading` stuck on forever with no redirect. Compare
`show_character_helper`, which redirects cleanly — copy that shape.
*Verify:* `access-control.spec.js` test 393, which currently asserts the stuck overlay as real
behaviour; invert it to assert the clean redirect.

**R5. Patronage routes — hide the loader unconditionally.** `a_patronage`,
`administration_patronage` and `administration_patronage_new` call `$.mobile.loading("hide")` only on
the failure path, so a stuck spinner can block subsequent clicks. Sibling routes use `.always()`.
*Verify:* `admin-patronage.spec.js` currently carries a defensive `clearStuckLoader`; remove it and
the suite must still pass.

**R6. Trait name collisions must surface.** The rejection is real — the colliding name never persists —
but nothing tells the user. The only trace is a `console.log`.
*Verify:* `traits-lifecycle.spec.js` tests 246, 258, 270 (all three venues).

**R7. Character rename collisions must surface, or be allowed deliberately.** See R41 — this needs a
product decision first.
*Verify:* `assets-rename-portrait.spec.js` test 114.

**R8. `format_entry` must distinguish zero from absent.** It returns the value only when truthy, so a
cost of `0` renders as an empty cell — indistinguishable from "not recorded". Return `0` explicitly.
*Verify:* `lifecycle-*.spec.js` assert empty cells for zero costs today; update them to assert `0`.

**R9. Never render `NaN` to a user.** The `wta_rites` change page shows a literal `Cost: NaN` /
`Final: NaN` before `_.isFinite` zeroes the spend. Whatever R14 decides the cost should be, the page
must never display `NaN`.
*Verify:* `creation-werewolf.spec.js` test 211 (with R14).

---

## Phase 2 — Promise-Chain Correctness

*These are the bugs that let bad data through. Each is small and each is serious.*

**R10. `EditRules.js:51` — no rule can be added, in any of the five editors.** The submit handler
builds `new Parse.Object(self.ruleName, {...})`, but `ruleName` is a module-scoped variable, not a
property of the view — the *same handler* uses it correctly at line 43 for its lookup query. With the
class name `undefined`, Parse falls through to its `(attributes, options)` signature, the save 404s,
and R2's swallowed error hides it. Change `self.ruleName` to `ruleName`.
*Verify:* tests 17, 18, 22, 24, 26, 28, 30 — seven pinned tests, the largest single win in this plan.

**R11. `cloud/main.js` `vote_for_referendum` — a refused vote is recorded anyway.** This is the most
serious data-integrity defect found. The function is a `.then()`/`.fail()` chain in which
`response.error(msg); return;` ends only *its own callback*, not the chain. The patronage check and the
ballot-creation code live in different callbacks, so when a non-patron is rejected the next `.then()`
still runs, receives `undefined`, reads that as "no existing ballot", and saves one — with
`casterpatronagestatus` hardcoded `true`. **A non-patron's vote is refused in the response and
persisted regardless, recorded as though they were a patron.** Restructure so a rejection actually
terminates the chain, and derive `casterpatronagestatus` from the real check rather than hardcoding it.
*Verify:* `admin-referendums.spec.js` test 50.

**R12. Audit `response.error(); return;` everywhere.** R11 is one instance of a pattern. Grep
`cloud/main.js` for `response.error` inside `.then()` callbacks and check each for the same flaw.
*Verify:* no direct test; add one per instance found.

**R13. `CharacterApprovalView.register` is missing a `return`.** Its final statement is
`p.then(function () { Parse.Promise.as(self); })`, so the chain resolves with `undefined`. Likely the
cause of R28.
*Verify:* with R28.

**R14. `wta_rites` purchases cost nothing.** `BNSWTAV1_WerewolfCosts.calculate_trait_cost` has no
branch for the category and no seeded Description carries a cost override, so the cost resolves to
`undefined` and `Character.update_trait`'s `_.isFinite` guard silently zeroes it. Decide the intended
cost and add the branch.
*Verify:* `creation-werewolf.spec.js` test 211.

**R15. `ctdbs_backgrounds` purchases cost nothing.** Same shape in
`BNSCTDBS_ChangelingCosts.calculate_trait_cost` — note it has a branch for `ctdbs_realms`, which has no
seed data, but none for backgrounds, which does.
*Verify:* `creation-changeling.spec.js` test 236.

**R16. Make a missing cost branch loud, not free.** Once R14 and R15 are fixed, the `_.isFinite` guard
in `Character.update_trait` will still silently zero any *future* category someone forgets. Make an
unresolvable cost throw or report rather than default to free.
*Verify:* add a test that a category with no branch fails loudly.

---

## Phase 3 — Data Integrity

**R17. Re-dating an XP notation forwards double-counts it.**
`Character._propagate_experience_notation_change` recomputes only rows `[0..index]`, seeded from row
`index + 1`. A notation moving *down* the list passes rows inside that window and they are corrected;
one moving *up* passes rows *above* `index`, which keep totals that still include it — and the moved
row is then recomputed on top of one of them. Measured: a 4-earned/3-spent notation moved up one
position took a character from `45/6/39` to `56/11/45`. The window must cover every row between the
old and new positions.
*Verify:* `xp-history.spec.js` test 60b.

**R18. Removing a creation-picked trait orphans its pool slot.** `Character.remove_trait` destroys the
trait and refunds its cost but never calls `update_creation_rules_for_changed_trait`, so the
`_remaining` counter is never restored — and with creation complete there is no route back to reclaim
the slot. Affects all three venues.
*Verify:* `traits-lifecycle.spec.js` tests 248, 260, 272.

**R19. `SimpleTraitChangeView.save_clicked` drops `free_value`.** It saves an existing trait with
`update_trait(self.simpletrait)` — one argument — so `free_value` arrives `undefined` and the code
composes a key literally named `<category>_undefined_remaining`. The right number is written under a
key nothing reads, alongside a stale `<category>_0_remaining`. The model-layer equivalent passes `0`
explicitly and works, which pins this to the UI layer.
*Verify:* `creation-vampire.spec.js` 179, `creation-werewolf.spec.js` 205,
`creation-changeling.spec.js` 231 — one bug, three venues, because the view is shared.

**R20. The creation pool badge undercounts for every non-Vampire category.**
`VampireCreation.remaining_picks` sizes its loop from a hardcoded `tops` map containing only
`skills / disciplines / backgrounds / attributes / merits / flaws`, so any `wta_*` or `ctdbs_*`
category falls back to `tops[category] || 1` and sums only the rating-1 and rating-0 sub-pools. The
per-rating counters are correct; only the badge is wrong.
*Verify:* `creation-werewolf.spec.js` test 202 and `creation-changeling.spec.js` test 228 currently
pin the wrong value as measured; update them to the true counts.

**R21. Unpicking a Kith does not reverse its Art grant.** Selecting a Kith auto-grants its affinity
Arts free (`update_trait(art, 1, "ctdbs_arts", 1)`) and consumes the pool. Repicking reconciles
correctly; unpicking clears the text and leaves both the Arts and the spent pool slots behind.
*Verify:* `creation-changeling.spec.js` test 220.

**R22. Picking a Kith inside the creation wizard drives `ctdbs_arts_1_remaining` to −2** and aborts
pool spending, which is why the suite picks Kith only after completing creation.
*Verify:* add a test; then remove the workaround noted in `creation-changeling.spec.js`'s header.

**R23. A Kith change can write two identical `define` rows for one Art.** When an Art is an affinity of
both the old and new Kith it is destroyed and re-granted, producing two rendered-identical log rows in
the same minute.
*Verify:* `lifecycle-changeling.spec.js` asserts the duplicate today; invert it.

**R24. Discipline cost tables stop growing after level 9.** `get_cost_table` builds `_.range(1, 10)`
and `get_cost_on_table` uses `_.take`, which silently returns the whole array past its end — so levels
10–15 all cost exactly what level 9 costs.
*Verify:* `creation-vampire.spec.js` test 189 derives its expectation from the current algorithm and
will go red deliberately; replace it with the corrected table.

**R25. Creation pool enforcement is presentational only.** An exhausted pool renders no pick link, but
`charactercreatepicksimpletrait` checks nothing, so a hand-typed URL decrements past zero and corrupts
the character.
*Verify:* add a test driving the route directly with an exhausted pool.

**R26. Numeric rule fields cannot be edited.** `EditRules.js` sends every CSV field as a string except
the literal column `"order"`, so any other numeric schema field 400s with "expected Number but got
String".
*Verify:* extend `admin-rules.spec.js` test 21, which currently edits only a string field to avoid this.

**R27. `bnsmetv1_ClanRule` rows have neither `name` nor `category`**, so the editor's lookup can never
target a chosen row — it deterministically hits whichever row Parse returns first.
*Verify:* `admin-rules.spec.js` test 21, which currently works around it.

---

## Phase 4 — Caching And Staleness

*A cluster of memoization bugs with one shape: a view decides nothing changed, and shows stale data.*

**R28. The approval view strands the router.** Navigating from `#character/:cid/approval` to an
unrelated route updates the hash but never changes the page, with nothing logged. Re-running the route
handler does not clear it; only a full reload does. Probably R13.
*Verify:* remove the reload fallback in `jqm-helpers.js#navigateToHash` and `approvals.spec.js` must
still pass.

**R29. `Vampire.get_character` never refetches.** A storyteller session that loaded a character before
the player's change renders stale trait values indefinitely — **meaning a storyteller can approve a
change their screen never showed them.** That is the most consequential instance of this cluster.
*Verify:* `approvals.spec.js` calls `freshApproval` (a reload) before every cycle; remove it and the
suite must still pass.

**R30. `CharacterLogView.register` only refetches when parameters differ.** It sets its `changed` flag
only when `start`, `changeBy` or the character reference change, so "read the log, act, read the log
again" — identical parameters both times — silently returns pre-action rows.
*Verify:* remove the `hardReload` in `logs.js#openLog`; `traits-lifecycle` and `lifecycle-*` must still
pass.

**R31. `SimpleTraitChangeView` quotes a stale price.** It rebuilds its `fauxtrait` only when the
`SimpleTrait` *object identity* changes, and the router hands back the same cached instance for the
life of the page. Measured: after raising Physical 5→6 (quoted 3, charged 3), reopening the same page
and sliding to 7 quoted **6** rather than the 3-point increment. The save is correct, so the player is
simply shown the wrong price.
*Verify:* add a test; `lifecycle-vampire.spec.js`'s header documents the measurement.

**R32. `CharacterHistoryView`** shares the same memoization family; audit it alongside R30/R31.

**R33. `#simpletrait-new` is one page element shared by every category**, so a picker-to-picker
navigation satisfies the page-active check instantly against the *previous* list and the subsequent
`changePage` is swallowed — the click updates the hash and the app sits still, with nothing logged.
*Verify:* remove the "park on the character sheet between pickers" workaround from the creation suites
and `descriptions-by-creature.spec.js`.

**R34. `administration_patronages` assigns from the wrong property.**
`self.administrationPatronagesView = self.administrationPatronageView || new PatronagesView(...)` —
note the singular/plural mismatch. Once any detail or new-patronage route has run, every later visit to
the list route silently reuses the wrong object and the list stays empty for the session.
*Verify:* `admin-patronage.spec.js` test 1 deliberately visits the list first to avoid this; remove
that ordering constraint.

---

## Phase 5 — Access Control

**R35. `#administration` has no access gate at all.** Zero `is_ad` checks in the route, no template
conditional — a plain member reaches the identical 13-link admin menu. Compare `administration_users`,
which has two such checks: the gating is inconsistent per route, not absent by design. The individual
destinations are mostly protected server-side, so this is an information-disclosure and confusion
problem rather than a direct breach — but it is the front door.
*Verify:* `access-control.spec.js` test 381.

**R36. Audit every `administration/*` route for a gate.** R35 is one instance; the pattern is
inconsistent across the router. Produce a table of route → gate present, and fix the gaps.
*Verify:* extend `access-control.spec.js` test 390's parameterized route sweep.

**R37. Rule editors are protected only server-side.** `bnsmetv1_ClanRule` and `bnsctdbs_KithRule` rely
entirely on class-level permissions (Parse code 119 on save). The editor renders fully for a
non-admin, who discovers the refusal only on submit — and today not even then, because of R2. Add a
route gate so the page does not render at all.
*Verify:* `access-control.spec.js` tests 382, 383 assert the server refusal; add page-level assertions.

**R38. `#characternew` has no `enforce_logged_in()` gate.** Related to the out-of-scope anonymous-write
issue — **coordinate with the session that owns it** before changing `Vampire` class permissions. The
route gate itself is independent and safe to add.
*Verify:* extend test 390's route sweep to include `characternew`.

---

## Phase 6 — Missing Data And Dead Code

**R39. Six Description categories have no source data anywhere.** Nothing can ever be picked from
them: `ctdbs_noble_houses`, `ctdbs_realms`, `wta_monikers`, `ctdbs_holdings_specializations`,
`ctdbs_arts_affinities_links`, `wta_territory_specializations`. The first three were dropped from the
test plan by decision; the other three still have tests asserting their emptiness. Authoring the game
data is a content task, not an engineering one — decide per category whether to populate or remove the
feature.
*Verify:* `creation-changeling.spec.js` test 237; `descriptions-by-creature.spec.js` item 315.

**R40. Renown has no UI path at all.** Glory, Honor and Wisdom are absent from
`ALL_SIMPLETRAIT_CATEGORIES`, have no seed data, and appear on neither the live nor the print sheet.
"Rage" is likewise a hardcoded print-only constant tied to no character data, and "Banality" does not
exist anywhere in the repository. These are unimplemented features, not bugs.
*Verify:* `creation-werewolf.spec.js` tests 212, 213, 215; `lifecycle-werewolf.spec.js` test 350.

**R41. Decide whether character names should be unique.** Nothing enforces it, client or server;
renaming onto an existing name succeeds silently. The codebase treats names as non-unique elsewhere
(identify by id), so this may be intended — **but test 114 currently asserts a rejection that never
happens.** Either implement uniqueness or invert the test, as was done for patronage readability.
*Verify:* `assets-rename-portrait.spec.js` test 114.

**R42. `paidOn` is dead data.** Only `expiresOn` is consulted for patron status
(`ExpirationMixin.isActive`, `get_my_patronage_status`, `vote_for_referendum`), so a future-dated
patronage is active immediately.
*Verify:* `admin-patronage.spec.js` test 11.

**R43. There is no way to delete a Patronage.** No button, no list control, no route.
*Verify:* `admin-patronage.spec.js` test 13.

**R44. `#administration/patronages/user/:id` is broken for everyone, admin included.**
`AdministrationUserView`'s regions require `#abs-form` and `#patronage-list-region`, but that page's
markup is an empty `<form>`. Marionette throws on construction inside a legacy promise callback and the
route dies before `changePage`.
*Verify:* `admin-patronage.spec.js` test 7.

**R45. Remove dead code.** `character-print-view.html` is imported by `CharacterPrintView` but never
rendered — the real template is the venue-aware `character-print-parent.html`. It actively misleads:
judging print coverage from it produces wrong conclusions. The `bnsmetv1_ElderDisciplineRule`,
`bnsmetv1_TechniqueRule` and `bnsmetv1_RitualRule` classes likewise have **no runtime consumer at all**
and no cost field — XP comes from a generation-keyed formula in `BNSMETV1_VampireCosts.js`. Decide
whether to wire them up or delete them.

**R46. `#profile/:id` links to a route that does not exist** (only `patronage/:id` does).

---

## Phase 7 — Reporting And Observability Coverage

**R47. Decide what the audit log is for, then make it consistent.** `beforeSave("Vampire")`'s
`tracked_texts` allowlist is exactly:

```
name, clan, state, archetype, archetype_2, faction, title, sect, antecedence,
wta_breed, wta_auspice, wta_tribe, wta_camp, wta_faction
```

The consequences are uneven in ways that look accidental rather than designed:

| Change | Logged? | Consequence |
|---|---|---|
| Rename | yes | — |
| Vampire text (clan, sect, title) | yes | — |
| Werewolf text (breed, auspice, tribe, camp) | yes | — |
| **Changeling text (kith, court, group type)** | **no** | A Changeling owns **no `core` log row at all** until a rename |
| **XP notation add / edit / delete** | **no** | No hook on `ExperienceNotation`; XP fields absent from the allowlist |
| **Long text edits** | **no** | `update_long_text` never calls `Vampire#save()`, so the hook never fires |

If the log is meant to be a complete audit trail, all three gaps need closing — the Changeling one by
adding `ctdbs_*` fields to the allowlist, the XP one by adding a hook on `ExperienceNotation`, and the
long-text one by either saving the parent or adding a `beforeSave("LongText")`.
*Verify:* `lifecycle-*.spec.js` tests 321, 329, 344, 352, 364, 369, 372; `xp-history.spec.js` test 75;
`long-texts.spec.js` test 285. **Nine pinned tests — the second-largest win in this plan.**

**R48. Experience pagination is dead code.** `CharacterExperienceView.register(character, start,
changeBy)` accepts both parameters and uses neither; the skip/limit lines and the Prev/Next controls
are commented out, so `/experience/0/10` and `/experience/10/10` return the identical full set. Note
that `CharacterLogView` **does** paginate correctly — copy its implementation rather than writing a new
one.
*Verify:* `xp-history.spec.js` test 74.

**R49. `VampireChange` rows can never be deleted by an administrator.** `_SCHEMA.json` grants `delete`
only to `role:SiteAdministrator`, and no user holds it. They also accumulate during teardown, since
destroying a trait fires a `beforeDelete` that writes a "remove" row. The current database holds
~13,500. Decide whether this is intended immutability — a defensible choice for an audit log — and if
so document it; if not, grant `Administrator` delete.

**R50. The XP history "Available" cell is permanently blank.** The template calls
`format_entry(log, "available")`, which reads a property that exists on neither the model nor the view.
The running balance a reader actually sees comes from the delta row.
*Verify:* `xp-history.spec.js` test 55 pins the blank cell; invert it.

**R51. No emailAdapter is configured**, so `requestPasswordReset` rejects deterministically with "An
appName, publicServerURL, and emailAdapter are required". The button wiring is correct; the deployment
is not.
*Verify:* `access-control.spec.js` test 389.

---

## 3. Suggested Order, And Why

| Order | Phase | Rationale |
|---|---|---|
| 1 | Phase 1 (R1–R9) | Nothing else is diagnosable until failures are visible. R2 alone changes how R10 presents. |
| 2 | R10, R11 | The two highest-impact single-line-ish fixes: seven pinned tests and one data-integrity breach. |
| 3 | Phase 2 remainder | Small, isolated, each with a test. |
| 4 | Phase 3 | Data integrity. R19 fixes three venues at once. |
| 5 | Phase 4 | Caching. Do this as a group — the bugs share a shape and a fix strategy, and each removal of a test workaround validates the next. |
| 6 | Phase 5 | Access control. Coordinate R38 with the other session first. |
| 7 | R47 | Largest remaining test win, but needs a product decision on audit scope. |
| 8 | Phases 6, 7 remainder | Mostly decisions rather than code. |

**Two fixes are worth doing first if you only have an hour:** R10 (seven pinned tests, one wrong
property name) and R11 (a refused vote being silently recorded).

---

## 4. Decisions Needed Before Coding

These are not engineering calls, and guessing wrong wastes work:

1. **Audit scope (R47)** — should XP, long texts and Changeling text changes be logged? This drives
   nine tests.
2. **Name uniqueness (R41)** — enforce, or accept and invert the test?
3. **Missing game data (R39, R40)** — populate the six empty categories and implement Renown, or
   remove the features?
4. **Rule-class purpose (R45)** — the elder discipline, technique and ritual rule tables have no
   consumer. Wire up or delete?
5. **Audit-log immutability (R49)** — intended, or an oversight?
6. **`paidOn` (R42)** — should a future-dated patronage be inactive until then?

---

## 5. Verification Checklist

A fix is done when:

- Its pinned test is a normal `test()` and passes.
- `node e2e/check-syntax.js` passes.
- The suite that owns the test passes three times consecutively.
- `npx playwright test --project=admin` still passes (five suites, serial — they mutate global state).
- No other suite regressed. The full run is ~41 minutes; run it before each commit that touches shared
  application code.
- Row counts return to baseline. Several suites assert this themselves; `VampireChange` is the known,
  documented exception (R49).

Commit per fix or per small group, referencing the R-number and the test that flipped.
