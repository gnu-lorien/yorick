# Yorick Application Remediation Plan

**53 actionable fixes across 7 phases, every one tied to an existing test or a named decision.**

Numbered R1–R51, with R47 split into R47a/b/c once audit scope was decided, and R7 withdrawn. All six open questions have been ruled on — see [Decisions Already Made](#4-decisions-already-made) before starting, because four of them change what "correct" means.

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

**R7. WITHDRAWN — character names are deliberately not unique.** Ruled on by the owner: uniqueness is
**not** required and must not be enforced. Nothing to fix here; the work is in R41, which inverts the
test that wrongly expected a rejection.

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

**R39. Exactly seven Description categories have no content, and it was never written.** Measured
against the live database: of the **62** categories the three models reference, **55 have data and 7
are empty**. For all seven there is no source anywhere — nothing in `database_seed/Description.json`,
nothing in any CSV under `data/`, nothing in `all_dev_descriptions.csv`. For contrast
`extra_affinity_links` has 30 rows in that CSV, which proves the seed pipeline works: this content was
never authored, not lost in loading.

| Category | Venue | Note |
|---|---|---|
| `ctdbs_noble_houses` | Changeling (text attribute) | dropped from the test plan by decision |
| `ctdbs_realms` | Changeling | dropped from the test plan by decision; oddly, the cost engine *does* have a branch for it |
| `wta_monikers` | Werewolf | dropped from the test plan by decision |
| `ctdbs_holdings_specializations` | Changeling | still has a test asserting emptiness |
| `ctdbs_arts_affinities_links` | Changeling | still has a test asserting emptiness; the Werewolf equivalent has 30 rows |
| `wta_territory_specializations` | Werewolf | still has a test asserting emptiness |
| **`luminary_disciplines`** | **Vampire** | **not previously reported — found while answering this question** |

This is a content task, not an engineering one. Per category, either author the rows or remove the
category from the model. `luminary_disciplines` is the notable one: every other empty category belongs
to the two newer venues, so a Vampire category with no content looks more like an oversight than an
unfinished feature.
*Verify:* `creation-changeling.spec.js` test 237; `descriptions-by-creature.spec.js` item 315.

**R40. DEFERRED FEATURES — Renown, Rage and Banality are planned for a future release.** Ruled by the
owner: these are **not defects and are not to be tested** until they are built. They differ from R39
in kind — R39 is a catalogue with no rows, whereas these have no trait category at all, so there is
nothing to author rows *into*:

- **Renown** (Glory, Honor, Wisdom) — absent from `ALL_SIMPLETRAIT_CATEGORIES`, no seed data, on
  neither the live nor the print sheet.
- **Rage** — a hardcoded print-only constant (10 boxes, split 7) tied to no character data.
- **Banality** — no field, no seed data, no template anywhere in the repository.

**Test treatment, already applied.** Two tests were purely about these concepts and are now
`test.skip()` with a pointer back to this item: `creation-werewolf` 212 and `lifecycle-werewolf` 350.
Two others *also* carried real coverage and were therefore **split rather than skipped**, because
skipping them would have silently dropped working assertions:

| Test | Kept | Removed |
|---|---|---|
| `creation-werewolf` 213 | Gnosis is auto-added at value 10 / free_value 6 and renders on the sheet | the Rage assertions |
| `creation-werewolf` 215 | the printable sheet renders the purchased Gift and Rite with real values | the Renown-section assertions |

When these features land, unskip 212 and 350 and add Rage/Renown coverage back to 213 and 215.

**R41. Invert test 114 — non-unique names are intended.** Ruled on by the owner: names are explicitly
**not** required to be unique, and uniqueness must not be enforced. Nothing enforces it today, so the
application is already correct; the test is what is wrong. Invert it to assert positively that a
rename onto an existing name **succeeds**, the same treatment patronage readability got, so that
anyone who later "fixes" this by adding uniqueness fails loudly instead of silently removing intended
behaviour. Identify characters by id, never by name — that constraint already holds throughout the
suite and the helpers.
*Verify:* `assets-rename-portrait.spec.js` test 114 becomes a positive pass.

**R42. Invert test 11 — a future-dated patronage is active on purpose.** Ruled on by the owner: only
`expiresOn` should gate patron status, deliberately, to avoid time-zone confusion around the start of
a patronage. `paidOn` is therefore recorded for reference rather than consulted, and the current
behaviour of `ExpirationMixin.isActive`, `get_my_patronage_status` and `vote_for_referendum` is
correct. Invert the test to assert that a patronage with a future `paidOn` and a future `expiresOn`
**is** active.
*Verify:* `admin-patronage.spec.js` test 11 becomes a positive pass.

**R43. There is no way to delete a Patronage.** No button, no list control, no route.
*Verify:* `admin-patronage.spec.js` test 13.

**R44. `#administration/patronages/user/:id` is broken for everyone, admin included.**
`AdministrationUserView`'s regions require `#abs-form` and `#patronage-list-region`, but that page's
markup is an empty `<form>`. Marionette throws on construction inside a legacy promise callback and the
route dies before `changePage`.
*Verify:* `admin-patronage.spec.js` test 7.

**R45. Remove one piece of dead code; keep the rule tables.** `character-print-view.html` is imported
by `CharacterPrintView` but never rendered — the real template is the venue-aware
`character-print-parent.html`. It actively misleads: judging print coverage from it produces wrong
conclusions. **Delete it.**

The `bnsmetv1_ElderDisciplineRule`, `bnsmetv1_TechniqueRule` and `bnsmetv1_RitualRule` classes have no
runtime consumer and no cost field, but the owner has ruled they **stay** — they are informational
reference data, and XP legitimately comes from the generation-keyed formula in
`BNSMETV1_VampireCosts.js` instead. **No tests are needed for them**, so do not add coverage; the
existing admin-rules tests that exercise their editors are sufficient.

**R46. `#profile/:id` links to a route that does not exist** (only `patronage/:id` does).

---

## Phase 7 — Reporting And Observability Coverage

**R47. Close the two real audit-log gaps; the third is intended.** Ruled on by the owner, the log's
purpose is a backend record of what really happened, so `beforeSave("Vampire")`'s `tracked_texts`
allowlist needs two additions and one deliberate omission. It is currently exactly:

```
name, clan, state, archetype, archetype_2, faction, title, sect, antecedence,
wta_breed, wta_auspice, wta_tribe, wta_camp, wta_faction
```

| Change | Today | Required |
|---|---|---|
| Rename, Vampire text, Werewolf text | logged | unchanged |
| **Changeling text** (`ctdbs_kith`, `ctdbs_fealty_court`, `ctdbs_kith_group_type`) | **not logged** | **must be logged, like the other venues** |
| **XP notation add / edit / delete** | **not logged** | **must be logged** |
| **Long text edits** | not logged | **intended — long texts can be very large, and must stay out of the log** |

**R47a — log Changeling text changes.** Add the `ctdbs_*` text attributes to `tracked_texts`. Today a
Changeling owns no `core` log row at all until a rename, which is purely an oversight of the allowlist
rather than a design choice.
*Verify:* `lifecycle-changeling.spec.js` test 369.

**R47b — log XP notation operations.** There is no hook on `ExperienceNotation` and the XP fields are
absent from the allowlist, so an add, an edit and a delete together produce zero rows. Add a hook on
`ExperienceNotation` recording the operation, the reason, and the earned/spent deltas. Note the
interaction with R49: the log is immutable, so an *edited* notation must append a new row rather than
amend the original — which is the right shape anyway, since the point is to show what really happened.
*Verify:* `xp-history.spec.js` test 75; `lifecycle-*.spec.js` tests 321, 344, 364.

**R47c — long texts stay unlogged, and the tests must say so.** Ruled intended: long texts can be
large enough that logging them would bloat the audit trail. `update_long_text` never calls
`Vampire#save()`, so the hook never fires, and the fields are absent from the allowlist — belt and
braces, both correct. Invert the four tests to assert positively that a long-text edit produces **no**
new log row, so that anyone who later adds long texts to the allowlist fails loudly.
*Verify:* `long-texts.spec.js` test 285 and `lifecycle-*.spec.js` tests 329, 352, 372 all become
positive passes.

**R48. Experience pagination is dead code.** `CharacterExperienceView.register(character, start,
changeBy)` accepts both parameters and uses neither; the skip/limit lines and the Prev/Next controls
are commented out, so `/experience/0/10` and `/experience/10/10` return the identical full set. Note
that `CharacterLogView` **does** paginate correctly — copy its implementation rather than writing a new
one.
*Verify:* `xp-history.spec.js` test 74.

**R49. Audit-log immutability is intended and is genuinely enforced — with one hole to close.** Ruled
on by the owner: if a player cheats, the backend must hold a record that **nobody** is allowed to
change, so the log always shows what really happened. Verified against the live schema, the guarantee
holds where it matters:

| Operation | Permitted to |
|---|---|
| `create` / `update` / `delete` | `role:SiteAdministrator` only — and no user holds that role |
| `find` / `get` | `*`, then narrowed per row by ACL (a stranger reads zero rows) |
| **`addField`** | **`*` — anyone can extend the class schema** |

Rows are written by the cloud hooks, which run with master-key privileges, which is why `create` being
restricted does not prevent legitimate logging.

**The one gap is `addField`.** An "immutable" record that any client can add arbitrary fields to is
weaker than it reads. Restrict `addField` to `role:SiteAdministrator` to match the other write
operations. Nothing else here needs changing, and the accumulation during teardown is a test-hygiene
consequence of immutability working as designed, not a defect — leave it.

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
| 7 | R47a, R47b | Largest remaining test win, and now unblocked — audit scope is decided. Five pinned tests. |
| 8 | The four test inversions | R41, R42, R47c. No application change at all — these tests assert the opposite of intended behaviour and must be turned around. Quick, and they stop a future "fix" from silently removing a guarantee. |
| 9 | Phases 6, 7 remainder | Content authoring (R39) and the one remaining open question (R40). |

**Two fixes are worth doing first if you only have an hour:** R10 (seven pinned tests, one wrong
property name) and R11 (a refused vote being silently recorded). If you have a second hour, the four
test inversions in R41/R42/R47c need no application change at all.

---

## 4. Decisions Already Made

All six open questions were ruled on by the owner. They are recorded here because several change what
"correct" means, and a fresh session must not re-litigate them.

| # | Question | Ruling |
|---|---|---|
| 1 | Audit-log scope | **XP notations must be logged. Changeling text changes must be logged, like the other venues. Long texts stay unlogged — they can be large enough to bloat the trail.** See R47a/b/c. |
| 2 | Name uniqueness | **Names are explicitly *not* required to be unique, and uniqueness must not be enforced.** See R41; R7 is withdrawn. |
| 3 | Missing game data | Answered in R39: seven categories, none with any source content, including one Vampire category not previously reported. |
| 4 | The three rule classes | **Keep them — they are informational reference data. No tests needed.** See R45. |
| 5 | Audit-log immutability | **Intended.** If a player cheats, the backend must hold a record nobody can change. Verified enforced for create/update/delete; `addField` is an open hole to close. See R49. |
| 6 | Future-dated patronage | **Active is correct**, deliberately, to avoid time-zone confusion. See R42. |

### What these rulings change

Four tests currently pinned red are asserting the *wrong* expectation and must be **inverted into
positive tests**, not fixed in the application:

| Test | Currently asserts | Must assert |
|---|---|---|
| `admin-patronage` 11 | a future-dated patronage is inactive | it **is** active |
| `assets-rename-portrait` 114 | renaming onto an existing name is rejected | it **succeeds** |
| `long-texts` 285 | long-text edits are logged | they produce **no** log row |
| `lifecycle-*` 329 / 352 / 372 | long-text edits are logged | they produce **no** log row |

Inverting rather than deleting is deliberate, and is the same treatment patronage readability already
received: a test that demands the opposite of intended behaviour will, if someone later "fixes" it,
silently remove a guarantee. Turned around, it defends the decision instead.

Five tests remain genuine work: `xp-history` 75 and `lifecycle-*` 321 / 344 / 364 (XP logging, R47b),
and `lifecycle-changeling` 369 (Changeling text logging, R47a).

## 4b. Known Outstanding — Read Before Running The Suite

**The Description catalogue was refreshed** from `data/all_greensboro_descriptions_20260816.csv`
(see R39). All seven previously-empty categories now have rows, and the existing catalogues grew
substantially. The merge is verified: zero dev-only values lost, no category shrank.

Four tests that had encoded the *old, empty* state were updated to assert the new reality, and one
hardcoded trait name was corrected — the refresh fixed the misspelling **"Seeling" → "Seelie"**. Expect
any test that names a trait literally to need checking against the catalogue rather than assumed.

**One test is left failing and it is not the data's fault:**

`lifecycle-werewolf.spec.js` **355** ("Player log paginates correctly across at least three pages").
Pagination itself is proven in the same test by URL navigation — three disjoint pages compared as an
ordered multiset. What fails is the final step, which drives the log's own **Next** button. After
`readLogPage`, the app ends up with the log hash set but `#character` still the active jQuery Mobile
page, so the Next button is present and enabled but not on screen, and the click times out against a
control no user could see.

That is **R28/R30/R33's swallowed-`changePage` defect**, not a pagination bug and not a consequence of
the data refresh — it is the same family this codebase hits whenever a view short-circuits a
re-render. The last attempted fix routes through `openLog` (the hard-reload path) and was **not
verified before hand-off**; treat it as unproven. Either finish it as part of Phase 4, or temporarily
reduce 355 to its URL-based assertions with a comment pointing at R28.

**Do not "fix" this by forcing the click.** A forced click on an invisible control would assert that a
user can press a button they cannot see.

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
