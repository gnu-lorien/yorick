/**
 * Task 8b - Werewolf Creation In The UI (Karma parity)
 *
 * Covers testing_implementation_plan.md items 190-215, driven entirely through
 * the real Marionette creation wizard and the real post-creation trait editor.
 * Mirrors `default-test.js`'s Werewolf creation coverage and
 * `creature-types-test.js`'s "Werewolf Specific Capabilities" describe block -
 * the latter is explicitly named in the plan's section 0.3 ("Karma coverage
 * with no UI counterpart"), which matters for tests 212/213 below.
 *
 * This is a translation of `creation-vampire.spec.js` (Task 8a), which proved
 * the pattern: one **wizard** character built up test by test through the real
 * wizard (190-208), and one **xp** character completed with `spendPools: false`
 * that carries the post-creation purchase tests (209-215), for the same reason
 * Task 8a's did - the three creation Gift slots would otherwise burn through
 * the character's own affinity Gifts, leaving nothing clean for 209/210 to
 * measure a fresh affinity-vs-non-affinity comparison against.
 *
 * `wta_monikers` is out of scope per the plan's "Dropped coverage" section (no
 * source data anywhere in the repo) and per this task's own brief - there is
 * no moniker test here, deliberately.
 *
 * ---
 *
 * ## Findings confirmed live against this server before any test below was written
 *
 * **1. `wta_merits`/`wta_flaws` are costed exactly like Vampire's `merits`/
 * `flaws` - confirmed, not assumed.** `BNSWTAV1_WerewolfCosts.calculate_
 * trait_cost` (helpers/BNSWTAV1_WerewolfCosts.js) contains the identical
 * pair of branches Vampire's cost engine has - `if ("wta_merits" == category)
 * { return mod_value; }` and `if ("wta_flaws" == category) { return mod_value
 * * -1; }` - keyed on the Werewolf-specific category strings, not shared code
 * that happens to also fire for Vampire. Measured live on a fresh Werewolf:
 * picking `Ambidextrous` (value 2) moves Spent 0 -> 2 and Available 30 -> 28;
 * picking `Impatient` (value 2, a *different* Description row than Vampire's
 * same-named flaw - distinct category, distinct row) moves Spent 0 -> -2 and
 * Available 30 -> 32. `wta_merits_0_remaining` / `wta_flaws_0_remaining` are
 * the 7-point *cap*, exactly as they are for Vampire, not a separate currency.
 * Tests 204 and 207 assert this measured arithmetic rather than the plan's
 * "XP is unchanged" wording, for the same reason Task 8a's 178/181 did.
 *
 * **2. DEFECT - changing a creation-picked `wta_merit`'s value does not
 * update the merit pool (test 205).** Same root cause as Vampire's test 179,
 * confirmed live: `SimpleTraitChangeView.js` is one shared file, not
 * per-venue, and its `save_clicked` persists via `character.update_trait(
 * self.simpletrait)` - one argument, so `free_value` is `undefined` inside
 * `update_creation_rules_for_changed_trait` (models/Werewolf.js), which
 * composes its key as `category + "_" + freeValue + "_remaining"`. The write
 * lands on `wta_merits_undefined_remaining` (carrying the right number, 4)
 * instead of `wta_merits_0_remaining` (which stays stale at 5). Pinned as a
 * defect, not merely observed, because the Karma equivalent passes `0`
 * explicitly at the model layer and correctly reaches 4.
 *
 * **3. DEFECT - the Backgrounds pool badge is wrong throughout the wizard,
 * even though the trait picks underneath it are entirely correct (tests 191,
 * 202).** `VampireCreation.remaining_picks(category)` (models/VampireCreation.
 * js) hardcodes a `tops` map keyed on Vampire's own bare category names -
 * `{skills: 4, disciplines: 2, backgrounds: 3, attributes: 7, merits: 0,
 * flaws: 0}` - with no entry for any `wta_*` or `ctdbs_*` category. For an
 * unlisted category it falls back to `start = tops[category] || 1`, so
 * `remaining_picks("wta_backgrounds")` only ever sums `wta_backgrounds_1_
 * remaining` (plus the nonexistent `_0_remaining`), completely ignoring the
 * 3-slot and 2-slot pools. Measured live: the badge reads "1" at the start
 * (true total is 3), stays frozen at "1" through the rating-3 and rating-2
 * picks, and only drops to "0" when the rating-1 pick lands - a player
 * watching the badge would see it do nothing for two of their three
 * background picks. By coincidence this bug is *silent* for every other
 * Werewolf pool this suite touches: `wta_gifts`'s only real slot is rating 1
 * (so `start=1` happens to be exactly right), and `wta_merits`/`wta_flaws`
 * are sum pools keyed at `_0_remaining` (which `_.range(1,-1,-1)` always
 * includes regardless of `start`). `wta_backgrounds` is the one category
 * where the map's Vampire-only keys actually produce a wrong number, so it is
 * the one pinned here.
 *
 * **4. DEFECT - `wta_rites` (and `wta_totem_bonus_traits`) purchases cost 0
 * XP unconditionally (test 211).** `calculate_trait_cost` has no case for
 * `"wta_rites"` - only `attributes`/`wta_gifts`/`wta_merits`/`wta_flaws`/
 * `wta_backgrounds`/`skills` are handled, plus an `experience_cost_type`
 * "flat"/"linear" override read off the trait's own Description. None of the
 * five seeded `wta_rites` Descriptions (`Caern`, `Mystic`, `Punishment`,
 * `Renown`, `Seasonal` - backfilled from `data/all_dev_descriptions.csv`,
 * which carries no cost columns for this category) sets that override. So
 * `calculate_trait_cost` returns `undefined`, the change page visibly renders
 * "Cost: NaN", and `Character.update_trait`'s own `if (!_.isFinite(spend)) {
 * spend = 0; }` guard (models/Character.js) silently converts that NaN to a
 * real, committed 0 before deciding whether to write an experience notation
 * at all. The Rite is still bought and still renders on the sheet - the
 * plan's "renders on the sheet" clause holds - it is simply always free,
 * which contradicts "deducts XP". The identical gap affects `wta_totem_bonus_
 * traits` (test 214), but that test's plan wording never claims a cost, so it
 * is not flagged there.
 *
 * **5. GAP - Renown (Glory, Honor, Wisdom) has no UI path anywhere (test
 * 212).** Confirmed at every layer a path could exist: `Werewolf.
 * ALL_SIMPLETRAIT_CATEGORIES` (models/Werewolf.js) has no "glory"/"honor"/
 * "wisdom" entry, so the generic sheet template - which renders one category
 * link per entry in that list, nothing more - can never produce one. No
 * Description row seeds those categories anywhere in the repository (neither
 * `database_seed/Description.json` nor `data/all_dev_descriptions.csv`
 * contains a single row in a "glory"/"honor"/"wisdom" category), so even a
 * hand-typed `#simpletraits/glory/:cid/new` would offer nothing to pick.
 * Neither the live sheet nor the printable sheet (test 215) render those
 * words anywhere. This is exactly the "Karma coverage with no UI
 * counterpart" the plan's own section 0.3 names for `creature-types-test.js`
 * - its "supports Renown pools (Glory, Honor, Wisdom) and Rites" spec calls
 * `werewolf.update_trait("Glory", 2, "glory", 0, false)` directly at the
 * model layer, bypassing the picker (and the Description lookup it would
 * need) entirely. Renown never got a wizard step or a sheet section to go
 * with it.
 *
 * **6. GAP - "Rage" is a hardcoded print-sheet constant, not per-character
 * data (test 213).** The only place the word "Rage" appears anywhere in this
 * application is `CharacterPrintView.js`'s print-only region, which renders a
 * generic `TotalView` with a literal `{ name: "Rage", total: 10, split: 7 }` -
 * the same ten empty boxes for every Werewolf ever created, gated only on
 * `wta_tribe != "Ananasi"`, never read from any trait the character owns.
 * There is no "value" here for the plan's "renders ... with correct values"
 * to be correct or incorrect about, and it does not appear on the live sheet
 * at all. Gnosis, by contrast, is real: `Werewolf.create` auto-adds a
 * "Gnosis" trait (value 10, free_value 6, in `wta_gnosis_sources`, which *is*
 * in `ALL_SIMPLETRAIT_CATEGORIES` under the "Expended" heading), so every
 * Werewolf's sheet carries a genuine, working Gnosis link from creation.
 *
 * **7. Gift affinity cost - the Werewolf analogue of in-clan/out-of-clan
 * (tests 209, 210).** `calculate_trait_cost`'s `"wta_gifts"` branch charges
 * `mod_value * 4` when `gift_is_affinity(character, trait)` is true and
 * `mod_value * 6` otherwise. `gift_is_affinity` intersects `character.
 * get_affinities()` - `[wta_tribe, wta_auspice, wta_breed]` plus any `extra_
 * affinity_links` names, filtered of `undefined` - against the Gift's own
 * `affinity_1`/`affinity_2`/`affinity_3` Description columns. Measured live
 * on a Lupus/Theurge/Silver Fangs character: `Falcon's Grasp` (affinity_1
 * "Silver Fangs") costs 4 at value 1; `Delirium of Voluptha` (affinity_1
 * "Black Furies", no overlap) costs 6 at value 1.
 *
 * **8. The post-creation "Add New Gift" picker defaults to affinity-only,
 * silently, and only for `wta_gifts`.** `SimpleTraitNewView.js`'s `GiftsForm`
 * initialises `gift_filter_options` to `{"affinities": "mine", "ladder":
 * true, ...}`, and its `templateHelpers` re-filters the already-fetched list
 * down to `get_affinity_items()` whenever `affinities == "mine"` - the
 * default. A non-affinity Gift is therefore not merely de-prioritised, it is
 * not rendered at all, so a test (or a player) searching the page for one by
 * name finds nothing until the "Show by Affinity" control is switched to
 * "Any". No other category renders this control - it is added by `if
 * (category == "wta_gifts")` in `SimpleTraitNewView.js`'s `LayoutView.
 * register` - so `openNewTraitChange` in `characters.js` now switches it to
 * "Any" whenever present, which is a no-op everywhere else including every
 * Vampire discipline purchase in `creation-vampire.spec.js` (re-verified by
 * re-running that suite after the change - see the report for this task).
 *
 * **9. `characters.js` fix - picking two categories back to back can read a
 * stale page.** `pickSimpleText`/`pickCreationTrait`/`unpickCreationTrait`
 * (and the two internal helpers `spendAllCreationPools` drives) previously
 * waited only for the jQuery Mobile loader to hide after a pick, which is not
 * sufficient: the pick's own redirect (typically to `#charactercreate/:cid`)
 * triggers a *second*, independent async route handler with its own loading
 * cycle, and the brief gap between the first handler's loader hiding and the
 * second one's loader showing is a window `waitForJqmLoader` alone can
 * observe as "done". Reproduced live on a fresh Werewolf: picking Breed then
 * immediately Auspice (no intervening read) rendered the Auspice picker with
 * the *stale Breed options* ("Homid, Lupus, Metis") until a proper wait for
 * the redirect's destination page was added. This is not hypothetical for
 * this suite - `createCompletedCharacter`'s `texts` loop fires exactly this
 * sequence for the xp character below (three text attributes back to back),
 * and failed outright before the fix. Vampire's suite never hit it because
 * its own `createCompletedCharacter` call only ever sets one text attribute
 * (`clan`). Fixed via a shared `settleAfterRedirect` wait; re-verified against
 * both suites (see the report for this task).
 *
 * **10. Deviation - the New Character form lands on the sheet, not the
 * wizard, same as Vampire (test 190).** Identical mechanism to Vampire's
 * finding 4: `redirectSave` defaults to `#character?<id>`, so the sheet is
 * where the form lands; the sheet's `is_being_created()` branch renders the
 * single `#charactercreate/<id>` link onward to the wizard. Unlike Vampire,
 * Werewolf's `Model.create` *does* set `type: "Werewolf"` on the row (only
 * Vampire carries no `type` attribute at all), so test 190 asserts that
 * value directly instead of asserting its absence.
 *
 * **11. Text attribute category naming is uniform.** For every one of
 * Werewolf's eight text attributes (`archetype`, `archetype_2`, `wta_breed`,
 * `wta_auspice`, `wta_tribe`, `wta_camp`, `wta_faction`, `antecedence`), the
 * Description category the picker queries is simply the attribute name plus
 * "s" (`archetypes`, `archetype_2s`, `wta_breeds`, ...) - confirmed against
 * every row in `data/all_dev_descriptions.csv`, including the slightly
 * unusual `archetype_2s`. `createCompletedCharacter`'s generic `target + 's'`
 * loop therefore needs no Werewolf-specific handling.
 *
 * **12. Observation - the completed sheet labels text attributes with the
 * raw field name, not the pretty name (test 208).** The wizard
 * (`templates/create/simpletexts.html`) labels each field via `all_text_
 * attributes_pretty_names()`, but the completed sheet's "Information" block
 * is one shared inline template (`script#characterView` in index.html, used
 * by every venue) that instead capitalises the *raw* attribute name
 * (`st[0].toUpperCase() + st.substr(1)`). Invisible for Vampire, whose raw
 * names already read like the pretty ones (`clan` -> "Clan"); for Werewolf it
 * prints "Wta_breed" / "Wta_auspice" rather than "Breed" / "Auspice".
 * Confirmed live. The underlying data is correct either way - only the label
 * is ugly - so test 208 asserts the real (raw-labelled) keys rather than
 * treating this as a defect worth a `test.fail()`.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { navigateToHash, waitForActivePage, activePageId, normalize } = require('./helpers/jqm-helpers');
const {
  createCompletedCharacter,
  openCreation,
  readCreationState,
  readCreation,
  readTraits,
  readCharacterTexts,
  readAffinities,
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
const FIXTURE_PREFIX = 'E2E T8b ';

/**
 * The wizard character's Breed/Auspice, kept set for its whole life so test
 * 203's Gift affinity filter has something to work from. Tribe is
 * deliberately picked, repicked, and then unpicked (194-196, mirroring
 * Vampire's Clan at 158-160) and never repicked, so the Gift affinity filter
 * in test 203 is working from two affinities, not three.
 */
