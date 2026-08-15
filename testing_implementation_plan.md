# Yorick Playwright E2E Implementation Plan

**393 itemized tests across 14 tasks (Task 0 through Task 13).**

This plan replaces the previous draft. It is grounded in the actual codebase: routes read from
[`public/scripts/app/routers/mobileRouter.js:137-241`](public/scripts/app/routers/mobileRouter.js:137), trait and text
categories read from the three creature models, and the existing Karma suites in
`public/scripts/app/tests/`. Every item the user listed is itemized below and cross-referenced in the
Requirements Traceability table so nothing is dropped during implementation.

---

## 0. Current State — What Is Actually Wrong

### 0.1 The suite does not currently run

Two files in the working tree fail `node --check`:

| File | Defect |
|---|---|
| [`e2e/administration.spec.js:108`](e2e/administration.spec.js:108) | Three stray `});` after the closing `test.describe` — leftover from a bad edit |
| [`e2e/helpers/auth.js:97`](e2e/helpers/auth.js:97) | Duplicated `logout\n};` fragment after `module.exports` |

Until these are fixed, **no** Playwright test can be collected. This is Task 0.

### 0.2 The existing 40-ish tests are almost entirely smoke tests

Reviewing all five existing specs, the dominant pattern is:

```js
await navigateToHash(page, someHash, '#some-view');
await expect(page.locator('#some-view')).toBeVisible();
```

That asserts *a view mounted*, not *the feature works*. Concretely:

- **Patronages** — [`administration.spec.js:66-79`](e2e/administration.spec.js:66) asserts the list container is
  attached. It never creates a patronage and never checks that anyone becomes a Patron.
- **Game rules** — [`administration.spec.js:81-93`](e2e/administration.spec.js:81) asserts the rules table renders.
  No rule is ever added.
- **Referendums** — [`administration.spec.js:102-107`](e2e/administration.spec.js:102) asserts a list div is visible.
  No referendum is created and no ballot is ever cast, despite `vote_for_referendum` being wired up in
  [`views/ReferendumView.js:59-79`](public/scripts/app/views/ReferendumView.js:59).
- **XP history** — [`character-history.spec.js`](e2e/character-history.spec.js) works against
  `Vampire.create_test_character`, whose notation count is unasserted. The "edit earned" test sets the field to `15`
  and then asserts `toContainText('15')` on the whole table — which passes even if `Available` never changed. There is
  no spent-value test at all.
- **Approvals** — [`character-history.spec.js:422-428`](e2e/character-history.spec.js:422) renders the approval view.
  Zero approvals are ever created.
- **Rename** — [`character-sheet.spec.js:560-580`](e2e/character-sheet.spec.js:560) asserts the string
  "Successfully Updated" appears. It never revisits any other view.
- **Portraits** — [`character-sheet.spec.js:582-588`](e2e/character-sheet.spec.js:582) asserts the file input is
  attached. Nothing is uploaded. Same for [`troupes.spec.js:697-703`](e2e/troupes.spec.js:697).
- **Troupes** — [`troupes.spec.js`](e2e/troupes.spec.js) hardcodes `sampleTroupeId = 'WOad4CBTsG'` and asserts empty
  roster containers are visible. With no characters in the troupe, the roster, summarize, select-to-print, and network
  views are all trivially "passing" against empty state.

### 0.3 Karma coverage with no UI counterpart

These Karma specs exercise creation and trait mutation at the model layer with no Playwright equivalent:
`default-test.js` (Vampire creation, Werewolf creation, traits, XP history, long texts, troupe membership),
`trait-test.js` (trait rename/collide/remove ×3 creature types), `creation-vs-xp-test.js` (creation pool vs XP ×3),
`creature-types-test.js` (Vampire/Werewolf/Changeling specifics), `approvals-test.js`, `xp-history-test.js`,
`admin-test.js`, `description-test.js`, `troupe-test.js`.

---

## 1. Conventions That Apply To Every Test Below

**Real UI interaction only.** Tests drive the jQuery Mobile DOM. `page.evaluate` with Parse is permitted **only** in
`beforeAll` fixture setup and in assertion-side read-back, never as a substitute for the interaction under test.

**Assert values, not visibility.** Every test asserts a concrete value, count, or delta. `toBeVisible()` on a container
is never the sole assertion of a test.

**Deltas over absolutes for XP.** Read the number before, act, read after, assert the arithmetic difference. This
survives changes to seeded starting values.

**Portrait verification is byte-level.** Fixtures are generated PNGs with a known dominant color and known dimensions.
Verification fetches the rendered `img[src]` over HTTP, asserts a 200 with an image content-type, decodes it, and
compares dimensions and dominant color to the fixture. "An `<img>` exists" is not verification.

**No hardcoded object IDs.** `WOad4CBTsG` and friends are replaced by fixtures that create their own troupes and
characters and return real IDs.

**Log assertions are structural.** A log assertion names the row (by trait name and timestamp ordering) and asserts the
`old_value` / `new_value` / `old_cost` / `new_cost` cells, not just that the trait name appears somewhere on the page.

---

## Task 0 Outcome — Completed, With Findings That Change Later Tasks

Task 0 is done and verified against a live server. What follows is what the work turned up; several
items change assumptions baked into the numbered tests below, so read this before starting any task.

### Blockers found and fixed

| Finding | Effect | Resolution |
|---|---|---|
| Two working-tree files had syntax errors (`e2e/administration.spec.js`, `e2e/helpers/auth.js`) | No test could be collected at all | Fixed; both now match their committed state. `node e2e/check-syntax.js` runs as `pretest:e2e` so it cannot recur |
| `database_seed/Description.json` carries only the 35 **Vampire** categories | Every Werewolf and Changeling text picker rendered **zero options** — no such character could be created, blocking ~126 tests across Tasks 8b, 8c, 11, 12b, 12c | `seed_extra.js` backfills from `data/all_dev_descriptions.csv`, which was already in the repo: **878 rows across 30 categories**, including `wta_tribes`, `wta_auspices`, `wta_breeds`, `wta_camps`, `ctdbs_kiths`, `ctdbs_fealty_courts`, `wta_gifts` |
| `bnsctdbs_KithRule` had no seed file, only a CSV | Kith Rules editor started empty, blocking tests 23–25 | Backfilled from `data/bnsctdbs_KithRule.csv` (11 rows) |
| The whole seed was gated behind `userCount === 0` | A new test account could never be added to an existing database | User/role seeding moved out of the gate and made idempotent; **`sampstranger` added** (required by Task 13) |
| `publicServerURL` defaults to a dead Cloud9 host | Every portrait upload failed with an opaque `[object Object]`, because the thumbnail `beforeSave` hook fetches the uploaded file back over HTTP from that URL. This would have blocked all of Tasks 6's portrait tests | Playwright's `webServer` now sets `PUBLIC_SERVER_URL=http://127.0.0.1:1337/parse/1`. **A manually started server needs this too**; global setup warns when it is unset |

### Application defects found (not fixed — for the owning task to decide)

- **`CharacterApprovalView.register` is missing a `return`.** Its final statement is
  `p.then(function () { Parse.Promise.as(self); })`, so the chain resolves with `undefined`.
- **The approval view strands the router.** Navigating from `#character/:cid/approval` to an unrelated
  route updates the hash but never changes the page, with nothing logged. Re-running the route handler
  does not clear it; only reloading does. `navigateToHash` now falls back to a reload, so tests get
  through, but Task 5 should treat this as a real defect rather than a test-harness quirk.
- **`format_entry(log, "available")`** in the XP notations template reads a property that exists on
  neither the model nor the view, so that column always renders blank.

### Facts the numbered tests depend on

- **The creation pool badge undercounts for every Werewolf and Changeling category.**
  `VampireCreation.remaining_picks()` sizes its loop from a hardcoded `tops` map holding only
  `skills / disciplines / backgrounds / attributes / merits / flaws`, so any `wta_*` or `ctdbs_*`
  category falls back to `tops[category] || 1` and sums only the rating-1 and rating-0 sub-pools. The
  per-rating counters on the creation record are correct; only the on-page `.ui-li-count` badge is
  wrong. Assert the real counters via `readCreation`, and treat the badge as a known-wrong value.
