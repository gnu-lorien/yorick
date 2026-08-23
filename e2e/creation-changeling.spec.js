/**
 * Task 8c - Changeling Creation In The UI (Karma parity)
 *
 * Covers testing_implementation_plan.md items 216-240, driven entirely through
 * the real Marionette creation wizard and the real post-creation trait editor.
 * Mirrors `default-test.js`'s Changeling creation coverage and
 * `creature-types-test.js`'s "Changeling Specific Capabilities" describe block.
 *
 * This is a translation of `creation-vampire.spec.js` (Task 8a) and
 * `creation-werewolf.spec.js` (Task 8b), which proved the pattern: one
 * **wizard** character built up test by test through the real wizard
 * (216-234), and one **xp** character completed with `spendPools: false` that
 * carries the post-creation purchase tests (235-240), for the same reason both
 * prior tasks' did - the three creation Art slots would otherwise burn through
 * real affinity Arts, leaving nothing clean for 235/238 to measure a fresh
 * purchase against.
 *
 * `ctdbs_noble_houses` and `ctdbs_realms` are out of scope per the plan's
 * "Dropped coverage" section (no source data anywhere in the repo) and per
 * this task's own brief - there is no House test and no Realm test here,
 * deliberately. The model still carries `ctdbs_noble_house` as a sixth text
 * attribute (`TEXT_ATTRIBUTES` in models/ChangelingBetaSlice.js) and the
 * wizard still renders a "Pick House" affordance for it - confirmed live on a
 * fresh Changeling - so `#ccv-simpletext` assertions below use `.toContain()`
 * rather than an exhaustive list, exactly as the prior two suites already do
 * for their own five/six-attribute sets.
 *
 * ---
 *
 * ## Findings confirmed live against this server before any test below was written
 *
 * **1. `ctdbs_merits`/`ctdbs_flaws` are costed exactly like Vampire's
 * `merits`/`flaws` and Werewolf's `wta_merits`/`wta_flaws` - confirmed, not
 * assumed.** `BNSCTDBS_ChangelingCosts.calculate_trait_cost`
 * (helpers/BNSCTDBS_ChangelingCosts.js) contains the identical pair of
 * branches: `if ("ctdbs_merits" == category) { return mod_value; }` and
 * `if ("ctdbs_flaws" == category) { return mod_value * -1; }`. Measured live
 * via `calculate_trait_cost` and reproduced through the real change page below:
 * a value-2 `ctdbs_merits` trait costs 2; a value-2 `ctdbs_flaws` trait costs
 * -2 (a refund). `ctdbs_merits_0_remaining` / `ctdbs_flaws_0_remaining` are the
 * 7-point *cap*, exactly as for the other two venues, not a separate currency.
 * Tests 230 and 233 assert this measured arithmetic rather than "XP is
 * unchanged", for the same reason Task 8a's 178/181 and Task 8b's 204/207 did.
 *
 * **2. DEFECT - changing a creation-picked `ctdbs_merit`'s value does not
 * update the merit pool (test 231).** Identical root cause to Vampire's test
 * 179 and Werewolf's test 205: `SimpleTraitChangeView.js` is one shared file,
 * not per-venue, and its `save_clicked` persists via
 * `character.update_trait(self.simpletrait)` - one argument, so `free_value`
 * is `undefined` inside `update_creation_rules_for_changed_trait`
 * (models/ChangelingBetaSlice.js), which composes its key as
 * `category + "_" + freeValue + "_remaining"`. Reproduced live: the write
 * lands on `ctdbs_merits_undefined_remaining` (carrying the right number, 4)
 * instead of `ctdbs_merits_0_remaining` (which stays stale at 5).
 *
 * **3. FIXED by remediation R20 - the Backgrounds pool badge was wrong
 * throughout the wizard, even though the trait picks underneath it were
 * entirely correct (tests 217, 228); Arts, Merits, and Flaws were
 * coincidentally unaffected.**
 * `VampireCreation.remaining_picks(category)` (models/VampireCreation.js) used
 * to hardcode a `tops` map keyed on Vampire's own bare category names -
 * `{skills: 4, disciplines: 2, backgrounds: 3, attributes: 7, merits: 0,
 * flaws: 0}` - with no entry for any `ctdbs_*` category. For an unlisted
 * category it falls back to `start = tops[category] || 1` and sums
 * `category + "_" + i + "_remaining"` for `i` from `start` down to `0`.
 * `ctdbs_backgrounds` has three real rating sub-pools (3/2/1), so with
 * `start=1` the badge only ever sums the rating-1 (and nonexistent rating-0)
 * slots - confirmed live: the badge reads "1" from the start (true total is
 * 3) and stays frozen there through the rating-3 and rating-2 picks, exactly
 * reproducing Task 8b's finding 3 for `wta_backgrounds`. `ctdbs_arts` has only
 * one real rating (1, three slots), so `start=1` happens to sum exactly the
 * right pool - the badge is coincidentally correct throughout test 229, the
 * same coincidence Task 8b documented for `wta_gifts`. `ctdbs_merits`/
 * `ctdbs_flaws` are sum pools keyed at `_0_remaining` only, which
 * `_.range(1,-1,-1)` always includes regardless of `start` - also
 * coincidentally correct. Pinned at test 228, the one place the wrong map
 * actually produces a wrong number - not at item 230 as an earlier draft of
 * this task's brief suggested; `VampireCreation.remaining_picks` was read
 * directly to confirm the mechanism, and Merits/Flaws are unaffected by it
 * for the structural reason above.
 *
 * **4. NEW DEFECT, not present in Vampire or Werewolf - post-creation
 * `ctdbs_backgrounds` purchases cost 0 XP unconditionally (test 236).**
 * `BNSCTDBS_ChangelingCosts.calculate_trait_cost` has a background-shaped
 * branch, but it checks the literal string `"backgrounds"` -
 * `if ("backgrounds" == category) { return self.get_trait_cost_on_table(
 * self.get_cost_table(2), trait); }` - which is Vampire's bare category name,
 * copy-pasted without renaming to this venue's actual category,
 * `"ctdbs_backgrounds"`. That branch therefore never matches a real
 * Changeling background, execution falls through every other branch, and the
 * function's own final statement is a bare `return 0;`. Confirmed live via
 * `calculate_trait_cost` on a fresh `Resources` trait at value 2: returns `0`,
 * not the `4` the cost table would give (`get_cost_table(2)` = `[2,4,...]`,
 * cumulative sum to value 2 = `2+4=6`... measured precisely inside test 236
 * against the real seeded values). Unlike Werewolf's `wta_rites` gap (which
 * returns `undefined`/NaN, caught only by `Character.update_trait`'s
 * `_.isFinite` guard), this one returns a clean, finite, wrong `0` - the
 * player is shown an honest-looking "Cost: 0" quote, not "Cost: NaN". The
 * trait is genuinely bought and genuinely renders; only the deduction is
 * missing.
 *
 * **5. THE CENTRAL MECHANIC - Kith drives Art affinity two ways, not one.**
 * Unlike Vampire's in-clan-discipline *filter* (which only narrows what the
 * creation picker offers) and Werewolf's Gift-affinity *filter* (ditto, plus a
 * post-creation "Mine"/"Any" toggle), Changeling's Kith **automatically grants
 * the Kith's own affinity Arts for free** the instant it is picked.
 * `ChangelingBetaSlice.update_text("ctdbs_kith", value)`
 * (models/ChangelingBetaSlice.js) first un-picks whichever Arts the
 * *previous* Kith granted (`_unpick_previous_arts`, via
 * `unpick_from_creation`), then - after saving the new Kith text - loops
 * `Costs.get_arts_affinities_for_kith(value)` (`bnsctdbs_KithRule.art_1..3`
 * for that Kith, via `BNSCTDBS_KithRules`) and calls
 * `self.update_trait(aa, 1, "ctdbs_arts", 1)` for each: value 1, free_value 1,
 * so `mod_value=0` and the trait costs nothing, while
 * `update_creation_rules_for_changed_trait` still decrements
 * `ctdbs_arts_1_remaining` because `freeValue` (1) is truthy. Measured live,
 * end to end: a fresh Changeling with no Kith starts at
 * `ctdbs_arts_1_remaining=3`, zero owned Arts. Picking Kith "Inanimae" (whose
 * `bnsctdbs_KithRule` row has only `art_1`/`art_2` - "Metamorphosis"/"Naming",
 * no `art_3`) grants exactly those two Arts at cost 0 and drops the pool to 1.
 * Repicking to "Boggans" (`art_1..3` = "Inglenook"/"Metamorphosis"/
 * "Skullduggery"... - measured exactly, see the constants below) correctly
 * reconciles rather than merely appending: "Naming" (Inanimae-only) is
 * removed, "Metamorphosis" (shared by both Kiths) is left at value 1 with no
 * duplicate, and the Boggans-only Arts are added, landing the pool at exactly
 * 0 - the *sum* of Boggans' three affinities, not the leftover from Inanimae's
 * two. This means the wizard's `ctdbs_arts_1_remaining` pool can already be
 * partially or fully spent before test 229 ever opens the Art picker - the
 * wizard Kith is deliberately picked, repicked, and (per finding 6 below)
 * cleaned back up to a blank slate before 229 runs, exactly so that test can
 * still demonstrate a *manual* pick against a clean 3-slot pool.
 *
 * **6. DEFECT - unpicking Kith clears the text value but leaves the
 * auto-granted Arts (and the exhausted pool) behind (test 220).**
 * `unpick_text` on ChangelingBetaSlice is a bare passthrough to
 * `Character.prototype.unpick_text` - it clears `ctdbs_kith` correctly (test
 * 220's own literal ask passes) but never calls `_unpick_previous_arts` the
 * way `update_text` does on every *re*pick. Confirmed live: after picking
 * "Boggans" then unpicking Kith, `ctdbs_kith` is cleared but "Inglenook",
 * "Metamorphosis", and "Soothsay" all remain on the character at cost 0, and
 * `ctdbs_arts_1_remaining` stays at 0 rather than returning to 3. There is no
 * spare numbered test to dedicate purely to cleanup (Vampire's merit defect
 * had test 180 for this; Werewolf's had test 206), so test 221 opens by
 * restoring this residue via the ordinary `unpickCreationTrait` route -
 * confirmed live to work perfectly when driven directly (pool returns to
 * exactly 3, Arts list empties) - which isolates the defect to `unpick_text`
 * specifically, not to the underlying unpick machinery.
 *
 * **7. Art cost - the Changeling analogue of in-clan/out-of-clan and Gift
 * affinity, and it follows Vampire's *cumulative table* shape, not
 * Werewolf's flat per-level rate (tests 235, 238).**
 * `calculate_trait_cost`'s `"ctdbs_arts"` branch calls
 * `get_trait_cost_on_table(get_cost_table(4), trait)` when
 * `art_is_affinity(character, trait)` is true, `get_cost_table(6)` otherwise -
 * `get_cost_table(n)` is `_.range(1,10)` scaled by `n` and summed
 * cumulatively, exactly the mechanism `BNSMETV1_VampireCosts` uses for
 * Disciplines (there: 3 in-clan / 4 out-of-clan). Measured live via
 * `calculate_trait_cost` on fake (unsaved) trait objects: affinity value 1 =
 * 4, value 2 = 12 (4+8); non-affinity value 1 = 6, value 2 = 18 (6+12).
 * Because Kith auto-grants *all* of its own affinity Arts for free the moment
 * it is set (finding 5), there is no way to "freshly buy" an unowned affinity
 * Art at the discounted rate post-creation - every Art the current Kith is
 * affine to is already owned. Test 238 therefore demonstrates the affinity
 * rate the realistic way: by upgrading an already-granted (free, value 1) Art
 * to value 2 and reading the live change page's own quote for the increment
 * (12-4=8), contrasted against a same-venue, same-moment quote for a
 * genuinely unowned, non-affinity Art (6) that is read and then abandoned,
 * mirroring Vampire test 186's "quoted but never saved" pattern.
 *
 * **8. GAP - `ctdbs_arts_affinities_links` (the literal category test 238
 * names) has zero seed Descriptions anywhere in the repository, unlike its
 * Werewolf analogue `extra_affinity_links` (30 rows, one per Tribe/Breed/
 * Auspice) or its Vampire analogue `extra_in_clan_disciplines` (36 rows).**
 * Confirmed via a direct query against the live `Description` class: `{}`
 * results for `category="ctdbs_arts_affinities_links"`, both in
 * `database_seed/Description.json` and `data/all_dev_descriptions.csv`. The
 * category is real - it is in `ALL_SIMPLETRAIT_CATEGORIES`
 * (models/ChangelingBetaSlice.js), it is read by `get_arts_affinities()`
 * alongside the Kith-derived list, and the live sheet renders a genuine "Arts
 * Affinities" link to its (permanently empty) category page - but nothing can
 * ever be added to it through the UI, because `#simpletraits/
 * ctdbs_arts_affinities_links/:cid/new` has no Descriptions to list. Test 238
 * confirms the render machinery (the link exists, the empty page loads) and
 * fails the literal "an addition renders" claim, the same shape Werewolf's
 * Renown gap (test 212) took.
 *
 * **9. GAP - `ctdbs_holdings_specializations` also has zero seed data of any
 * kind, unlike every other `*_specializations` category (test 237).** Every
 * one of `lore_specializations`, `academics_specializations`,
 * `drive_specializations`, `linguistics_specializations`,
 * `contacts_specializations`, `allies_specializations`,
 * `influence_elite_specializations`, and `influence_underworld_specializations`
 * carries exactly one seeded Description named "Custom" with
 * `requirement: "requires_specialization"`, which is what lets a player type a
 * free-text specialization through `#simpletrait/specialize/...`
 * (SimpleTraitNewSpecializationView.js) despite the category having no other
 * content. `ctdbs_holdings_specializations` has no such row - confirmed via
 * both the live `Description` class and `data/all_dev_descriptions.csv` - nor
 * does the `ctdbs_backgrounds` row for "Holdings" itself carry
 * `requires_specialization` the way Vampire's "Retainers" or Werewolf's
 * "Kinfolk" do. There is therefore no path through the UI, direct or via
 * specialization, to ever add anything to this category. Same class of gap as
 * the plan's already-dropped `ctdbs_noble_houses`/`ctdbs_realms`, but this one
 * was not dropped from the numbered list, so test 237 pins it live with
 * `test.fail()` rather than silently disappearing.
 *
 * **10. Data-naming mismatches inside the seeded `bnsctdbs_KithRule` /
 * `ctdbs_arts` pair, avoided rather than chased.** Eshu's `art_2` is
 * "Talecraft" (no space) in `bnsctdbs_KithRule`, but the seeded `ctdbs_arts`
 * Description is named "Tale Craft" (with a space) - confirmed live via the
 * `Description` class (13 Arts total; "Tale Craft" is the only spelling that
 * exists). Sluagh's `art_1` is "Chicanery", which has **no** matching
 * `ctdbs_arts` Description under any spelling - the same word the plan's own
 * item 235 names for a purchase, which is how "Chicanery" is confirmed to be
 * unpurchasable rather than merely an inconvenient example. Every Kith this
 * suite actually picks (Inanimae, Boggans, Ghillie Dhu) has all of its
 * `art_1..3` names matching a real seeded Description exactly, so these two
 * mismatches are documented here and not exercised.
 *
 * **11. GAP - "Banality" appears nowhere in the codebase; "Glamour" is real
 * but print-only and entirely `Seeming`-background-derived (test 239).**
 * Confirmed via a repository-wide search: no model field, category, template,
 * or print view mentions "banality" in any casing - the same "no UI path
 * anywhere" shape as Werewolf's Renown gap (test 212). "Glamour" is different:
 * `templates/print/glamour.html` (rendered only by `CharacterPrintView.js`'s
 * `GlamourView`, never by the live sheet) computes a box count from
 * `character.seeming()` via a hardcoded `{1:14, 2:13, 3:12, 4:11, 5:10}`
 * lookup, and prints the literal word "Kinain" instead of any boxes when
 * `seeming()` is 0. `seeming()` reads the value of a `ctdbs_backgrounds` trait
 * named "Seeming" (`ChangelingBetaSlice._raw_seeming`) - real, per-character
 * data, just never shown on the live sheet, only on print. Test 236's
 * background purchase deliberately buys "Seeming" at value 3 (feeding this
 * test a real value = 12) rather than the plan's example "Freehold" (also
 * unseeded - see finding 12), so one purchase serves both the cost-defect
 * demonstration and the Glamour render check.
 *
 * **12. The plan's own example names for tests 235 ("Chicanery") and 236
 * ("Freehold") do not exist in any seed source, the same trap the "Dropped
 * coverage" section already names for Realms/Noble Houses/Monikers.**
 * "Chicanery" is addressed in finding 10 above. "Freehold" is not a
 * `ctdbs_backgrounds` Description under any spelling - the eleven seeded
 * names are `Allies`, `Alternate Identity`, `Chimerical Companion`,
 * `Contacts`, `Dreamers`, `Fame`, `Holdings`, `Influences`, `Kinain`,
 * `Resources`, `Seeming`, `Treasures` (confirmed live, twelve total). Real
 * seeded names are substituted throughout, each labelled at its point of use.
 *
 * **13. Observation - the wizard's Art picker (creation step 5) is not
 * filtered by Kith at all, unlike Vampire's in-clan-discipline filter or
 * Werewolf's Gift-affinity filter.** `charactercreatepicksimpletrait`
 * (routers/mobileRouter.js) only sets a `specialCategory`/`filterRule` for
 * `"disciplines"` ("in clan disciplines") and `"wta_gifts"`
 * (`["affinity", "show_only_value_1"]`) - there is no branch for
 * `"ctdbs_arts"`, so `SimpleTraitNewView`'s generic `else` path runs and every
 * not-yet-owned Art in the catalogue is offered regardless of Kith. Confirmed
 * live: with Kith "Sidhe" set (owning its 3 affinity Arts for free), the
 * rating-1 Art picker still offered all 10 remaining Arts, not merely
 * Sidhe's. This does not block anything the numbered tests need - the
 * *cost* differential (finding 7) is what "drives Art affinity" for this
 * task's purposes - so it is recorded as an observation, not a defect.
 *
 * **14. Observation - `ctdbs_kith_group_types` seed rows collide on name, so
 * only 11 of the ~30-odd rows in `data/all_dev_descriptions.csv` survive
 * seeding.** Each Kith has three distinct sub-group flavor rows sharing the
 * *same* `name` column (e.g. three rows all named "Boggan", differing only in
 * an ignored "note"-shaped column carrying values like "The Minutemen").
 * `seed_extra.js`'s dedup key is `category + " " + name` only, so the first of
 * each trio wins and the other two are silently skipped as "already present".
 * Confirmed live: exactly 11 `ctdbs_kith_group_types` Descriptions exist, one
 * per Kith name. Not a defect in the application - the seed script's dedup
 * behaves exactly as documented - just a fact worth knowing when picking a
 * value; this suite picks whichever one the picker offers first.
 *
 * **15. `characters.js` change - `readArtAffinities` added, mirroring
 * `readAffinities`/`readInClanDisciplines`.** No existing function's behavior
 * changed. Re-run three times against `creation-vampire.spec.js`,
 * `creation-werewolf.spec.js`, and `--project=admin` after this addition (see
 * the report for this task) - all pass, confirming the addition is inert for
 * every other suite.
 *
 * **16. Deviation - the New Character form's `type` select stores
 * `"ChangelingBetaSlice"`, not `"Changeling"` (test 216).**
 * `CharacterNewView.js`'s field options are
 * `{label: "Changeling", value: "ChangelingBetaSlice"}` - the visible label
 * and the underlying option value differ, unlike Vampire/Werewolf's matching
 * pairs. This also means the option's DOM `value` attribute is not a plain
 * match for either string: Backform's `SelectControl` runs every option
 * through `Backform.JSONFormatter`, so the attribute a browser actually
 * assigns is `JSON.stringify(...)` - confirmed live, `<option value=
 * "&quot;ChangelingBetaSlice&quot;">Changeling</option>`. Playwright's
 * `selectOption(plainString)` matches by value first and falls back to label
 * when no value matches (confirmed live: `selectOption('Werewolf')` succeeds
 * only via this label fallback, since the DOM value is `"Werewolf"` with
 * embedded quote characters, not `Werewolf`). `selectOption('ChangelingBetaSlice')`
 * therefore throws - it matches neither the quoted value nor the "Changeling"
 * label - and `selectOption('Changeling')` (the label, exactly mirroring
 * Werewolf's `selectOption('Werewolf')` call shape) is used instead. The
 * row's stored `type` is still asserted to be the real value,
 * `"ChangelingBetaSlice"`, read back from the saved character, not the label.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { navigateToHash, waitForActivePage, activePageId, normalize, runInApp } = require('./helpers/jqm-helpers');
const {
  createCompletedCharacter,
  openCreation,
  readCreationState,
  readCreation,
  readTraits,
  readCharacterTexts,
  readArtAffinities,
  readSheetXp,
  readSheetTextAttributes,
  listSimpleTextOptions,
  pickSimpleText,
  unpickSimpleText,
  pickCreationTrait,
  listCreationTraitOptions,
  countCreationPickLinks,
  unpickCreationTrait,
  purchaseTrait,
  openNewTraitChange,
  openTraitChange,
  setTraitChangeSliders,
  readTraitChangeView,
  saveTraitChange,
  completeCreation,
  isCompleted,
  countCharactersByPrefix,
  destroyCharactersByPrefix
} = require('./helpers/characters');

/** Every character this file creates is named with this prefix, so teardown is a query. */
const FIXTURE_PREFIX = 'E2E T8c ';