const WIZARD_BREED = 'Homid';
const WIZARD_AUSPICE = 'Ahroun';
const WIZARD_TRIBE = 'Get of Fenris';
const WIZARD_TRIBE_REPICK = 'Black Furies';

/** Gifts affinity-matched to Breed=Homid/Auspice=Ahroun, offered once both are set. */
const WIZARD_GIFT_PICKS = ['Razor Claws', 'Persuasion', 'Fight or Flight'];

/**
 * The xp character's Breed/Auspice/Tribe, all three set from creation via
 * `createCompletedCharacter`'s generic `texts` loop, giving `get_affinities()`
 * three affinities to test 209/210 against a genuinely full affinity set.
 */
const XP_BREED = 'Lupus';
const XP_AUSPICE = 'Theurge';
const XP_TRIBE = 'Silver Fangs';

/**
 * Skills picked at creation, one list per pool rating (4x1, 3x2, 2x3, 1x4).
 * The `skills` category is shared with Vampire - same Description rows, same
 * `requires_specialization` exclusions - so this is the identical list Task
 * 8a used: `Performance`, `Crafts` and `Science` all carry that requirement
 * and are avoided.
 */
const SKILL_PICKS = {
  4: ['Athletics'],
  3: ['Brawl', 'Dodge'],
  2: ['Melee', 'Stealth', 'Subterfuge'],
  1: ['Academics', 'Awareness', 'Computer', 'Empathy']
};

/**
 * Backgrounds picked at creation. `Kinfolk` carries `requires_specialization`
 * (the `wta_backgrounds` analogue of Vampire's `Retainers`) and `Rank` is
 * skipped because owning it changes `character.rank()`, which the skill cost
 * table (`BNSWTAV1_WerewolfCosts`) branches on - the same reason Task 8a
 * avoided Vampire's `Generation` background.
 */
const BACKGROUND_PICKS = { 3: 'Allies', 2: 'Contacts', 1: 'Ancestors' };

/** A merit with no tribe restriction and no `requires_specialization`, value exactly 2. */
const MERIT_NAME = 'Ambidextrous';
const MERIT_VALUE = 2;
/** A flaw whose Description value is 2, so the flaw pool moves by a checkable amount. */
const FLAW_NAME = 'Impatient';
const FLAW_VALUE = 2;