- **`wta_rites` purchases cost nothing.** `BNSWTAV1_WerewolfCosts.calculate_trait_cost` has no branch
  for that category and no seeded Description carries a cost override, so the cost resolves to
  `undefined` and `Character.update_trait`'s `_.isFinite` guard silently zeroes it. The Rite is bought
  and rendered correctly; only the XP deduction is missing.
- **Renown (Glory / Honor / Wisdom) has no UI path at all.** It is absent from
  `ALL_SIMPLETRAIT_CATEGORIES`, has no seed data anywhere in the repository, and appears on neither
  the live nor the print sheet. **Item 354 (Task 12b, "raise Renown") therefore cannot pass** and
  should be treated the same way as the three dropped Description categories. "Rage" is likewise a
  hardcoded print-only constant, tied to no character data.
- **Gift affinity** is `[wta_tribe, wta_auspice, wta_breed] + extra_affinity_links` intersected against
  a Gift's `affinity_1..3`. Measured: affinity Gift 4 XP at value 1, non-affinity 6. The post-creation
  `wta_gifts` picker also defaults its own filter to "Mine", hiding non-affinity Gifts until switched
  to "Any".

- **Creation merits cost XP and flaws refund it — this is deliberate, not a bug.**
  `calculate_trait_cost` in `helpers/BNSMETV1_VampireCosts.js` returns `mod_value` for `merits` and
  `mod_value * -1` for `flaws`, unlike the slot pools, which use `free_value` so their cost nets to
  zero. The `merits_0_remaining` / `flaws_0_remaining` counters are a 7-point *cap*, not an
  XP-exemption. Items 178, 179, 181 and 182 originally said "XP is unchanged"; that was an error in
  this plan, extrapolated from slot-pool behaviour, and has been corrected to the measured arithmetic.
  The Karma test this derives from only ever asserted the pool.
- **Discipline cost tables stop growing after level 9.** `get_cost_table` builds `_.range(1, 10)` and
  `get_cost_on_table` uses `_.take`, which silently returns the whole array past its end, so levels
  10-15 all cost what level 9 costs. Test 189's expectation is derived from that algorithm, so fixing
  the app will turn it red — deliberately.
- **`VampireChange` rows cannot be deleted by the test user and accumulate.** Class-level permissions
  in `database_seed/_SCHEMA.json` grant `delete` only to `role:SiteAdministrator`, and `devuser` holds
  `Administrator`. They are also *generated* during teardown, since `beforeDelete("SimpleTrait")`
  writes a "remove" entry per destroyed trait. Suites that count audit-log rows globally must expect
  this growth rather than assume a clean table.

- **The XP notations table renders two `<tr>` per notation.** A delta row carrying the running balance
  as `earned - spent`, then a value row with the Edit controls. The running balance test 57 asks for is
  in the *delta* row. `readXpRows` pairs them.
- **New notations are inserted at the top**, not appended. Addressing a new row by position silently
  edits an existing entry — this is how the character's original 30 XP award gets clobbered. Look rows
  up by reason.
- **jQuery Mobile leaves stale popup copies in the DOM.** A character with four notations has *sixteen*
  elements with `id="alteration-input"`. `page.fill('#alteration-input', …)` hits a detached copy and
  the edit silently does nothing. Use `fillInActivePopup` / `submitActivePopup`.
- **Log column names differ from this plan's prose**: the new-value column is `value` (not `new_value`)
  and the new-cost column is `cost` (not `new_cost`). `logs.js` accepts either spelling.
- **The approval UI is slider-driven.** `historyBaseRange` / `historyChangePicker` are
  `input[type="number"]`, not `range`. The approvals region is itself a slider whose `max` is the
  approval count, plus one hidden `#approval-changes-N` input per approval — there is no table to scrape.
- **Merits and flaws are point-sum pools, not slot pools.** The wizard renders one pick link per
  remaining *point* while each pick costs that trait's own value, so following every link overspends the
  budget and drives the pool negative, corrupting spent XP. `spendAllCreationPools` skips sum pools by
  default.
- **Troupe membership lives on the character** (`troupes` relation), not on the troupe. Querying
  `troupe.relation('characters')` always counts zero.

### Dropped coverage

**`ctdbs_noble_houses`, `ctdbs_realms`, and `wta_monikers` are out of scope.** They have no source data
anywhere in the repository — absent from `database_seed/Description.json` and from every CSV under
`data/` — so seeding cannot populate them without inventing game content. On the owner's decision these
are dropped from the suite rather than blocked on authoring that data.

Four tests existed only to exercise them and have been **removed**, taking the total from 397 to 393:

| Was | Test |
|---|---|
| 212 | Post-creation `wta_monikers` addition renders on the sheet |
| 223 | Pick Noble House; the value renders |
| 238 | Post-creation Realm purchase (`Actor` 1) deducts XP |
| 312 | The House picker lists the seeded `ctdbs_noble_houses` Descriptions |

Six further tests survive with the category removed from their scope: the Changeling print sheet no
longer asserts a Realms section; the Werewolf and Changeling category lists drop `wta_monikers` and
`ctdbs_realms`; Changeling's text-attribute set drops `ctdbs_noble_house`; and in Task 12 the Werewolf
lifecycle adds a Rite without a Moniker while the Changeling lifecycle purchases an Art without a Realm
and changes Kith and Court without House.

Everything after the removals has been renumbered, so **numbering is contiguous 1–393** and the ranges in
the execution-order and traceability tables reflect the new values. `descriptions.js` no longer lists the
three categories as venue coverage; `UNSEEDABLE_CATEGORIES` retains them purely as a guard, so any future
test that reaches for one fails with an explanation instead of an empty list.

### Still outstanding

- **`troupes.addStaff` is incomplete.** Selecting a user from `#troupe/:id/staff/add` continues to
  `#troupe/:id/staff/edit/:uid`, where a role (LST / AST / Narrator) must be chosen and saved; only the
  first step is implemented, so the staff list stays empty. It throws unless passed
  `{ allowIncomplete: true }`. **Tests 130, 131 and anything needing a troupe AST cannot pass until the
  role step is added** — this is the first thing Task 7 should build.

### Verification performed

Against a live server on a fresh in-memory Mongo:

- All three venues drive the real wizard to completion and land on **exactly 30 earned / 0 spent / 30 available**.
- XP: four seeded notations produce running balances `[42, 40, 35, 30]` and totals `{45, 3, 42}`;
  editing earned moves Available by **exactly +20**, editing spent by **exactly −10**, and resetting spent
  restores the prior balance exactly.
- Portraits: a 200×200 red PNG uploads, renders as a 128×128 JPEG thumbnail, and decodes to
  `rgb(220, 40, 40)`; replacing it with the blue fixture changes every surface to `rgb(39, 78, 219)`; the
  troupe fixture decodes to `rgb(40, 180, 90)` at 400×300.
- Venue exclusivity: a Vampire sheet offers no `wta_*` or `ctdbs_*` categories.
- Logs parse into typed rows; troupe create / join / roster / leave round-trips; approvals register.
- **The pre-existing suite still passes: 42 passed, 1 skipped, 1.2 minutes** (previously serial with full
  trace and video capture on every test).

---

## Task 0 — Repair The Harness And Build Shared Fixtures

No test numbers; these are the deliverables the other 393 tests depend on.

- **D0.1** Fix the syntax error in [`e2e/administration.spec.js:108`](e2e/administration.spec.js:108).
- **D0.2** Fix the syntax error in [`e2e/helpers/auth.js:97`](e2e/helpers/auth.js:97).
- **D0.3** Add `node --check` over `e2e/**/*.js` as a pretest step in `package.json` so this class of breakage cannot
  recur silently.
- **D0.4** `e2e/helpers/characters.js` — `createCharacter(page, type, name)`, `createCompletedCharacter(page, type, opts)`
  (drives the real creation wizard to completion), `deleteCharacter`. Returns real IDs.
