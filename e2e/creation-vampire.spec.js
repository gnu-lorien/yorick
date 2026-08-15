/**
 * Task 8a - Vampire Creation In The UI (Karma parity)
 *
 * Covers testing_implementation_plan.md items 155-189, driven entirely through
 * the real Marionette creation wizard and the real post-creation trait editor.
 * Mirrors `default-test.js` "A Vampire's creation" and `creation-vs-xp-test.js`.
 *
 * The suite is `serial` and builds up **one** character through the wizard:
 * test 155 creates it through the New Character form, 156-182 spend its pools
 * step by step, 183 completes it, 184 reads the finished sheet. That ordering is
 * the point - a creation wizard is a lifecycle, and asserting each step against
 * the state the previous one left is what makes the pool arithmetic meaningful.
 *
 * A **second** completed character carries 185-189 (the post-creation XP tests).
 * It is deliberately completed with `spendPools: false`, because the three
 * creation discipline slots would otherwise consume *all three* of the clan's
 * in-clan disciplines - `bnsmetv1_ClanRule` has exactly `discipline_1..3`, the
 * creation picker filters out anything already owned, and the pool is
 * 1x(rating 2) + 2x(rating 1) = 3 picks - leaving no in-clan discipline for test
 * 185 to buy. Unspent creation pools cost nothing, so that character still
 * completes at exactly 30 earned / 0 spent / 30 available, which each test
 * re-asserts before measuring its delta.
 *
 * ---
 *
 * ## Findings confirmed live against this server before any test below was written
 *
 * **1. DEFECT - changing a creation-picked merit's value does not update the
 * merit pool (test 179).** `SimpleTraitChangeView.save_clicked` persists an
 * existing trait with `self.character.update_trait(self.simpletrait)` - one
 * argument, so `update_trait`'s `free_value` parameter is `undefined`. It
 * forwards that straight into `update_creation_rules_for_changed_trait`, which
 * composes its keys as `category + "_" + freeValue + "_remaining"`. For a
 * creation merit the correct key is `merits_0_remaining`; what actually gets
 * written is **`merits_undefined_remaining`**, carrying the right number (4)
 * under a key nothing reads, while `merits_0_remaining` stays at its stale 5. A
 * companion `merits_undefined_picks` array is created too. The equivalent
 * model-level call in `default-test.js` ("can change the value of a picked
 * merit") passes `0` explicitly and correctly reaches 4, which is what pins this
 * as a UI defect rather than a model one. Confirmed live.
 *
 * **2. Plan-vs-application conflict - creation merits and flaws DO move XP
 * (tests 178, 181, 182).** Item 178 asks for "the merit pool sum updates and XP
 * is unchanged". The pool half is true. The XP half is not, and the code that
 * contradicts it is deliberate, not accidental:
 * `BNSMETV1_VampireCosts.calculate_trait_cost` contains
 * `if ("merits" == category) { return mod_value; }` and
 * `if ("flaws" == category) { return mod_value * -1; }`. Measured live on a
 * fresh Vampire: picking `Bloodline: Coyote` (value 2) moves Spent 0 -> 2 and
 * Available 30 -> 28; picking a 2-point flaw moves Spent 0 -> -2 and Available
 * 30 -> 32. That is the By Night Studios rule - creation Merits are bought with
 * the starting 30 XP and Flaws refund it, with `merits_0_remaining` /
 * `flaws_0_remaining` acting as the 7-point *cap* rather than a separate
 * currency - so the application looks correct here and the plan's "XP is
 * unchanged" clause looks wrong. Rather than assert a claim the application
 * deliberately contradicts, tests 178 and 181 assert the exact measured
 * arithmetic and test 182 asserts the invariant over every *slot* pool (where it
 * genuinely holds, all the way to completion at 30/0/30) plus the measured
 * merit/flaw exception. Flagged for the owner: if the plan is right, the fix is
 * in `calculate_trait_cost`, and these three tests invert to red immediately.
 *
 * **3. DEFECT - discipline costs stop increasing above level 9 (test 189).**
 * `get_cost_table` returns `_.map(_.range(1, 10), ...)` - nine entries - and
 * `get_cost_on_table` sums `_.take(ct, value)`. `_.take` of more than the array
 * holds silently returns the whole array, so levels 10 through 15 all cost
 * exactly what level 9 costs. Measured live off the change page's own live cost
 * readout: in-clan `3, 9, 18, 30, 45, 63, 84, 108, 135, 135, 135, 135, 135, 135,
 * 135`; out-of-clan `4, 12, 24, 40, 60, 84, 112, 144, 180, 180, ...`. Test 189
 * asserts that progression exactly, plateau included, so the numbers are pinned
 * as "unchanged" and any fix trips the test.
 *
 * **4. Deviation - the New Character form lands on the sheet, not the wizard
 * (test 155).** `CharacterNewView`'s `redirectSave` defaults to
 * `#character?<id>` and `mobileRouter` constructs the view without overriding
 * it, so submitting the form lands on the character sheet. The sheet then
 * renders exactly one `#charactercreate/<id>` link (the template's
 * `if (character.is_being_created())` branch), one click from the wizard. Test
 * 155 asserts both hops precisely rather than pretending either one is the
 * other.
 *
 * **5. Observation - creation pool enforcement is presentational only (tests
 * 167, 175).** Each section template emits one pick link per remaining slot, so
 * an exhausted pool renders no affordance - that is the enforcement, and it is
 * what these tests measure. The route behind the link
 * (`charactercreatepicksimpletrait`) checks nothing, so a hand-typed URL would
 * decrement the counter past zero. Not exercised here: doing so corrupts the
 * character under test, and no UI path reaches it.
 *
 * **6. Observation - the wizard has no one-step repick for slot pools (test
 * 171).** Simpletexts render an explicit "Repick X" link; trait pools do not.
 * The only path is Delete then Pick, so test 171 drives exactly that and asserts
 * the pool passes through 1 and returns to 0 with the trait replaced.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { navigateToHash, waitForActivePage, activePageId, normalize } = require('./helpers/jqm-helpers');
const {
  createCharacter,
  createCompletedCharacter,
  openCreation,
  readCreationState,
  readCreation,
  readTraits,
  readCharacterTexts,
  readInClanDisciplines,
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
  readTraitCostProgression,
  saveTraitChange,
  completeCreation,
  isCompleted,
  countCharactersByPrefix,
  destroyCharactersByPrefix
} = require('./helpers/characters');

/** Every character this file creates is named with this prefix, so teardown is a query. */
const FIXTURE_PREFIX = 'E2E T8a ';

/**
 * The clan the wizard character ends up with. Chosen because its three in-clan
 * disciplines (read from `bnsmetv1_ClanRule` at run time, never hardcoded here)
 * are exactly the three the creation pool can afford, which is what test 177
 * needs. Its trio deliberately excludes Celerity and Dominate so those stay
 * available as the in-clan / out-of-clan examples on the *other* character.
 */
const WIZARD_CLAN = 'Nosferatu';

/** The clan the XP character carries: in-clan Celerity/Potence/Presence, out-of-clan Dominate. */
const XP_CLAN = 'Brujah';