/** The full merit and flaw creation budgets, per `ensure_creation_rules_exist`. */
const SUM_POOL_BUDGET = 7;

/** A level-1 Gift whose `affinity_1` is the xp character's own Tribe (Silver Fangs). */
const AFFINITY_GIFT_NAME = "Falcon's Grasp";
/** A second, distinct level-1 affinity Gift (`affinity_2` is Lupus, the xp character's Breed). */
const AFFINITY_GIFT_NAME_2 = 'Call of the Wyld';
/** A level-1 Gift affinity-matched to Black Furies, which the xp character is not any part of. */
const NON_AFFINITY_GIFT_NAME = 'Delirium of Voluptha';
/** Per `calculate_trait_cost`'s `"wta_gifts"` branch: `mod_value * 4` (affinity) or `* 6` (not). */
const AFFINITY_GIFT_COST_PER_LEVEL = 4;
const NON_AFFINITY_GIFT_COST_PER_LEVEL = 6;

/** A seeded `wta_rites` Description with no cost data - see file-level finding 4. */
const RITE_NAME = 'Seasonal';
/** A seeded `wta_totem_bonus_traits` Description, for test 214. */
const TOTEM_BONUS_NAME = 'Pack Link';

const BASELINE_XP = { earned: 30, spent: 0, available: 30 };

test.describe.configure({ mode: 'serial' });