- **D0.5** `e2e/helpers/troupes.js` — `createTroupe(page, name)`, `addStaff(page, troupeId, username, role)`,
  `joinTroupe(page, charId, troupeId)`, `leaveTroupe`.
- **D0.6** `e2e/helpers/xp.js` — `readXpTotals(page)` returning `{earned, spent, available}` parsed as numbers from the
  stat cards; `readXpRows(page)` returning the table as an array of objects; `addNotation`, `editNotationField`.
- **D0.7** `e2e/helpers/approvals.js` — `approveLatestChange(page, charId)`, `readApprovals(page, charId)`,
  `readApprovedSnapshot(page, charId)`.
- **D0.8** `e2e/helpers/images.js` — `makeFixturePng(color, w, h)` writing to the scratch dir; `fetchRenderedImage(page,
  selector)` returning `{status, contentType, width, height, dominantColor}`.
- **D0.9** `e2e/helpers/logs.js` — `readLogRows(page, charId, start, count)` returning structured rows;
  `expectLogRow(rows, {trait, oldValue, newValue, oldCost, newCost})`.
- **D0.10** `e2e/helpers/descriptions.js` — `pickSimpleText(page, charId, category, target, value)` driving the real
  picker route; `listPickerOptions(page, ...)`.
- **D0.11** `e2e/fixtures/` — checked-in PNG fixtures (`portrait-red-200x200.png`, `portrait-blue-320x240.png`,
  `troupe-green-400x300.png`) plus a non-image file for negative upload tests.
- **D0.12** Split `playwright.config.js` projects per task file group so the suite can shard; keep `workers: 1` only for
  the fixture-mutating admin projects, allow parallelism elsewhere. Add per-task `npm run test:e2e:*` scripts.
- **D0.13** A `seedTestUsers` guard that asserts `devuser`, `sampmem`, `sampast`, and a fourth `sampstranger` user exist
  before the suite runs (the stranger user is required by several access-control tests and does not currently exist).

---

## Task 1 — Patronage Lifecycle And Patron Status
*File: `e2e/admin-patronage.spec.js`*

1. Patronages list (`#administration/patronages`) renders with a working "New Patronage" action link
2. New Patronage form (`#administration/patronages/new`) renders owner select, `paidOn`, `expiresOn`, and submit
3. Create a patronage for `sampmem` through the form; success feedback is shown and the form clears
4. The new patronage appears as a row in `#administration/patronages` showing `sampmem` as owner
5. Patronage detail (`#administration/patronage/:id`) shows the exact `paidOn` and `expiresOn` that were submitted
6. The patronage appears in the CSV view (`#administration/patronagescsv`) with correct column values
7. Per-user view (`#administration/patronages/user/:id`) lists exactly the one created record for `sampmem`
8. Admin user view (`#administration/user/:id`) shows `sampmem`'s patronage region populated with the new record
9. **`sampmem` logged in sees the patronage in their own `#profile` `#usp-patronage-list-region`**
10. **`sampmem` is recognized as an active Patron** — the patron-gated affordance is enabled for them and absent for a
    non-patron user
11. Create a second patronage with a **future** `paidOn`; the user is not yet an active Patron
12. Edit the patronage `expiresOn` to a past date; the user loses active-Patron status in `#profile`
13. Delete the patronage; the user loses Patron status and the row disappears from the list and CSV views
14. Privacy: `sampast` cannot view `sampmem`'s patronage via `#administration/patronages/user/:id`
15. Non-admin `sampmem` navigating to `#administration/patronages/new` is blocked or redirected

---

## Task 2 — Game Rules Editors: Add And Verify
*File: `e2e/admin-rules.spec.js`*

16. Clan Rules editor (`#administration/bnsmetv1_clan_rules`) renders the rules table and the add/edit form
17. **Add a new Clan Rule through the form; the new row appears in the rules table**
18. The added Clan Rule persists across a full page reload
19. The added Clan Rule is offered as a selectable Clan in the Vampire creation clan picker
20. Selecting the new Clan on a Vampire sets it on the sheet and print header
21. Edit an existing Clan Rule's fields; the updated values render in the table
22. Delete the added Clan Rule; it disappears from the table and from the creation picker
23. Kith Rules editor (`#administration/bnsctdbs_kith_rules`) renders the table and form
24. **Add a new Kith Rule; the new row appears in the table**
25. The added Kith Rule is offered as a selectable Kith in Changeling creation
26. Elder Discipline Rules (`#administration/bnsmetv1_elder_discipline_rules`): add a rule; it appears in the table
27. The added Elder Discipline is purchasable on a Vampire and shows the cost defined by the rule
28. Technique Rules (`#administration/bnsmetv1_technique_rules`): add a rule; it appears in the table
29. The added Technique is purchasable on a Vampire at the rule-defined cost
30. Ritual Rules (`#administration/bnsmetv1_ritual_rules`): add a rule; it appears in the table
31. The added Ritual is purchasable via `#simpletraits/rituals/:cid/new` at the rule-defined cost
32. Descriptions admin (`#administration/descriptions`) renders the category selector and filters the list by category
33. **Create a new Description through the admin UI; it appears in the filtered list**
34. The new Description is offered in the matching trait "new" picker for a character
35. Update the Description's text through the admin UI; the change is reflected in the picker
36. Non-admin `sampmem` is blocked from `#administration/bnsmetv1_clan_rules`
37. Non-admin `sampmem` attempting to save a global Description edit gets a surfaced permission error

---

## Task 3 — Referendums: Creation And Voting
*File: `e2e/admin-referendums.spec.js`*

38. Admin referendums list (`#administration/referendums`) renders with a create action
39. **Create a referendum with a title, description, and at least three ballot options**
40. The created referendum appears in `#administration/referendums`
41. Admin referendum detail (`#administration/referendum/:id`) shows all ballot options with zero initial tallies
42. The referendum is visible to a member at `#referendums`
43. A member opening `#referendum/:id` sees the description child view and the options child view
44. **A patron member casts a vote; the ballot is recorded and a confirmation message is displayed**
45. Reloading `#referendum/:id` shows the member's existing ballot as their current selection
46. **Recasting the vote for a different option replaces the ballot — the member still has exactly one ballot**
47. The tally in the admin view increments to match after the vote
48. A second user votes for a different option; both tallies are correct in the admin view
49. A third user votes for the same option as the first; that tally reaches 2
50. A non-patron user is prevented from voting and shown the patron-required message
51. An unauthenticated visitor cannot reach `#referendum/:id`
52. A referendum past its close date does not accept new votes
53. Editing a referendum's ballot options through the admin UI is reflected on the member-facing view

---

## Task 4 — XP History: Four-Plus Entries, Earned And Spent Recalculation
*File: `e2e/xp-history.spec.js`*

Fixture: a completed Vampire seeded through the UI with **four distinct notations**, each with a different date,
reason, earned value, and spent value.

54. **Fixture verification: the character has exactly four XP notations with four distinct dates and reasons**
55. `#character/:cid/experience/0/10` renders exactly four rows with Date, Reason, Earned, Spent, Available columns
56. The header stat cards (Earned / Spent / Available) equal the column sums of the four rows
57. **The per-row running Available column equals cumulative earned-minus-spent at every one of the four rows**
58. Add a fifth notation via the Add button; the table shows five rows and the totals update by the added amounts
59. Edit the Reason on row 2; the new reason persists in the table after a reload
60. Edit the Date on row 3; the row re-sorts to the correct chronological position
61. **Edit Earned on row 2 upward by 20; Available increases by exactly 20 and Earned total increases by exactly 20**
62. **Edit Earned on row 2 downward by 15; Available decreases by exactly 15**
63. **Set Earned on row 2 to 0; Available decreases by exactly that row's prior earned value**
64. **Edit Spent on row 3 upward by 10; Available decreases by exactly 10 and Spent total increases by exactly 10**
65. **Reset Spent on row 3 to 0; Available returns to exactly its pre-edit balance**
66. **Edit both Earned and Spent on the same row; Available reflects the net of both deltas**
67. Set Spent higher than the running Available; the negative balance is displayed rather than silently clamped
68. Insert a backdated notation preceding row 1; it lands first and every subsequent row's Available re-propagates
69. Delete a middle notation; the four remaining rows re-propagate their running Available correctly
70. Delete the top-most notation; the totals recalculate correctly
71. Four rapid sequential additions produce the correct aggregate totals with no lost updates
72. The sheet header Available XP at `#character?:id` matches the XP page Available after all the above edits
73. `#character/:cid/costs` reconciles: total trait cost equals the Spent total from the history
74. With more than ten entries, `/experience/0/10` and `/experience/10/10` paginate correctly with no duplicates
75. Every XP notation add, edit, and delete produces a corresponding entry in `#character/:cid/log/0/10`