/**
 * Skills picked at creation, one list per pool rating (4x1, 3x2, 2x3, 1x4).
 * All plain skills: `Performance`, `Crafts` and `Science` carry
 * `requirement: "requires_specialization"`, which diverts the pick to the
 * specialization page instead of returning to the wizard.
 */
const SKILL_PICKS = {
  4: ['Athletics'],
  3: ['Brawl', 'Dodge'],
  2: ['Melee', 'Stealth', 'Subterfuge'],
  1: ['Academics', 'Awareness', 'Computer', 'Empathy']
};

/**
 * Backgrounds picked at creation. `Retainers` is skipped for the same
 * specialization reason as the skills above; `Generation` is skipped because
 * owning it changes `character.generation()` and therefore the skill and
 * out-of-clan discipline cost tables the later tests measure.
 */
const BACKGROUND_PICKS = { 3: 'Allies', 2: 'Contacts', 1: 'Haven' };

/** A merit whose Description value is exactly 2, as item 178 names. */
const MERIT_NAME = 'Bloodline: Coyote';
const MERIT_VALUE = 2;
/** A flaw whose Description value is 2, so the flaw pool moves by a checkable amount. */
const FLAW_NAME = 'Impatient';
const FLAW_VALUE = 2;

/** The full merit and flaw creation budgets, per `ensure_creation_rules_exist`. */
const SUM_POOL_BUDGET = 7;

/**
 * Reproduce `BNSMETV1_VampireCosts`'s cumulative cost table for values 1..max.
 *
 * Deliberately mirrors the implementation rather than restating its outputs:
 * `get_cost_table(n)` yields exactly nine entries (`_.range(1, 10)`) and
 * `get_cost_on_table` sums `_.take(ct, value)`, so beyond nine the total stops
 * growing. Expressing the expectation this way makes the plateau in test 189 a
 * derived consequence rather than a magic list of numbers.
 */
function cumulativeCostTable(costPerEntry, maxValue) {
  const table = [];
  for (let i = 1; i <= 9; i++) table.push(i * costPerEntry);
  const out = [];
  for (let v = 1; v <= maxValue; v++) {
    out.push(table.slice(0, v).reduce((a, b) => a + b, 0));
  }
  return out;
}

/** In-clan disciplines cost 3 per level; out-of-clan below generation 5 cost 4; skills at generation 1 cost 1. */
const IN_CLAN_PER_LEVEL = 3;
const OUT_OF_CLAN_PER_LEVEL = 4;
const SKILL_PER_LEVEL_GEN1 = 1;

const BASELINE_XP = { earned: 30, spent: 0, available: 30 };

test.describe.configure({ mode: 'serial' });