/**
 * The wizard character's Kith sequence. "Inanimae" has only two
 * `bnsctdbs_KithRule` affinities (no `art_3`), which is what leaves exactly
 * one rating-1 Art slot open for test 229's manual pick once the wizard's
 * Kith is ultimately unpicked and cleaned up (finding 6). "Boggans" has all
 * three, one of which ("Metamorphosis") overlaps Inanimae's set - chosen
 * deliberately so the repick test proves reconciliation, not mere addition.
 * Both Kiths' art names match real seeded `ctdbs_arts` Descriptions exactly
 * (finding 10).
 */
const WIZARD_KITH = 'Inanimae';
const WIZARD_KITH_ARTS = ['Metamorphosis', 'Naming'];
const WIZARD_KITH_REPICK = 'Boggans';
const WIZARD_KITH_REPICK_ARTS = ['Inglenook', 'Metamorphosis', 'Soothsay'];

/** A seeded `ctdbs_fealty_courts` Description, for test 221. */
const WIZARD_COURT = 'Unseelie';

/** Arts manually picked in test 229, once the wizard's Kith is unset and the pool is a clean 3. */
const WIZARD_ART_PICKS = ['Arboreal', 'Dread', 'Wayfare'];

/**
 * Skills picked at creation, one list per pool rating (4x1, 3x2, 2x3, 1x4).
 * The `skills` category is shared with Vampire and Werewolf - same
 * Description rows, same `requires_specialization` exclusions - so this is
 * the identical list both prior tasks used: `Performance`, `Crafts` and
 * `Science` all carry that requirement and are avoided.
 */