---

## Task 5 — Approvals: Ten Steps, Snapshot Verified At Each Step
*File: `e2e/approvals.spec.js`*

Fixture: a fully created Vampire owned by `sampmem`, joined to a troupe with `sampast` as Assistant Storyteller.

76. Setup: baseline Vampire is created and completed by `sampmem` and joined to the troupe
77. Before any approval, `#character/:cid/approved` shows only the creation baseline

Each of tests 78–87 performs one player-side change, has `sampast` approve it, and then asserts three things:
the approval count incremented by one, `#character/:cid/approved` reflects the **new** value, and the approved
snapshot no longer shows the **previous** value.

78. **Approval 1/10** — Physical attribute raised by 1; approved snapshot matches step 1
79. **Approval 2/10** — Social attribute raised by 1; approved snapshot matches step 2
80. **Approval 3/10** — Mental attribute raised by 1; approved snapshot matches step 3
81. **Approval 4/10** — Skill `Athletics` purchased at 1; approved snapshot matches step 4
82. **Approval 5/10** — Skill `Brawl` raised to 2; approved snapshot matches step 5
83. **Approval 6/10** — In-clan discipline `Celerity` +1; approved snapshot matches step 6
84. **Approval 7/10** — Out-of-clan discipline `Dominate` +1; approved snapshot matches step 7
85. **Approval 8/10** — Background `Resources` +1; approved snapshot matches step 8
86. **Approval 9/10** — Merit added; approved snapshot matches step 9
87. **Approval 10/10** — Text attribute `Title` changed; approved snapshot matches step 10
88. `#character/:cid/approval` lists all ten approvals in chronological order with the approver's name on each
89. Each approval row links to the change it approved and displays that change's old → new values
90. After a further unapproved change, the sheet flags the character as containing unapproved edits
91. `#character/:cid/approved` still shows the step-10 snapshot while the pending change exists
92. `#character/:cid/print` shows the current pending values, demonstrably different from the approved snapshot
93. False-approval detection: modifying a trait after its approval marks that approval as stale in the approval view
94. `sampmem` cannot approve their own character's changes — the approve control is absent or the action is refused
95. A stranger user sharing no troupe cannot open `#character/:cid/approval`
96. An AST from a different troupe cannot approve this character
97. Administrator `devuser` can approve and is recorded as the approver
98. All ten approvals survive a reload and re-render identically

---

## Task 6 — Rename And Portraits, Verified Everywhere They Appear
*File: `e2e/assets-rename-portrait.spec.js`*

99. Rename form submits a new unique name and shows success feedback
100. **Renamed name appears in the sheet header at `#character?:id`**
101. **Renamed name appears in the roster at `#characters?all`**
102. **Renamed name appears in the printable sheet at `#character/:cid/print`**
103. **Renamed name appears in the approved view at `#character/:cid/approved`**
104. **Renamed name appears in the log view header at `#character/:cid/log/0/10`**
105. **Renamed name appears in the costs view at `#character/:cid/costs`**
106. **Renamed name appears in the XP history view header**
107. **Renamed name appears in the history timeline view at `#character/:cid/history/0`**
108. **Renamed name appears in the troupe roster at `#troupe/:id/characters/all`**
109. **Renamed name appears in the troupe summarize view**
110. **Renamed name appears in the troupe select-to-print list**
111. **Renamed name appears in the admin characters list at `#administration/characters/all`**
112. **Renamed name appears in the admin characters summarize view**
113. The rename is recorded in the character log as a name-change entry with old and new name
114. Renaming to collide with an existing character name is rejected with a surfaced error
115. Portrait upload: submit `portrait-red-200x200.png` at `#character/:cid/portrait`; success is confirmed
116. **The sheet header `img` src fetches with HTTP 200 and an image content-type**
117. **The fetched sheet-header image decodes to 200×200 with a red dominant color, matching the fixture**
118. **The uploaded portrait renders and byte-matches in the printable sheet `#character/:cid/print`**
119. **The uploaded portrait renders and byte-matches in the character list item on `#characters?all`**
120. **The uploaded portrait renders and byte-matches in the troupe roster list item**
121. **The uploaded portrait renders and byte-matches in the troupe select-to-print list item**
122. **The uploaded portrait renders and byte-matches in the admin character view**
123. **Replacing the portrait with `portrait-blue-320x240.png` changes every surface above to the blue fixture**
124. Uploading a non-image file is rejected with a surfaced error and leaves the existing portrait intact
125. Troupe portrait upload at `#troupe/:id/portrait` submits `troupe-green-400x300.png` successfully
126. **The troupe portrait renders in troupe detail `#troupe/:id` and byte-matches the green fixture**
127. **The troupe portrait renders in the troupe directory `#troupes` list item and byte-matches**
128. **Replacing the troupe portrait updates both surfaces to the new fixture**

---

## Task 7 — Troupes Populated With Real Characters
*File: `e2e/troupes.spec.js` (rewritten — the hardcoded `WOad4CBTsG` is removed)*

129. Create a new troupe via `#troupe/new`; it appears in `#troupes`
130. Add `sampast` as Assistant Storyteller via `#troupe/:id/staff/add`; they appear in the staff list
131. Edit the staff role via `#troupe/:id/staff/edit/:uid`; the new role renders in the staff list
132. **Create and fully complete a Vampire owned by `sampmem` and join it to the troupe**
133. **Create and fully complete a Werewolf and join it to the troupe**
134. **Create and fully complete a Changeling and join it to the troupe**
135. **`#troupe/:id/characters/all` lists all three characters by name**
136. The roster shows the correct creature type for each of the three characters
137. The roster filter narrows the list to a single character by name
138. `#troupe/:id/character/:cid` renders each individual character within troupe context
139. `sampast` as AST can open all three characters' sheets
140. A stranger user not in the troupe cannot open the troupe roster
141. A stranger user cannot open any of the three characters
142. **`#troupe/:id/characters/summarize/all` renders one row per character with populated trait columns**
143. The summarize view shows each character's actual attribute and skill values, not blanks
144. Switching the summarize view to CSV renders a header row plus three data rows
145. Filtering the summarize view by creature type shows only the matching characters
146. **`#troupe/:id/characters/selecttoprint/all` lists all three with selection checkboxes**
147. **Selecting two of the three and printing renders exactly two sheets**
148. **The printed sheets contain each selected character's actual trait values**
149. The unselected character does not appear in the print output
150. **`#troupe/:id/characters/relationships/network` renders one node per troupe character**
151. Adding a relationship between two characters renders an edge in the network graph
152. A character leaving via `#character/:cid/troupes/leave` disappears from the roster
153. After leaving, `sampast` loses access to that character
154. Re-joining the troupe restores AST access and the roster entry

---

## Task 8a — Vampire Creation In The UI (Karma parity)
*File: `e2e/creation-vampire.spec.js`*

Mirrors `default-test.js` "A Vampire's creation" and `creation-vs-xp-test.js`, driven entirely through the wizard.

155. `#characternew` creates a Vampire and lands on `#charactercreate/:cid`
156. The creation page renders all ten regions: description, simpletexts, attributes, focuses, skills, backgrounds,
     disciplines, merits, flaws, complete