test.describe('Task 8a - Vampire Creation In The UI', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  const state = {
    /** XP readings taken after each slot-pool step; test 182 asserts over all of them. */
    xpSamples: [],
    texts: {}
  };

  /** Record an XP reading for test 182's invariant. */
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
    console.log('[e2e creation-vampire] self-heal swept:', JSON.stringify(swept));
    console.log('[e2e creation-vampire] baseline Vampire row counts:', JSON.stringify(state.baseline));

    // The clan rule that decides which disciplines the wizard's in-clan filter
    // will offer in test 177. Read from the live rule table so the expectation
    // comes from the data the application itself reads, not from this file.
    state.wizardClanRule = await page.evaluate((clan) => {
      return new window.Parse.Query('bnsmetv1_ClanRule')
        .equalTo('clan', clan)
        .first()
        .then((r) => (r ? {
          id: r.id,
          clan: r.get('clan'),
          disciplines: [r.get('discipline_1'), r.get('discipline_2'), r.get('discipline_3')].filter(Boolean)
        } : null));
    }, WIZARD_CLAN);
    expect(state.wizardClanRule, `seeded bnsmetv1_ClanRule for "${WIZARD_CLAN}"`).not.toBeNull();
    expect(state.wizardClanRule.disciplines).toHaveLength(3);

    // How many Descriptions the unfiltered discipline catalogue holds; test 177
    // uses it to prove the in-clan filter is inert until a clan is set.
    state.disciplineCatalogueSize = await page.evaluate(() => {
      const q = new window.Parse.Query('Description');
      q.equalTo('category', 'disciplines');
      return q.count();
    });
    expect(state.disciplineCatalogueSize).toBeGreaterThan(3);

    // The post-creation XP character (tests 185-189). See the file-level comment
    // for why its creation pools are left unspent.
    state.xpCharacter = await createCompletedCharacter(page, 'Vampire', {
      name: `${FIXTURE_PREFIX}XP ${Date.now().toString(36)}`,
      texts: { clan: XP_CLAN },
      spendPools: false
    });
    expect(state.xpCharacter.xp).toEqual(BASELINE_XP);
  });

  test.afterAll(async () => {
    if (!page) return;

    const destroyed = await destroyCharactersByPrefix(page, FIXTURE_PREFIX)
      .catch((e) => ({ characters: 0, children: 0, errors: [String(e)] }));
    console.log('[e2e creation-vampire] destroyed in teardown:', JSON.stringify(destroyed));

    const final = {
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX).catch(() => -1)
    };
    console.log(
      '[e2e creation-vampire] final Vampire row counts (should equal baseline ' +
      JSON.stringify(state.baseline) + '):', JSON.stringify(final)
    );

    await page.close();
  });

  // -------------------------------------------------------------------------
  // 155-157 - the wizard character exists and starts from a known state
  // -------------------------------------------------------------------------

  test('155 New character form creates a Vampire and lands on the creation wizard', async () => {
    // DEVIATION from the plan's wording (file-level finding 4): the form lands
    // on `#character?<id>`, not `#charactercreate/<id>`. Both hops are asserted
    // exactly - the form's own landing hash, and the single wizard link the
    // sheet renders for a character still being created.
    const name = `${FIXTURE_PREFIX}Wizard ${Date.now().toString(36)}`;
    state.wizardName = name;

    await navigateToHash(page, 'characternew', '#character-new');
    await page.locator('#character-new input[name="name"]').fill(name);
    await page.locator('#character-new select[name="type"]').selectOption('Vampire');
    await page.locator('#character-new select[name="type"]').dispatchEvent('change');
    await page.locator('#character-new button, #character-new input[type="submit"]').last().click();

    await page.waitForFunction(() => /^#character\?\w+$/.test(window.location.hash), null, { timeout: 30000 });
    const landedHash = await page.evaluate(() => window.location.hash);
    const cid = landedHash.replace('#character?', '');
    state.wizardId = cid;
    expect(cid).toMatch(/^\w+$/);
    expect(landedHash).toBe(`#character?${cid}`);
    // The form assigns the hash from inside its own save callback; jQuery
    // Mobile's page transition is driven separately by the route handler that
    // hash change triggers, so the sheet becomes active a beat later.
    await waitForActivePage(page, 'character');
    expect(await activePageId(page)).toBe('character');

    // The row the form actually wrote. Vampires carry no `type` attribute at
    // all (only Werewolf and ChangelingBetaSlice set one), so the venue is
    // proven below by the Vampire-specific region the wizard renders.
    const created = await page.evaluate((id) => {
      const q = new window.Parse.Query('Vampire');
      return q.get(id).then((c) => ({ id: c.id, name: c.get('name'), type: c.get('type') || null }));
    }, cid);
    expect(created.name).toBe(name);
    expect(created.type).toBeNull();

    // Exactly one wizard affordance, rendered by the sheet's
    // `if (character.is_being_created())` branch, and it goes to this character.
    const wizardLinks = page.locator(`#character a[href^="#charactercreate/"]`);
    await expect(wizardLinks).toHaveCount(1);
    expect(await wizardLinks.first().getAttribute('href')).toBe(`#charactercreate/${cid}`);

    await wizardLinks.first().click();
    await page.waitForFunction((h) => window.location.hash === h, `#charactercreate/${cid}`, { timeout: 30000 });
    await waitForActivePage(page, 'character-create');
    expect(await activePageId(page)).toBe('character-create');
  });

  test('156 The creation page renders all ten regions', async () => {
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

    // Each region is identified by content, not merely by being non-empty - the
    // ten-region layout is only meaningful if the right child view is in each.
    const byId = Object.fromEntries(regions.map((r) => [r.id, r.text]));
    expect(byId['ccv-description']).toContain('initial XP to spend');
    expect(byId['ccv-simpletext']).toContain('Pick Clan');
    expect(byId['ccv-next-one']).toContain('Attributes');
    expect(byId['ccv-next-two']).toContain('Physical Focus');
    expect(byId['ccv-next-two']).toContain('Social Focus');
    expect(byId['ccv-next-two']).toContain('Mental Focus');
    expect(byId['ccv-next-three']).toContain('Skills');
    expect(byId['ccv-next-four']).toContain('Backgrounds');
    // Vampire-specific: the fifth region is Disciplines, where a Werewolf gets
    // Gifts and a Changeling gets Arts. This is the venue proof test 155 defers.
    expect(byId['ccv-next-five']).toContain('Disciplines');
    expect(byId['ccv-next-five']).not.toContain('Gifts');
    expect(byId['ccv-next-five']).not.toContain('Arts');
    expect(byId['ccv-next-six']).toContain('Merits');
    expect(byId['ccv-next-seven']).toContain('Flaws');
    expect(byId['ccv-next-eight']).toBe('Complete Character Creation!');

    // The pool badges the whole suite reads, at their documented start values.
    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.pools).toEqual({
      Attributes: 3,
      'Physical Focus': 1,
      'Social Focus': 1,
      'Mental Focus': 1,
      Skills: 10,
      Backgrounds: 3,
      Disciplines: 3,
      Merits: SUM_POOL_BUDGET,
      Flaws: SUM_POOL_BUDGET
    });
  });

  test('157 The creation phase reports an initial 30 XP with 0 spent', async () => {
    await openCreation(page, state.wizardId);
    const description = normalize(await page.locator('#ccv-description').textContent());
    expect(description).toContain('You have 30 initial XP to spend');
    expect(description).toContain(`Remaining steps for ${state.wizardName}`);

    const creation = await readCreation(page, state.wizardId);
    expect(creation.initial_xp).toBe(30);
    expect(creation.completed).toBe(false);

    const xp = await sampleXp('157 wizard start');
    expect(xp).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 158-165 - text attributes
  // -------------------------------------------------------------------------

  test('158 Pick a Clan via the simpletext picker; the clan is displayed on the creation page', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'clans', 'clan');
    expect(options).toContain('Brujah');

    const picked = await pickSimpleText(page, state.wizardId, 'clans', 'clan', 'Brujah');
    expect(picked).toBe('Brujah');

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Clan).toBe('Brujah');
    expect((await readCharacterTexts(page, state.wizardId)).clan).toBe('Brujah');

    // The affordance flips from a lone "Pick" to the "Repick" + "Unpick" pair
    // once a value is set.
    const links = creationState.textPickLinks.filter((h) => h.indexOf('/clans/clan/') !== -1);
    expect([...links].sort()).toEqual([
      `#charactercreate/simpletext/clans/clan/${state.wizardId}/pick`,
      `#charactercreate/simpletext/clans/clan/${state.wizardId}/unpick`
    ].sort());
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Repick Clan' })).toHaveCount(1);
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Unpick Clan' })).toHaveCount(1);
    await expect(page.locator('#ccv-simpletext a').filter({ hasText: /^Pick Clan$/ })).toHaveCount(0);
  });

  test('159 Repick the Clan; the new value replaces the prior one', async () => {
    expect((await readCharacterTexts(page, state.wizardId)).clan).toBe('Brujah');

    const picked = await pickSimpleText(page, state.wizardId, 'clans', 'clan', 'Toreador');
    expect(picked).toBe('Toreador');

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Clan).toBe('Toreador');
    // Replacement, not accumulation: exactly one Clan divider, and the old
    // value is nowhere on the page.
    const clanDividers = await page.locator('#ccv-simpletext li[data-role="list-divider"]')
      .filter({ hasText: 'Clan' }).count();
    expect(clanDividers).toBe(1);
    expect(normalize(await page.locator('#ccv-simpletext').textContent())).not.toContain('Brujah');
    expect((await readCharacterTexts(page, state.wizardId)).clan).toBe('Toreador');
  });

  test('160 Unpick the Clan; the value is cleared and the "Pick Clan" affordance returns', async () => {
    await unpickSimpleText(page, state.wizardId, 'clans', 'clan');

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts.Clan).toBeUndefined();
    expect((await readCharacterTexts(page, state.wizardId)).clan).toBeNull();
    // The creation record's own per-target flag is cleared too (`unpick_text`
    // sets `creation.set(target, false)`).
    expect((await readCreation(page, state.wizardId)).clan).toBe(false);

    await expect(page.locator('#ccv-simpletext a').filter({ hasText: /^Pick Clan$/ })).toHaveCount(1);
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Repick Clan' })).toHaveCount(0);
    await expect(page.locator('#ccv-simpletext a', { hasText: 'Unpick Clan' })).toHaveCount(0);
  });

  test('161 Pick Archetype; the value renders', async () => {
    const picked = await pickSimpleText(page, state.wizardId, 'archetypes', 'archetype');
    expect(picked).toBeTruthy();
    state.texts.archetype = picked;

    expect((await readCreationState(page, state.wizardId)).texts.Archetype).toBe(picked);
    expect((await readCharacterTexts(page, state.wizardId)).archetype).toBe(picked);
  });

  test('162 Pick Sect; the value renders', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'sects', 'sect');
    expect(options).toContain('Camarilla');

    const picked = await pickSimpleText(page, state.wizardId, 'sects', 'sect', 'Camarilla');
    state.texts.sect = picked;

    expect((await readCreationState(page, state.wizardId)).texts.Sect).toBe('Camarilla');
    expect((await readCharacterTexts(page, state.wizardId)).sect).toBe('Camarilla');
  });

  test('163 Pick Faction; the value renders', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'factions', 'faction');
    expect(options.length).toBeGreaterThan(0);

    const picked = await pickSimpleText(page, state.wizardId, 'factions', 'faction', options[0]);
    expect(picked).toBe(options[0]);
    state.texts.faction = picked;

    expect((await readCreationState(page, state.wizardId)).texts.Faction).toBe(picked);
    expect((await readCharacterTexts(page, state.wizardId)).faction).toBe(picked);
  });

  test('164 Pick Title; the value renders', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'titles', 'title');
    expect(options.length).toBeGreaterThan(0);

    const picked = await pickSimpleText(page, state.wizardId, 'titles', 'title', options[0]);
    expect(picked).toBe(options[0]);
    state.texts.title = picked;

    expect((await readCreationState(page, state.wizardId)).texts.Title).toBe(picked);
    expect((await readCharacterTexts(page, state.wizardId)).title).toBe(picked);
  });

  test('165 Pick Antecedence (Primary/Secondary/NPC); the value renders', async () => {
    const options = await listSimpleTextOptions(page, state.wizardId, 'antecedences', 'antecedence');
    expect([...options].sort()).toEqual(['NPC', 'Primary', 'Secondary']);

    const picked = await pickSimpleText(page, state.wizardId, 'antecedences', 'antecedence', 'Primary');
    expect(picked).toBe('Primary');
    state.texts.antecedence = picked;

    // The wizard labels this divider with the model's pretty name, not the
    // attribute name (`TEXT_ATTRIBUTES_PRETTY_NAMES` in models/Vampire.js).
    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.texts['Primary, Secondary, or NPC']).toBe('Primary');
    expect((await readCharacterTexts(page, state.wizardId)).antecedence).toBe('Primary');

    // Every text attribute except Clan (unpicked by test 160) now carries a value.
    const texts = await readCharacterTexts(page, state.wizardId);
    expect(texts.clan).toBeNull();
    for (const key of ['archetype', 'sect', 'faction', 'title', 'antecedence']) {
      expect(texts[key], `text attribute "${key}"`).toBeTruthy();
    }

    expect(await sampleXp('165 all text attributes picked')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 166-169 - attributes
  // -------------------------------------------------------------------------

  test('166 Pick Physical as the 7-point primary attribute; attributes_7_remaining reaches 0', async () => {
    const before = await readCreation(page, state.wizardId);
    expect(before.attributes_7_remaining).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 7)).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(3);

    const picked = await pickCreationTrait(page, state.wizardId, 'attributes', 7, 'Physical');
    expect(picked).toBe('Physical');

    const after = await readCreation(page, state.wizardId);
    expect(after.attributes_7_remaining).toBe(0);
    expect(after.attributes_5_remaining).toBe(1);
    expect(after.attributes_3_remaining).toBe(1);
    expect(after.attributes_7_picks).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(2);

    // The trait the pick actually wrote: value equals the slot rating and is
    // fully free, which is why creation picks cost nothing.
    const traits = await readTraits(page, state.wizardId, 'attributes');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: 'Physical', value: 7, free_value: 7, cost: 0 });
  });

  test('167 Attribute pool enforcement: a second 7-slot pick is prevented', async () => {
    // Enforcement here is the absence of the affordance - see file-level finding
    // 5. The 5 and 3 slots are still offered, which is what makes this a
    // per-slot check rather than "the section disappeared".
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 7)).toBe(0);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 5)).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 3)).toBe(1);

    const creationState = await readCreationState(page, state.wizardId);
    expect(creationState.pools.Attributes).toBe(2);
    // The badge is exactly the sum of the affordances still on the page.
    const attributeLinks = creationState.pickLinks.filter((h) => h.indexOf('/simpletraits/attributes/') !== -1);
    expect(attributeLinks).toHaveLength(2);
    expect(attributeLinks.filter((h) => h.endsWith('/pick/7'))).toHaveLength(0);
  });

  test('168 Unpick Physical; the 7 slot is restored', async () => {
    await unpickCreationTrait(page, state.wizardId, 'attributes', 'Physical');

    const after = await readCreation(page, state.wizardId);
    expect(after.attributes_7_remaining).toBe(1);
    expect(after.attributes_7_picks).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(3);
    expect(await countCreationPickLinks(page, state.wizardId, 'attributes', 7)).toBe(1);
    expect(await readTraits(page, state.wizardId, 'attributes')).toHaveLength(0);
  });

  test('169 Pick Social at 5 and Mental at 3; all three attribute pools reach 0', async () => {
    await pickCreationTrait(page, state.wizardId, 'attributes', 7, 'Physical');
    await pickCreationTrait(page, state.wizardId, 'attributes', 5, 'Social');
    await pickCreationTrait(page, state.wizardId, 'attributes', 3, 'Mental');

    const creation = await readCreation(page, state.wizardId);
    expect(creation.attributes_7_remaining).toBe(0);
    expect(creation.attributes_5_remaining).toBe(0);
    expect(creation.attributes_3_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Attributes).toBe(0);

    const traits = await readTraits(page, state.wizardId, 'attributes');
    const byName = Object.fromEntries(traits.map((t) => [t.name, t.value]));
    expect(byName).toEqual({ Physical: 7, Social: 5, Mental: 3 });
    expect(traits.every((t) => t.cost === 0)).toBe(true);

    expect(await sampleXp('169 attributes 7/5/3 spent')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 170-173 - focuses
  // -------------------------------------------------------------------------

  test('170 Pick a Physical focus; focus_physicals_1_remaining reaches 0', async () => {
    expect((await readCreation(page, state.wizardId)).focus_physicals_1_remaining).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'focus_physicals', 1)).toBe(1);

    const picked = await pickCreationTrait(page, state.wizardId, 'focus_physicals', 1, 'Dexterity');
    expect(picked).toBe('Dexterity');

    expect((await readCreation(page, state.wizardId)).focus_physicals_1_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(0);
    expect(await countCreationPickLinks(page, state.wizardId, 'focus_physicals', 1)).toBe(0);
    expect((await readTraits(page, state.wizardId, 'focus_physicals')).map((t) => t.name)).toEqual(['Dexterity']);
  });

  test('171 Repick the Physical focus (Dexterity to Stamina); the pool stays at 0 and the trait is replaced', async () => {
    // See file-level finding 6: slot pools render no one-step "Repick" link, so
    // the only path a player has is Delete then Pick. Both halves are asserted,
    // including the intermediate state, so the round trip is proven rather than
    // assumed.
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(0);

    await unpickCreationTrait(page, state.wizardId, 'focus_physicals', 'Dexterity');
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(1);

    await pickCreationTrait(page, state.wizardId, 'focus_physicals', 1, 'Stamina');

    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(0);
    expect((await readCreation(page, state.wizardId)).focus_physicals_1_remaining).toBe(0);
    expect((await readTraits(page, state.wizardId, 'focus_physicals')).map((t) => t.name)).toEqual(['Stamina']);
  });

  test('172 Unpick the Physical focus; the pool is restored', async () => {
    await unpickCreationTrait(page, state.wizardId, 'focus_physicals', 'Stamina');

    expect((await readCreation(page, state.wizardId)).focus_physicals_1_remaining).toBe(1);
    expect((await readCreationState(page, state.wizardId)).pools['Physical Focus']).toBe(1);
    expect(await countCreationPickLinks(page, state.wizardId, 'focus_physicals', 1)).toBe(1);
    expect(await readTraits(page, state.wizardId, 'focus_physicals')).toHaveLength(0);
  });

  test('173 Pick Mental and Social focuses; both pools reach 0', async () => {
    await pickCreationTrait(page, state.wizardId, 'focus_mentals', 1, 'Intelligence');
    await pickCreationTrait(page, state.wizardId, 'focus_socials', 1, 'Charisma');
    // Physical was left empty by test 172; refill it so the wizard is complete
    // for tests 182-184.
    await pickCreationTrait(page, state.wizardId, 'focus_physicals', 1, 'Dexterity');

    const creation = await readCreation(page, state.wizardId);
    expect(creation.focus_mentals_1_remaining).toBe(0);
    expect(creation.focus_socials_1_remaining).toBe(0);
    expect(creation.focus_physicals_1_remaining).toBe(0);

    const pools = (await readCreationState(page, state.wizardId)).pools;
    expect(pools['Mental Focus']).toBe(0);
    expect(pools['Social Focus']).toBe(0);
    expect(pools['Physical Focus']).toBe(0);

    expect((await readTraits(page, state.wizardId, 'focus_mentals')).map((t) => t.name)).toEqual(['Intelligence']);
    expect((await readTraits(page, state.wizardId, 'focus_socials')).map((t) => t.name)).toEqual(['Charisma']);

    expect(await sampleXp('173 all three focuses spent')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 174-177 - skills, backgrounds, disciplines
  // -------------------------------------------------------------------------

  test('174 Pick skills consuming the 4, 3, 2, and 1 pools; each decrements as expected', async () => {
    const creation = await readCreation(page, state.wizardId);
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
        (await readCreation(page, state.wizardId))[`skills_${rating}_remaining`],
        `skills_${rating}_remaining after filling that slot`
      ).toBe(0);
    }

    expect(expectedBadge).toBe(0);

    const traits = await readTraits(page, state.wizardId, 'skills');
    expect(traits).toHaveLength(10);
    const byName = Object.fromEntries(traits.map((t) => [t.name, t.value]));
    for (const rating of [4, 3, 2, 1]) {
      for (const skill of SKILL_PICKS[rating]) {
        expect(byName[skill], `${skill} rating`).toBe(rating);
      }
    }
    expect(traits.every((t) => t.cost === 0 && t.free_value === t.value)).toBe(true);

    expect(await sampleXp('174 all ten skills spent')).toEqual(BASELINE_XP);
  });

  test('175 Skill pool enforcement: picking beyond an exhausted pool is prevented', async () => {
    for (const rating of [4, 3, 2, 1]) {
      expect(
        await countCreationPickLinks(page, state.wizardId, 'skills', rating),
        `skill pick affordances left at rating ${rating}`
      ).toBe(0);
    }
    expect((await readCreationState(page, state.wizardId)).pools.Skills).toBe(0);

    // What the section does still render is exactly the ten picked rows, each
    // with its Delete affordance - nothing that could spend an eleventh pick.
    await openCreation(page, state.wizardId);
    await expect(page.locator('#ccv-next-three li[data-icon="delete"]')).toHaveCount(10);
    await expect(page.locator('#ccv-next-three a[href*="/pick/"]')).toHaveCount(0);
  });

  test('176 Pick backgrounds consuming the 3, 2, and 1 pools', async () => {
    const before = await readCreation(page, state.wizardId);
    expect(before.backgrounds_3_remaining).toBe(1);
    expect(before.backgrounds_2_remaining).toBe(1);
    expect(before.backgrounds_1_remaining).toBe(1);

    let expectedBadge = 3;
    for (const rating of [3, 2, 1]) {
      const picked = await pickCreationTrait(page, state.wizardId, 'backgrounds', rating, BACKGROUND_PICKS[rating]);
      expect(picked).toBe(BACKGROUND_PICKS[rating]);
      expectedBadge -= 1;
      expect(
        (await readCreationState(page, state.wizardId)).pools.Backgrounds,
        `Backgrounds badge after ${picked} at rating ${rating}`
      ).toBe(expectedBadge);
      expect((await readCreation(page, state.wizardId))[`backgrounds_${rating}_remaining`]).toBe(0);
    }
    expect(expectedBadge).toBe(0);

    const traits = await readTraits(page, state.wizardId, 'backgrounds');
    expect(Object.fromEntries(traits.map((t) => [t.name, t.value]))).toEqual({
      [BACKGROUND_PICKS[3]]: 3,
      [BACKGROUND_PICKS[2]]: 2,
      [BACKGROUND_PICKS[1]]: 1
    });
    // No Generation background, so `character.generation()` stays at its
    // fallback of 1 - which is what fixes the cost tables the later tests use.
    expect((await readInClanDisciplines(page, state.wizardId)).hasGeneration).toBe(false);

    expect(await sampleXp('176 all three backgrounds spent')).toEqual(BASELINE_XP);
  });

  test('177 Pick in-clan disciplines using the 2 and 1 discipline slots', async () => {
    // The wizard hands this picker an "in clan disciplines" filter, but the
    // filter short-circuits while the character has no clan (test 160 unpicked
    // it), so the whole catalogue is offered. Proving that first is what makes
    // the filtered result below meaningful.
    const unfiltered = await listCreationTraitOptions(page, state.wizardId, 'disciplines', 2);
    expect(unfiltered).toHaveLength(state.disciplineCatalogueSize);

    await pickSimpleText(page, state.wizardId, 'clans', 'clan', WIZARD_CLAN);
    expect((await readCharacterTexts(page, state.wizardId)).clan).toBe(WIZARD_CLAN);

    const filtered = await listCreationTraitOptions(page, state.wizardId, 'disciplines', 2);
    expect([...filtered].sort()).toEqual([...state.wizardClanRule.disciplines].sort());

    const [first, second, third] = state.wizardClanRule.disciplines;
    let expectedBadge = 3;
    for (const [rating, name] of [[2, first], [1, second], [1, third]]) {
      const picked = await pickCreationTrait(page, state.wizardId, 'disciplines', rating, name);
      expect(picked).toBe(name);
      expectedBadge -= 1;
      expect(
        (await readCreationState(page, state.wizardId)).pools.Disciplines,
        `Disciplines badge after ${name} at rating ${rating}`
      ).toBe(expectedBadge);
    }

    const creation = await readCreation(page, state.wizardId);
    expect(creation.disciplines_2_remaining).toBe(0);
    expect(creation.disciplines_1_remaining).toBe(0);
    expect((await readCreationState(page, state.wizardId)).pools.Disciplines).toBe(0);

    const traits = await readTraits(page, state.wizardId, 'disciplines');
    expect(Object.fromEntries(traits.map((t) => [t.name, t.value]))).toEqual({
      [first]: 2, [second]: 1, [third]: 1
    });
    // In-clan by the cost engine's own reckoning, not merely by the picker's.
    const inClan = await readInClanDisciplines(page, state.wizardId);
    expect([...inClan.inClan].sort()).toEqual([...state.wizardClanRule.disciplines].sort());

    expect(await sampleXp('177 all three disciplines spent')).toEqual(BASELINE_XP);
  });

  // -------------------------------------------------------------------------
  // 178-181 - merits and flaws (the point-sum pools)
  // -------------------------------------------------------------------------

  test('178 Pick a merit (Bloodline: Coyote at 2); the merit pool sum updates and XP moves by the merit value', async () => {
    // PLAN-VS-APPLICATION CONFLICT - see file-level finding 2. The plan asks for
    // "XP is unchanged"; the application deliberately charges the merit's value
    // against the starting 30 XP (`calculate_trait_cost`:
    // `if ("merits" == category) { return mod_value; }`), which is the By Night
    // Studios rule with `merits_0_remaining` acting as the 7-point cap. Asserting
    // "unchanged" here would encode a claim the application contradicts on
    // purpose, so the exact measured arithmetic is asserted instead and the
    // conflict is reported for the owner to rule on.
    const xpBefore = await readSheetXp(page, state.wizardId);
    expect(xpBefore).toEqual(BASELINE_XP);
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET);
    expect((await readCreation(page, state.wizardId)).merits_0_remaining).toBe(SUM_POOL_BUDGET);

    const picked = await pickCreationTrait(page, state.wizardId, 'merits', 0, MERIT_NAME);
    expect(picked).toBe(MERIT_NAME);

    // The pool half of item 178: a sum pool consumes the trait's own value, not
    // one slot.
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET - MERIT_VALUE);
    expect((await readCreation(page, state.wizardId)).merits_0_remaining).toBe(SUM_POOL_BUDGET - MERIT_VALUE);

    const traits = await readTraits(page, state.wizardId, 'merits');
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

  test.fail('179 Change the picked merit\'s value from 2 to 3; the pool sum updates and XP is unchanged', async () => {
    // DEFECT (file-level finding 1, confirmed live). Changing an existing
    // trait's value through `#simpletrait/:category/:cid/:bid` saves via
    // `update_trait(trait)` with no `free_value` argument, so
    // `update_creation_rules_for_changed_trait` writes
    // `merits_undefined_remaining` / `merits_undefined_picks` instead of
    // `merits_0_*`. The number is right (4) and the key is wrong, so the pool a
    // player sees never moves. `default-test.js`'s "can change the value of a
    // picked merit" passes `0` explicitly at the model layer and correctly
    // reaches 4, which is what pins this as a UI-layer defect.
    const newValue = MERIT_VALUE + 1;

    const label = await openTraitChange(page, state.wizardId, 'merits', MERIT_NAME);
    expect(label).toBe(`${MERIT_NAME} x${MERIT_VALUE}`);

    const atCurrent = await readTraitChangeView(page);
    expect(atCurrent.text).toContain(`${MERIT_NAME} ${MERIT_VALUE}`);
    expect(atCurrent.cost).toBe(0);

    await setTraitChangeSliders(page, { value: newValue });
    const atNew = await readTraitChangeView(page);
    expect(atNew.text).toContain(`${MERIT_NAME} ${newValue}`);
    expect(atNew.cost).toBe(newValue - MERIT_VALUE);

    await saveTraitChange(page, state.wizardId, 'merits');

    // These pass: the trait itself is updated and charged correctly.
    const traits = await readTraits(page, state.wizardId, 'merits');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: MERIT_NAME, value: newValue, cost: newValue });
    expect(await readSheetXp(page, state.wizardId)).toEqual({ earned: 30, spent: newValue, available: 30 - newValue });

    // This is the defect: the pool the player is shown never moves.
    const creation = await readCreation(page, state.wizardId);
    const junkKeys = Object.keys(creation).filter((k) => k.indexOf('undefined') !== -1);
    expect(
      creation.merits_0_remaining,
      `merits_0_remaining should be ${SUM_POOL_BUDGET - newValue}; the write landed on ` +
      `${JSON.stringify(junkKeys.map((k) => [k, creation[k]]))} instead`
    ).toBe(SUM_POOL_BUDGET - newValue);
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET - newValue);
  });

  test('180 Unpick the merit with the changed value; the pool sum is fully restored', async () => {
    // Test 179 leaves the merit at value 3 with its XP charged, which is exactly
    // the "merit with the changed value" this item wants unpicked.
    const traitsBefore = await readTraits(page, state.wizardId, 'merits');
    expect(traitsBefore).toHaveLength(1);
    expect(traitsBefore[0].value).toBe(MERIT_VALUE + 1);
    expect((await readSheetXp(page, state.wizardId)).spent).toBe(MERIT_VALUE + 1);

    await unpickCreationTrait(page, state.wizardId, 'merits', MERIT_NAME);

    // `unpick_from_creation` recomputes the sum pool from the remaining picks
    // (`7 - sum`) rather than incrementing it, so the stale counter left by test
    // 179 is corrected on the way out and the budget lands back on the full 7.
    expect((await readCreationState(page, state.wizardId)).pools.Merits).toBe(SUM_POOL_BUDGET);
    const creation = await readCreation(page, state.wizardId);
    expect(creation.merits_0_remaining).toBe(SUM_POOL_BUDGET);
    expect(creation.merits_0_picks).toBe(0);
    expect(await readTraits(page, state.wizardId, 'merits')).toHaveLength(0);

    // XP is refunded in full: `remove_trait` posts `-cost` as a spent alteration.
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);

    // Residue from the defect in test 179: the bogus key is never cleaned up. It
    // is inert (nothing reads it) but it is recorded here so a future fix can be
    // seen to remove it.
    expect(creation.merits_undefined_remaining).toBe(SUM_POOL_BUDGET - (MERIT_VALUE + 1));
  });

  test('181 Pick a flaw; the flaw pool sum updates', async () => {
    const xpBefore = await readSheetXp(page, state.wizardId);
    expect(xpBefore).toEqual(BASELINE_XP);
    expect((await readCreationState(page, state.wizardId)).pools.Flaws).toBe(SUM_POOL_BUDGET);

    const picked = await pickCreationTrait(page, state.wizardId, 'flaws', 0, FLAW_NAME);
    expect(picked).toBe(FLAW_NAME);

    expect((await readCreationState(page, state.wizardId)).pools.Flaws).toBe(SUM_POOL_BUDGET - FLAW_VALUE);
    expect((await readCreation(page, state.wizardId)).flaws_0_remaining).toBe(SUM_POOL_BUDGET - FLAW_VALUE);

    const traits = await readTraits(page, state.wizardId, 'flaws');
    expect(traits).toHaveLength(1);
    // A flaw's cost is negative (`calculate_trait_cost`: `mod_value * -1`), so it
    // refunds XP - the mirror image of test 178's merit. See file-level finding 2.
    expect(traits[0]).toMatchObject({ name: FLAW_NAME, value: FLAW_VALUE, free_value: 0, cost: -FLAW_VALUE });

    const xpAfter = await readSheetXp(page, state.wizardId);
    state.flawXpDelta = {
      spent: xpAfter.spent - xpBefore.spent,
      available: xpAfter.available - xpBefore.available
    };
    expect(state.flawXpDelta).toEqual({ spent: -FLAW_VALUE, available: FLAW_VALUE });

    // Restore, so tests 182-184 see the wizard's slot pools alone. The
    // restoration is asserted rather than assumed.
    await unpickCreationTrait(page, state.wizardId, 'flaws', FLAW_NAME);
    expect((await readCreationState(page, state.wizardId)).pools.Flaws).toBe(SUM_POOL_BUDGET);
    expect(await readTraits(page, state.wizardId, 'flaws')).toHaveLength(0);
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);
  });

  test('182 Across all creation picks, Available XP never moves off 30 and Spent stays 0', async () => {
    // The samples were taken through the sheet's own XP counters after each
    // slot-pool step of tests 157-177: texts, attributes, focuses, all ten
    // skills, all three backgrounds, all three disciplines.
    expect(state.xpSamples.length).toBeGreaterThanOrEqual(7);
    for (const sample of state.xpSamples) {
      expect(sample.xp, `XP after "${sample.label}"`).toEqual(BASELINE_XP);
    }

    // Still true now that every slot pool is spent to zero.
    const pools = (await readCreationState(page, state.wizardId)).pools;
    expect(pools).toEqual({
      Attributes: 0,
      'Physical Focus': 0,
      'Social Focus': 0,
      'Mental Focus': 0,
      Skills: 0,
      Backgrounds: 0,
      Disciplines: 0,
      Merits: SUM_POOL_BUDGET,
      Flaws: SUM_POOL_BUDGET
    });
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);

    // The one documented exception, recorded as measured values by tests 178 and
    // 181 rather than left as prose: the two point-sum pools move XP by the
    // picked trait's own value, merits down and flaws up. See file-level finding 2.
    expect(state.meritXpDelta).toEqual({ spent: MERIT_VALUE, available: -MERIT_VALUE });
    expect(state.flawXpDelta).toEqual({ spent: -FLAW_VALUE, available: FLAW_VALUE });
  });

  // -------------------------------------------------------------------------
  // 183-184 - completion
  // -------------------------------------------------------------------------

  test('183 Complete Creation transitions the character out of the wizard to the live sheet', async () => {
    expect(await isCompleted(page, state.wizardId, 'Vampire')).toBe(false);

    // Driven through the wizard's own "Complete Character Creation!" button.
    await openCreation(page, state.wizardId);
    const completeLink = page.locator(`#ccv-next-eight a[href="#charactercreate/complete/${state.wizardId}"]`);
    await expect(completeLink).toHaveCount(1);
    await completeLink.click();

    // The completion route assigns the hash from inside a `.done()` whose
    // return value is discarded, so the hash can move before the creation record
    // is written; wait for the persisted flag, then land on the sheet.
    await completeCreation(page, state.wizardId, 'Vampire');

    expect(await isCompleted(page, state.wizardId, 'Vampire')).toBe(true);
    expect((await readCreation(page, state.wizardId)).completed).toBe(true);
    expect(await activePageId(page)).toBe('character');

    // The sheet's `is_being_created()` branches have flipped: the wizard link is
    // gone and the Information block now renders the text attributes.
    await expect(page.locator('#character a[href^="#charactercreate/"]')).toHaveCount(0);
    const sheetTexts = await readSheetTextAttributes(page, state.wizardId);
    expect(sheetTexts.Clan).toBe(WIZARD_CLAN);
    expect(sheetTexts.Sect).toBe('Camarilla');
    expect(sheetTexts.Antecedence).toBe('Primary');
  });

  test('184 The completed sheet shows 30 available XP and 0 spent', async () => {
    expect(await readSheetXp(page, state.wizardId)).toEqual(BASELINE_XP);

    const stored = await page.evaluate((id) => {
      return new window.Parse.Query('Vampire').get(id).then((c) => ({
        earned: c.get('experience_earned'),
        spent: c.get('experience_spent')
      }));
    }, state.wizardId);
    expect(stored).toEqual({ earned: 30, spent: 0 });

    // Every trait the wizard placed is fully free, which is why nothing was spent.
    for (const category of ['attributes', 'focus_physicals', 'focus_mentals', 'focus_socials', 'skills', 'backgrounds', 'disciplines']) {
      const traits = await readTraits(page, state.wizardId, category);
      expect(traits.length, `${category} count`).toBeGreaterThan(0);
      expect(
        traits.every((t) => t.cost === 0 && t.free_value === t.value),
        `${category} traits are all free: ${JSON.stringify(traits)}`
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 185-189 - post-creation spending, on the second completed character
  // -------------------------------------------------------------------------

  test('185 Post-creation purchase of in-clan Celerity 2 deducts the in-clan cost from Available', async () => {
    const cid = state.xpCharacter.id;
    const clan = await readInClanDisciplines(page, cid);
    expect(clan.clan).toBe(XP_CLAN);
    expect(clan.inClan).toContain('Celerity');
    expect(clan.generation).toBe(1);

    const before = await readSheetXp(page, cid);
    expect(before).toEqual(BASELINE_XP);

    // The price the change page quotes before anything is committed.
    await openNewTraitChange(page, cid, 'disciplines', 'Celerity');
    await setTraitChangeSliders(page, { value: 2 });
    const quote = await readTraitChangeView(page);
    const expectedCost = cumulativeCostTable(IN_CLAN_PER_LEVEL, 2)[1]; // 3 + 6
    expect(quote.cost).toBe(expectedCost);
    expect(quote.available).toBe(before.available);
    expect(quote.final).toBe(before.available - expectedCost);

    await saveTraitChange(page, cid, 'disciplines');

    const after = await readSheetXp(page, cid);
    expect(after.available - before.available).toBe(-expectedCost);
    expect(after.spent - before.spent).toBe(expectedCost);
    expect(after.earned).toBe(before.earned);

    const traits = await readTraits(page, cid, 'disciplines');
    expect(traits).toHaveLength(1);
    expect(traits[0]).toMatchObject({ name: 'Celerity', value: 2, free_value: 0, cost: expectedCost });
    state.inClanCostAt2 = expectedCost;
  });

  test('186 Post-creation purchase of out-of-clan Dominate 1 deducts the higher out-of-clan cost', async () => {
    const cid = state.xpCharacter.id;
    const clan = await readInClanDisciplines(page, cid);
    expect(clan.inClan).not.toContain('Dominate');

    // Like-for-like comparison at the same value, both read off the change page
    // before committing to either: an in-clan discipline this character does not
    // own yet, and the out-of-clan one.
    const inClanUnowned = clan.inClan.find((d) => d !== 'Celerity');
    expect(inClanUnowned).toBeTruthy();
    await openNewTraitChange(page, cid, 'disciplines', inClanUnowned);
    await setTraitChangeSliders(page, { value: 1 });
    const inClanQuote = await readTraitChangeView(page);

    // Read the XP baseline before opening the page that is about to be saved:
    // reading it afterwards would navigate to the sheet and leave the change
    // page's Save button on an inactive jQuery Mobile page.
    const before = await readSheetXp(page, cid);

    await openNewTraitChange(page, cid, 'disciplines', 'Dominate');
    await setTraitChangeSliders(page, { value: 1 });
    const outOfClanQuote = await readTraitChangeView(page);

    expect(inClanQuote.cost).toBe(cumulativeCostTable(IN_CLAN_PER_LEVEL, 1)[0]);
    expect(outOfClanQuote.cost).toBe(cumulativeCostTable(OUT_OF_CLAN_PER_LEVEL, 1)[0]);
    expect(outOfClanQuote.cost).toBeGreaterThan(inClanQuote.cost);
    expect(outOfClanQuote.available).toBe(before.available);

    await saveTraitChange(page, cid, 'disciplines');
    const after = await readSheetXp(page, cid);

    expect(after.available - before.available).toBe(-outOfClanQuote.cost);
    expect(after.spent - before.spent).toBe(outOfClanQuote.cost);

    const dominate = (await readTraits(page, cid, 'disciplines')).find((t) => t.name === 'Dominate');
    expect(dominate).toMatchObject({ value: 1, free_value: 0, cost: outOfClanQuote.cost });
    state.outOfClanCostAt1 = outOfClanQuote.cost;
    state.inClanCostAt1 = inClanQuote.cost;
  });

  test('187 Upgrading Athletics 1 to 2 post-creation charges only the incremental difference, not the full new cost', async () => {
    const cid = state.xpCharacter.id;
    const skillTable = cumulativeCostTable(SKILL_PER_LEVEL_GEN1, 2);

    // Buy Athletics at 1 first, so the upgrade below has a real starting point.
    const beforeBuy = await readSheetXp(page, cid);
    await purchaseTrait(page, cid, 'skills', 'Athletics', { value: 1 });
    const afterBuy = await readSheetXp(page, cid);
    expect(afterBuy.available - beforeBuy.available).toBe(-skillTable[0]);

    // What a *fresh* skill at value 2 would cost this character, measured the
    // same way and then abandoned without saving. This is the "full new cost"
    // the requirement contrasts against.
    await openNewTraitChange(page, cid, 'skills', 'Brawl');
    await setTraitChangeSliders(page, { value: 2 });
    const fullCostAt2 = (await readTraitChangeView(page)).cost;
    expect(fullCostAt2).toBe(skillTable[1]);

    // The upgrade itself. XP baseline first, for the same reason as test 186:
    // reading it between opening the change page and saving would navigate away.
    const before = await readSheetXp(page, cid);
    await openTraitChange(page, cid, 'skills', 'Athletics');
    expect((await readTraitChangeView(page)).cost).toBe(0);
    await setTraitChangeSliders(page, { value: 2 });
    const upgradeQuote = await readTraitChangeView(page);
    expect(upgradeQuote.cost).toBe(fullCostAt2 - skillTable[0]);
    expect(upgradeQuote.cost).toBeLessThan(fullCostAt2);
    expect(upgradeQuote.available).toBe(before.available);

    await saveTraitChange(page, cid, 'skills');
    const after = await readSheetXp(page, cid);

    expect(after.available - before.available).toBe(-upgradeQuote.cost);
    expect(after.spent - before.spent).toBe(upgradeQuote.cost);

    // Total spent on Athletics across both steps equals the full cost of value
    // 2, never more: the increment replaced the first charge, it did not repeat it.
    expect(after.spent - beforeBuy.spent).toBe(fullCostAt2);
    const athletics = (await readTraits(page, cid, 'skills')).find((t) => t.name === 'Athletics');
    expect(athletics).toMatchObject({ value: 2, cost: fullCostAt2 });
    // "Brawl" was quoted but never saved.
    expect((await readTraits(page, cid, 'skills')).map((t) => t.name)).toEqual(['Athletics']);

    state.skillFullCostAt2 = fullCostAt2;
    state.skillUpgradeIncrement = upgradeQuote.cost;
  });

  test('188 Post-creation text attribute change (Title) leaves XP untouched', async () => {
    const cid = state.xpCharacter.id;
    const options = await listSimpleTextOptions(page, cid, 'titles', 'title', { duringCreation: false });
    expect(options.length).toBeGreaterThan(1);

    // Setup: give it a Title, so what follows is genuinely a *change*.
    const firstTitle = await pickSimpleText(page, cid, 'titles', 'title', options[0], { duringCreation: false });
    expect((await readSheetTextAttributes(page, cid)).Title).toBe(firstTitle);

    const before = await readSheetXp(page, cid);
    const secondTitle = options.find((o) => o !== firstTitle);
    const changed = await pickSimpleText(page, cid, 'titles', 'title', secondTitle, { duringCreation: false });
    expect(changed).toBe(secondTitle);

    const after = await readSheetXp(page, cid);
    expect(after).toEqual(before);

    expect((await readCharacterTexts(page, cid)).title).toBe(secondTitle);
    const sheetTexts = await readSheetTextAttributes(page, cid);
    expect(sheetTexts.Title).toBe(secondTitle);
    expect(sheetTexts.Clan).toBe(XP_CLAN);
  });

  test('189 The costs view renders the expected discipline cost progression through level 15 unchanged', async () => {
    const cid = state.xpCharacter.id;

    // Part one: the costs view itself, listing every purchased trait at its
    // stored cost. Exactly the three things tests 185-187 bought.
    await navigateToHash(page, `character/${cid}/costs`, '#character-costs');
    await expect(page.locator('#character-costs li')).toHaveCount(3);
    const items = (await page.locator('#character-costs li').allTextContents()).map(normalize).sort();
    expect(items).toEqual([
      `Athletics: ${state.skillFullCostAt2}`,
      `Celerity: ${state.inClanCostAt2}`,
      `Dominate: ${state.outOfClanCostAt1}`
    ].sort());
    // With no Generation background the engine falls back to generation 1, and
    // the view says so.
    expect(normalize(await page.locator('#character-costs').textContent()))
      .toContain('Warning: Values are just a guess without a generation set');

    // Part two: the cost progression through level 15, read live off the change
    // page's own quote at each slider position and never saved. `expectedInClan`
    // is derived from `get_cost_table` / `get_cost_on_table`, so the plateau from
    // level 9 on is a consequence of the implementation rather than a magic list.
    const clan = await readInClanDisciplines(page, cid);
    const inClanUnowned = clan.inClan.find((d) => d !== 'Celerity');
    const outOfClanUnowned = 'Auspex';
    expect(clan.inClan).not.toContain(outOfClanUnowned);

    await openNewTraitChange(page, cid, 'disciplines', inClanUnowned);
    const inClanProgression = await readTraitCostProgression(page, 15);
    const expectedInClan = cumulativeCostTable(IN_CLAN_PER_LEVEL, 15);
    expect(inClanProgression).toEqual(expectedInClan);
    expect(inClanProgression.slice(0, 9)).toEqual([3, 9, 18, 30, 45, 63, 84, 108, 135]);

    await openNewTraitChange(page, cid, 'disciplines', outOfClanUnowned);
    const outOfClanProgression = await readTraitCostProgression(page, 15);
    const expectedOutOfClan = cumulativeCostTable(OUT_OF_CLAN_PER_LEVEL, 15);
    expect(outOfClanProgression).toEqual(expectedOutOfClan);
    expect(outOfClanProgression.slice(0, 9)).toEqual([4, 12, 24, 40, 60, 84, 112, 144, 180]);

    // DEFECT (file-level finding 3): levels 10-15 cost exactly what level 9
    // costs, because `get_cost_table` only ever produces nine entries and
    // `_.take` of more than that silently returns the whole array. Pinned here
    // as an assertion so a fix cannot land unnoticed.
    expect(new Set(inClanProgression.slice(8))).toEqual(new Set([135]));
    expect(new Set(outOfClanProgression.slice(8))).toEqual(new Set([180]));

    // Nothing above was committed: the character still owns only what it bought.
    expect((await readTraits(page, cid, 'disciplines')).map((t) => t.name).sort())
      .toEqual(['Celerity', 'Dominate']);
    expect(await readSheetXp(page, cid)).toEqual({
      earned: 30,
      spent: state.inClanCostAt2 + state.outOfClanCostAt1 + state.skillFullCostAt2,
      available: 30 - (state.inClanCostAt2 + state.outOfClanCostAt1 + state.skillFullCostAt2)
    });
  });
});