const SKILL_PICKS = {
  4: ['Athletics'],
  3: ['Brawl', 'Dodge'],
  2: ['Melee', 'Stealth', 'Subterfuge'],
  1: ['Academics', 'Awareness', 'Computer', 'Empathy']
};

/**
 * Backgrounds picked at creation. "Seeming" is deliberately avoided here -
 * it is reserved for the xp character's post-creation purchase (test 236),
 * both because it feeds test 239's Glamour check and because owning it
 * changes `character.seeming()`, which the skill cost table
 * (`BNSCTDBS_ChangelingCosts`) branches on - the same reason Task 8a avoided
 * Vampire's `Generation` and Task 8b avoided Werewolf's `Rank`.
 */
const BACKGROUND_PICKS = { 3: 'Allies', 2: 'Contacts', 1: 'Resources' };

/** A merit with no specialization requirement, value exactly 2 - the same seeded name Task 8b used for Werewolf. */
const MERIT_NAME = 'Ambidextrous';
const MERIT_VALUE = 2;
/** A flaw whose Description value is 2, so the flaw pool moves by a checkable amount. */
const FLAW_NAME = 'Impatient';
const FLAW_VALUE = 2;

/** The full merit and flaw creation budgets, per `ensure_creation_rules_exist`. */
const SUM_POOL_BUDGET = 7;

/**
 * The xp character's post-creation purchases. Kith is deliberately left unset
 * until test 238, so test 235's fresh Art purchase has a clean, affinity-free
 * baseline to measure against (finding 5/7) - a real seeded Art, substituted
 * for the plan's "Chicanery" (finding 10/12, unpurchasable under any spelling).
 */
const XP_FRESH_ART_NAME = 'Skullduggery';
/** Per `calculate_trait_cost`'s `"ctdbs_arts"` branch: cumulative `get_cost_table(6)` when non-affinity. */
const XP_FRESH_ART_COST = 6;

/** A seeded `ctdbs_backgrounds` Description, substituted for the plan's unseeded "Freehold" (finding 12). */
const XP_BACKGROUND_NAME = 'Seeming';
const XP_BACKGROUND_VALUE = 3;
/** Cumulative on `get_cost_table(2)` == [2, 4, 6, ...]: 2 + 4 + 6. See R15. */
const XP_BACKGROUND_COST = 12;
/** `bptLookup[3]` in templates/print/glamour.html - the Glamour box total test 239 expects. */
const XP_GLAMOUR_BOXES = 12;

/** A Kith whose all three `bnsctdbs_KithRule` art names match real seeded Descriptions exactly (finding 10). */
const XP_KITH = 'Ghillie Dhu';
const XP_KITH_ARTS = ['Arboreal', 'Oakenshield', 'Primal'];
/** One of the Kith-granted (free) Arts, upgraded post-creation for test 238's affinity-cost measurement. */
const XP_AFFINITY_UPGRADE_ART = 'Arboreal';
/** Per `calculate_trait_cost`'s `"ctdbs_arts"` branch: cumulative `get_cost_table(4)` when affine. */
const AFFINITY_ART_COST_LEVEL_1 = 4;
const AFFINITY_ART_COST_LEVEL_2 = 12;
/** Cumulative `get_cost_table(6)` when not affine - what `XP_FRESH_ART_NAME` (bought in test 235) is costed on. */
const NON_AFFINITY_ART_COST_LEVEL_1 = 6;
const NON_AFFINITY_ART_COST_LEVEL_2 = 18;

const BASELINE_XP = { earned: 30, spent: 0, available: 30 };

test.describe.configure({ mode: 'serial' });