157. The creation phase reports an initial 30 XP with 0 spent
158. **Pick a Clan via the simpletext picker; the clan is displayed on the creation page**
159. **Repick the Clan; the new value replaces the prior one**
160. **Unpick the Clan; the value is cleared and the "Pick Clan" affordance returns**
161. Pick Archetype; the value renders
162. Pick Sect; the value renders
163. Pick Faction; the value renders
164. Pick Title; the value renders
165. Pick Antecedence (Primary/Secondary/NPC); the value renders
166. **Pick Physical as the 7-point primary attribute; `attributes_7_remaining` reaches 0**
167. **Attribute pool enforcement: a second 7-slot pick is prevented**
168. **Unpick Physical; the 7 slot is restored**
169. Pick Social at 5 and Mental at 3; all three attribute pools reach 0
170. **Pick a Physical focus; `focus_physicals_1_remaining` reaches 0**
171. **Repick the Physical focus (Dexterity → Stamina); the pool stays at 0 and the trait is replaced**
172. **Unpick the Physical focus; the pool is restored**
173. Pick Mental and Social focuses; both pools reach 0
174. Pick skills consuming the 4, 3, 2, and 1 pools; each decrements as expected
175. Skill pool enforcement: picking beyond an exhausted pool is prevented
176. Pick backgrounds consuming the 3, 2, and 1 pools
177. Pick in-clan disciplines using the 2 and 1 discipline slots
178. **Pick a merit (`Bloodline: Coyote` at 2); the merit pool sum drops by 2 and Spent XP rises by 2**
179. **Change the picked merit's value from 2 to 3; the pool sum and Spent XP both follow the new value**
180. **Unpick the merit with the changed value; the pool sum is fully restored**
181. Pick a flaw; the flaw pool sum drops by its value and Spent XP falls by the same amount (a refund)
182. **Across all *slot* pool picks, Available XP never moves off 30 and Spent stays 0; merits and flaws are
     the documented exception, and completion still lands on 30/0/30**
183. **Complete Creation transitions the character out of the wizard to the live sheet**
184. The completed sheet shows 30 available XP and 0 spent
185. **Post-creation purchase of in-clan `Celerity` 2 deducts the in-clan cost from Available**
186. **Post-creation purchase of out-of-clan `Dominate` 1 deducts the higher out-of-clan cost**
187. **Upgrading `Athletics` 1 → 2 post-creation charges only the incremental difference, not the full new cost**
188. Post-creation text attribute change (Title) leaves XP untouched
189. The costs view renders the expected discipline cost progression through level 15 unchanged

---

## Task 8b — Werewolf Creation In The UI (Karma parity)
*File: `e2e/creation-werewolf.spec.js`*

190. `#characternew` creates a Werewolf and lands on the creation page
191. The creation page renders the Gifts region in place of Disciplines
192. **Pick Breed; the value renders**
193. **Pick Auspice; the value renders**
194. **Pick Tribe; the value renders**
195. **Repick Tribe; the new value replaces the prior one**
196. **Unpick Tribe; the value is cleared**
197. Pick Camp, Faction, Archetype, Second Archetype, and Antecedence; all render
198. Attribute 7/5/3 allocation completes and all three pools reach 0
199. Attribute pool enforcement prevents a second 7-slot pick
200. Focus pick, repick, and unpick behave correctly for all three focus categories
201. Skill pools 4/3/2/1 each decrement correctly
202. `wta_backgrounds` pools 3/2/1 each decrement correctly
203. **Pick a Gift using `wta_gifts_1_remaining`; the pool reaches 0**
204. **Pick a `wta_merit`; the pool sum updates and XP is unchanged**
205. **Change the picked `wta_merit`'s value; the pool sum updates**
206. **Unpick the `wta_merit` with the changed value; the pool sum is restored**
207. Pick a `wta_flaw`; the flaw pool sum updates
208. **Complete Creation; the live sheet shows 30 available XP and 0 spent**
209. Post-creation Gift purchase deducts XP at the affinity-appropriate cost
210. Post-creation non-affinity Gift purchase deducts the higher cost
211. Post-creation `wta_rites` purchase deducts XP and renders on the sheet
212. Renown allocation (Glory, Honor, Wisdom) renders with correct values on the sheet
213. Gnosis sources and Rage render with correct values on the sheet
214. `wta_totem_bonus_traits` render in the Pack section
215. The Werewolf printable sheet renders the Gifts, Rites, and Renown sections with real values

---

## Task 8c — Changeling Creation In The UI (Karma parity)
*File: `e2e/creation-changeling.spec.js`*

216. `#characternew` creates a Changeling and lands on the creation page
217. The creation page renders the Arts region in place of Disciplines
218. **Pick Kith; the value renders**
219. **Repick Kith; the new value replaces the prior one**
220. **Unpick Kith; the value is cleared**
221. Pick Court (Fealty); the value renders
222. Pick Kith Group Type; the value renders
223. Pick Archetype and Antecedence; both render
224. Attribute 7/5/3 allocation completes and all three pools reach 0
225. Attribute pool enforcement prevents a second 7-slot pick
226. Focus pick, repick, and unpick behave correctly for all three focus categories
227. Skill pools 4/3/2/1 each decrement correctly
228. `ctdbs_backgrounds` pools 3/2/1 each decrement correctly
229. **Pick an Art using `ctdbs_arts_1_remaining`; the pool reaches 0**
230. **Pick a `ctdbs_merit`; the pool sum updates and XP is unchanged**
231. **Change the picked `ctdbs_merit`'s value; the pool sum updates**
232. **Unpick the `ctdbs_merit` with the changed value; the pool sum is restored**
233. Pick a `ctdbs_flaw`; the flaw pool sum updates
234. **Complete Creation; the live sheet shows 30 available XP and 0 spent**
235. Post-creation Art purchase (`Chicanery` 1) deducts XP
236. Post-creation Freehold background (`ctdbs_backgrounds` at 2) deducts XP and renders
237. `ctdbs_holdings_specializations` addition renders on the sheet
238. `ctdbs_arts_affinities_links` render correctly for the chosen Kith
239. Glamour and Banality render with correct values on the sheet
240. The Changeling printable sheet renders the Arts and Kith sections with real values

---

## Task 9 — Trait Change Lifecycle In The UI, All Three Creature Types
*File: `e2e/traits-lifecycle.spec.js` (parameterized over Vampire, Werewolf, Changeling)*

Mirrors `trait-test.js` and the "traits" block of `default-test.js`. Twelve scenarios × three creature types = 36 tests.
Category per creature: `backgrounds` / `wta_backgrounds` / `ctdbs_backgrounds`.

**Vampire (241–252)**

241. Adding a trait through `#simpletraits/:category/:cid/new` records it in the log
242. Re-adding the same trait at the same value produces no duplicate log entry
243. Raising the trait's value records a log row with the correct old and new values
244. **Renaming a trait to a specialization (`Retainers` → `Retainers: Specialized Now`) via
     `#simpletrait/specialize/...` succeeds**
245. The renamed specialization displays grouped under its base name on the sheet
246. **Renaming a trait to collide with an existing trait name is rejected with a surfaced error**
247. Changing the value of a specialized trait charges or refunds the correct XP difference
248. Removing a creation-picked trait fails with an informative error
249. Removing a purchased trait succeeds and refunds the correct XP
250. The removed trait disappears from both the category view and the main sheet
251. The removal is recorded in the log with the correct old value and cost
252. The category "new" picker lists only Descriptions valid for that category

**Werewolf (253–264)** — the same twelve scenarios against `wta_backgrounds` / `wta_gifts` / `wta_merits`

253. Adding a trait records it in the log
254. Re-adding the same trait at the same value produces no duplicate log entry
255. Raising the trait's value records correct old and new values
256. Renaming a trait to a specialization succeeds
257. The renamed specialization displays grouped under its base name
258. Renaming to a colliding name is rejected with a surfaced error
259. Changing a specialized trait's value charges or refunds correctly
260. Removing a creation-picked trait fails with an informative error
261. Removing a purchased trait succeeds and refunds correctly
262. The removed trait disappears from the category view and the sheet
263. The removal is recorded in the log
264. The category "new" picker lists only valid Descriptions