test.describe('Task 8b - Werewolf Creation In The UI', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  const state = {
    /** XP readings taken after each slot-pool step; test 208 asserts over all of them. */
    xpSamples: []
  };

  /** Record an XP reading for test 208's invariant. */
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
    console.log('[e2e creation-werewolf] self-heal swept:', JSON.stringify(swept));
    console.log('[e2e creation-werewolf] baseline Vampire row counts:', JSON.stringify(state.baseline));

    // The post-creation purchase character (tests 209-215). Its creation
    // pools are left unspent for the same reason Vampire's xp character's
    // were: the three creation Gift slots would otherwise consume real
    // affinity Gifts, leaving nothing clean for 209/210 to buy. All three of
    // Breed/Auspice/Tribe are set here so `get_affinities()` has a full set.
    state.xpCharacter = await createCompletedCharacter(page, 'Werewolf', {
      name: `${FIXTURE_PREFIX}XP ${Date.now().toString(36)}`,
      texts: { wta_breed: XP_BREED, wta_auspice: XP_AUSPICE, wta_tribe: XP_TRIBE },
      spendPools: false
    });
    expect(state.xpCharacter.xp).toEqual(BASELINE_XP);
  });

  test.afterAll(async () => {
    if (!page) return;

    const destroyed = await destroyCharactersByPrefix(page, FIXTURE_PREFIX)
      .catch((e) => ({ characters: 0, children: 0, errors: [String(e)] }));
    console.log('[e2e creation-werewolf] destroyed in teardown:', JSON.stringify(destroyed));

    const final = {
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX).catch(() => -1)
    };
    console.log(
      '[e2e creation-werewolf] final Vampire row counts (should equal baseline ' +
      JSON.stringify(state.baseline) + '):', JSON.stringify(final)
    );

    await page.close();
  });

  // -------------------------------------------------------------------------
  // 190-191 - the wizard character exists and starts from a known state
  // -------------------------------------------------------------------------

  test('190 New character form creates a Werewolf and lands on the creation wizard', async () => {
    // DEVIATION from the plan's wording (file-level finding 10): the form
    // lands on `#character?<id>`, not `#charactercreate/<id>`, same as
    // Vampire. Both hops are asserted exactly.
    const name = `${FIXTURE_PREFIX}Wizard ${Date.now().toString(36)}`;
    state.wizardName = name;

    await navigateToHash(page, 'characternew', '#character-new');
    await page.locator('#character-new input[name="name"]').fill(name);
    await page.locator('#character-new select[name="type"]').selectOption('Werewolf');
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

    // Unlike Vampire, Werewolf's `Model.create` sets `type: "Werewolf"`.
    const created = await page.evaluate((id) => {
      const q = new window.Parse.Query('Vampire');
      return q.get(id).then((c) => ({ id: c.id, name: c.get('name'), type: c.get('type') || null }));
    }, cid);
    expect(created.name).toBe(name);
    expect(created.type).toBe('Werewolf');

    const wizardLinks = page.locator(`#character a[href^="#charactercreate/"]`);
    await expect(wizardLinks).toHaveCount(1);
    expect(await wizardLinks.first().getAttribute('href')).toBe(`#charactercreate/${cid}`);

    await wizardLinks.first().click();
    await page.waitForFunction((h) => window.location.hash === h, `#charactercreate/${cid}`, { timeout: 30000 });
    await waitForActivePage(page, 'character-create');
    expect(await activePageId(page)).toBe('character-create');
  });

  test('191 The creation page renders the Gifts region in place of Disciplines, with an initial 30 XP', async () => {
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
    expect(byId['ccv-simpletext']).toContain('Pick Breed');
    expect(byId['ccv-simpletext']).toContain('Pick Auspice');
    expect(byId['ccv-simpletext']).toContain('Pick Tribe');
    expect(byId['ccv-next-one']).toContain('Attributes');
    expect(byId['ccv-next-two']).toContain('Physical Focus');
    expect(byId['ccv-next-two']).toContain('Social Focus');
    expect(byId['ccv-next-two']).toContain('Mental Focus');
    expect(byId['ccv-next-three']).toContain('Skills');
    expect(byId['ccv-next-four']).toContain('Backgrounds');
    // Werewolf-specific: the fifth region is Gifts, where a Vampire gets
    // Disciplines and a Changeling gets Arts.
    expect(byId['ccv-next-five']).toContain('Gifts');
    expect(byId['ccv-next-five']).not.toContain('Disciplines');
    expect(byId['ccv-next-five']).not.toContain('Arts');
    expect(byId['ccv-next-six']).toContain('Merits');
    expect(byId['ccv-next-seven']).toContain('Flaws');
    expect(byId['ccv-next-eight']).toBe('Complete Character Creation!');

    const description = normalize(await page.locator('#ccv-description').textContent());
    expect(description).toContain('You have 30 initial XP to spend');
    expect(description).toContain(`Remaining steps for ${state.wizardName}`);

    const creation = await readCreation(page, state.wizardId, 'Werewolf');
    expect(creation.initial_xp).toBe(30);
    expect(creation.completed).toBe(false);
    expect(await sampleXp('191 wizard start')).toEqual(BASELINE_XP);

    // The pool badges the rest of this suite reads, at their documented start
    // values - with one deliberate exception. DEFECT (file-level finding 3,
    // confirmed live): `Backgrounds` reads 1, not the true 3, because
    // `VampireCreation.remaining_picks()`'s hardcoded `tops` map has no entry
    // for "wta_backgrounds" and falls back to summing only the rating-1 slot.
    // The real per-rating counters underneath are correct, as test 202
    // proves - pinned here as the wrong number the badge actually shows,
    // not the "3" a human would expect.
    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.pools).toEqual({
      Attributes: 3,
      'Physical Focus': 1,
      'Social Focus': 1,
      'Mental Focus': 1,
      Skills: 10,
      Backgrounds: 1,
      Gifts: 3,
      Merits: SUM_POOL_BUDGET,
      Flaws: SUM_POOL_BUDGET
    });
  });

  // -------------------------------------------------------------------------
  // 192-197 - text attributes
  // -------------------------------------------------------------------------

  test('192 Pick Breed; the value renders', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'wta_breeds', 'wta_breed');
    expect([...options].sort()).toEqual(['Homid', 'Lupus', 'Metis']);

    const picked = await pickSimpleText(page, state.wizardId, 'wta_breeds', 'wta_breed', WIZARD_BREED);
    expect(picked).toBe(WIZARD_BREED);

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Breed).toBe(WIZARD_BREED);
    expect((await readCharacterTexts(page, state.wizardId, 'Werewolf')).wta_breed).toBe(WIZARD_BREED);
  });

  test('193 Pick Auspice; the value renders', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'wta_auspices', 'wta_auspice');
    expect([...options].sort()).toEqual(['Ahroun', 'Galliard', 'Philodox', 'Ragabash', 'Theurge']);

    const picked = await pickSimpleText(page, state.wizardId, 'wta_auspices', 'wta_auspice', WIZARD_AUSPICE);
    expect(picked).toBe(WIZARD_AUSPICE);

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Auspice).toBe(WIZARD_AUSPICE);
    expect((await readCharacterTexts(page, state.wizardId, 'Werewolf')).wta_auspice).toBe(WIZARD_AUSPICE);

    // Breed from test 192 is still set - text picks do not clobber each other.
    expect((await readCharacterTexts(page, state.wizardId, 'Werewolf')).wta_breed).toBe(WIZARD_BREED);
  });

  test('194 Pick Tribe; the value renders', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'wta_tribes', 'wta_tribe');
    expect(options).toContain(WIZARD_TRIBE);
    expect(options).toContain(WIZARD_TRIBE_REPICK);

    const picked = await pickSimpleText(page, state.wizardId, 'wta_tribes', 'wta_tribe', WIZARD_TRIBE);
    expect(picked).toBe(WIZARD_TRIBE);

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Tribe).toBe(WIZARD_TRIBE);
    expect((await readCharacterTexts(page, state.wizardId, 'Werewolf')).wta_tribe).toBe(WIZARD_TRIBE);

    // The affordance flips from a lone "Pick" to the "Repick" + "Unpick" pair
    // once a value is set.
    const links = creationState.textPickLinks.filter((h) => h.indexOf('/wta_tribes/wta_tribe/') !== -1);
    expect([...links].sort()).toEqual([
      `#charactercreate/simpletext/wta_tribes/wta_tribe/${state.wizardId}/pick`,
      `#charactercreate/simpletext/wta_tribes/wta_tribe/${state.wizardId}/unpick`
    ].sort());
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Repick Tribe' })).toHaveCount(1);
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Unpick Tribe' })).toHaveCount(1);
    await expect(page.locator('#ccv-simpletext a').filter({ hasText: /^Pick Tribe$/ })).toHaveCount(0);
  });

  test('195 Repick Tribe; the new value replaces the prior one', async () => {
    expect((await readCharacterTexts(page, state.wizardId, 'Werewolf')).wta_tribe).toBe(WIZARD_TRIBE);

    const picked = await pickSimpleText(page, state.wizardId, 'wta_tribes', 'wta_tribe', WIZARD_TRIBE_REPICK);
    expect(picked).toBe(WIZARD_TRIBE_REPICK);

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Tribe).toBe(WIZARD_TRIBE_REPICK);
    // Replacement, not accumulation: exactly one Tribe divider, and the old
    // value is nowhere on the page.
    const tribeDividers = await page.locator('#ccv-simpletext li[data-role="list-divider"]')
      .filter({ hasText: 'Tribe' }).count();
    expect(tribeDividers).toBe(1);
    expect(normalize(await page.locator('#ccv-simpletext').textContent())).not.toContain(WIZARD_TRIBE);
    expect((await readCharacterTexts(page, state.wizardId, 'Werewolf')).wta_tribe).toBe(WIZARD_TRIBE_REPICK);
  });

  test('196 Unpick Tribe; the value is cleared', async () => {
    await unpickSimpleText(page, state.wizardId, 'wta_tribes', 'wta_tribe');

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Tribe).toBeUndefined();
    expect((await readCharacterTexts(page, state.wizardId, 'Werewolf')).wta_tribe).toBeNull();
    // The creation record's own per-target flag is cleared too (`unpick_text`
    // sets `creation.set(target, false)`).
    expect((await readCreation(page, state.wizardId, 'Werewolf')).wta_tribe).toBe(false);

    await expect(page.locator('#ccv-simpletext a').filter({ hasText: /^Pick Tribe$/ })).toHaveCount(1);
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Repick Tribe' })).toHaveCount(0);
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Unpick Tribe' })).toHaveCount(0);

    // Tribe stays unpicked for the rest of the wizard's life - test 203's
    // Gift affinity filter runs off Breed/Auspice alone, and completion
    // (test 208) never requires it (`complete_character_creation` has no
    // validation at all).
  });

  test('197 Pick Camp, Faction, Archetype, Second Archetype, and Antecedence; all render', async () => {
    const campOptions = await listSimpleTextOptions(page, state.wizardId, 'wta_camps', 'wta_camp');
    expect(campOptions.length).toBeGreaterThan(0);
    const camp = await pickSimpleText(page, state.wizardId, 'wta_camps', 'wta_camp', campOptions[0]);
    expect(camp).toBe(campOptions[0]);
    expect((await readCreationState(page, state.wizardId)).texts.Camp).toBe(camp);

    const factionOptions = await listSimpleTextOptions(page, state.wizardId, 'wta_factions', 'wta_faction');
    expect(factionOptions.length).toBeGreaterThan(0);
    const faction = await pickSimpleText(page, state.wizardId, 'wta_factions', 'wta_faction', factionOptions[0]);
    expect(faction).toBe(factionOptions[0]);
    expect((await readCreationState(page, state.wizardId)).texts.Faction).toBe(faction);

    const archetypeOptions = await listSimpleTextOptions(page, state.wizardId, 'archetypes', 'archetype');
    expect(archetypeOptions.length).toBeGreaterThan(0);
    const archetype = await pickSimpleText(page, state.wizardId, 'archetypes', 'archetype', archetypeOptions[0]);
    expect(archetype).toBe(archetypeOptions[0]);
    expect((await readCreationState(page, state.wizardId)).texts.Archetype).toBe(archetype);

    // A distinct Description category from plain "archetypes" (file-level
    // finding 11), even though the two catalogues share many names.
    const archetype2Options = await listSimpleTextOptions(page, state.wizardId, 'archetype_2s', 'archetype_2');
    expect(archetype2Options.length).toBeGreaterThan(0);
    const archetype2 = await pickSimpleText(page, state.wizardId, 'archetype_2s', 'archetype_2', archetype2Options[0]);
    expect(archetype2).toBe(archetype2Options[0]);
    expect((await readCreationState(page, state.wizardId)).texts['Second Archetype']).toBe(archetype2);

    const antecedenceOptions = await listSimpleTextOptions(page, state.wizardId, 'antecedences', 'antecedence');
    expect([...antecedenceOptions].sort()).toEqual(['NPC', 'Primary', 'Secondary']);
    const antecedence = await pickSimpleText(page, state.wizardId, 'antecedences', 'antecedence', 'Primary');
    expect(antecedence).toBe('Primary');
    // The wizard labels this divider with the model's pretty name, not the
    // attribute name (`TEXT_ATTRIBUTES_PRETTY_NAMES` in models/Werewolf.js).
    expect((await readCreationState(page, state.wizardId)).texts['Primary, Secondary, or NPC']).toBe('Primary');

    // Every text attribute except Tribe (unpicked by test 196) now carries a value.
    const texts = await readCharacterTexts(page, state.wizardId, 'Werewolf');
    expect(texts.wta_tribe).toBeNull();
    for (const key of ['wta_breed', 'wta_auspice', 'wta_camp', 'wta_faction', 'archetype', 'archetype_2', 'antecedence']) {
      expect(texts[key], `text attribute "${key}"`).toBeTruthy();
    }

    expect(await sampleXp('197 all text attributes picked')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 198-199 - attributes
  // -------------------------------------------------------------------------

  test('198 Attribute 7/5/3 allocation completes and all three pools reach 0', async () => {
    const before = await readCreation(page, state.wizardId, 'Werewolf');
    expect(before.attributes_7_remaining).toBe(1);
    expect(before.attributes_5_remaining).toBe(1);
    expect(before.attributes_3_remaining).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(3);

    const picked = await pickCreationTrait(page, state.wizardId, 'attributes', 7, 'Physical');
    expect(picked).toBe('Physical');
    let after = await readCreation(page, state.wizardId, 'Werewolf');
    expect(after.attributes_7_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(2);
    let traits = await readTraits(page, state.wizardId, 'attributes', 'Werewolf');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: 'Physical', value: 7, free_value: 7, cost: 0 });

    // Delete then Pick is the only repick path for slot pools (no one-step
    // "Repick" link renders for them), so unpicking and picking again
    // demonstrates the round trip before filling all three.
    await unpickCreationTrait(page, state.wizardId, 'attributes', 'Physical');
    after = await readCreation(page, state.wizardId, 'Werewolf');
    expect(after.attributes_7_remaining).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(3);
    expect(await readTraits(page, state.wizardId, 'attributes', 'Werewolf')).toHaveLength(0);

    await pickCreationTrait(page, state.wizardId, 'attributes', 7, 'Physical');
    await pickCreationTrait(page, state.wizardId, 'attributes', 5, 'Social');
    await pickCreationTrait(page, state.wizardId, 'attributes', 3, 'Mental');

    const creation = await readCreation(page, state.wizardId, 'Werewolf');
    expect(creation.attributes_7_remaining).toBe(0);
    expect(creation.attributes_5_remaining).toBe(0);
    expect(creation.attributes_3_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(0);

    traits = await readTraits(page, state.wizardId, 'attributes', 'Werewolf');
    const byName = Object.fromEntries(traits.map((t) => [t.name, t.value]));
    expect(byName).toEqual({ Physical: 7, Social: 5, Mental: 3 });
    expect(traits.every((t) => t.cost === 0)).toBe(true);

    expect(await sampleXp('198 attributes 7/5/3 spent')).toEqual(BASELINE_XP);
  });

  test('199 Attribute pool enforcement prevents a second 7-slot pick', async () => {
    // Every rating is exhausted by test 198, so checking "no pick links
    // remain" here alone would prove only that the *section* is closed, not
    // that the block is per-slot. Restoring just the 7 slot and re-checking
    // proves the finer claim: only the 7-rated affordance reappears, 5 and 3
    // stay exhausted.
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 7)).toBe(0);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 5)).toBe(0);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 3)).toBe(0);

    await unpickCreationTrait(page, state.wizardId, 'attributes', 'Physical');
    expect((await readCreation(page, state.wizardId, 'Werewolf')).attributes_7_remaining).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(1);

    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 7)).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 5)).toBe(0);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 3)).toBe(0);

    // Restore the full allocation test 198 left the wizard with, so later
    // tests (and completion) see attributes durably finished.
    await pickCreationTrait(page, state.wizardId, 'attributes', 7, 'Physical');
    const creation = await readCreation(page, state.wizardId, 'Werewolf');
    expect(creation.attributes_7_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(0);
    const traits = await readTraits(page, state.wizardId, 'attributes', 'Werewolf');
    expect(Object.fromEntries(traits.map((t) => [t.name, t.value]))).toEqual({ Physical: 7, Social: 5, Mental: 3 });
  });

  // -------------------------------------------------------------------------
  // 200 - focuses
  // -------------------------------------------------------------------------

  test('200 Focus pick, repick, and unpick behave correctly for all three focus categories', async () => {
    expect((await readCreation(page, state.wizardId, 'Werewolf')).focus_physicals_1_remaining).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'focus_physicals', 1)).toBe(1);

    const picked = await pickCreationTrait(page, state.wizardId, 'focus_physicals', 1, 'Dexterity');
    expect(picked).toBe('Dexterity');
    expect((await readCreation(page, state.wizardId, 'Werewolf')).focus_physicals_1_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(0);
    expect((await readTraits(page, state.wizardId, 'focus_physicals', 'Werewolf')).map((t) => t.name)).toEqual(['Dexterity']);

    // Repick (Dexterity -> Stamina): Delete then Pick, the pool passes
    // through 1 on its way back to 0 and the trait is replaced.
    await unpickCreationTrait(page, state.wizardId, 'focus_physicals', 'Dexterity');
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(1);
    await pickCreationTrait(page, state.wizardId, 'focus_physicals', 1, 'Stamina');
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(0);
    expect((await readCreation(page, state.wizardId, 'Werewolf')).focus_physicals_1_remaining).toBe(0);
    expect((await readTraits(page, state.wizardId, 'focus_physicals', 'Werewolf')).map((t) => t.name)).toEqual(['Stamina']);

    // Unpick: the pool is restored, nothing refilled yet.
    await unpickCreationTrait(page, state.wizardId, 'focus_physicals', 'Stamina');
    expect((await readCreation(page, state.wizardId, 'Werewolf')).focus_physicals_1_remaining).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'focus_physicals', 1)).toBe(1);
    expect(await readTraits(page, state.wizardId, 'focus_physicals', 'Werewolf')).toHaveLength(0);

    // Fill all three, leaving the wizard complete for the rest of the suite.
    await pickCreationTrait(page, state.wizardId, 'focus_physicals', 1, 'Dexterity');
    await pickCreationTrait(page, state.wizardId, 'focus_mentals', 1, 'Intelligence');
    await pickCreationTrait(page, state.wizardId, 'focus_socials', 1, 'Charisma');

    const creation = await readCreation(page, state.wizardId, 'Werewolf');
    expect(creation.focus_physicals_1_remaining).toBe(0);
    expect(creation.focus_mentals_1_remaining).toBe(0);
    expect(creation.focus_socials_1_remaining).toBe(0);

    const pools = (await readCreationState(page, state.wizardId)).pools;
    expect(pools['Physical Focus']).toBe(0);
    expect(pools['Mental Focus']).toBe(0);
    expect(pools['Social Focus']).toBe(0);

    expect((await readTraits(page, state.wizardId, 'focus_physicals', 'Werewolf')).map((t) => t.name)).toEqual(['Dexterity']);
    expect((await readTraits(page, state.wizardId, 'focus_mentals', 'Werewolf')).map((t) => t.name)).toEqual(['Intelligence']);
    expect((await readTraits(page, state.wizardId, 'focus_socials', 'Werewolf')).map((t) => t.name)).toEqual(['Charisma']);

    expect(await sampleXp('200 all three focuses spent')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 201-203 - skills, backgrounds, gifts
  // -------------------------------------------------------------------------

  test('201 Skill pools 4/3/2/1 each decrement correctly', async () => {
    const creation = await readCreation(page, state.wizardId, 'Werewolf');
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
        (await readCreation(page, state.wizardId, 'Werewolf'))[`skills_${rating}_remaining`],
        `skills_${rating}_remaining after filling that slot`
      ).toBe(0);
    }
    expect(expectedBadge).toBe(0);

    const traits = await readTraits(page, state.wizardId, 'skills', 'Werewolf');
    expect(traits).toHaveLength(10);
    const byName = Object.fromEntries(traits.map((t) => [t.name, t.value]));
    for (const rating of [4, 3, 2, 1]) {
      for (const skill of SKILL_PICKS[rating]) {
        expect(byName[skill], `${skill} rating`).toBe(rating);
      }
    }
    expect(traits.every((t) => t.cost === 0 && t.free_value === t.value)).toBe(true);

    expect(await sampleXp('201 all ten skills spent')).toEqual(BASELINE_XP);
  });

  test('202 wta_backgrounds pools 3/2/1 each decrement correctly', async () => {
    const before = await readCreation(page, state.wizardId, 'Werewolf');
    expect(before.wta_backgrounds_3_remaining).toBe(1);
    expect(before.wta_backgrounds_2_remaining).toBe(1);
    expect(before.wta_backgrounds_1_remaining).toBe(1);
    // DEFECT (file-level finding 3, confirmed live): the badge reads 1, not
    // the true 3 - see test 191's note. Pinned here as the number it actually
    // shows.
    expect((await readCreationState(page, state.wizardId)).pools.Backgrounds).toBe(1);

    const picked3 = await pickCreationTrait(page, state.wizardId, 'wta_backgrounds', 3, BACKGROUND_PICKS[3]);
    expect(picked3).toBe(BACKGROUND_PICKS[3]);
    expect((await readCreation(page, state.wizardId, 'Werewolf')).wta_backgrounds_3_remaining, 'the real counter').toBe(0);
    // The badge does not move: it was never reading the 3-slot pool at all.
    expect((await readCreationState(page, state.wizardId)).pools.Backgrounds, 'the badge, unmoved').toBe(1);

    const picked2 = await pickCreationTrait(page, state.wizardId, 'wta_backgrounds', 2, BACKGROUND_PICKS[2]);
    expect(picked2).toBe(BACKGROUND_PICKS[2]);
    expect((await readCreation(page, state.wizardId, 'Werewolf')).wta_backgrounds_2_remaining, 'the real counter').toBe(0);
    // Still unmoved, for the same reason.
    expect((await readCreationState(page, state.wizardId)).pools.Backgrounds, 'the badge, still unmoved').toBe(1);

    const picked1 = await pickCreationTrait(page, state.wizardId, 'wta_backgrounds', 1, BACKGROUND_PICKS[1]);
    expect(picked1).toBe(BACKGROUND_PICKS[1]);
    const after = await readCreation(page, state.wizardId, 'Werewolf');
    expect(after.wta_backgrounds_3_remaining).toBe(0);
    expect(after.wta_backgrounds_2_remaining).toBe(0);
    expect(after.wta_backgrounds_1_remaining).toBe(0);
    // Only now does the badge move - because the *1*-slot pool it actually
    // reads has itself reached 0, not because the other two are also spent.
    expect((await readCreationState(page, state.wizardId)).pools.Backgrounds, 'the badge, now that the 1-slot itself is spent').toBe(0);

    const traits = await readTraits(page, state.wizardId, 'wta_backgrounds', 'Werewolf');
    expect(Object.fromEntries(traits.map((t) => [t.name, t.value]))).toEqual({
      [BACKGROUND_PICKS[3]]: 3,
      [BACKGROUND_PICKS[2]]: 2,
      [BACKGROUND_PICKS[1]]: 1
    });
    expect(traits.every((t) => t.cost === 0 && t.free_value === t.value)).toBe(true);

    expect(await sampleXp('202 all three backgrounds spent')).toEqual(BASELINE_XP);
  });

  test('203 Pick a Gift using wta_gifts_1_remaining; the pool reaches 0', async () => {
    // Breed and Auspice are set (192, 193); Tribe was unpicked in test 196
    // and never repicked, so `charactercreatepicksimpletrait`'s ["affinity",
    // "show_only_value_1"] filter (mobileRouter.js) is working from two
    // affinities, not three - still enough level-1 Gifts to offer several.
    const options = await listCreationTraitOptions(page, state.wizardId, 'wta_gifts', 1);
    expect(options.length).toBeGreaterThan(0);
    for (const name of WIZARD_GIFT_PICKS) {
      expect(options, `"${name}" offered given Breed=${WIZARD_BREED}/Auspice=${WIZARD_AUSPICE}`).toContain(name);
    }

    const before = await readCreation(page, state.wizardId, 'Werewolf');
    expect(before.wta_gifts_1_remaining).toBe(3);
    expect((await readCreationState(page, state.wizardId)).pools.Gifts).toBe(3);

    let expectedBadge = 3;
    for (const name of WIZARD_GIFT_PICKS) {
      const picked = await pickCreationTrait(page, state.wizardId, 'wta_gifts', 1, name);
      expect(picked).toBe(name);
      expectedBadge -= 1;
      expect(
        (await readCreationState(page, state.wizardId)).pools.Gifts,
        `Gifts badge after picking ${name}`
      ).toBe(expectedBadge);
    }
    expect(expectedBadge).toBe(0);

    const after = await readCreation(page, state.wizardId, 'Werewolf');
    expect(after.wta_gifts_1_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Gifts).toBe(0);

    const traits = await readTraits(page, state.wizardId, 'wta_gifts', 'Werewolf');
    expect(traits.map((t) => t.name).sort()).toEqual([...WIZARD_GIFT_PICKS].sort());
    expect(traits.every((t) => t.cost === 0 && t.free_value === t.value)).toBe(true);

    expect(await sampleXp('203 all three gifts spent')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 204-207 - merits and flaws (the point-sum pools)
  // -------------------------------------------------------------------------

  test('204 Pick a wta_merit (Ambidextrous at 2); the merit pool sum drops by 2 and XP moves by the merit value', async () => {
    // PLAN-VS-APPLICATION CONFLICT, same one Task 8a found for Vampire merits
    // (file-level finding 1): the plan asks for "XP is unchanged"; the
    // application deliberately charges the merit's value against the
    // starting 30 XP, and `wta_merits_0_remaining` is a 7-point *cap*, not a
    // separate currency. Measured arithmetic is asserted instead.
    const xpBefore = await readSheetXp(page, state.wizardId);
    expect(xpBefore).toEqual(BASELINE_XP);
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET);
    expect((await readCreation(page, state.wizardId, 'Werewolf')).wta_merits_0_remaining).toBe(SUM_POOL_BUDGET);

    const picked = await pickCreationTrait(page, state.wizardId, 'wta_merits', 0, MERIT_NAME);
    expect(picked).toBe(MERIT_NAME);

    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET - MERIT_VALUE);
    expect((await readCreation(page, state.wizardId, 'Werewolf')).wta_merits_0_remaining).toBe(SUM_POOL_BUDGET - MERIT_VALUE);

    const traits = await readTraits(page, state.wizardId, 'wta_merits', 'Werewolf');
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

  test.fail('205 Change the picked wta_merit\'s value from 2 to 3; the pool sum updates', async () => {
    // DEFECT (file-level finding 2, confirmed live). `SimpleTraitChangeView.
    // js` is one shared file, not per-venue, so this is the identical bug
    // Task 8a found for Vampire: `save_clicked` persists via `character.
    // update_trait(self.simpletrait)` with no `free_value` argument, so
    // `update_creation_rules_for_changed_trait` (models/Werewolf.js) writes
    // `wta_merits_undefined_remaining` / `wta_merits_undefined_picks` instead
    // of `wta_merits_0_*`. The number is right (4), the key is wrong, and the
    // pool a player sees never moves.
    const newValue = MERIT_VALUE + 1;

    const label = await openTraitChange(page, state.wizardId, 'wta_merits', MERIT_NAME);
    expect(label).toBe(`${MERIT_NAME} x${MERIT_VALUE}`);

    const atCurrent = await readTraitChangeView(page);
    expect(atCurrent.text).toContain(`${MERIT_NAME} ${MERIT_VALUE}`);
    expect(atCurrent.cost).toBe(0);

    await setTraitChangeSliders(page, { value: newValue });
    const atNew = await readTraitChangeView(page);
    expect(atNew.text).toContain(`${MERIT_NAME} ${newValue}`);
    expect(atNew.cost).toBe(newValue - MERIT_VALUE);

    await saveTraitChange(page, state.wizardId, 'wta_merits');

    // These pass: the trait itself is updated and charged correctly.
    const traits = await readTraits(page, state.wizardId, 'wta_merits', 'Werewolf');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: MERIT_NAME, value: newValue, cost: newValue });
    expect(await readSheetXp(page, state.wizardId)).toEqual({ earned: 30, spent: newValue, available: 30 - newValue });

    // This is the defect: the pool the player is shown never moves.
    const creation = await readCreation(page, state.wizardId, 'Werewolf');
    const junkKeys = Object.keys(creation).filter((k) => k.indexOf('undefined') !== -1);
    expect(
      creation.wta_merits_0_remaining,
      `wta_merits_0_remaining should be ${SUM_POOL_BUDGET - newValue}; the write landed on ` +
      `${JSON.stringify(junkKeys.map((k) => [k, creation[k]]))} instead`
    ).toBe(SUM_POOL_BUDGET - newValue);
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET - newValue);
  });

  test('206 Unpick the wta_merit with the changed value; the pool sum is fully restored', async () => {
    // Test 205 leaves the merit at value 3 with its XP charged, which is
    // exactly the "merit with the changed value" this item wants unpicked.
    const traitsBefore = await readTraits(page, state.wizardId, 'wta_merits', 'Werewolf');
    expect(traitsBefore).toHaveLength(1);
    expect(traitsBefore[0].value).toBe(MERIT_VALUE + 1);
    expect((await readSheetXp(page, state.wizardId)).spent).toBe(MERIT_VALUE + 1);

    await unpickCreationTrait(page, state.wizardId, 'wta_merits', MERIT_NAME);

    // `unpick_from_creation` recomputes the sum pool from the remaining picks
    // (`7 - sum`) rather than incrementing it, so the stale counter left by
    // test 205 is corrected on the way out and the budget lands back on 7.
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET);
    const creation = await readCreation(page, state.wizardId, 'Werewolf');
    expect(creation.wta_merits_0_remaining).toBe(SUM_POOL_BUDGET);
    expect(creation.wta_merits_0_picks).toBe(0);
    expect(await readTraits(page, state.wizardId, 'wta_merits', 'Werewolf')).toHaveLength(0);

    // XP is refunded in full: `remove_trait` posts `-cost` as a spent alteration.
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);

    // Residue from the defect in test 205: the bogus key is never cleaned up.
    // It is inert (nothing reads it) but recorded here so a future fix can be
    // seen to remove it.
    expect(creation.wta_merits_undefined_remaining).toBe(SUM_POOL_BUDGET - (MERIT_VALUE + 1));
  });

  test('207 Pick a wta_flaw; the flaw pool sum updates', async () => {
    const xpBefore = await readSheetXp(page, state.wizardId);
    expect(xpBefore).toEqual(BASELINE_XP);
    expect((await readCreationState(page, state.wizardId)).pools.Flaws).toBe(SUM_POOL_BUDGET);

    const picked = await pickCreationTrait(page, state.wizardId, 'wta_flaws', 0, FLAW_NAME);
    expect(picked).toBe(FLAW_NAME);

    expect((await readCreationState(page, state.wizardId)).pools.Flaws).toBe(SUM_POOL_BUDGET - FLAW_VALUE);
    expect((await readCreation(page, state.wizardId, 'Werewolf')).wta_flaws_0_remaining).toBe(SUM_POOL_BUDGET - FLAW_VALUE);

    const traits = await readTraits(page, state.wizardId, 'wta_flaws', 'Werewolf');
    expect(traits).toHaveLength(1);
    // A flaw's cost is negative (`mod_value * -1`), so it refunds XP - the
    // mirror image of test 204's merit.
    expect(traits[0]).toMatchObject({ name: FLAW_NAME, value: FLAW_VALUE, free_value: 0, cost: -FLAW_VALUE });

    const xpAfter = await readSheetXp(page, state.wizardId);
    state.flawXpDelta = {
      spent: xpAfter.spent - xpBefore.spent,
      available: xpAfter.available - xpBefore.available
    };
    expect(state.flawXpDelta).toEqual({ spent: -FLAW_VALUE, available: FLAW_VALUE });

    // Restore, so test 208 sees the wizard's slot pools alone. The
    // restoration is asserted rather than assumed.
    await unpickCreationTrait(page, state.wizardId, 'wta_flaws', FLAW_NAME);
    expect((await readCreationState(page, state.wizardId)).pools.Flaws).toBe(SUM_POOL_BUDGET);
    expect(await readTraits(page, state.wizardId, 'wta_flaws', 'Werewolf')).toHaveLength(0);
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 208 - completion
  // -------------------------------------------------------------------------

  test('208 Complete Creation; the live sheet shows 30 available XP and 0 spent', async () => {
    // Across every *slot*-pool pick sampled through tests 191-203 (texts,
    // attributes, focuses, all ten skills, all three backgrounds, all three
    // gifts), Available never moved off 30 and Spent stayed 0. Merits/flaws
    // are the documented point-sum exception, measured in 204/207.
    expect(state.xpSamples.length).toBeGreaterThanOrEqual(7);
    for (const sample of state.xpSamples) {
      expect(sample.xp, `XP after "${sample.label}"`).toEqual(BASELINE_XP);
    }
    expect(state.meritXpDelta).toEqual({ spent: MERIT_VALUE, available: -MERIT_VALUE });
    expect(state.flawXpDelta).toEqual({ spent: -FLAW_VALUE, available: FLAW_VALUE });

    expect(await isCompleted(page, state.wizardId, 'Werewolf')).toBe(false);

    // Driven through the wizard's own "Complete Character Creation!" button.
    await openCreation(page, state.wizardId);
    const completeLink = page.locator(`#ccv-next-eight a[href="#charactercreate/complete/${state.wizardId}"]`);
    await expect(completeLink).toHaveCount(1);
    await completeLink.click();

    // The completion route assigns the hash from inside a `.done()` whose
    // return value is discarded, so the hash can move before the creation
    // record is written; wait for the persisted flag, then land on the sheet.
    await completeCreation(page, state.wizardId, 'Werewolf');

    expect(await isCompleted(page, state.wizardId, 'Werewolf')).toBe(true);
    expect((await readCreation(page, state.wizardId, 'Werewolf')).completed).toBe(true);
    expect(await activePageId(page)).toBe('character');

    // The sheet's `is_being_created()` branches have flipped: the wizard link
    // is gone and the Information block now renders the text attributes.
    await expect(page.locator('#character a[href^="#charactercreate/"]')).toHaveCount(0);
    // OBSERVATION, confirmed live: unlike the wizard (`templates/create/
    // simpletexts.html`, which labels each field with `all_text_attributes_
    // pretty_names()`), the completed sheet's "Information" block - one
    // shared inline template, `script#characterView` in index.html, used by
    // every venue - labels each field with the *raw* attribute name
    // capitalised (`st[0].toUpperCase() + st.substr(1)`), never the pretty
    // name. That is invisible for Vampire, whose raw names (`clan`,
    // `archetype`, ...) already read like the pretty ones, but for Werewolf
    // it prints literally "Wta_breed" / "Wta_auspice" instead of "Breed" /
    // "Auspice". The data underneath is entirely correct; only the label is
    // ugly, which is why this is recorded as an observation rather than
    // pinned as a defect the way the Backgrounds badge was.
    const sheetTexts = await readSheetTextAttributes(page, state.wizardId);
    expect(sheetTexts.Wta_breed).toBe(WIZARD_BREED);
    expect(sheetTexts.Wta_auspice).toBe(WIZARD_AUSPICE);
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
    for (const category of ['attributes', 'focus_physicals', 'focus_mentals', 'focus_socials', 'skills', 'wta_backgrounds', 'wta_gifts']) {
      const traits = await readTraits(page, state.wizardId, category, 'Werewolf');
      expect(traits.length, `${category} count`).toBeGreaterThan(0);
      expect(
        traits.every((t) => t.cost === 0 && t.free_value === t.value),
        `${category} traits are all free: ${JSON.stringify(traits)}`
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 209-215 - post-creation spending, on the second completed character
  // -------------------------------------------------------------------------

  test('209 Post-creation Gift purchase deducts XP at the affinity-appropriate cost', async () => {
    const cid = state.xpCharacter.id;

    // Work out affinity the way the app does (file-level finding 7) before
    // asserting any cost against it.
    const affinityInfo = await readAffinities(page, cid);
    expect(affinityInfo.breed).toBe(XP_BREED);
    expect(affinityInfo.auspice).toBe(XP_AUSPICE);
    expect(affinityInfo.tribe).toBe(XP_TRIBE);
    expect(affinityInfo.affinities.sort()).toEqual([XP_BREED, XP_AUSPICE, XP_TRIBE].sort());

    const before = await readSheetXp(page, cid);
    expect(before).toEqual(BASELINE_XP);

    // The price the change page quotes before anything is committed.
    await openNewTraitChange(page, cid, 'wta_gifts', AFFINITY_GIFT_NAME);
    await setTraitChangeSliders(page, { value: 1 });
    const quote = await readTraitChangeView(page);
    expect(quote.cost).toBe(AFFINITY_GIFT_COST_PER_LEVEL);
    expect(quote.available).toBe(before.available);
    expect(quote.final).toBe(before.available - AFFINITY_GIFT_COST_PER_LEVEL);

    await saveTraitChange(page, cid, 'wta_gifts');

    const after = await readSheetXp(page, cid);
    expect(after.available - before.available).toBe(-AFFINITY_GIFT_COST_PER_LEVEL);
    expect(after.spent - before.spent).toBe(AFFINITY_GIFT_COST_PER_LEVEL);
    expect(after.earned).toBe(before.earned);

    const traits = await readTraits(page, cid, 'wta_gifts', 'Werewolf');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: AFFINITY_GIFT_NAME, value: 1, free_value: 0, cost: AFFINITY_GIFT_COST_PER_LEVEL });
  });

  test('210 Post-creation non-affinity Gift purchase deducts the higher cost', async () => {
    const cid = state.xpCharacter.id;

    // Like-for-like comparison at the same value, both read off the change
    // page before committing to either: a second, still-unowned affinity
    // Gift, and the non-affinity one.
    await openNewTraitChange(page, cid, 'wta_gifts', AFFINITY_GIFT_NAME_2);
    await setTraitChangeSliders(page, { value: 1 });
    const affinityQuote = await readTraitChangeView(page);

    // Read the XP baseline before opening the page that is about to be
    // saved: reading it afterwards would navigate to the sheet and leave the
    // change page's Save button on an inactive jQuery Mobile page.
    const before = await readSheetXp(page, cid);

    await openNewTraitChange(page, cid, 'wta_gifts', NON_AFFINITY_GIFT_NAME);
    await setTraitChangeSliders(page, { value: 1 });
    const nonAffinityQuote = await readTraitChangeView(page);

    expect(affinityQuote.cost).toBe(AFFINITY_GIFT_COST_PER_LEVEL);
    expect(nonAffinityQuote.cost).toBe(NON_AFFINITY_GIFT_COST_PER_LEVEL);
    expect(nonAffinityQuote.cost).toBeGreaterThan(affinityQuote.cost);
    expect(nonAffinityQuote.available).toBe(before.available);

    await saveTraitChange(page, cid, 'wta_gifts');
    const after = await readSheetXp(page, cid);

    expect(after.available - before.available).toBe(-NON_AFFINITY_GIFT_COST_PER_LEVEL);
    expect(after.spent - before.spent).toBe(NON_AFFINITY_GIFT_COST_PER_LEVEL);

    const bought = (await readTraits(page, cid, 'wta_gifts', 'Werewolf')).find((t) => t.name === NON_AFFINITY_GIFT_NAME);
    expect(bought).toMatchObject({ value: 1, free_value: 0, cost: NON_AFFINITY_GIFT_COST_PER_LEVEL });

    // The second affinity Gift was quoted but never saved.
    expect((await readTraits(page, cid, 'wta_gifts', 'Werewolf')).map((t) => t.name).sort())
      .toEqual([AFFINITY_GIFT_NAME, NON_AFFINITY_GIFT_NAME].sort());
  });

  test.fail('211 Post-creation wta_rites purchase renders on the sheet, but does not deduct XP', async () => {
    // DEFECT (file-level finding 4, confirmed live): `calculate_trait_cost`
    // has no case for "wta_rites" and none of the seeded Descriptions in that
    // category set an `experience_cost_type` override, so the cost comes
    // back `undefined`; `Character.update_trait`'s own `_.isFinite(spend)`
    // guard silently forces the resulting NaN to 0 before ever writing an
    // experience notation. The Rite is genuinely bought and genuinely
    // renders - only "deducts XP" is false.
    const cid = state.xpCharacter.id;
    const before = await readSheetXp(page, cid);

    await openNewTraitChange(page, cid, 'wta_rites', RITE_NAME);
    await setTraitChangeSliders(page, { value: 1 });
    const quote = await readTraitChangeView(page);
    // The player is shown this literally, before saving anything.
    expect(quote.text).toContain('Cost: NaN');

    await saveTraitChange(page, cid, 'wta_rites');

    // These pass: the Rite is bought and genuinely renders, both in the
    // trait list and on the category listing page the sheet's "Rites" link
    // leads to.
    const traits = await readTraits(page, cid, 'wta_rites', 'Werewolf');
    expect(traits.map((t) => t.name)).toContain(RITE_NAME);
    await navigateToHash(page, `simpletraits/wta_rites/${cid}/all`, '#simpletraitcategory-all');
    expect(normalize(await page.locator('#simpletraitcategory-all').textContent())).toContain(`${RITE_NAME} x1`);

    // This is the defect: XP never moves.
    const after = await readSheetXp(page, cid);
    expect(after.spent, 'Spent XP after buying a Rite').not.toBe(before.spent);
  });

  test.skip('212 Renown allocation (Glory, Honor, Wisdom) renders with correct values on the sheet [DEFERRED]', async () => {
    // DEFERRED FEATURE, not a defect. Renown (Glory/Honor/Wisdom) has no trait
    // category, no seed data and no sheet rendering today, so there is nothing to
    // test yet. Skipped rather than pinned red: test.fail() asserts "this is
    // broken", and this is simply unbuilt. Unskip when it lands.
    // See remediation_implementation_plan.md R40.
    // GAP (file-level finding 5, confirmed live at every layer a UI path
    // could exist): no wizard step, no Description rows, no sheet section.
    const cid = state.xpCharacter.id;

    await navigateToHash(page, `character?${cid}`, '#character');
    const sheetText = normalize(await page.locator('#character').textContent());
    // These pass: the sheet genuinely has nothing Renown-shaped on it.
    expect(sheetText).not.toMatch(/glory|honor|wisdom/i);
    const headings = await page.locator('#character h3').allTextContents();
    expect(headings.map(normalize)).not.toContain('Renown');

    // The plan's actual expectation - fails, because there is nothing to
    // read a Renown value from.
    expect(sheetText, 'the sheet has no Renown/Glory/Honor/Wisdom section to read values from').toMatch(/glory/i);
  });

  test('213 Gnosis renders a real per-character value on the sheet', async () => {
    // Rage is a DEFERRED FEATURE, not a defect - see remediation_implementation_plan.md
    // R40. It is a hardcoded print-only constant tied to no character data, planned for
    // a future release. The Rage assertions that lived here were removed rather than the
    // whole test skipped, so the real Gnosis coverage below keeps running.
    const cid = state.xpCharacter.id;

    // These pass: Gnosis is real (file-level finding 6). `Werewolf.create`
    // auto-adds it at value 10/free_value 6, and its category is in
    // `ALL_SIMPLETRAIT_CATEGORIES`, so the sheet carries a genuine link to it.
    const gnosisTraits = await readTraits(page, cid, 'wta_gnosis_sources', 'Werewolf');
    expect(gnosisTraits).toHaveLength(1);
    expect(gnosisTraits[0]).toMatchObject({ name: 'Gnosis', value: 10, free_value: 6 });

    await navigateToHash(page, `character?${cid}`, '#character');
    const gnosisLink = page.locator(`#character a[href="#simpletraits/wta_gnosis_sources/${cid}/all"]`);
    await expect(gnosisLink).toHaveCount(1);

    await navigateToHash(page, `simpletraits/wta_gnosis_sources/${cid}/all`, '#simpletraitcategory-all');
    expect(normalize(await page.locator('#simpletraitcategory-all').textContent())).toContain('Gnosis');
  });

  test('214 wta_totem_bonus_traits render in the Pack section', async () => {
    const cid = state.xpCharacter.id;
    const before = await readTraits(page, cid, 'wta_totem_bonus_traits', 'Werewolf');
    expect(before).toHaveLength(0);

    await purchaseTrait(page, cid, 'wta_totem_bonus_traits', TOTEM_BONUS_NAME, { value: 1 });

    const traits = await readTraits(page, cid, 'wta_totem_bonus_traits', 'Werewolf');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: TOTEM_BONUS_NAME, value: 1 });

    // The live sheet groups this category under its own "Pack" heading -
    // `ALL_SIMPLETRAIT_CATEGORIES` gives `wta_totem_bonus_traits` the heading
    // "Pack", the only category that heading has, distinct from "Backgrounds".
    await navigateToHash(page, `character?${cid}`, '#character');
    const packHeading = page.locator('#character h3', { hasText: 'Pack' });
    await expect(packHeading).toHaveCount(1);
    const totemLink = page.locator(`#character a[href="#simpletraits/wta_totem_bonus_traits/${cid}/all"]`);
    await expect(totemLink).toHaveCount(1);
    expect(normalize(await totemLink.textContent())).toBe('Totem Bonuses');

    // Follow the link: the purchased trait genuinely renders there.
    await navigateToHash(page, `simpletraits/wta_totem_bonus_traits/${cid}/all`, '#simpletraitcategory-all');
    expect(normalize(await page.locator('#simpletraitcategory-all').textContent())).toContain(`${TOTEM_BONUS_NAME} x1`);
  });

  test('215 The Werewolf printable sheet renders Gifts and Rites with real values', async () => {
    // A Renown section is a DEFERRED FEATURE, not a defect - see
    // remediation_implementation_plan.md R40. The assertions about its absence were
    // removed rather than the whole test skipped, keeping the Gift and Rite print
    // coverage below alive.
    const cid = state.xpCharacter.id;

    await navigateToHash(page, `character/${cid}/print`, '#printable-sheet');
    const printText = normalize(await page.locator('#printable-sheet').textContent());

    // These pass: Gifts and Rites are driven by the real `wta_gifts`/
    // `wta_rites` trait lists (`CharacterPrintView.js`'s `bottom_one_a`/
    // `bottom_one_b` `SectionsView`s), so what tests 209-211 actually bought
    // is exactly what prints - real values, not placeholders.
    expect(printText).toContain(`${AFFINITY_GIFT_NAME} x1`);
    expect(printText).toContain(`${RITE_NAME} x1`);

  });
});