test.describe('Task 8c - Changeling Creation In The UI', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  const state = {
    /** XP readings taken after each slot-pool step; test 234 asserts over all of them. */
    xpSamples: []
  };

  /** Record an XP reading for test 234's invariant. */
  async function sampleXp(label) {
    const xp = await readSheetXp(page, state.wizardId);
    state.xpSamples.push({ label, xp });
    return xp;
  }

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginAsAdmin(page);

    // Self-heal first: sweep anything a crashed earlier run left behind, keyed
    // by the name prefix rather than by ids this run has never seen, so the
    // baseline measured immediately afterwards is trustworthy on a repeat run.
    const swept = await destroyCharactersByPrefix(page, FIXTURE_PREFIX);

    state.baseline = {
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX)
    };
    console.log('[e2e creation-changeling] self-heal swept:', JSON.stringify(swept));
    console.log('[e2e creation-changeling] baseline Vampire row counts:', JSON.stringify(state.baseline));

    // The `bnsctdbs_KithRule` rows this suite's Kith choices depend on, read
    // from the live rule table so the expectation comes from the data the
    // application itself reads, not from this file.
    state.kithRules = await page.evaluate(() => {
      return new window.Parse.Query('bnsctdbs_KithRule').find().then((rows) => {
        const out = {};
        rows.forEach((r) => {
          out[r.get('name')] = [r.get('art_1'), r.get('art_2'), r.get('art_3')].filter(Boolean);
        });
        return out;
      });
    });
    expect(state.kithRules[WIZARD_KITH]).toEqual(WIZARD_KITH_ARTS);
    expect(state.kithRules[WIZARD_KITH_REPICK]).toEqual(WIZARD_KITH_REPICK_ARTS);
    expect(state.kithRules[XP_KITH]).toEqual(XP_KITH_ARTS);

    // The post-creation purchase character (tests 235-240). Its creation
    // pools are left unspent and its Kith is left unset for the same reason
    // the other two venues' xp characters are: the three creation Art slots
    // would otherwise auto-consume real affinity Arts (finding 5), leaving
    // nothing clean for 235/238 to measure a fresh purchase against.
    state.xpCharacter = await createCompletedCharacter(page, 'Changeling', {
      name: `${FIXTURE_PREFIX}XP ${Date.now().toString(36)}`,
      spendPools: false
    });
    expect(state.xpCharacter.xp).toEqual(BASELINE_XP);
  });

  test.afterAll(async () => {
    if (!page) return;

    const destroyed = await destroyCharactersByPrefix(page, FIXTURE_PREFIX)
      .catch((e) => ({ characters: 0, children: 0, errors: [String(e)] }));
    console.log('[e2e creation-changeling] destroyed in teardown:', JSON.stringify(destroyed));

    const final = {
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX).catch(() => -1)
    };
    console.log(
      '[e2e creation-changeling] final Vampire row counts (should equal baseline ' +
      JSON.stringify(state.baseline) + '):', JSON.stringify(final)
    );

    await page.close();
  });

  // -------------------------------------------------------------------------
  // 216-217 - the wizard character exists and starts from a known state
  // -------------------------------------------------------------------------

  test('216 New character form creates a Changeling and lands on the creation wizard', async () => {
    // Same deviation as Vampire/Werewolf: the form lands on `#character?<id>`,
    // not `#charactercreate/<id>`. Both hops are asserted exactly.
    const name = `${FIXTURE_PREFIX}Wizard ${Date.now().toString(36)}`;
    state.wizardName = name;

    await navigateToHash(page, 'characternew', '#character-new');
    await page.locator('#character-new input[name="name"]').fill(name);
    // DEVIATION (file-level finding 16): the select's underlying option value
    // is "ChangelingBetaSlice", JSON-stringified by Backform on top of that
    // (`"ChangelingBetaSlice"` with embedded quotes), which matches neither a
    // plain-string `selectOption`. Selecting by the visible label
    // ("Changeling") is what actually works, exactly the way Werewolf's
    // `selectOption('Werewolf')` only succeeds via the same label fallback.
    await page.locator('#character-new select[name="type"]').selectOption('Changeling');
    await page.locator('#character-new select[name="type"]').dispatchEvent('change');
    await page.locator('#character-new button, #character-new input[type="submit"]').last().click();

    await page.waitForFunction(() => /^#character\?\w+$/.test(window.location.hash), null, { timeout: 30000 });
    const landedHash = await page.evaluate(() => window.location.hash);
    const cid = landedHash.replace('#character?', '');
    state.wizardId = cid;
    expect(cid).toMatch(/^\w+$/);
    expect(landedHash).toBe(`#character?${cid}`);
    await waitForActivePage(page, 'character');
    expect(await activePageId(page)).toBe('character');

    // Like Werewolf, Changeling's `Model.create` sets `type: "ChangelingBetaSlice"`.
    const created = await page.evaluate((id) => {
      const q = new window.Parse.Query('Vampire');
      return q.get(id).then((c) => ({ id: c.id, name: c.get('name'), type: c.get('type') || null }));
    }, cid);
    expect(created.name).toBe(name);
    expect(created.type).toBe('ChangelingBetaSlice');

    const wizardLinks = page.locator(`#character a[href^="#charactercreate/"]`);
    await expect(wizardLinks).toHaveCount(1);
    expect(await wizardLinks.first().getAttribute('href')).toBe(`#charactercreate/${cid}`);

    await wizardLinks.first().click();
    await page.waitForFunction((h) => window.location.hash === h, `#charactercreate/${cid}`, { timeout: 30000 });
    await waitForActivePage(page, 'character-create');
    expect(await activePageId(page)).toBe('character-create');
  });

  test('217 The creation page renders the Arts region in place of Disciplines, with an initial 30 XP', async () => {
    await openCreation(page, state.wizardId);

    const regions = await page.evaluate(() => {
      const pg = document.querySelector('#character-create');
      return Array.from(pg.querySelectorAll('div[role="main"] > div[id^="ccv-"]')).map((d) => ({
        id: d.id,
        text: d.textContent.replace(/\s+/g, ' ').trim()
      }));
    });

    expect(regions.map((r) => r.id)).toEqual([
      'ccv-description', 'ccv-simpletext',
      'ccv-next-one', 'ccv-next-two', 'ccv-next-three', 'ccv-next-four',
      'ccv-next-five', 'ccv-next-six', 'ccv-next-seven', 'ccv-next-eight'
    ]);
    expect(regions).toHaveLength(10);

    const byId = Object.fromEntries(regions.map((r) => [r.id, r.text]));
    expect(byId['ccv-description']).toContain('initial XP to spend');
    expect(byId['ccv-simpletext']).toContain('Pick Kith');
    expect(byId['ccv-simpletext']).toContain('Pick Court');
    expect(byId['ccv-simpletext']).toContain('Pick Archetype');
    // `ctdbs_noble_house` is out of scope for this suite (see file header), but
    // the model still lists it and the wizard still renders its affordance -
    // confirmed live. Documented, not asserted against further.
    expect(byId['ccv-simpletext']).toContain('Pick House');
    expect(byId['ccv-next-one']).toContain('Attributes');
    expect(byId['ccv-next-two']).toContain('Physical Focus');
    expect(byId['ccv-next-two']).toContain('Social Focus');
    expect(byId['ccv-next-two']).toContain('Mental Focus');
    expect(byId['ccv-next-three']).toContain('Skills');
    expect(byId['ccv-next-four']).toContain('Backgrounds');
    // Changeling-specific: the fifth region is Arts, where a Vampire gets
    // Disciplines and a Werewolf gets Gifts.
    expect(byId['ccv-next-five']).toContain('Arts');
    expect(byId['ccv-next-five']).not.toContain('Disciplines');
    expect(byId['ccv-next-five']).not.toContain('Gifts');
    expect(byId['ccv-next-six']).toContain('Merits');
    expect(byId['ccv-next-seven']).toContain('Flaws');
    expect(byId['ccv-next-eight']).toBe('Complete Character Creation!');

    const description = normalize(await page.locator('#ccv-description').textContent());
    expect(description).toContain('You have 30 initial XP to spend');
    expect(description).toContain(`Remaining steps for ${state.wizardName}`);

    const creation = await readCreation(page, state.wizardId, 'Changeling');
    expect(creation.initial_xp).toBe(30);
    expect(creation.completed).toBe(false);
    expect(await sampleXp('217 wizard start')).toEqual(BASELINE_XP);

    // The pool badges the rest of this suite reads, at their documented start
    // values. `Backgrounds` used to read 1 rather than the true 3 - see
    // file-level finding 3 and test 228 - until remediation R20 made
    // `VampireCreation.remaining_picks` sum the sub-pools that actually exist
    // on the record instead of consulting a Vampire-only table. `Arts` always
    // read 3 correctly, because that pool only ever has one real rating (1),
    // so the old fallback happened to land right.
    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.pools).toEqual({
      Attributes: 3,
      'Physical Focus': 1,
      'Social Focus': 1,
      'Mental Focus': 1,
      Skills: 10,
      Backgrounds: 3,
      Arts: 3,
      Merits: SUM_POOL_BUDGET,
      Flaws: SUM_POOL_BUDGET
    });
  });

  // -------------------------------------------------------------------------
  // 218-223 - text attributes
  // -------------------------------------------------------------------------

  test('218 Pick Kith; the value renders, and its affinity Arts are auto-granted for free', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'ctdbs_kiths', 'ctdbs_kith');
    expect(options).toContain(WIZARD_KITH);

    const before = await readCreation(page, state.wizardId, 'Changeling');
    expect(before.ctdbs_arts_1_remaining).toBe(3);
    expect(await readTraits(page, state.wizardId, 'ctdbs_arts', 'Changeling')).toHaveLength(0);

    const picked = await pickSimpleText(page, state.wizardId, 'ctdbs_kiths', 'ctdbs_kith', WIZARD_KITH);
    expect(picked).toBe(WIZARD_KITH);

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Kith).toBe(WIZARD_KITH);
    expect((await readCharacterTexts(page, state.wizardId, 'Changeling')).ctdbs_kith).toBe(WIZARD_KITH);

    // The affordance flips from a lone "Pick" to the "Repick" + "Unpick" pair.
    const links = creationState.textPickLinks.filter((h) => h.indexOf('/ctdbs_kiths/ctdbs_kith/') !== -1);
    expect([...links].sort()).toEqual([
      `#charactercreate/simpletext/ctdbs_kiths/ctdbs_kith/${state.wizardId}/pick`,
      `#charactercreate/simpletext/ctdbs_kiths/ctdbs_kith/${state.wizardId}/unpick`
    ].sort());
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Repick Kith' })).toHaveCount(1);
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Unpick Kith' })).toHaveCount(1);
    await expect(page.locator('#ccv-simpletext a').filter({ hasText: /^Pick Kith$/ })).toHaveCount(0);

    // THE CENTRAL MECHANIC (file-level finding 5), measured here rather than
    // assumed: picking a Kith with two `bnsctdbs_KithRule` affinities
    // auto-grants exactly those two Arts, for free, and the arts_1 pool moves
    // by exactly that many - a pool the player never touched directly.
    const after = await readCreation(page, state.wizardId, 'Changeling');
    expect(after.ctdbs_arts_1_remaining).toBe(3 - WIZARD_KITH_ARTS.length);
    expect((await readCreationState(page, state.wizardId)).pools.Arts).toBe(3 - WIZARD_KITH_ARTS.length);

    const arts = await readTraits(page, state.wizardId, 'ctdbs_arts', 'Changeling');
    expect(arts.map((t) => t.name).sort()).toEqual([...WIZARD_KITH_ARTS].sort());
    expect(arts.every((t) => t.value === 1 && t.free_value === 1 && t.cost === 0)).toBe(true);

    const affinityInfo = await readArtAffinities(page, state.wizardId);
    expect(affinityInfo.kith).toBe(WIZARD_KITH);
    expect(affinityInfo.affinities.sort()).toEqual([...WIZARD_KITH_ARTS].sort());

    expect(await sampleXp('218 Kith picked, affinity Arts auto-granted')).toEqual(BASELINE_XP);
  });

  test('219 Repick Kith; the new value replaces the prior one, and Arts reconcile rather than accumulate', async () => {
    expect((await readCharacterTexts(page, state.wizardId, 'Changeling')).ctdbs_kith).toBe(WIZARD_KITH);

    const picked = await pickSimpleText(page, state.wizardId, 'ctdbs_kiths', 'ctdbs_kith', WIZARD_KITH_REPICK);
    expect(picked).toBe(WIZARD_KITH_REPICK);

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Kith).toBe(WIZARD_KITH_REPICK);
    // Replacement, not accumulation, at the text level: exactly one Kith
    // divider, and the old value is nowhere on the page.
    const kithDividers = await page.locator('#ccv-simpletext li[data-role="list-divider"]')
      .filter({ hasText: 'Kith' }).count();
    expect(kithDividers).toBe(1);
    expect(normalize(await page.locator('#ccv-simpletext').textContent())).not.toContain(WIZARD_KITH);
    expect((await readCharacterTexts(page, state.wizardId, 'Changeling')).ctdbs_kith).toBe(WIZARD_KITH_REPICK);

    // Reconciliation, not accumulation, at the Arts level (file-level finding
    // 5): "Naming" (Inanimae-only) is gone; "Metamorphosis" (shared by both
    // Kiths) survives as a single trait, not a duplicate; the two
    // Boggans-only Arts are added. The pool lands at exactly 0 - the sum of
    // Boggans' three affinities, not a leftover from Inanimae's two.
    const arts = await readTraits(page, state.wizardId, 'ctdbs_arts', 'Changeling');
    expect(arts.map((t) => t.name).sort()).toEqual([...WIZARD_KITH_REPICK_ARTS].sort());
    expect(arts.every((t) => t.value === 1 && t.free_value === 1 && t.cost === 0)).toBe(true);
    const metamorphosis = arts.filter((t) => t.name === 'Metamorphosis');
    expect(metamorphosis).toHaveLength(1);

    const creation = await readCreation(page, state.wizardId, 'Changeling');
    expect(creation.ctdbs_arts_1_remaining).toBe(3 - WIZARD_KITH_REPICK_ARTS.length);
    expect((await readCreationState(page, state.wizardId)).pools.Arts).toBe(3 - WIZARD_KITH_REPICK_ARTS.length);

    const affinityInfo = await readArtAffinities(page, state.wizardId);
    expect(affinityInfo.kith).toBe(WIZARD_KITH_REPICK);
    expect(affinityInfo.affinities.sort()).toEqual([...WIZARD_KITH_REPICK_ARTS].sort());

    expect(await sampleXp('219 Kith repicked, Arts reconciled')).toEqual(BASELINE_XP);
  });

  test('220 Unpick Kith; the value is cleared and the auto-granted Arts and pool come back with it', async () => {
    // FIXED by remediation R21.
    //
    // Was: `unpick_text` was a bare passthrough on ChangelingBetaSlice - it
    // never called `_unpick_previous_arts` the way `update_text` does on every
    // repick. The Arts test 219 granted stayed owned at cost 0 and the pool
    // that should have returned to 3 stayed at 0, with the Kith gone and so no
    // route back to reclaim the slots. `unpick_text` now releases the Kith's
    // Arts before clearing the text, reading the affinities while the Kith is
    // still set.
    await unpickSimpleText(page, state.wizardId, 'ctdbs_kiths', 'ctdbs_kith');

    // The text value itself is cleared, exactly as Vampire's Clan and
    // Werewolf's Tribe are.
    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Kith).toBeUndefined();
    expect((await readCharacterTexts(page, state.wizardId, 'Changeling')).ctdbs_kith).toBeNull();
    expect((await readCreation(page, state.wizardId, 'Changeling')).ctdbs_kith).toBe(false);
    await expect(page.locator('#ccv-simpletext a').filter({ hasText: /^Pick Kith$/ })).toHaveCount(1);
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Repick Kith' })).toHaveCount(0);
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Unpick Kith' })).toHaveCount(0);

    // What R21 restored: the grant is reversed, not orphaned.
    const arts = await readTraits(page, state.wizardId, 'ctdbs_arts', 'Changeling');
    expect(
      arts.map((t) => t.name).sort(),
      'unpicking Kith removes the Arts it granted'
    ).toEqual([]);

    const creation = await readCreation(page, state.wizardId, 'Changeling');
    expect(creation.ctdbs_arts_1_remaining, 'and hands the pool slots back').toBe(3);
    expect((await readCreationState(page, state.wizardId)).pools.Arts).toBe(3);
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);
  });

  test('221 Pick Court (Fealty); the value renders', async () => {
    // No cleanup step needed any more: remediation R21 made test 220's unpick
    // release the Kith's Arts and their pool slots itself. This used to have
    // to remove three orphaned Arts by hand, the same way Vampire's test 180
    // and Werewolf's test 206 clear their own residue. Asserted rather than
    // assumed, since every later pool number in this file depends on it.
    expect(await readTraits(page, state.wizardId, 'ctdbs_arts', 'Changeling')).toHaveLength(0);
    const restoredCreation = await readCreation(page, state.wizardId, 'Changeling');
    expect(restoredCreation.ctdbs_arts_1_remaining, 'Arts pool already restored by the unpick').toBe(3);
    expect((await readCreationState(page, state.wizardId)).pools.Arts).toBe(3);
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);

    // The actual ask for this item: pick Court.
    const options = await listSimpleTextOptions(page, state.wizardId, 'ctdbs_fealty_courts', 'ctdbs_fealty_court');
    expect(options).toContain(WIZARD_COURT);

    const picked = await pickSimpleText(page, state.wizardId, 'ctdbs_fealty_courts', 'ctdbs_fealty_court', WIZARD_COURT);
    expect(picked).toBe(WIZARD_COURT);

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Court).toBe(WIZARD_COURT);
    expect((await readCharacterTexts(page, state.wizardId, 'Changeling')).ctdbs_fealty_court).toBe(WIZARD_COURT);
  });

  test('222 Pick Kith Group Type; the value renders', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'ctdbs_kith_group_types', 'ctdbs_kith_group_type');
    expect(options.length).toBeGreaterThan(0);

    const picked = await pickSimpleText(page, state.wizardId, 'ctdbs_kith_group_types', 'ctdbs_kith_group_type', options[0]);
    expect(picked).toBe(options[0]);
    state.groupType = picked;

    // The wizard labels this divider with the model's pretty-name function
    // (`function(character) { return "Group"; }` in
    // models/ChangelingBetaSlice.js), not the raw attribute name.
    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Group).toBe(picked);
    expect((await readCharacterTexts(page, state.wizardId, 'Changeling')).ctdbs_kith_group_type).toBe(picked);

    // Court from test 221 is still set - text picks do not clobber each other.
    expect((await readCharacterTexts(page, state.wizardId, 'Changeling')).ctdbs_fealty_court).toBe(WIZARD_COURT);
  });

  test('223 Pick Archetype and Antecedence; both render', async () => {
    const archetypeOptions = await listSimpleTextOptions(page, state.wizardId, 'archetypes', 'archetype');
    expect(archetypeOptions.length).toBeGreaterThan(0);
    const archetype = await pickSimpleText(page, state.wizardId, 'archetypes', 'archetype', archetypeOptions[0]);
    expect(archetype).toBe(archetypeOptions[0]);
    expect((await readCreationState(page, state.wizardId)).texts.Archetype).toBe(archetype);

    const antecedenceOptions = await listSimpleTextOptions(page, state.wizardId, 'antecedences', 'antecedence');
    expect([...antecedenceOptions].sort()).toEqual(['NPC', 'Primary', 'Secondary']);
    const antecedence = await pickSimpleText(page, state.wizardId, 'antecedences', 'antecedence', 'Primary');
    expect(antecedence).toBe('Primary');
    // The wizard labels this divider with the model's pretty name, not the
    // attribute name (`TEXT_ATTRIBUTES_PRETTY_NAMES` in models/ChangelingBetaSlice.js).
    expect((await readCreationState(page, state.wizardId)).texts['Primary, Secondary, or NPC']).toBe('Primary');
    expect((await readCharacterTexts(page, state.wizardId, 'Changeling')).antecedence).toBe('Primary');

    // Every text attribute except Kith (unpicked by test 220, never
    // repicked) and House (out of scope) now carries a value.
    const texts = await readCharacterTexts(page, state.wizardId, 'Changeling');
    expect(texts.ctdbs_kith).toBeNull();
    for (const key of ['archetype', 'ctdbs_fealty_court', 'ctdbs_kith_group_type', 'antecedence']) {
      expect(texts[key], `text attribute "${key}"`).toBeTruthy();
    }

    expect(await sampleXp('223 all in-scope text attributes picked')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 224-225 - attributes
  // -------------------------------------------------------------------------

  test('224 Attribute 7/5/3 allocation completes and all three pools reach 0', async () => {
    const before = await readCreation(page, state.wizardId, 'Changeling');
    expect(before.attributes_7_remaining).toBe(1);
    expect(before.attributes_5_remaining).toBe(1);
    expect(before.attributes_3_remaining).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(3);

    const picked = await pickCreationTrait(page, state.wizardId, 'attributes', 7, 'Physical');
    expect(picked).toBe('Physical');
    let after = await readCreation(page, state.wizardId, 'Changeling');
    expect(after.attributes_7_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(2);
    let traits = await readTraits(page, state.wizardId, 'attributes', 'Changeling');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: 'Physical', value: 7, free_value: 7, cost: 0 });

    // Delete then Pick is the only repick path for slot pools (no one-step
    // "Repick" link renders for them), so unpicking and picking again
    // demonstrates the round trip before filling all three.
    await unpickCreationTrait(page, state.wizardId, 'attributes', 'Physical');
    after = await readCreation(page, state.wizardId, 'Changeling');
    expect(after.attributes_7_remaining).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(3);
    expect(await readTraits(page, state.wizardId, 'attributes', 'Changeling')).toHaveLength(0);

    await pickCreationTrait(page, state.wizardId, 'attributes', 7, 'Physical');
    await pickCreationTrait(page, state.wizardId, 'attributes', 5, 'Social');
    await pickCreationTrait(page, state.wizardId, 'attributes', 3, 'Mental');

    const creation = await readCreation(page, state.wizardId, 'Changeling');
    expect(creation.attributes_7_remaining).toBe(0);
    expect(creation.attributes_5_remaining).toBe(0);
    expect(creation.attributes_3_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(0);

    traits = await readTraits(page, state.wizardId, 'attributes', 'Changeling');
    const byName = Object.fromEntries(traits.map((t) => [t.name, t.value]));
    expect(byName).toEqual({ Physical: 7, Social: 5, Mental: 3 });
    expect(traits.every((t) => t.cost === 0)).toBe(true);

    expect(await sampleXp('224 attributes 7/5/3 spent')).toEqual(BASELINE_XP);
  });

  test('225 Attribute pool enforcement prevents a second 7-slot pick', async () => {
    // Every rating is exhausted by test 224, so checking "no pick links
    // remain" here alone would prove only that the *section* is closed, not
    // that the block is per-slot. Restoring just the 7 slot and re-checking
    // proves the finer claim: only the 7-rated affordance reappears, 5 and 3
    // stay exhausted.
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 7)).toBe(0);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 5)).toBe(0);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 3)).toBe(0);

    await unpickCreationTrait(page, state.wizardId, 'attributes', 'Physical');
    expect((await readCreation(page, state.wizardId, 'Changeling')).attributes_7_remaining).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(1);

    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 7)).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 5)).toBe(0);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 3)).toBe(0);

    // Restore the full allocation test 224 left the wizard with, so later
    // tests (and completion) see attributes durably finished.
    await pickCreationTrait(page, state.wizardId, 'attributes', 7, 'Physical');
    const creation = await readCreation(page, state.wizardId, 'Changeling');
    expect(creation.attributes_7_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(0);
    const traits = await readTraits(page, state.wizardId, 'attributes', 'Changeling');
    expect(Object.fromEntries(traits.map((t) => [t.name, t.value]))).toEqual({ Physical: 7, Social: 5, Mental: 3 });
  });

  // -------------------------------------------------------------------------
  // 226 - focuses
  // -------------------------------------------------------------------------

  test('226 Focus pick, repick, and unpick behave correctly for all three focus categories', async () => {
    expect((await readCreation(page, state.wizardId, 'Changeling')).focus_physicals_1_remaining).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'focus_physicals', 1)).toBe(1);

    const picked = await pickCreationTrait(page, state.wizardId, 'focus_physicals', 1, 'Dexterity');
    expect(picked).toBe('Dexterity');
    expect((await readCreation(page, state.wizardId, 'Changeling')).focus_physicals_1_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(0);
    expect((await readTraits(page, state.wizardId, 'focus_physicals', 'Changeling')).map((t) => t.name)).toEqual(['Dexterity']);

    // Repick (Dexterity -> Stamina): Delete then Pick, the pool passes
    // through 1 on its way back to 0 and the trait is replaced.
    await unpickCreationTrait(page, state.wizardId, 'focus_physicals', 'Dexterity');
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(1);
    await pickCreationTrait(page, state.wizardId, 'focus_physicals', 1, 'Stamina');
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(0);
    expect((await readCreation(page, state.wizardId, 'Changeling')).focus_physicals_1_remaining).toBe(0);
    expect((await readTraits(page, state.wizardId, 'focus_physicals', 'Changeling')).map((t) => t.name)).toEqual(['Stamina']);

    // Unpick: the pool is restored, nothing refilled yet.
    await unpickCreationTrait(page, state.wizardId, 'focus_physicals', 'Stamina');
    expect((await readCreation(page, state.wizardId, 'Changeling')).focus_physicals_1_remaining).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'focus_physicals', 1)).toBe(1);
    expect(await readTraits(page, state.wizardId, 'focus_physicals', 'Changeling')).toHaveLength(0);

    // Fill all three, leaving the wizard complete for the rest of the suite.
    await pickCreationTrait(page, state.wizardId, 'focus_physicals', 1, 'Dexterity');
    await pickCreationTrait(page, state.wizardId, 'focus_mentals', 1, 'Intelligence');
    await pickCreationTrait(page, state.wizardId, 'focus_socials', 1, 'Charisma');

    const creation = await readCreation(page, state.wizardId, 'Changeling');
    expect(creation.focus_physicals_1_remaining).toBe(0);
    expect(creation.focus_mentals_1_remaining).toBe(0);
    expect(creation.focus_socials_1_remaining).toBe(0);

    const pools = (await readCreationState(page, state.wizardId)).pools;
    expect(pools['Physical Focus']).toBe(0);
    expect(pools['Mental Focus']).toBe(0);
    expect(pools['Social Focus']).toBe(0);

    expect((await readTraits(page, state.wizardId, 'focus_physicals', 'Changeling')).map((t) => t.name)).toEqual(['Dexterity']);
    expect((await readTraits(page, state.wizardId, 'focus_mentals', 'Changeling')).map((t) => t.name)).toEqual(['Intelligence']);
    expect((await readTraits(page, state.wizardId, 'focus_socials', 'Changeling')).map((t) => t.name)).toEqual(['Charisma']);

    expect(await sampleXp('226 all three focuses spent')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 227-229 - skills, backgrounds, arts
  // -------------------------------------------------------------------------

  test('227 Skill pools 4/3/2/1 each decrement correctly', async () => {
    const creation = await readCreation(page, state.wizardId, 'Changeling');
    expect(creation.skills_4_remaining).toBe(1);
    expect(creation.skills_3_remaining).toBe(2);
    expect(creation.skills_2_remaining).toBe(3);
    expect(creation.skills_1_remaining).toBe(4);

    let expectedBadge = 10;
    expect((await readCreationState(page, state.wizardId)).pools.Skills).toBe(expectedBadge);

    for (const rating of [4, 3, 2, 1]) {
      for (const skill of SKILL_PICKS[rating]) {
        const picked = await pickCreationTrait(page, state.wizardId, 'skills', rating, skill);
        expect(picked).toBe(skill);
        expectedBadge -= 1;
        expect(
          (await readCreationState(page, state.wizardId)).pools.Skills,
          `Skills badge after picking ${skill} at rating ${rating}`
        ).toBe(expectedBadge);
      }
      expect(
        (await readCreation(page, state.wizardId, 'Changeling'))[`skills_${rating}_remaining`],
        `skills_${rating}_remaining after filling that slot`
      ).toBe(0);
    }
    expect(expectedBadge).toBe(0);

    const traits = await readTraits(page, state.wizardId, 'skills', 'Changeling');
    expect(traits).toHaveLength(10);
    const byName = Object.fromEntries(traits.map((t) => [t.name, t.value]));
    for (const rating of [4, 3, 2, 1]) {
      for (const skill of SKILL_PICKS[rating]) {
        expect(byName[skill], `${skill} rating`).toBe(rating);
      }
    }
    expect(traits.every((t) => t.cost === 0 && t.free_value === t.value)).toBe(true);

    expect(await sampleXp('227 all ten skills spent')).toEqual(BASELINE_XP);
  });

  test('228 ctdbs_backgrounds pools 3/2/1 each decrement correctly', async () => {
    const before = await readCreation(page, state.wizardId, 'Changeling');
    expect(before.ctdbs_backgrounds_3_remaining).toBe(1);
    expect(before.ctdbs_backgrounds_2_remaining).toBe(1);
    expect(before.ctdbs_backgrounds_1_remaining).toBe(1);
    // FIXED by remediation R20 - see creation-werewolf.spec.js test 202 for
    // the same fix in the other venue. The badge used to read 1 rather than
    // the true 3 and stayed frozen through the rating-3 and rating-2 picks,
    // because `remaining_picks` sized its loop from a hardcoded map of
    // Vampire's bare category names. It now sums the sub-pools that actually
    // exist on the record.
    expect((await readCreationState(page, state.wizardId)).pools.Backgrounds).toBe(3);

    const picked3 = await pickCreationTrait(page, state.wizardId, 'ctdbs_backgrounds', 3, BACKGROUND_PICKS[3]);
    expect(picked3).toBe(BACKGROUND_PICKS[3]);
    expect((await readCreation(page, state.wizardId, 'Changeling')).ctdbs_backgrounds_3_remaining, 'the real counter').toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Backgrounds, 'the badge follows the 3-slot pick').toBe(2);

    const picked2 = await pickCreationTrait(page, state.wizardId, 'ctdbs_backgrounds', 2, BACKGROUND_PICKS[2]);
    expect(picked2).toBe(BACKGROUND_PICKS[2]);
    expect((await readCreation(page, state.wizardId, 'Changeling')).ctdbs_backgrounds_2_remaining, 'the real counter').toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Backgrounds, 'and the 2-slot pick').toBe(1);

    const picked1 = await pickCreationTrait(page, state.wizardId, 'ctdbs_backgrounds', 1, BACKGROUND_PICKS[1]);
    expect(picked1).toBe(BACKGROUND_PICKS[1]);
    const after = await readCreation(page, state.wizardId, 'Changeling');
    expect(after.ctdbs_backgrounds_3_remaining).toBe(0);
    expect(after.ctdbs_backgrounds_2_remaining).toBe(0);
    expect(after.ctdbs_backgrounds_1_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Backgrounds, 'and reaches zero with the last one').toBe(0);

    const traits = await readTraits(page, state.wizardId, 'ctdbs_backgrounds', 'Changeling');
    expect(Object.fromEntries(traits.map((t) => [t.name, t.value]))).toEqual({
      [BACKGROUND_PICKS[3]]: 3,
      [BACKGROUND_PICKS[2]]: 2,
      [BACKGROUND_PICKS[1]]: 1
    });
    expect(traits.every((t) => t.cost === 0 && t.free_value === t.value)).toBe(true);

    expect(await sampleXp('228 all three backgrounds spent')).toEqual(BASELINE_XP);
  });

  test('229 Pick an Art using ctdbs_arts_1_remaining; the pool reaches 0', async () => {
    // Test 220/221 left the wizard with no Kith and a clean 3-slot Arts pool
    // (confirmed restored in test 221), so this is a genuinely manual pick
    // against the full, unfiltered catalogue - see file-level finding 13: the
    // creation-time Art picker applies no Kith-based filter at all, unlike
    // Vampire's in-clan-discipline gate or Werewolf's Gift-affinity gate.
    expect((await readCharacterTexts(page, state.wizardId, 'Changeling')).ctdbs_kith).toBeNull();
    const options = await listCreationTraitOptions(page, state.wizardId, 'ctdbs_arts', 1);
    for (const name of WIZARD_ART_PICKS) {
      expect(options, `"${name}" offered with no Kith set`).toContain(name);
    }

    const before = await readCreation(page, state.wizardId, 'Changeling');
    expect(before.ctdbs_arts_1_remaining).toBe(3);
    expect((await readCreationState(page, state.wizardId)).pools.Arts).toBe(3);

    let expectedBadge = 3;
    for (const name of WIZARD_ART_PICKS) {
      const picked = await pickCreationTrait(page, state.wizardId, 'ctdbs_arts', 1, name);
      expect(picked).toBe(name);
      expectedBadge -= 1;
      expect(
        (await readCreationState(page, state.wizardId)).pools.Arts,
        `Arts badge after picking ${name}`
      ).toBe(expectedBadge);
    }
    expect(expectedBadge).toBe(0);

    const after = await readCreation(page, state.wizardId, 'Changeling');
    expect(after.ctdbs_arts_1_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Arts).toBe(0);

    const traits = await readTraits(page, state.wizardId, 'ctdbs_arts', 'Changeling');
    expect(traits.map((t) => t.name).sort()).toEqual([...WIZARD_ART_PICKS].sort());
    expect(traits.every((t) => t.cost === 0 && t.free_value === t.value)).toBe(true);

    expect(await sampleXp('229 all three Arts spent')).toEqual(BASELINE_XP);
  });

  test('229b Picking a Kith with the Art pool spent is refused, not overspent (R22)', async () => {
    // Test 229 leaves the wizard with all three Art picks spent and no Kith,
    // which is exactly the state this is about.
    //
    // A Kith's affinity Arts are granted free, but they do consume the
    // character's own Art picks - that is the rule, and tests 218/219 measure
    // it. What was missing was any check that picks remain: the grant
    // decremented regardless, driving `ctdbs_arts_1_remaining` to -2 and
    // making `spendAllCreationPools` abort with "creation overspent a pool".
    // Remediation R22 refuses the pick instead, and says why. Refusing rather
    // than clamping is deliberate - clamping would silently drop a grant the
    // character is entitled to.
    const cid = state.wizardId;
    const before = await readCreation(page, cid, 'Changeling');
    expect(before.ctdbs_arts_1_remaining, 'test 229 spent the Art pool').toBe(0);
    const artsBefore = (await readTraits(page, cid, 'ctdbs_arts', 'Changeling')).map((t) => t.name).sort();

    await navigateToHash(page, `charactercreate/simpletext/ctdbs_kiths/ctdbs_kith/${cid}/pick`, '#simpletext-new');
    await page.locator(`#simpletext-new a.simpletext[name="${WIZARD_KITH}"]`).first().click();

    const banner = page.locator('#global-error-region');
    await expect(banner, 'the refusal is told to the player').toBeVisible({ timeout: 15000 });
    const text = await banner.textContent();
    expect(text).toContain(WIZARD_KITH);
    expect(text, 'and names what is in the way').toMatch(/Art pick/i);

    // Nothing moved: no Kith, no Arts granted, the pool untouched and not negative.
    expect((await readCharacterTexts(page, cid, 'Changeling')).ctdbs_kith, 'the Kith was not set').toBeNull();
    expect((await readTraits(page, cid, 'ctdbs_arts', 'Changeling')).map((t) => t.name).sort())
      .toEqual(artsBefore);
    const after = await readCreation(page, cid, 'Changeling');
    expect(after.ctdbs_arts_1_remaining, 'the pool is untouched, and never negative').toBe(0);
    expect(await sampleXp('229b Kith refused for want of Art picks')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 230-233 - merits and flaws (the point-sum pools)
  // -------------------------------------------------------------------------

  test('230 Pick a ctdbs_merit (Ambidextrous at 2); the merit pool sum drops by 2 and XP moves by the merit value', async () => {
    // PLAN-VS-APPLICATION CONFLICT, the same one Task 8a found for Vampire
    // merits and Task 8b found for Werewolf's `wta_merits` (file-level
    // finding 1): the plan asks for "XP is unchanged"; the application
    // deliberately charges the merit's value against the starting 30 XP, and
    // `ctdbs_merits_0_remaining` is a 7-point *cap*, not a separate currency.
    // Measured arithmetic is asserted instead.
    const xpBefore = await readSheetXp(page, state.wizardId);
    expect(xpBefore).toEqual(BASELINE_XP);
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET);
    expect((await readCreation(page, state.wizardId, 'Changeling')).ctdbs_merits_0_remaining).toBe(SUM_POOL_BUDGET);

    const picked = await pickCreationTrait(page, state.wizardId, 'ctdbs_merits', 0, MERIT_NAME);
    expect(picked).toBe(MERIT_NAME);

    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET - MERIT_VALUE);
    expect((await readCreation(page, state.wizardId, 'Changeling')).ctdbs_merits_0_remaining).toBe(SUM_POOL_BUDGET - MERIT_VALUE);

    const traits = await readTraits(page, state.wizardId, 'ctdbs_merits', 'Changeling');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: MERIT_NAME, value: MERIT_VALUE, free_value: 0, cost: MERIT_VALUE });

    const xpAfter = await readSheetXp(page, state.wizardId);
    state.meritXpDelta = {
      spent: xpAfter.spent - xpBefore.spent,
      available: xpAfter.available - xpBefore.available
    };
    expect(state.meritXpDelta).toEqual({ spent: MERIT_VALUE, available: -MERIT_VALUE });
    expect(xpAfter).toEqual({ earned: 30, spent: MERIT_VALUE, available: 30 - MERIT_VALUE });
  });

  test('231 Change the picked ctdbs_merit\'s value from 2 to 3; the pool sum updates', async () => {
    // FIXED by remediation R19 - one fix, three venues, because
    // `SimpleTraitChangeView.js` is one shared file.
    //
    // Was: `save_clicked` persisted via `character.update_trait
    // (self.simpletrait)` - one argument, so `free_value` was `undefined`
    // inside `update_creation_rules_for_changed_trait`
    // (models/ChangelingBetaSlice.js), which composes its key as
    // `category + "_" + freeValue + "_remaining"`. The write landed on
    // `ctdbs_merits_undefined_remaining` (carrying the right number, 4)
    // instead of `ctdbs_merits_0_remaining` (which stayed stale at 5).
    const newValue = MERIT_VALUE + 1;

    const label = await openTraitChange(page, state.wizardId, 'ctdbs_merits', MERIT_NAME);
    expect(label).toBe(`${MERIT_NAME} x${MERIT_VALUE}`);

    const atCurrent = await readTraitChangeView(page);
    expect(atCurrent.text).toContain(`${MERIT_NAME} ${MERIT_VALUE}`);
    expect(atCurrent.cost).toBe(0);

    await setTraitChangeSliders(page, { value: newValue });
    const atNew = await readTraitChangeView(page);
    expect(atNew.text).toContain(`${MERIT_NAME} ${newValue}`);
    expect(atNew.cost).toBe(newValue - MERIT_VALUE);

    await saveTraitChange(page, state.wizardId, 'ctdbs_merits');

    // These pass: the trait itself is updated and charged correctly.
    const traits = await readTraits(page, state.wizardId, 'ctdbs_merits', 'Changeling');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: MERIT_NAME, value: newValue, cost: newValue });
    expect(await readSheetXp(page, state.wizardId)).toEqual({ earned: 30, spent: newValue, available: 30 - newValue });

    // What R19 fixed: the write lands on the key the pool badge reads.
    const creation = await readCreation(page, state.wizardId, 'Changeling');
    const junkKeys = Object.keys(creation).filter((k) => k.indexOf('undefined') !== -1);
    expect(junkKeys, 'no `<category>_undefined_*` keys are written any more').toEqual([]);
    expect(creation.ctdbs_merits_0_remaining).toBe(SUM_POOL_BUDGET - newValue);
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET - newValue);
  });

  test('232 Unpick the ctdbs_merit with the changed value; the pool sum is fully restored', async () => {
    // Test 231 leaves the merit at value 3 with its XP charged, which is
    // exactly the "merit with the changed value" this item wants unpicked.
    const traitsBefore = await readTraits(page, state.wizardId, 'ctdbs_merits', 'Changeling');
    expect(traitsBefore).toHaveLength(1);
    expect(traitsBefore[0].value).toBe(MERIT_VALUE + 1);
    expect((await readSheetXp(page, state.wizardId)).spent).toBe(MERIT_VALUE + 1);

    await unpickCreationTrait(page, state.wizardId, 'ctdbs_merits', MERIT_NAME);

    // `unpick_from_creation` recomputes the sum pool from the remaining picks
    // (`7 - sum`) rather than incrementing it, so the stale counter left by
    // test 231 is corrected on the way out and the budget lands back on 7.
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET);
    const creation = await readCreation(page, state.wizardId, 'Changeling');
    expect(creation.ctdbs_merits_0_remaining).toBe(SUM_POOL_BUDGET);
    expect(creation.ctdbs_merits_0_picks).toBe(0);
    expect(await readTraits(page, state.wizardId, 'ctdbs_merits', 'Changeling')).toHaveLength(0);

    // XP is refunded in full: `remove_trait` posts `-cost` as a spent alteration.
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);

    // This used to record the residue of test 231's defect - an inert
    // `ctdbs_merits_undefined_remaining` key nothing reads - "so a future fix
    // can be seen to remove it". Remediation R19 is that fix, so the assertion
    // is inverted rather than deleted: no such key is written at all now.
    expect(Object.keys(creation).filter((k) => k.indexOf('undefined') !== -1)).toEqual([]);
  });

  test('233 Pick a ctdbs_flaw; the flaw pool sum updates', async () => {
    const xpBefore = await readSheetXp(page, state.wizardId);
    expect(xpBefore).toEqual(BASELINE_XP);
    expect((await readCreationState(page, state.wizardId)).pools.Flaws).toBe(SUM_POOL_BUDGET);

    const picked = await pickCreationTrait(page, state.wizardId, 'ctdbs_flaws', 0, FLAW_NAME);
    expect(picked).toBe(FLAW_NAME);

    expect((await readCreationState(page, state.wizardId)).pools.Flaws).toBe(SUM_POOL_BUDGET - FLAW_VALUE);
    expect((await readCreation(page, state.wizardId, 'Changeling')).ctdbs_flaws_0_remaining).toBe(SUM_POOL_BUDGET - FLAW_VALUE);

    const traits = await readTraits(page, state.wizardId, 'ctdbs_flaws', 'Changeling');
    expect(traits).toHaveLength(1);
    // A flaw's cost is negative (`mod_value * -1`), so it refunds XP - the
    // mirror image of test 230's merit.
    expect(traits[0]).toMatchObject({ name: FLAW_NAME, value: FLAW_VALUE, free_value: 0, cost: -FLAW_VALUE });

    const xpAfter = await readSheetXp(page, state.wizardId);
    state.flawXpDelta = {
      spent: xpAfter.spent - xpBefore.spent,
      available: xpAfter.available - xpBefore.available
    };
    expect(state.flawXpDelta).toEqual({ spent: -FLAW_VALUE, available: FLAW_VALUE });

    // Restore, so test 234 sees the wizard's slot pools alone. The
    // restoration is asserted rather than assumed.
    await unpickCreationTrait(page, state.wizardId, 'ctdbs_flaws', FLAW_NAME);
    expect((await readCreationState(page, state.wizardId)).pools.Flaws).toBe(SUM_POOL_BUDGET);
    expect(await readTraits(page, state.wizardId, 'ctdbs_flaws', 'Changeling')).toHaveLength(0);
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 234 - completion
  // -------------------------------------------------------------------------

  test('234 Complete Creation; the live sheet shows 30 available XP and 0 spent', async () => {
    // Across every *slot*-pool pick sampled through tests 217-229 (texts,
    // Kith's own auto-grants, attributes, focuses, all ten skills, all three
    // backgrounds, all three Arts), Available never moved off 30 and Spent
    // stayed 0. Merits/flaws are the documented point-sum exception, measured
    // in 230/233.
    expect(state.xpSamples.length).toBeGreaterThanOrEqual(7);
    for (const sample of state.xpSamples) {
      expect(sample.xp, `XP after "${sample.label}"`).toEqual(BASELINE_XP);
    }
    expect(state.meritXpDelta).toEqual({ spent: MERIT_VALUE, available: -MERIT_VALUE });
    expect(state.flawXpDelta).toEqual({ spent: -FLAW_VALUE, available: FLAW_VALUE });

    expect(await isCompleted(page, state.wizardId, 'Changeling')).toBe(false);

    // Driven through the wizard's own "Complete Character Creation!" button.
    await openCreation(page, state.wizardId);
    const completeLink = page.locator(`#ccv-next-eight a[href="#charactercreate/complete/${state.wizardId}"]`);
    await expect(completeLink).toHaveCount(1);
    await completeLink.click();

    // The completion route assigns the hash from inside a `.done()` whose
    // return value is discarded, so the hash can move before the creation
    // record is written; wait for the persisted flag, then land on the sheet.
    await completeCreation(page, state.wizardId, 'Changeling');

    expect(await isCompleted(page, state.wizardId, 'Changeling')).toBe(true);
    expect((await readCreation(page, state.wizardId, 'Changeling')).completed).toBe(true);
    expect(await activePageId(page)).toBe('character');

    // The sheet's `is_being_created()` branches have flipped: the wizard link
    // is gone and the Information block now renders the text attributes.
    await expect(page.locator('#character a[href^="#charactercreate/"]')).toHaveCount(0);
    const sheetTexts = await readSheetTextAttributes(page, state.wizardId);
    expect(sheetTexts.Ctdbs_fealty_court).toBe(WIZARD_COURT);
    expect(sheetTexts.Antecedence).toBe('Primary');

    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);
    const stored = await page.evaluate((id) => {
      return new window.Parse.Query('Vampire').get(id).then((c) => ({
        earned: c.get('experience_earned'),
        spent: c.get('experience_spent')
      }));
    }, state.wizardId);
    expect(stored).toEqual({ earned: 30, spent: 0 });

    // Every slot-pool trait the wizard placed is fully free.
    for (const category of ['attributes', 'focus_physicals', 'focus_mentals', 'focus_socials', 'skills', 'ctdbs_backgrounds', 'ctdbs_arts']) {
      const traits = await readTraits(page, state.wizardId, category, 'Changeling');
      expect(traits.length, `${category} count`).toBeGreaterThan(0);
      expect(
        traits.every((t) => t.cost === 0 && t.free_value === t.value),
        `${category} traits are all free: ${JSON.stringify(traits)}`
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 235-240 - post-creation spending, on the second completed character
  // -------------------------------------------------------------------------

  test('235 Post-creation Art purchase deducts XP', async () => {
    // The plan names "Chicanery" - unpurchasable under any spelling (file-
    // level findings 10/12). A real seeded Art is substituted. The xp
    // character has no Kith yet (deliberately, see the constants above), so
    // `get_arts_affinities()` is empty and this is unambiguously non-affinity.
    const cid = state.xpCharacter.id;
    const affinityInfo = await readArtAffinities(page, cid);
    expect(affinityInfo.kith).toBeNull();
    expect(affinityInfo.affinities).toEqual([]);

    const before = await readSheetXp(page, cid);
    expect(before).toEqual(BASELINE_XP);

    // The price the change page quotes before anything is committed.
    await openNewTraitChange(page, cid, 'ctdbs_arts', XP_FRESH_ART_NAME);
    await setTraitChangeSliders(page, { value: 1 });
    const quote = await readTraitChangeView(page);
    expect(quote.cost).toBe(XP_FRESH_ART_COST);
    expect(quote.cost).toBe(NON_AFFINITY_ART_COST_LEVEL_1);
    expect(quote.available).toBe(before.available);
    expect(quote.final).toBe(before.available - XP_FRESH_ART_COST);

    await saveTraitChange(page, cid, 'ctdbs_arts');

    const after = await readSheetXp(page, cid);
    expect(after.available - before.available).toBe(-XP_FRESH_ART_COST);
    expect(after.spent - before.spent).toBe(XP_FRESH_ART_COST);
    expect(after.earned).toBe(before.earned);

    const traits = await readTraits(page, cid, 'ctdbs_arts', 'Changeling');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: XP_FRESH_ART_NAME, value: 1, free_value: 0, cost: XP_FRESH_ART_COST });
  });

  test('236 Post-creation background purchase (ctdbs_backgrounds at 3) renders and deducts XP', async () => {
    // The plan names "Freehold" - not a seeded ctdbs_backgrounds Description
    // under any spelling (file-level finding 12). "Seeming" is substituted:
    // real, seeded, and its value is what test 239's Glamour check reads.
    //
    // FIXED by remediation R15 (with R16).
    //
    // Was: `calculate_trait_cost`'s only background-shaped branch checked the
    // literal string "backgrounds", which never matches this venue's real
    // category, "ctdbs_backgrounds", so execution fell through to the
    // function's final `return 0;` and the purchase was free. The background
    // was genuinely bought and genuinely rendered - only "deducts XP" was
    // false.
    //
    // Now: the branch matches both spellings and charges the same cumulative
    // 2-per-level table the other two venues use for Backgrounds. R16
    // additionally replaced that `return 0` fallthrough with an explicit list
    // of genuinely-free categories, so the next category anyone forgets to
    // price refuses out loud instead of being silently free.
    const cid = state.xpCharacter.id;
    const before = await readSheetXp(page, cid);

    await openNewTraitChange(page, cid, 'ctdbs_backgrounds', XP_BACKGROUND_NAME);
    await setTraitChangeSliders(page, { value: XP_BACKGROUND_VALUE });
    const quote = await readTraitChangeView(page);
    // Cumulative on get_cost_table(2) == [2, 4, 6, ...]: 2 + 4 + 6 = 12.
    expect(quote.cost).toBe(XP_BACKGROUND_COST);
    expect(quote.final).toBe(before.available - XP_BACKGROUND_COST);

    await saveTraitChange(page, cid, 'ctdbs_backgrounds');

    // The background is bought and genuinely renders, both in the trait list
    // and on the category listing page the sheet's "Backgrounds" link leads to.
    const traits = await readTraits(page, cid, 'ctdbs_backgrounds', 'Changeling');
    expect(traits.map((t) => t.name)).toContain(XP_BACKGROUND_NAME);
    expect(traits.find((t) => t.name === XP_BACKGROUND_NAME))
      .toMatchObject({ value: XP_BACKGROUND_VALUE, free_value: 0, cost: XP_BACKGROUND_COST });
    await navigateToHash(page, `simpletraits/ctdbs_backgrounds/${cid}/all`, '#simpletraitcategory-all');
    expect(normalize(await page.locator('#simpletraitcategory-all').textContent())).toContain(`${XP_BACKGROUND_NAME} x${XP_BACKGROUND_VALUE}`);

    // And the XP really moves.
    const after = await readSheetXp(page, cid);
    expect(after.spent - before.spent, 'Spent XP after buying a background').toBe(XP_BACKGROUND_COST);
    expect(after.available - before.available).toBe(-XP_BACKGROUND_COST);
    expect(after.earned).toBe(before.earned);
  });

  test('237 ctdbs_holdings_specializations is now seeded and offers real options', async () => {
    // Previously a GAP pinned red: this category had no seeded Description at
    // any layer, so nothing could ever be added to it. The catalogue was
    // backfilled from data/all_greensboro_descriptions_20260816.csv, which
    // supplied the rows that were simply never authored, and the picker now
    // works. Asserting a non-empty picker rather than an exact count keeps
    // this robust against the catalogue growing again.
    const cid = state.xpCharacter.id;

    await navigateToHash(page, `simpletraits/ctdbs_holdings_specializations/${cid}/new`, '#simpletrait-new');
    const offered = await page.locator('#simpletrait-new a.simpletrait')
      .evaluateAll((els) => els.map((e) => (e.getAttribute('name') || e.textContent).replace(/\s+/g, ' ').trim()).filter(Boolean));
    expect(offered.length, 'the "add new" picker for ctdbs_holdings_specializations').toBeGreaterThan(0);

    // The sheet renders a link to the category page, as it always did.
    await navigateToHash(page, `character?${cid}`, '#character');
    const link = page.locator(`#character a[href="#simpletraits/ctdbs_holdings_specializations/${cid}/all"]`);
    await expect(link).toHaveCount(1);

    // What the gap used to prevent, and what the plan actually asks for: add
    // one through the real picker and see it render. The listing starts empty
    // for this character, so the delta is what proves the addition, not the
    // absolute count.
    await navigateToHash(page, `simpletraits/ctdbs_holdings_specializations/${cid}/all`, '#simpletraitcategory-all');
    const before = await page.locator('#simpletraitcategory-all li').count();

    const chosen = offered[0];
    await purchaseTrait(page, cid, 'ctdbs_holdings_specializations', chosen, { value: 1 });

    await navigateToHash(page, `simpletraits/ctdbs_holdings_specializations/${cid}/all`, '#simpletraitcategory-all');
    const after = await page.locator('#simpletraitcategory-all li').count();
    expect(after, 'the category listing after adding one').toBe(before + 1);
    await expect(page.locator('#simpletraitcategory-all')).toContainText(chosen);

    const stored = await readTraits(page, cid, 'ctdbs_holdings_specializations', 'Changeling');
    expect(stored.map((t) => t.name), 'the trait is persisted, not just rendered').toContain(chosen);
  });

  test('238 ctdbs_arts_affinities_links: Kith drives Art affinity, measured at the real change-page cost', async () => {
    const cid = state.xpCharacter.id;

    // Set Kith through the real post-creation text picker (not the wizard
    // route) - the same auto-grant mechanic fires either way (finding 5),
    // confirmed here through the actual UI rather than assumed from test
    // 218's creation-time measurement.
    const before = await readArtAffinities(page, cid);
    expect(before.kith).toBeNull();
    const picked = await pickSimpleText(page, cid, 'ctdbs_kiths', 'ctdbs_kith', XP_KITH, { duringCreation: false });
    expect(picked).toBe(XP_KITH);

    const affinityInfo = await readArtAffinities(page, cid);
    expect(affinityInfo.kith).toBe(XP_KITH);
    expect(affinityInfo.affinities.sort()).toEqual([...XP_KITH_ARTS].sort());

    const granted = await readTraits(page, cid, 'ctdbs_arts', 'Changeling');
    const grantedNames = granted.map((t) => t.name);
    for (const name of XP_KITH_ARTS) {
      expect(grantedNames, `Kith-granted "${name}"`).toContain(name);
    }
    const arboreal = granted.find((t) => t.name === XP_AFFINITY_UPGRADE_ART);
    expect(arboreal).toMatchObject({ value: 1, free_value: 1, cost: 0 });

    // Setting Kith spent no XP - the grant is free, exactly as at creation
    // time. The running total is what tests 235 and 236 already spent: the
    // fresh Art, plus the background that remediation R15 made cost real XP
    // instead of nothing.
    const spentBeforeKith = XP_FRESH_ART_COST + XP_BACKGROUND_COST;
    const afterGrant = await readSheetXp(page, cid);
    expect(afterGrant.spent, 'the Kith grant itself charged nothing').toBe(spentBeforeKith);
    expect(afterGrant.earned).toBe(30);

    // The affinity rate, read live off the change page rather than only from
    // `calculate_trait_cost` (file-level finding 7): upgrading the already-
    // granted (free) "Arboreal" from 1 to 2 charges only the affinity-table
    // increment (12-4=8), because Kith auto-grants every affinity Art it can,
    // there is no "buy a fresh affinity Art" scenario to measure instead.
    await openTraitChange(page, cid, 'ctdbs_arts', XP_AFFINITY_UPGRADE_ART);
    expect((await readTraitChangeView(page)).cost).toBe(0);
    await setTraitChangeSliders(page, { value: 2 });
    const affinityQuote = await readTraitChangeView(page);
    expect(affinityQuote.cost).toBe(AFFINITY_ART_COST_LEVEL_2 - AFFINITY_ART_COST_LEVEL_1);
    await saveTraitChange(page, cid, 'ctdbs_arts');

    const afterUpgrade = await readSheetXp(page, cid);
    expect(afterUpgrade.spent - afterGrant.spent).toBe(AFFINITY_ART_COST_LEVEL_2 - AFFINITY_ART_COST_LEVEL_1);
    const upgraded = (await readTraits(page, cid, 'ctdbs_arts', 'Changeling')).find((t) => t.name === XP_AFFINITY_UPGRADE_ART);
    // The stored `cost` on a trait is `get_trait_cost_on_table`'s own output -
    // the cumulative table value at `value` *minus* the cumulative table
    // value at `free_value` - so for a trait with free_value=1 this is
    // already the increment (8), not the raw table value at 2 (12). Confirmed
    // live; matches the quoted/spent increment exactly, as it must.
    expect(upgraded).toMatchObject({ value: 2, free_value: 1, cost: AFFINITY_ART_COST_LEVEL_2 - AFFINITY_ART_COST_LEVEL_1 });

    // Same-shape, same-moment contrast: `XP_FRESH_ART_NAME` ("Skullduggery",
    // bought non-affinity in test 235 at value 1) quoted for the identical
    // 1->2 upgrade, then abandoned - mirroring Vampire test 186's "quoted but
    // never saved" pattern. A fresh-vs-increment comparison would understate
    // the affinity discount (a fresh non-affinity value-1 buy is only 6,
    // numerically *less* than the affinity increment of 8, even though the
    // affinity *rate* is cheaper per level) - see this test's inline note
    // above finding 7 - so both sides here are the same shape: the 1->2
    // increment, one at the affinity rate, one not.
    await openTraitChange(page, cid, 'ctdbs_arts', XP_FRESH_ART_NAME);
    expect((await readTraitChangeView(page)).cost).toBe(0);
    await setTraitChangeSliders(page, { value: 2 });
    const nonAffinityQuote = await readTraitChangeView(page);
    expect(nonAffinityQuote.cost).toBe(NON_AFFINITY_ART_COST_LEVEL_2 - NON_AFFINITY_ART_COST_LEVEL_1);
    expect(nonAffinityQuote.cost).toBeGreaterThan(affinityQuote.cost);
    // Abandoned: navigate away without saving. Test 240 depends on
    // `XP_FRESH_ART_NAME` still being owned at value 1, not 2.
    await navigateToHash(page, `character?${cid}`, '#character');
    const skullduggery = (await readTraits(page, cid, 'ctdbs_arts', 'Changeling')).find((t) => t.name === XP_FRESH_ART_NAME);
    expect(skullduggery).toMatchObject({ value: 1, cost: XP_FRESH_ART_COST });

    // GAP (file-level finding 8, confirmed live): the literal category the
    // plan names, `ctdbs_arts_affinities_links`, has zero seed Descriptions,
    // so nothing can ever be *added* to it through the UI, even though it is
    // real enough to render its own (permanently empty) sheet link and feeds
    // into `get_arts_affinities()` alongside the Kith-derived list above.
    await navigateToHash(page, `simpletraits/ctdbs_arts_affinities_links/${cid}/new`, '#simpletrait-new');
    const linkOptions = await page.locator('#simpletrait-new a.simpletrait').count();
    // This category was empty until the catalogue was backfilled from
    // data/all_greensboro_descriptions_20260816.csv; extra affinity links can
    // now genuinely be added, matching the Werewolf equivalent which always
    // had rows.
    expect(linkOptions, 'the "add new" picker for ctdbs_arts_affinities_links').toBeGreaterThan(0);

    await navigateToHash(page, `character?${cid}`, '#character');
    const affinityLinkOnSheet = page.locator(`#character a[href="#simpletraits/ctdbs_arts_affinities_links/${cid}/all"]`);
    await expect(affinityLinkOnSheet).toHaveCount(1);
  });

  test.fail('239 Glamour renders a real value derived from Seeming; Banality does not exist anywhere', async () => {
    const cid = state.xpCharacter.id;

    // These pass: "Seeming" (bought in test 236) is real, per-character data,
    // and `character.seeming()` reads its value correctly even though the
    // purchase itself was free (test 236's defect).
    const seemingTrait = (await readTraits(page, cid, 'ctdbs_backgrounds', 'Changeling')).find((t) => t.name === XP_BACKGROUND_NAME);
    expect(seemingTrait).toMatchObject({ name: XP_BACKGROUND_NAME, value: XP_BACKGROUND_VALUE });
    // Through `runInApp` rather than a hand-rolled `window.require`, so this
    // reaches the models on either front end. The defensive `window.require ?
    // ... : null` this replaced returned null on any app without RequireJS,
    // which is an assertion that silently stops asserting.
    const seeming = await runInApp(page, ['app/models/ChangelingBetaSlice'], `
      return mods[0].get_character(arg.id, ['ctdbs_backgrounds']).then(function (c) {
        return { seeming: c.seeming(), hasSeeming: c.has_seeming() };
      });
    `, { id: cid });
    expect(seeming).toEqual({ seeming: XP_BACKGROUND_VALUE, hasSeeming: true });

    // Also passes: "Seeming" is listed on the live sheet under Backgrounds,
    // with its real value - this is the on-sheet representation of what
    // drives Glamour, since Glamour itself (finding 11) never renders on the
    // live sheet, only on print.
    await navigateToHash(page, `character?${cid}`, '#character');
    const liveSheetText = normalize(await page.locator('#character').textContent());
    expect(liveSheetText).not.toMatch(/glamour/i);
    await navigateToHash(page, `simpletraits/ctdbs_backgrounds/${cid}/all`, '#simpletraitcategory-all');
    expect(normalize(await page.locator('#simpletraitcategory-all').textContent())).toContain(`${XP_BACKGROUND_NAME} x${XP_BACKGROUND_VALUE}`);

    // Also passes: the print sheet's Glamour block (`templates/print/
    // glamour.html`, file-level finding 11) renders exactly
    // `bptLookup[3] = 12` empty boxes and the number "12", derived from the
    // real Seeming value above - not a hardcoded constant the way Werewolf's
    // print-only "Rage" box is.
    await navigateToHash(page, `character/${cid}/print`, '#printable-sheet');
    const printText = normalize(await page.locator('#printable-sheet').textContent());
    expect(printText).toContain(String(XP_GLAMOUR_BOXES));
    const glamourHeading = page.locator('#printable-sheet h4', { hasText: 'Glamour' });
    await expect(glamourHeading).toHaveCount(1);
    const glamourBoxes = await glamourHeading.locator(
      'xpath=following-sibling::i[contains(@class, "fa-square-o")]'
    ).count();
    expect(glamourBoxes).toBe(XP_GLAMOUR_BOXES);

    // GAP (file-level finding 11, confirmed live at every layer): "banality"
    // appears in no model field, category, template, or print view anywhere
    // in the repository - the same "no UI path anywhere" shape as Werewolf's
    // Renown gap.
    expect(liveSheetText).not.toMatch(/banality/i);
    expect(printText).not.toMatch(/banality/i);

    // The plan's actual expectation for Banality - fails, because there is no
    // Banality value anywhere on this character to read.
    expect(printText, 'neither sheet has a Banality value to read').toMatch(/banality/i);
  });

  test('240 The Changeling printable sheet renders the Arts and Kith sections with real values', async () => {
    const cid = state.xpCharacter.id;

    await navigateToHash(page, `character/${cid}/print`, '#printable-sheet');
    const printText = normalize(await page.locator('#printable-sheet').textContent());

    // Kith section: driven by the real `TextBarView` fields
    // (`CharacterPrintView.js`), so what test 238 actually set is exactly
    // what prints.
    expect(printText).toContain(XP_KITH);
    const affinityInfo = await readArtAffinities(page, cid);
    expect(affinityInfo.kith).toBe(XP_KITH);

    // Arts section: driven by the real `ctdbs_arts` trait list
    // (`CharacterPrintView.js`'s `bottom_one_b` `SectionsView`), so what
    // tests 235/238 actually bought and were granted is exactly what prints -
    // real values, not placeholders.
    expect(printText).toContain(`${XP_FRESH_ART_NAME} x1`);
    expect(printText).toContain(`${XP_AFFINITY_UPGRADE_ART} x2`);
    for (const name of XP_KITH_ARTS) {
      if (name === XP_AFFINITY_UPGRADE_ART) continue;
      expect(printText).toContain(`${name} x1`);
    }

    // Cross-check against the live trait list, so this test is measuring the
    // print view's fidelity to real data, not merely that some text appears.
    const arts = await readTraits(page, cid, 'ctdbs_arts', 'Changeling');
    const byName = Object.fromEntries(arts.map((t) => [t.name, t.value]));
    expect(byName[XP_FRESH_ART_NAME]).toBe(1);
    expect(byName[XP_AFFINITY_UPGRADE_ART]).toBe(2);
  });
});