**Changeling (265–276)** — the same twelve scenarios against `ctdbs_backgrounds` / `ctdbs_arts` / `ctdbs_merits`

265. Adding a trait records it in the log
266. Re-adding the same trait at the same value produces no duplicate log entry
267. Raising the trait's value records correct old and new values
268. Renaming a trait to a specialization succeeds
269. The renamed specialization displays grouped under its base name
270. Renaming to a colliding name is rejected with a surfaced error
271. Changing a specialized trait's value charges or refunds correctly
272. Removing a creation-picked trait fails with an informative error
273. Removing a purchased trait succeeds and refunds correctly
274. The removed trait disappears from the category view and the sheet
275. The removal is recorded in the log
276. The category "new" picker lists only valid Descriptions

---

## Task 10 — Long Texts In The UI (Karma parity with `fast-test.js`)
*File: `e2e/long-texts.spec.js`*

277. Extended print text (`#character/:cid/extendedprinttext`) renders an empty state for a new character
278. Updating the extended print text persists and appears in the print preview
279. Removing the extended print text clears it from the print preview
280. Background long text (`#character/:cid/backgroundlt`) updates and persists on the sheet and print
281. Removing the background long text clears both surfaces
282. Notes long text (`#character/:cid/noteslt`) updates and persists
283. Removing the notes long text clears it
284. Navigating away and back re-renders the saved long text (cache priming behaves)
285. Long text edits are recorded in the character log
286. All three long texts render correctly on the Werewolf and Changeling printable sheets

---

## Task 11 — Creature Types And Their Unique Description Types
*File: `e2e/descriptions-by-creature.spec.js`*

Text-attribute pickers derive their Description category by appending `s` to the attribute name (see
[`templates/create/simpletexts.html`](public/scripts/app/templates/create/simpletexts.html)). Attribute lists come from
`TEXT_ATTRIBUTES` in each model.

**Vampire — `clan`, `archetype`, `sect`, `faction`, `title`, `antecedence`**

287. The Clan picker lists the seeded `clans` Descriptions
288. The Archetype picker lists the seeded `archetypes` Descriptions
289. The Sect picker lists the seeded `sects` Descriptions
290. The Faction picker lists the seeded `factions` Descriptions
291. The Title picker lists the seeded `titles` Descriptions
292. The Antecedence picker lists the seeded `antecedences` Descriptions
293. Picking each of the six sets the value on the live sheet
294. All six values render in the Vampire print header
295. Vampire-only trait categories are offered on the sheet: `disciplines`, `elder_disciplines`,
     `luminary_disciplines`, `techniques`, `rituals`, `sabbat_rituals`, `vampiric_texts`, `status_traits`, `paths`,
     `extra_in_clan_disciplines`
296. Selecting a Path renders in the Morality print block
297. `extra_in_clan_disciplines` changes which disciplines are charged at in-clan cost

**Werewolf — `archetype`, `archetype_2`, `wta_breed`, `wta_auspice`, `wta_tribe`, `wta_camp`, `wta_faction`, `antecedence`**

298. The Breed picker lists the seeded `wta_breeds` Descriptions
299. The Auspice picker lists the seeded `wta_auspices` Descriptions
300. The Tribe picker lists the seeded `wta_tribes` Descriptions
301. The Camp picker lists the seeded `wta_camps` Descriptions
302. The Faction picker lists the seeded `wta_factions` Descriptions
303. The Second Archetype picker lists the seeded `archetype_2s` Descriptions
304. Picking each sets the value on the live sheet and renders in the Werewolf print header
305. Werewolf-only trait categories are offered: `wta_gifts`, `extra_affinity_links`, `wta_backgrounds`,
     `wta_territory_specializations`, `wta_rites`, `wta_totem_bonus_traits`, `wta_gnosis_sources`
306. Breed, Auspice, and Tribe each drive their own Gift affinity link

**Changeling — `archetype`, `ctdbs_kith`, `ctdbs_fealty_court`, `ctdbs_kith_group_type`, `antecedence`**

(`ctdbs_noble_house` is omitted: see Dropped Coverage.)

307. The Kith picker lists the seeded `ctdbs_kiths` Descriptions
308. The Court picker lists the seeded `ctdbs_fealty_courts` Descriptions
309. The Group Type picker lists the seeded `ctdbs_kith_group_types` Descriptions
310. Picking each sets the value on the live sheet and renders in the Changeling print header
311. Changeling-only trait categories are offered: `ctdbs_arts`, `ctdbs_backgrounds`,
     `ctdbs_holdings_specializations`, `ctdbs_arts_affinities_links`
312. Kith drives the Art affinity links

**Shared and exclusivity**

313. Categories shared by all three render on each: `attributes`, the three focus categories, `skills`,
     `health_levels`, `willpower_sources`, `lore_specializations`, `academics_specializations`,
     `drive_specializations`, `linguistics_specializations`, `contacts_specializations`, `allies_specializations`,
     `influence_elite_specializations`, `influence_underworld_specializations`
314. **Exclusivity: a Vampire sheet offers no `wta_*` or `ctdbs_*` categories**
315. **Exclusivity: a Werewolf sheet offers no discipline or `ctdbs_*` categories**
316. **Exclusivity: a Changeling sheet offers no discipline or `wta_*` categories**
317. A Description added through the admin UI appears only in the picker for its own category and creature

---

## Task 12 — Baseline Creation, Long-Term Change, Dual Audit Log Verification

Each creature gets a fully created baseline, then ten distinct long-term changes, then the change set is verified in
**both** the player-visible log (`#character/:cid/log/:start/:changeBy`, viewed as the owner) and the admin-visible
log (reached via `#administration/character/:id`, viewed as `devuser`).

### 12a — Vampire (`e2e/lifecycle-vampire.spec.js`)

318. Baseline: a Vampire is created and completed through the full wizard with every creation pool spent
319. Baseline: creation produces a log entry for every creation pick
320. Baseline: the printable sheet matches every creation choice made
321. Change 1 — award a 25 XP notation; the log records the XP transaction with the reason
322. Change 2 — raise Physical across two separate edits; the log has two rows with correct old/new values and costs
323. Change 3 — purchase an out-of-clan discipline; the log records the out-of-clan cost
324. Change 4 — add a background then specialize it; the log records both the add and the specialization rename
325. Change 5 — remove a purchased trait; the log records the removal and the refund
326. Change 6 — change Sect and Title; the log records `old_text` → `new_text` for both
327. Change 7 — change Path of Enlightenment; the log records it and the Morality block updates
328. Change 8 — add a Ritual and a Technique; the log records both with their costs
329. Change 9 — edit all three long texts; the log records each edit
330. Change 10 — rename the character; the log records the old and new name
331. **Player log as owner shows all changes in reverse-chronological order**
332. **Player log paginates correctly across at least three pages, covering every entry with no gaps or duplicates**
333. **Player log rows show populated `old_value`, `new_value`, `old_cost`, and `new_cost` cells**
334. **Admin reaches the same character's log via `#administration/character/:id`**
335. **Admin log entry count matches the player log entry count exactly**
336. **Admin log timestamps, categories, and values match the player log row for row**
337. Any entry visible only to the admin is explicitly enumerated and asserted as such
338. The troupe AST can view the log; a stranger user cannot
339. `#character/:cid/history/:id` steps through at least ten versions, each rendering the correct snapshot
340. The costs view total reconciles against the sum of the logged costs

### 12b — Werewolf (`e2e/lifecycle-werewolf.spec.js`)

341. Baseline: a Werewolf is created and completed through the full wizard
342. Baseline: creation produces a log entry for every creation pick
343. Baseline: the printable sheet matches every creation choice made
344. Change 1 — award a 25 XP notation; the log records the transaction
345. Change 2 — raise an attribute across two edits; two log rows with correct values and costs
346. Change 3 — purchase a non-affinity Gift; the log records the higher cost
347. Change 4 — add and specialize a territory specialization; the log records both
348. Change 5 — remove a purchased Gift; the log records the removal and refund
349. Change 6 — change Tribe and Camp; the log records `old_text` → `new_text` for both
350. Change 7 — raise Renown (Glory, Honor, Wisdom); the log records each
351. Change 8 — add a Rite; the log records it
352. Change 9 — edit all three long texts; the log records each edit
353. Change 10 — rename the character; the log records the old and new name
354. **Player log as owner shows all changes in reverse-chronological order**
355. **Player log paginates correctly across at least three pages**
356. **Player log rows show populated old/new value and cost cells**
357. **Admin log via `#administration/character/:id` matches the player log row for row**
358. The troupe AST can view the log; a stranger user cannot
359. The history timeline steps through at least ten versions with correct snapshots
360. The costs view reconciles against the sum of the logged costs

### 12c — Changeling (`e2e/lifecycle-changeling.spec.js`)

361. Baseline: a Changeling is created and completed through the full wizard
362. Baseline: creation produces a log entry for every creation pick
363. Baseline: the printable sheet matches every creation choice made
364. Change 1 — award a 25 XP notation; the log records the transaction
365. Change 2 — raise an attribute across two edits; two log rows with correct values and costs
366. Change 3 — purchase an Art; the log records the cost
367. Change 4 — add and specialize a Holdings specialization; the log records both
368. Change 5 — remove a purchased Art; the log records the removal and refund
369. Change 6 — change Kith and Court; the log records `old_text` → `new_text` for each
370. Change 7 — raise Glamour and Banality sources; the log records each
371. Change 8 — add a Freehold background at an increased rating; the log records the cost
372. Change 9 — edit all three long texts; the log records each edit
373. Change 10 — rename the character; the log records the old and new name
374. **Player log as owner shows all changes in reverse-chronological order**
375. **Player log paginates correctly across at least three pages**
376. **Player log rows show populated old/new value and cost cells**
377. **Admin log via `#administration/character/:id` matches the player log row for row**
378. The troupe AST can view the log; a stranger user cannot
379. The history timeline steps through at least ten versions with correct snapshots
380. The costs view reconciles against the sum of the logged costs

---

## Task 13 — Access Control In The UI (Karma parity with `admin-test.js` and `description-test.js`)
*File: `e2e/access-control.spec.js`*

381. `sampmem` is blocked from `#administration`
382. `sampmem` cannot save an edit to global Clan Rules — the UI surfaces the permission error
383. `sampmem` cannot save an edit to global Kith Rules
384. `sampmem` cannot view another user's patronage page
385. `sampmem` cannot open `#administration/user/:id`
386. Role toggles are absent from the profile view for non-admins
387. Admin can toggle a user's Administrator role and the change persists across reload
388. Admin can toggle a user's Storyteller role and the change persists across reload
389. Admin can trigger a password reset for a user and sees confirmation
390. A logged-out visitor is redirected to login for every protected route (parameterized over the route table)
391. `sampmem` cannot delete or overwrite a global Description
392. `sampmem` cannot open another player's character sheet
393. `sampmem` cannot open another player's XP history or character log

---

## Requirements Traceability

Every explicit request maps to specific tests. Nothing is left implicit.

| Request | Tests |
|---|---|
| Add a Patronage and the user shows up as a Patron | 1–15 (esp. **9, 10, 12**) |
| Add game rules and they show up | 16–37 (esp. **17, 19, 24, 26, 28, 30, 33**) |
| Add referendums and users can vote on them | 38–53 (esp. **39, 44, 46, 48**) |
| XP history with at least four entries | **54–57** |
| XP history: change spent, verify available | **64, 65, 66, 67** |
| XP history: change earned, verify available | **61, 62, 63, 66** |
| Approvals: at least 10 | **78–87** |
| Approvals: approved character view correct at each step | **78–87** (three assertions each), 91, 92 |
| Rename verified in other views | **100–112** |
| Portrait actually becomes the character portrait | **116–123** (byte-level) |
| Troupe tests create and add real characters | **132–134**, then 135–151 |
| Troupe portrait verified | **126–128** (byte-level) |
| Playwright versions of Karma creation and trait-change tests | 155–189 (Vampire), 190–215 (Werewolf), 216–240 (Changeling), 241–276 (traits ×3), 277–286 (long texts) |
| Each character type and its unique Description types | 287–317 |
| Baseline creation → long-term changes → player and admin audit logs | 318–380 |

### Karma → Playwright mapping

| Karma spec | Playwright tests |
|---|---|
| `default-test.js` "A Vampire's creation" | 155–184 |
| `default-test.js` "A Werewolf's creation" | 190–208 |
| `default-test.js` / `trait-test.js` traits (×3) | 241–276 |
| `default-test.js` / `fast-test.js` long texts (×3) | 277–286 |
| `default-test.js` experience history (×3) | 54–75 |
| `default-test.js` troupe membership (×3) | 132–154 |
| `default-test.js` in/out-of-clan cost calculation | 185–187, 189 |
| `creation-vs-xp-test.js` (×3) | 157, 178–182, 185–188, 204–208, 230–234 |
| `creature-types-test.js` Vampire / Werewolf / Changeling | 287–317 |
| `approvals-test.js` | 76–98 |
| `xp-history-test.js` | 67, 68, 69, 71 |
| `admin-test.js` | 381–393 |
| `description-test.js` | 32–37, 317, 391 |
| `troupe-test.js` | 129–154 |

---

## Execution Order And Checkpoints

Each task ends with a green run of its own spec files and a `WIP Checkpoint` commit.

| Order | Task | Tests | Depends on | Model | Effort |
|---|---|---|---|---|---|
| 1 | Task 0 — harness repair and fixtures ✅ **done** | — | — | **Opus 5** | **max** |
| 2 | Task 1 — Patronage | 1–15 | Task 0 | Sonnet 5 | high |
| 3 | Task 2 — Game Rules | 16–37 | Task 0 | Sonnet 5 | medium |
| 4 | Task 3 — Referendums | 38–53 | Task 1 (patron status gates voting) | Sonnet 5 | high |
| 5 | Task 8a — Vampire creation | 155–189 | Task 0 | **Opus 5** | high |
| 6 | Task 8b — Werewolf creation | 190–215 | Task 8a | Sonnet 5 | medium |
| 7 | Task 8c — Changeling creation | 216–240 | Task 8a | Sonnet 5 | medium |
| 8 | Task 4 — XP history | 54–75 | Task 8a | **Opus 5** | high |
| 9 | Task 9 — Trait lifecycle ×3 | 241–276 | Tasks 8a–8c | Sonnet 5 | medium |
| 10 | Task 10 — Long texts | 277–286 | Tasks 8a–8c | Haiku 4.5 | medium |
| 11 | Task 7 — Troupes | 129–154 | Tasks 8a–8c | Sonnet 5 | high |
| 12 | Task 5 — Approvals | 76–98 | Tasks 7, 8a | **Opus 5** | high |
| 13 | Task 6 — Rename and portraits | 99–128 | Tasks 7, 8a | Sonnet 5 | medium |
| 14 | Task 11 — Descriptions by creature | 287–317 | Tasks 2, 8a–8c | Haiku 4.5 | high |
| 15 | Task 12 — Lifecycle and audit logs | 318–380 | Tasks 8a–8c, 9 | **Opus 5** | **xhigh** |
| 16 | Task 13 — Access control | 381–393 | Task 0 | Sonnet 5 | medium |

The creation suites (8a–8c) are sequenced early because Tasks 4, 5, 6, 7, 9, 10, 11, and 12 all depend on
`createCompletedCharacter` driving a real wizard run.

---

## Model And Effort Assignment

### The three questions that set the tier

Tier is not chosen by test count. A 63-test task can be routine and a zero-test task can be the hardest work in the
project. Three things decide it:

1. **Blast radius** — if this is wrong, how many downstream tests silently inherit the error?
2. **Novelty** — is the pattern being invented here, or replicated from a task that already proved it?
3. **Invariant depth** — does correctness rest on arithmetic and state that a plausible-looking wrong
   implementation would still make green?

Task 0 scores maximum on all three, which is why it gets the most expensive tier despite defining no tests. Task 11
scores near zero on all three across 32 tests, which is why it gets the cheapest.

### Per-task rationale

| Task | Tier | Why this tier |
|---|---|---|
| **0** — Harness and fixtures | Opus 5 / max | Every one of the 393 tests depends on these thirteen deliverables. `createCompletedCharacter` has to drive a real Marionette wizard to completion; `readXpTotals` has to parse stat cards reliably; the image helper needs PNG decode and dominant-color extraction; all of it has to settle jQuery Mobile's async page transitions without arbitrary `waitForTimeout` padding. A subtle bug here produces 393 tests that pass against the wrong thing. Highest blast radius in the project. |
| **1** — Patronage | Sonnet 5 / high | Form-driven CRUD, but tests 10 and 12 require deriving how active-Patron status is actually computed from `paidOn`/`expiresOn` and where it gates UI. That reverse-engineering justifies high effort; the surface itself is ordinary. |
| **2** — Game Rules | Sonnet 5 / medium | Five rule types (clan, kith, elder discipline, technique, ritual) exercising one repeated add-then-verify pattern. The rule-cost-flows-to-purchase tests (24, 27, 29, 31) are the only non-mechanical part, and they repeat across the five. |
| **3** — Referendums | Sonnet 5 / high | Multi-user voting with a real invariant — one ballot per user, recast replaces rather than appends — plus patron gating and the `vote_for_referendum` cloud-function error paths. Cross-user state, so high effort, but no deep arithmetic. |
| **4** — XP History | **Opus 5** / high | The running-balance propagation is exactly where the existing suite is wrong today. Backdated insertion re-propagating every subsequent row, mid-chain deletion, negative balances that must not be silently clamped, and four rapid sequential adds racing each other. A wrong implementation here looks completely correct. |
| **5** — Approvals | **Opus 5** / high | Ten sequential steps, each with three assertions including a negative one (the *previous* value must be gone from the snapshot). Requires holding the approved-versus-current snapshot distinction straight across the whole sequence, plus stale-approval detection and four cross-troupe permission boundaries. Sequencing errors here produce false greens. |
| **6** — Rename and portraits | Sonnet 5 / medium | Two halves, both mechanical once Task 0 exists. Rename reflection is the same assertion against thirteen views; portrait verification is the same byte-comparison against eight surfaces. The hard part — image decode and comparison — was already solved in Task 0. |
| **7** — Troupes | Sonnet 5 / high | Three creature types joining, four distinct user perspectives with different ACLs, and the relationship-network graph where asserting rendered nodes and edges is genuinely fiddly. Breadth and multi-user state push this to high. |
| **8a** — Vampire creation | **Opus 5** / high | The first end-to-end wizard drive, and it sets the pattern 8b and 8c copy. The subtle content is creation-pool accounting staying completely separate from XP (tests 178–182, 185–188): picks consume pools without spending XP, post-creation purchases spend XP without touching pools, and upgrades charge only the increment. Getting this wrong propagates into both sibling tasks. |
| **8b** — Werewolf creation | Sonnet 5 / medium | 8a proved the pattern. This adapts it to the Gifts region, renown pools, and WTA text attributes. Translation work against a known-good template. |
| **8c** — Changeling creation | Sonnet 5 / medium | Same as 8b, adapted to Arts and CTD text attributes. |
| **9** — Trait lifecycle ×3 | Sonnet 5 / medium | Twelve scenarios parameterized over three creature types. Once the Vampire twelve pass, the remaining 24 are loop parameters over category names. Only the specialization-rename-collision case needs real thought. |
| **10** — Long texts | Haiku 4.5 / medium | Ten tests of straightforward update/remove/render against three long-text routes, with Task 0 helpers already in place. The one risk is test 287 (cache priming across navigation); **escalate this task to Sonnet 5 if that test proves flaky.** |
| **11** — Descriptions by creature | Haiku 4.5 / high | 32 tests, but every one is "open picker, assert it contains the seeded category, assert exclusivity." Zero novelty and zero invariant depth. Effort is set to high rather than medium purely because volume-with-precision is the failure mode: the exact category names are already enumerated in this document, so the work is careful transcription rather than derivation. |
| **12** — Lifecycle and audit logs | **Opus 5** / xhigh | The most demanding task in the plan. Three full baselines, thirty long-term changes, then row-for-row parity between the player log and the admin log including timestamps, categories, old/new values and old/new costs — across three-plus pages of pagination — plus stepping the history timeline through ten versions and reconciling the costs view against the summed log. Verification logic this deep is trivially faked by an implementation that just checks entry counts. |
| **13** — Access control | Sonnet 5 / medium | Thirteen negative assertions, largely parameterized over a route table. Simple to write. Worth noting the asymmetry: a broken test here yields a *false sense of security* rather than a visible failure, so the review gate below applies. |

### Distribution

| Tier | Tasks | Tests |
|---|---|---|
| Opus 5 (max / xhigh / high) | 0, 4, 5, 8a, 12 | 143 |
| Sonnet 5 (high / medium) | 1, 2, 3, 6, 7, 8b, 8c, 9, 13 | 209 |
| Haiku 4.5 (high / medium) | 10, 11 | 41 |

### Review gate

Cheaper tiers are safe here only because they inherit a correct foundation. Two checkpoints protect that:

- **After Task 0**, before any other task starts: the helpers get a deliberate correctness pass. Everything downstream
  assumes they are right.
- **After Tasks 4, 5, 12, and 13**: spot-check that the tests actually fail when the behavior they describe is broken.
  Deliberately break one behavior per task and confirm the corresponding test goes red. A green suite that cannot go
  red is the failure mode this whole plan exists to eliminate.

### How the switching is wired

Model and effort are switched by dispatching each task to a tier-specific subagent. Seven definitions live in
[`.claude/agents/`](.claude/agents):

| Subagent | Model | Effort | Used by |
|---|---|---|---|
| `e2e-tier-opus-max` | opus | max | Task 0 |
| `e2e-tier-opus-xhigh` | opus | xhigh | Task 12 |
| `e2e-tier-opus-high` | opus | high | Tasks 4, 5, 8a |
| `e2e-tier-sonnet-high` | sonnet | high | Tasks 1, 3, 7 |
| `e2e-tier-sonnet-medium` | sonnet | medium | Tasks 2, 6, 8b, 8c, 9, 13 |
| `e2e-tier-haiku-high` | haiku | high | Task 11 |
| `e2e-tier-haiku-medium` | haiku | medium | Task 10 |

Each definition carries the seven non-negotiable conventions from §1 in its system prompt, so tier is the only variable
between them. Each dispatch names the task number and its test range; this document is the specification the subagent
reads.

Two limits worth stating plainly:

- A subagent starts with no memory of this conversation. Every dispatch must point at this document and at
  `e2e/helpers/`. That works because the plan is written down — it is why the itemization is this granular.
- The main session's own model and effort cannot be changed from inside a session. Only the tier subagents switch.

---

## Runtime And Configuration

393 tests against a jQuery Mobile app at the current `workers: 1`, `trace: 'on'`, `video: 'on'` settings would take
hours and produce many gigabytes of artifacts. Task 0 therefore includes:

- `trace: 'retain-on-failure'`, `video: 'retain-on-failure'`, `screenshot: 'only-on-failure'` as the defaults
- Parallel workers for read-mostly suites; `workers: 1` retained only for the admin suites (Tasks 1, 2, 3, 13) that
  mutate global Description and rule records
- Per-task npm scripts and Playwright projects so a single area can be run in isolation
- A CI shard split across the task boundaries above

## Verification

Per task, during implementation:

```bash
npx playwright test e2e/<task-spec>.spec.js
```

Full suite:

```bash
npm run test:e2e
```

Manual: open `npx playwright test --ui` and confirm all fourteen task groups appear as separate, individually runnable
trees.
