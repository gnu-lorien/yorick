/**
 * Task 12c - Changeling: Baseline Creation, Long-Term Change, Dual Audit Log
 *
 * Covers testing_implementation_plan.md items 361-380, the Changeling sibling
 * of `lifecycle-vampire.spec.js` and `lifecycle-werewolf.spec.js`. One
 * Changeling owned by `sampmem`, created through the real wizard with every
 * slot pool spent, joined to a troupe with `sampast` as Assistant
 * Storyteller, then ten long-term changes, then the resulting
 * `VampireChange` rows verified as the owner and again as `devuser` arriving
 * through `#administration/character/:id`.
 *
 * See `lifecycle-vampire.spec.js`'s header for the findings shared by all
 * three venues. What follows is what is specific to this venue.
 *
 * ---------------------------------------------------------------------------
 * Changeling-specific findings, measured live before any test below was written
 * ---------------------------------------------------------------------------
 *
 * **1. No Changeling text change is ever audit-logged (item 369).**
 * `beforeSave("Vampire")`'s `tracked_texts` allowlist is exactly
 * `name, clan, state, archetype, archetype_2, faction, title, sect,
 * antecedence, wta_breed, wta_auspice, wta_tribe, wta_camp, wta_faction` -
 * every Vampire and Werewolf text field, and not one `ctdbs_*` field. So
 * changing Kith or Court intersects to an empty change set and the hook
 * returns before writing anything. Measured: picking a Kith moved the log
 * from 26 rows to 28, and both new rows were `ctdbs_arts` "define" rows for
 * the Arts the Kith grants - no `core` row for `ctdbs_kith` at all.
 *
 * **2. Picking a Kith rewrites the character's Arts, which is why item 369 is
 * not simply "no rows".** `ChangelingBetaSlice.update_text("ctdbs_kith", ...)`
 * first calls `_unpick_previous_arts`, which *destroys* every Art matching the
 * outgoing Kith's affinities (each destruction firing
 * `beforeDelete("SimpleTrait")` and writing a "remove" row), and then calls
 * `update_trait(art, 1, "ctdbs_arts", 1)` for each of the incoming Kith's
 * affinity Arts (each writing a "define" row at `free_value` 1, so free).
 * Test 369 therefore asserts the precise thing that is missing - a `core` row
 * naming `ctdbs_kith` or `ctdbs_fealty_court` - rather than a bare row count,
 * and reports the side-effect rows it did produce.
 *
 * **3. `ctdbs_holdings_specializations` has zero Description rows (item 367).**
 * Measured against the catalogue (0 rows) and through the real picker at
 * `#simpletraits/ctdbs_holdings_specializations/:cid/new`, which renders no
 * options. Nothing can be added there. The chain the item is actually about -
 * add a Holdings trait, then specialize it, and have the log record both - is
 * driven instead against the seeded `ctdbs_backgrounds` entry named
 * `Holdings`, with the empty category asserted first as the real defect.
 *
 * **4. `ctdbs_backgrounds` purchases cost exactly nothing (items 370, 371).**
 * `BNSCTDBS_ChangelingCosts.calculate_trait_cost` branches on `ctdbs_arts`,
 * `ctdbs_merits`, `ctdbs_flaws`, `skills`, `ctdbs_realms` and - the irony
 * being that this one never matches - the bare string `"backgrounds"`, which
 * is Vampire's category name, never this venue's `"ctdbs_backgrounds"`. Its
 * final statement is `return 0`. Measured on the live change page: a
 * `Holdings` purchase at value 1 quotes `Cost: 0`. So the "records the cost"
 * assertions on `ctdbs_backgrounds` assert the zero the engine actually
 * charges.
 *
 * **5. Glamour is real and derived; Banality does not exist (item 370).**
 * `ChangelingBetaSlice.seeming()` reads the value of the `ctdbs_backgrounds`
 * trait named `Seeming`, and `print/glamour.html` turns it into a Glamour
 * pool through `{1: 14, 2: 13, 3: 12, 4: 11, 5: 10}`. Measured: buying
 * `Seeming` at 1 made the printable sheet read "Glamour 14". Raising it to 2
 * makes it read 13, and both changes are logged as ordinary
 * `ctdbs_backgrounds` rows. "Banality" appears nowhere in the repository - no
 * model field, no seed row, no template - so this test asserts Glamour
 * positively and Banality's absence explicitly. (The plan's literal Banality
 * expectation is already pinned red by Task 8c's item 239; re-failing the
 * whole of item 370 for it would throw away the Glamour half, which does
 * work and is logged.)
 *
 * **6. Art costs are cumulative: affinity 4/level (1 -> 4, 2 -> 12),
 * non-affinity 6/level (1 -> 6, 2 -> 18).** Because item 369 changes the
 * Kith, and Kith decides Art affinity, the Arts bought in items 366 and 368
 * are chosen at runtime to be non-affinity for *both* the outgoing and
 * incoming Kith; otherwise the costs view (item 380) would recompute them at
 * the affinity price while the log still held the non-affinity one.
 *
 * **7. The Kith is picked as fixture setup *after* creation completes, not
 * during it.** `update_text("ctdbs_kith", ...)` grants the Kith's affinity
 * Arts through `update_trait(art, 1, "ctdbs_arts", 1)`, whose `free_value` of
 * 1 decrements `ctdbs_arts_1_remaining`. A Changeling has exactly one Art
 * creation slot, so picking a three-Art Kith *inside* the wizard drives that
 * counter to -2 and `spendAllCreationPools` aborts with "creation overspent a
 * pool". Picking it immediately after completion produces the same character
 * with the same grants (measured: `ctdbs_arts_1_remaining` ends at -3, which
 * is inert once creation is over), so item 361's pool assertions are made
 * against a snapshot taken at the moment creation finished.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, loginAsAST, loginAsStranger } = require('./helpers/auth');
const {
  navigateToHash,
  waitForJqmLoader,
  runInApp,
  hardReload,
  normalize
} = require('./helpers/jqm-helpers');
const {
  createCompletedCharacter,
  readTraits,
  readSheetXp,
  readCreation,
  readCharacterTexts,
  readArtAffinities,
  openNewTraitChange,
  openTraitChange,
  setTraitChangeSliders,
  readTraitChangeView,
  saveTraitChange,
  pickSimpleText,
  countCharactersByPrefix,
  destroyCharactersByPrefix
} = require('./helpers/characters');
const {
  createTroupe,
  addStaff,
  joinTroupe,
  uniqueTroupeName,
  countTroupesByPrefix,
  destroyTroupesByPrefix
} = require('./helpers/troupes');
const { readLogRows } = require('./helpers/logs');
const { seedNotations, readXpTotals } = require('./helpers/xp');
const L = require('./helpers/lifecycle');

const FIXTURE_PREFIX = 'E2E T12C ';

const KITH_BEFORE = 'Ghillie Dhu';
const KITH_AFTER = 'Clurichaun';
// The catalogue previously carried the misspelling "Seeling"; the refresh from
// data/all_greensboro_descriptions_20260816.csv corrected it to "Seelie".
const COURT_BEFORE = 'Seelie';
const COURT_AFTER = 'Unseelie';

const XP_AWARD = 25;
const XP_HEADROOM = 200;

const ATTRIBUTE_PER_POINT = 3;
/** Non-affinity Arts are 6/level cumulative, so value 1 costs 6. */
const NON_AFFINITY_ART_AT_1 = 6;
const AFFINITY_ART_AT_1 = 4;
/** Every `ctdbs_backgrounds` purchase resolves to zero (finding 4). */
const BACKGROUND_COST = 0;
const HOLDINGS_BASE = 'Holdings';
const HOLDINGS_SUFFIX = 'Sunken Glade';
const SEEMING = 'Seeming';

test.describe.configure({ mode: 'serial' });

test.describe('Task 12c - Changeling lifecycle and dual audit log', () => {
  const contexts = [];
  let adminPage;
  let memberPage;
  let astPage;
  let strangerPage;

  const state = { changes: {} };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(900000);

    for (const [name, login] of [
      ['admin', loginAsAdmin],
      ['member', loginAsMember],
      ['ast', loginAsAST],
      ['stranger', loginAsStranger]
    ]) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await login(page);
      if (name === 'admin') adminPage = page;
      if (name === 'member') memberPage = page;
      if (name === 'ast') astPage = page;
      if (name === 'stranger') strangerPage = page;
    }

    const sweptChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX);
    const sweptTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX);
    state.baseline = {
      allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()),
      allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()),
      fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX),
      fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX)
    };
    console.log('[t12-changeling] self-heal swept characters:', JSON.stringify(sweptChars));
    console.log('[t12-changeling] self-heal swept troupes:', JSON.stringify(sweptTroupes));
    console.log('[t12-changeling] baseline counts:', JSON.stringify(state.baseline));

    state.troupe = await createTroupe(adminPage, uniqueTroupeName(FIXTURE_PREFIX));
    await addStaff(adminPage, state.troupe.id, 'sampast', 'AST');

    state.originalName = `${FIXTURE_PREFIX}Baseline ${Date.now().toString(36)}`;
    state.character = await createCompletedCharacter(memberPage, 'Changeling', {
      name: state.originalName,
      spendPools: true
    });
    state.creationXp = state.character.xp;
    state.creationPicks = state.character.creationPicks;
    const cid = state.character.id;

    // Snapshot the creation record before the Kith grant perturbs the Art
    // slot counter (finding 7). Item 361 asserts this snapshot.
    state.creationRecord = await readCreation(memberPage, cid, 'Changeling');
    state.creationArts = (await readTraits(memberPage, cid, 'ctdbs_arts', 'Changeling')).map((t) => t.name);

    await joinTroupe(memberPage, cid, state.troupe.id);

    // Kith and Court, through the real pickers, so items 369's changes are
    // genuine changes rather than first definitions.
    await L.parkOnSheet(memberPage, cid);
    await pickSimpleText(memberPage, cid, 'ctdbs_kiths', 'ctdbs_kith', KITH_BEFORE, { duringCreation: false });
    await L.parkOnSheet(memberPage, cid);
    await pickSimpleText(memberPage, cid, 'ctdbs_fealty_courts', 'ctdbs_fealty_court', COURT_BEFORE, { duringCreation: false });

    // Arts that stay non-affinity across item 369's Kith change (finding 6),
    // are not already owned, and are actually offered by the picker.
    const kithArts = await memberPage.evaluate(async (kiths) => {
      const q = new window.Parse.Query('bnsctdbs_KithRule');
      q.containedIn('name', kiths);
      q.limit(100);
      const rows = await q.find();
      const out = [];
      rows.forEach((r) => {
        [r.get('art_1'), r.get('art_2'), r.get('art_3')].filter(Boolean).forEach((a) => out.push(a));
      });
      return out;
    }, [KITH_BEFORE, KITH_AFTER]);
    expect(kithArts.length, 'both Kith rules declare affinity Arts').toBeGreaterThan(3);
    state.kithArts = kithArts;

    const ownedArts = (await readTraits(memberPage, cid, 'ctdbs_arts', 'Changeling')).map((t) => t.name);
    await L.parkOnSheet(memberPage, cid);
    await navigateToHash(memberPage, `simpletraits/ctdbs_arts/${cid}/new`, '#simpletrait-new');
    const offeredArts = await memberPage.locator('#simpletrait-new a.simpletrait')
      .evaluateAll((els) => els.map((e) => e.getAttribute('name')));
    state.nonAffinityArts = offeredArts
      .filter((n) => kithArts.indexOf(n) === -1 && ownedArts.indexOf(n) === -1)
      .sort();
    expect(
      state.nonAffinityArts.length,
      `the picker offers unowned Arts that are non-affinity for both Kiths (offered: ${offeredArts.join(', ')})`
    ).toBeGreaterThan(1);

    await runInApp(memberPage, ['app/models/ChangelingBetaSlice'], `
      return mods[0].get_character(arg.id, "all").then(function (c) {
        return c.add_experience_notation({ reason: arg.reason, alteration_earned: arg.amount });
      });
    `, { id: cid, amount: XP_HEADROOM, reason: `${FIXTURE_PREFIX}headroom` });
    await hardReload(memberPage);

    console.log('[t12-changeling] fixture ready:', JSON.stringify({
      character: cid,
      troupe: state.troupe.id,
      picks: state.creationPicks.length,
      creationXp: state.creationXp,
      creationArts: state.creationArts,
      kithArts,
      arts: state.nonAffinityArts.slice(0, 3)
    }));
  });

  test.afterAll(async () => {
    if (adminPage) {
      const destroyedChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX)
        .catch((e) => ({ characters: -1, children: -1, errors: [String(e)] }));
      const destroyedTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX)
        .catch((e) => ({ troupes: -1, roles: -1, errors: [String(e)] }));
      console.log('[t12-changeling] destroyed characters:', JSON.stringify(destroyedChars));
      console.log('[t12-changeling] destroyed troupes:', JSON.stringify(destroyedTroupes));
      if (destroyedChars.errors && destroyedChars.errors.length) {
        console.log('[t12-changeling] TEARDOWN ERRORS (characters):', JSON.stringify(destroyedChars.errors));
      }
      if (destroyedTroupes.errors && destroyedTroupes.errors.length) {
        console.log('[t12-changeling] TEARDOWN ERRORS (troupes):', JSON.stringify(destroyedTroupes.errors));
      }
      const final = {
        allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
        allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()).catch(() => -1),
        fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1),
        fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1)
      };
      console.log(
        '[t12-changeling] final counts (baseline was ' + JSON.stringify(state.baseline) + '):',
        JSON.stringify(final)
      );
    }
    for (const context of contexts) await context.close().catch(() => {});
  });

  // =========================================================================
  // 361-363 - the baseline
  // =========================================================================

  test('361 Baseline: a Changeling is created and completed through the full wizard', async () => {
    const cid = state.character.id;
    const creation = state.creationRecord;
    expect(creation.completed, 'the creation record is marked completed').toBe(true);

    const slotPools = Object.entries(creation)
      .filter(([k]) => /_remaining$/.test(k) && !/^ctdbs_(merits|flaws)_/.test(k));
    expect(slotPools.length, 'slot pools exist on the creation record').toBeGreaterThan(10);
    expect(slotPools.filter(([, v]) => v !== 0), 'every slot pool is spent to exactly zero').toEqual([]);
    expect(creation.ctdbs_merits_0_remaining, 'the merit point budget is untouched by design').toBe(7);
    expect(creation.ctdbs_flaws_0_remaining, 'the flaw point budget is untouched by design').toBe(7);

    expect(state.creationXp, 'creation lands on 30 earned / 0 spent / 30 available').toEqual({
      earned: 30, spent: 0, available: 30
    });
    expect(state.creationPicks.length).toBeGreaterThanOrEqual(22);

    const attributes = await readTraits(memberPage, cid, 'attributes', 'Changeling');
    expect(attributes.map((t) => t.value).sort((a, b) => b - a)).toEqual([7, 5, 3]);
    expect(state.creationArts.length, 'the wizard picked Arts, the Changeling power category').toBeGreaterThan(0);

    const texts = await readCharacterTexts(memberPage, cid, 'Changeling');
    expect(texts.ctdbs_kith, 'the fixture Kith is set').toBe(KITH_BEFORE);
    expect(texts.ctdbs_fealty_court).toBe(COURT_BEFORE);
    expect(texts.clan, 'a Changeling has no Vampire clan field set').toBeFalsy();
    expect(texts.wta_tribe, 'nor a Werewolf tribe').toBeFalsy();

    // The Kith really did grant its affinity Arts for free.
    const affinity = await readArtAffinities(memberPage, cid);
    expect(affinity.kith).toBe(KITH_BEFORE);
    const arts = await readTraits(memberPage, cid, 'ctdbs_arts', 'Changeling');
    for (const granted of affinity.affinities) {
      const owned = arts.find((t) => t.name === granted);
      expect(owned, `Kith-granted Art "${granted}" is present`).toBeTruthy();
      expect(owned.cost, `and cost nothing`).toBe(0);
    }
  });

  test('362 Baseline: creation produces a log entry for every creation pick', async () => {
    test.setTimeout(180000);
    const cid = state.character.id;
    const rows = await L.readAllLogRows(memberPage, cid);

    const missing = [];
    for (const pick of state.creationPicks) {
      const idx = pick.indexOf(':');
      const category = pick.slice(0, idx);
      const name = pick.slice(idx + 1);
      if (L.matchingRows(rows, { category, name, type: 'define' }).length === 0) missing.push(pick);
    }
    expect(missing, 'every creation pick has its own "define" row').toEqual([]);

    for (const [category, name] of [
      ['willpower_sources', 'Willpower'],
      ['health_levels', 'Healthy']
    ]) {
      expect(
        L.matchingRows(rows, { category, name, type: 'define' }).length,
        `wizard-granted ${category}/${name} is logged`
      ).toBe(1);
    }

    const artDefines = L.matchingRows(rows, { category: 'ctdbs_arts', type: 'define' });
    expect(artDefines.length, 'creation Arts and Kith-granted Arts are both logged')
      .toBeGreaterThanOrEqual(state.creationArts.length);
    for (const row of artDefines) {
      expect(L.numCost(row.cost), `${row.name} was granted free`).toBe(0);
      expect(row.free_value).toBe(row.value);
    }

    // This file used to rest on the opposite fact: no Changeling text field was
    // tracked, so even the *first* Kith and Court picks produced no "core" row,
    // unlike a Vampire's clan or a Werewolf's tribe. Remediation R47a added the
    // three `ctdbs_*` texts to the allowlist, because that omission was an
    // oversight rather than a design choice - the log is meant to be a backend
    // record of what really happened, in every venue.
    const coreRows = L.matchingRows(rows, { category: 'core' });
    for (const attribute of ['ctdbs_kith', 'ctdbs_fealty_court']) {
      expect(
        L.matchingRows(coreRows, { name: attribute }).length,
        `the ${attribute} pick is logged, like a Vampire's clan or a Werewolf's tribe`
      ).toBeGreaterThan(0);
    }
    // Only the tracked attributes, and nothing else that happened to be dirty
    // on the same save - the allowlist governs what is written now, not merely
    // whether anything is.
    const TRACKED = ['name', 'archetype', 'antecedence', 'ctdbs_kith', 'ctdbs_fealty_court', 'ctdbs_kith_group_type'];
    expect(
      [...new Set(coreRows.map((r) => r.name))].filter((n) => !TRACKED.includes(n)),
      'no untracked attribute leaks into the core log'
    ).toEqual([]);
    console.log(`[t12-changeling] 362: ${rows.length} log rows after creation for ${state.creationPicks.length} picks, and ${coreRows.length} core rows`);
  });

  test('363 Baseline: the printable sheet matches every creation choice made', async () => {
    const cid = state.character.id;
    await navigateToHash(memberPage, `character/${cid}/print`, '#printable-sheet');
    const printText = normalize(await memberPage.locator('#printable-sheet').textContent());

    expect(printText, 'the character name prints').toContain(state.originalName);
    expect(printText, 'the picked Kith prints').toContain(KITH_BEFORE);
    expect(printText, 'the picked Court prints').toContain(COURT_BEFORE);
    expect(printText, 'the Changeling sheet carries a Glamour block').toMatch(/Glamour/);

    const checked = [];
    for (const category of ['skills', 'ctdbs_backgrounds', 'ctdbs_arts']) {
      const traits = await readTraits(memberPage, cid, category, 'Changeling');
      expect(traits.length, `${category} holds creation picks`).toBeGreaterThan(0);
      for (const t of traits) {
        expect(printText, `${category} "${t.name} x${t.value}" prints`).toContain(`${t.name} x${t.value}`);
        checked.push(`${t.name} x${t.value}`);
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(16);

    for (const a of await readTraits(memberPage, cid, 'attributes', 'Changeling')) {
      expect(printText, `attribute ${a.name} prints`).toContain(a.name);
    }
  });

  // =========================================================================
  // 364-373 - the ten long-term changes
  // =========================================================================

  test('364 Change 1 - award a 25 XP notation; the log records the transaction', async () => {
    // Same measured defect as items 321 and 344, re-measured on a Changeling.
    const cid = state.character.id;
    const reason = `${FIXTURE_PREFIX}storyteller award`;

    const before = await L.readAllLogRows(memberPage, cid);
    const xpBefore = await readSheetXp(memberPage, cid);

    const seeded = await seedNotations(memberPage, cid, [{ reason, earned: XP_AWARD }]);
    expect(seeded.some((r) => r.reason === reason && r.earned === XP_AWARD)).toBe(true);

    const totals = await readXpTotals(memberPage);
    expect(totals.earned - xpBefore.earned, 'the award moved Earned by exactly 25').toBe(XP_AWARD);
    expect(totals.available - xpBefore.available).toBe(XP_AWARD);

    const after = await L.readAllLogRows(memberPage, cid);
    expect(after.length - before.length, 'the log records the XP transaction').toBeGreaterThan(0);

    // Named after the reason the storyteller typed, so the trail says what
    // the award was for and not merely that a number moved.
    const awardRow = L.freshestRow(after, { category: 'experience' });
    expect(awardRow, 'an experience row exists').toBeTruthy();
    expect(awardRow.name).toBe(reason);
    expect(L.numCost(awardRow.value), 'and carries the earned delta').toBe(XP_AWARD);
  });

  test('365 Change 2 - raise an attribute across two edits; two log rows with correct values and costs', async () => {
    const cid = state.character.id;
    const start = (await readTraits(memberPage, cid, 'attributes', 'Changeling')).find((t) => t.name === 'Physical');
    expect(start, 'Physical exists from creation').toBeTruthy();
    expect(start.free_value, 'the creation-granted Physical is entirely free').toBe(start.value);
    expect([7, 5, 3]).toContain(start.value);
    expect(L.numCost(start.cost)).toBe(0);
    state.physicalBase = start.value;

    for (const target of [start.value + 1, start.value + 2]) {
      await hardReload(memberPage);
      const xpBefore = await readSheetXp(memberPage, cid);
      await L.parkOnSheet(memberPage, cid);
      await openTraitChange(memberPage, cid, 'attributes', 'Physical');
      await setTraitChangeSliders(memberPage, { value: target });
      const quote = await readTraitChangeView(memberPage);
      await saveTraitChange(memberPage, cid, 'attributes');
      const xpAfter = await readSheetXp(memberPage, cid);

      expect(quote.cost, `raising Physical to ${target}`).toBe(ATTRIBUTE_PER_POINT);
      expect(xpAfter.spent - xpBefore.spent).toBe(ATTRIBUTE_PER_POINT);
      expect(xpAfter.available - xpBefore.available).toBe(-ATTRIBUTE_PER_POINT);
    }

    const base = state.physicalBase;
    const raised = (await readTraits(memberPage, cid, 'attributes', 'Changeling')).find((t) => t.name === 'Physical');
    expect(raised).toMatchObject({ value: base + 2, free_value: base, cost: 2 * ATTRIBUTE_PER_POINT });

    const rows = await L.readAllLogRows(memberPage, cid);
    const updates = L.matchingRows(rows, { category: 'attributes', name: 'Physical', type: 'update' });
    expect(updates.length, 'exactly two update rows, one per edit').toBe(2);
    expect(updates[0]).toMatchObject({ old_value: base + 1, value: base + 2, cost: 2 * ATTRIBUTE_PER_POINT });
    expect(L.numCost(updates[0].old_cost)).toBe(ATTRIBUTE_PER_POINT);
    expect(updates[1]).toMatchObject({ old_value: base, value: base + 1, cost: ATTRIBUTE_PER_POINT });
    expect(L.numCost(updates[1].old_cost)).toBe(0);
  });

  test('366 Change 3 - purchase an Art; the log records the cost', async () => {
    const cid = state.character.id;
    const art = state.nonAffinityArts[0];
    state.changes.art = art;

    const affinity = await readArtAffinities(memberPage, cid);
    expect(affinity.affinities, `"${art}" is not an affinity Art for this Kith`).not.toContain(art);

    const xpBefore = await readSheetXp(memberPage, cid);
    await L.parkOnSheet(memberPage, cid);
    await openNewTraitChange(memberPage, cid, 'ctdbs_arts', art);
    await setTraitChangeSliders(memberPage, { value: 1 });
    const quote = await readTraitChangeView(memberPage);
    expect(quote.cost, `"${art}" is priced at the non-affinity Art rate`).toBe(NON_AFFINITY_ART_AT_1);
    expect(quote.cost, 'which is higher than the affinity rate').toBeGreaterThan(AFFINITY_ART_AT_1);
    await saveTraitChange(memberPage, cid, 'ctdbs_arts');
    const xpAfter = await readSheetXp(memberPage, cid);
    expect(xpAfter.spent - xpBefore.spent).toBe(NON_AFFINITY_ART_AT_1);

    const bought = (await readTraits(memberPage, cid, 'ctdbs_arts', 'Changeling')).find((t) => t.name === art);
    expect(bought).toMatchObject({ value: 1, free_value: 0, cost: NON_AFFINITY_ART_AT_1 });

    const rows = await L.readAllLogRows(memberPage, cid);
    const row = L.freshestRow(rows, { category: 'ctdbs_arts', name: art, type: 'define' });
    expect(row).toMatchObject({ value: 1, cost: NON_AFFINITY_ART_AT_1, old_value: null });
  });

  test('367 Change 4 - add and specialize a Holdings specialization; the log records both', async () => {
    const cid = state.character.id;

    // This category was empty until the catalogue was backfilled from
    // data/all_greensboro_descriptions_20260816.csv, and the chain below used to
    // run on the Holdings background purely as a substitute. It is now seeded, so
    // assert that directly; the background chain is kept because it is the
    // specialization mechanic this item is really about.
    await L.parkOnSheet(memberPage, cid);
    await navigateToHash(memberPage, `simpletraits/ctdbs_holdings_specializations/${cid}/new`, '#simpletrait-new');
    const offered = await memberPage.locator('#simpletrait-new a.simpletrait')
      .evaluateAll((els) => els.map((e) => e.getAttribute('name')).filter(Boolean));
    expect(offered.length, 'ctdbs_holdings_specializations is seeded and offers options').toBeGreaterThan(0);

    const owned = (await readTraits(memberPage, cid, 'ctdbs_backgrounds', 'Changeling')).map((t) => t.name);
    expect(owned, 'Holdings is not already owned').not.toContain(HOLDINGS_BASE);

    const xpBefore = await readSheetXp(memberPage, cid);
    await L.parkOnSheet(memberPage, cid);
    await openNewTraitChange(memberPage, cid, 'ctdbs_backgrounds', HOLDINGS_BASE);
    await setTraitChangeSliders(memberPage, { value: 1 });
    const quote = await readTraitChangeView(memberPage);
    expect(quote.cost, 'every ctdbs_backgrounds purchase resolves to zero (finding 4)').toBe(BACKGROUND_COST);
    await saveTraitChange(memberPage, cid, 'ctdbs_backgrounds');
    const xpAfterAdd = await readSheetXp(memberPage, cid);
    expect(xpAfterAdd, 'so nothing is charged').toEqual(xpBefore);

    const added = (await readTraits(memberPage, cid, 'ctdbs_backgrounds', 'Changeling')).find((t) => t.name === HOLDINGS_BASE);
    expect(added).toMatchObject({ value: 1, free_value: 0, cost: BACKGROUND_COST });

    await L.specializeRename(memberPage, cid, 'ctdbs_backgrounds', added.id, HOLDINGS_SUFFIX);
    const xpAfterRename = await readSheetXp(memberPage, cid);
    expect(xpAfterRename, 'a specialization rename moves no XP').toEqual(xpAfterAdd);

    const full = `${HOLDINGS_BASE}: ${HOLDINGS_SUFFIX}`;
    const renamed = (await readTraits(memberPage, cid, 'ctdbs_backgrounds', 'Changeling')).find((t) => t.id === added.id);
    expect(renamed).toMatchObject({ name: full, value: 1, cost: BACKGROUND_COST });

    const rows = await L.readAllLogRows(memberPage, cid);
    const addRow = L.freshestRow(rows, { category: 'ctdbs_backgrounds', name: HOLDINGS_BASE, type: 'define' });
    expect(addRow).toMatchObject({ value: 1, old_value: null });
    expect(L.numCost(addRow.cost), 'the add is logged at the zero cost actually charged').toBe(BACKGROUND_COST);

    const renameRow = L.freshestRow(rows, { category: 'ctdbs_backgrounds', name: full, type: 'update' });
    expect(renameRow, 'the rename row carries the old name and an unchanged value').toMatchObject({
      old_text: HOLDINGS_BASE, old_value: 1, value: 1
    });
    state.changes.holdings = full;
  });

  test('368 Change 5 - remove a purchased Art; the log records the removal and refund', async () => {
    const cid = state.character.id;
    const art = state.nonAffinityArts[1];
    expect(art, 'a second unowned non-affinity Art is available').toBeTruthy();

    const xpBefore = await readSheetXp(memberPage, cid);
    await L.parkOnSheet(memberPage, cid);
    await openNewTraitChange(memberPage, cid, 'ctdbs_arts', art);
    await setTraitChangeSliders(memberPage, { value: 1 });
    await saveTraitChange(memberPage, cid, 'ctdbs_arts');

    const bought = (await readTraits(memberPage, cid, 'ctdbs_arts', 'Changeling')).find((t) => t.name === art);
    expect(bought).toMatchObject({ value: 1, cost: NON_AFFINITY_ART_AT_1 });
    const xpAfterBuy = await readSheetXp(memberPage, cid);
    expect(xpAfterBuy.spent - xpBefore.spent).toBe(NON_AFFINITY_ART_AT_1);

    await L.removeTraitViaChangePage(memberPage, cid, 'ctdbs_arts', art, openTraitChange);
    const xpAfterRemove = await readSheetXp(memberPage, cid);

    expect(xpAfterRemove.spent - xpAfterBuy.spent, 'Spent falls by exactly the Art cost').toBe(-NON_AFFINITY_ART_AT_1);
    expect(xpAfterRemove.available - xpAfterBuy.available).toBe(NON_AFFINITY_ART_AT_1);
    expect(xpAfterRemove.spent, 'the round trip nets to zero').toBe(xpBefore.spent);
    expect(
      (await readTraits(memberPage, cid, 'ctdbs_arts', 'Changeling')).some((t) => t.name === art),
      'the removed Art is gone from the character'
    ).toBe(false);

    const rows = await L.readAllLogRows(memberPage, cid);
    const removeRow = L.freshestRow(rows, { category: 'ctdbs_arts', name: art, type: 'remove' });
    expect(removeRow).toMatchObject({ old_value: 1 });
    expect(L.numCost(removeRow.old_cost), 'the removal row carries the refunded cost').toBe(NON_AFFINITY_ART_AT_1);
  });

  test.fail('369 Change 6 - change Kith and Court; the log records them', async () => {
    // DEFECT (findings 1 and 2). Every measured assertion below passes: the
    // two texts really do change, the Kith really does rewrite the Arts, and
    // the log really does gain rows - just never a `core` row naming either
    // field, because no `ctdbs_*` key is in `tracked_texts`. Only the plan's
    // literal expectation fails.
    const cid = state.character.id;

    const before = await L.readAllLogRows(memberPage, cid);
    const xpBefore = await readSheetXp(memberPage, cid);

    await L.parkOnSheet(memberPage, cid);
    await pickSimpleText(memberPage, cid, 'ctdbs_kiths', 'ctdbs_kith', KITH_AFTER, { duringCreation: false });
    await L.parkOnSheet(memberPage, cid);
    await pickSimpleText(memberPage, cid, 'ctdbs_fealty_courts', 'ctdbs_fealty_court', COURT_AFTER, { duringCreation: false });

    const texts = await readCharacterTexts(memberPage, cid, 'Changeling');
    expect(texts.ctdbs_kith, 'the Kith really changed').toBe(KITH_AFTER);
    expect(texts.ctdbs_fealty_court, 'and so did the Court').toBe(COURT_AFTER);

    // The change is functional, not cosmetic: Art affinity follows the Kith.
    const affinity = await readArtAffinities(memberPage, cid);
    expect(affinity.kith).toBe(KITH_AFTER);
    expect(affinity.affinities.length, 'the new Kith carries its own affinity Arts').toBeGreaterThan(0);

    await navigateToHash(memberPage, `character/${cid}/print`, '#printable-sheet');
    const printText = normalize(await memberPage.locator('#printable-sheet').textContent());
    expect(printText, 'and the printable sheet shows the new Kith').toContain(KITH_AFTER);
    expect(printText, 'and the new Court').toContain(COURT_AFTER);

    const after = await L.readAllLogRows(memberPage, cid);
    const grew = after.length - before.length;
    const newRows = after.slice(0, Math.max(0, grew));
    console.log(
      `[t12-changeling] 369 measured: changing Kith and Court added ${grew} rows, ` +
      `all of them Art side effects: ${JSON.stringify(newRows.map((r) => `${r.category}/${r.name}/${r.type}`))}`
    );
    expect(
      newRows.filter((r) => r.category !== 'ctdbs_arts'),
      'every row the change produced is an Art side effect of the Kith grant, never a text row'
    ).toEqual([]);

    // The actual absence, asserted directly and confirmed by a query.
    expect(L.matchingRows(after, { category: 'core' }), 'still no core row of any kind').toEqual([]);
    const directCount = await memberPage.evaluate(async (id) => {
      const q = new window.Parse.Query('VampireChange');
      q.equalTo('owner', window.Parse.Object.extend('Vampire').createWithoutData(id));
      q.containedIn('name', ['ctdbs_kith', 'ctdbs_fealty_court']);
      return q.count();
    }, cid);
    expect(directCount, 'no VampireChange row names either Changeling text field').toBe(0);

    expect(await readSheetXp(memberPage, cid), 'text changes never move XP directly').toEqual(xpBefore);

    // The plan's literal expectation. Fails, deliberately.
    expect(
      L.matchingRows(after, { category: 'core', name: 'ctdbs_kith' }).length,
      'the log should record the Kith change'
    ).toBe(1);
  });

  test('370 Change 7 - raise the Glamour source; the log records each edit (Banality does not exist anywhere in the application)', async () => {
    const cid = state.character.id;

    // Glamour is derived from the `Seeming` background (finding 5).
    const owned = (await readTraits(memberPage, cid, 'ctdbs_backgrounds', 'Changeling')).map((t) => t.name);
    expect(owned, 'Seeming is not already owned').not.toContain(SEEMING);

    await L.parkOnSheet(memberPage, cid);
    await openNewTraitChange(memberPage, cid, 'ctdbs_backgrounds', SEEMING);
    await setTraitChangeSliders(memberPage, { value: 1 });
    await saveTraitChange(memberPage, cid, 'ctdbs_backgrounds');

    await navigateToHash(memberPage, `character/${cid}/print`, '#printable-sheet');
    const printAt1 = normalize(await memberPage.locator('#printable-sheet').textContent());
    expect(printAt1, 'Seeming 1 produces a Glamour pool of 14').toMatch(/Glamour\s*(?:O|\s)*14/);

    // Raise it: a second, separate edit on the same source.
    await hardReload(memberPage);
    await L.parkOnSheet(memberPage, cid);
    await openTraitChange(memberPage, cid, 'ctdbs_backgrounds', SEEMING);
    await setTraitChangeSliders(memberPage, { value: 2 });
    await saveTraitChange(memberPage, cid, 'ctdbs_backgrounds');

    const raised = (await readTraits(memberPage, cid, 'ctdbs_backgrounds', 'Changeling')).find((t) => t.name === SEEMING);
    expect(raised).toMatchObject({ value: 2, cost: BACKGROUND_COST });

    await navigateToHash(memberPage, `character/${cid}/print`, '#printable-sheet');
    const printAt2 = normalize(await memberPage.locator('#printable-sheet').textContent());
    expect(printAt2, 'Seeming 2 moves the Glamour pool to 13').toMatch(/Glamour\s*(?:O|\s)*13/);
    expect(printAt2, 'Banality exists nowhere in this application').not.toMatch(/banality/i);

    const rows = await L.readAllLogRows(memberPage, cid);
    const define = L.freshestRow(rows, { category: 'ctdbs_backgrounds', name: SEEMING, type: 'define' });
    expect(define).toMatchObject({ value: 1, old_value: null });
    expect(L.numCost(define.cost)).toBe(BACKGROUND_COST);
    const update = L.freshestRow(rows, { category: 'ctdbs_backgrounds', name: SEEMING, type: 'update' });
    expect(update, 'the raise is logged with correct old and new values').toMatchObject({ old_value: 1, value: 2 });

    // Assertion-side read-back of the derived value the sheet is rendering.
    const seeming = await runInApp(memberPage, ['app/models/ChangelingBetaSlice'], `
      return mods[0].get_character(arg.id, "all").then(function (c) { return c.seeming(); });
    `, { id: cid });
    expect(seeming, 'the model agrees with the printed pool').toBe(2);
    console.log('[t12-changeling] 370 measured: Seeming 1 -> Glamour 14, Seeming 2 -> Glamour 13; no Banality anywhere');
  });

  test('371 Change 8 - add a background at an increased rating; the log records the cost it is actually charged', async () => {
    const cid = state.character.id;
    // "Freehold" is not a seeded `ctdbs_backgrounds` name (the catalogue is
    // Allies, Alternate Identity, Chimerical Companion, Contacts, Dreamers,
    // Fame, Holdings, Influences, Kinain, Resources, Seeming, Treasures), so
    // an unowned one is chosen at runtime instead of inventing game content.
    const owned = (await readTraits(memberPage, cid, 'ctdbs_backgrounds', 'Changeling')).map((t) => t.name);
    const catalogue = await memberPage.evaluate(async () => {
      const q = new window.Parse.Query('Description');
      q.equalTo('category', 'ctdbs_backgrounds');
      q.limit(1000);
      const rows = await q.find();
      return rows.map((r) => ({ name: r.get('name'), requirement: r.get('requirement') || null }));
    });
    expect(catalogue.some((c) => c.name === 'Freehold'), 'there is no seeded "Freehold" background').toBe(false);

    const target = catalogue.find((c) =>
      !c.requirement && c.name !== HOLDINGS_BASE && c.name !== SEEMING && owned.indexOf(c.name) === -1);
    expect(target, 'an unowned plain ctdbs_background is available').toBeTruthy();

    const xpBefore = await readSheetXp(memberPage, cid);
    await L.parkOnSheet(memberPage, cid);
    await openNewTraitChange(memberPage, cid, 'ctdbs_backgrounds', target.name);
    await setTraitChangeSliders(memberPage, { value: 2 });
    const quote = await readTraitChangeView(memberPage);
    expect(quote.cost, 'an increased rating still costs nothing (finding 4)').toBe(BACKGROUND_COST);
    await saveTraitChange(memberPage, cid, 'ctdbs_backgrounds');
    const xpAfter = await readSheetXp(memberPage, cid);
    expect(xpAfter, 'so the ledger does not move').toEqual(xpBefore);

    const bought = (await readTraits(memberPage, cid, 'ctdbs_backgrounds', 'Changeling')).find((t) => t.name === target.name);
    expect(bought, `${target.name} at the increased rating`).toMatchObject({
      value: 2, free_value: 0, cost: BACKGROUND_COST
    });

    const rows = await L.readAllLogRows(memberPage, cid);
    const row = L.freshestRow(rows, { category: 'ctdbs_backgrounds', name: target.name, type: 'define' });
    expect(row, 'the log records the increased rating').toMatchObject({ value: 2, old_value: null });
    expect(L.numCost(row.cost), 'at the zero cost BNSCTDBS_ChangelingCosts actually returns').toBe(BACKGROUND_COST);
    console.log(`[t12-changeling] 371 measured: "${target.name}" bought at value 2 for 0 XP and logged with a blank cost cell`);
    state.changes.background = target.name;
  });

  test('372 Change 9 - edit all three long texts; the log deliberately records none of them', async () => {
    // The same two mechanisms as items 329 and 352, re-measured on a Changeling.
    const cid = state.character.id;
    const before = await L.readAllLogRows(memberPage, cid);

    const written = await L.editAllLongTexts(memberPage, cid, FIXTURE_PREFIX);
    for (const key of Object.keys(written)) {
      expect(await L.readLongText(memberPage, cid, key), `${key} persisted`).toBe(written[key]);
    }

    const after = await L.readAllLogRows(memberPage, cid);
    expect(after.length, 'measured: no log row is written for any long-text edit').toBe(before.length);
    console.log('[t12-changeling] 372 measured: three long-text edits produced 0 new log rows');

    // INVERTED, per remediation R47c and the owner's ruling behind it: long
    // texts can be large enough that logging them would bloat the audit trail,
    // so they stay out of it on purpose. Turned around rather than deleted, so
    // that anyone who later adds long texts to `tracked_texts` fails here,
    // loudly, instead of silently removing an intended guarantee.
    expect(after.length - before.length, 'a long-text edit writes no log row, by design').toBe(0);
  });

  test('373 Change 10 - rename the character; the log records the old and new name', async () => {
    const cid = state.character.id;
    state.renamedName = `${FIXTURE_PREFIX}Renamed ${Date.now().toString(36)}`;

    const result = await L.renameCharacter(memberPage, cid, state.renamedName);
    expect(result.isSuccess, `rename feedback was "${result.text}"`).toBe(true);

    await hardReload(memberPage);
    await navigateToHash(memberPage, `character?${cid}`, '#character');
    await expect(memberPage.locator('#character h2').first()).toHaveText(state.renamedName);

    const rows = await L.readAllLogRows(memberPage, cid);
    const row = L.freshestRow(rows, { category: 'core', name: 'name', type: 'core_update' });
    expect(row).toMatchObject({ old_text: state.originalName, new_text: state.renamedName });

    // `name` is the *only* tracked text a Changeling has, so this is also the
    // only `core` row this character will ever own.
    expect(L.matchingRows(rows, { category: 'core' }).length, 'exactly one core row exists, the rename').toBe(1);
    expect(rows[0], 'the rename is the newest row in the log').toMatchObject({
      category: 'core', name: 'name', new_text: state.renamedName
    });
    console.log(`[t12-changeling] 373: log now holds ${rows.length} rows`);
  });

  // =========================================================================
  // 374-378 - player log, admin log, access control
  // =========================================================================

  test('374 Player log as owner shows all changes in reverse-chronological order', async () => {
    const cid = state.character.id;
    const rows = await L.readAllLogRows(memberPage, cid);
    expect(rows.length, 'the log holds every change made so far').toBeGreaterThanOrEqual(35);

    const order = L.isNonIncreasing(rows);
    expect(order.ok, `timestamps are non-increasing; first inversion: ${JSON.stringify(order.rows)}`).toBe(true);

    expect(rows[0]).toMatchObject({ category: 'core', name: 'name', new_text: state.renamedName });
    expect(rows[rows.length - 1].type).toMatch(/^define$/);

    const renameIdx = rows.findIndex((r) => r.category === 'core' && r.name === 'name');
    const backgroundIdx = rows.findIndex((r) => r.category === 'ctdbs_backgrounds' && r.name === state.changes.background);
    const artIdx = rows.findIndex((r) => r.category === 'ctdbs_arts' && r.name === state.changes.art && r.type === 'define');
    expect(renameIdx).toBeLessThan(backgroundIdx);
    expect(backgroundIdx).toBeLessThan(artIdx);
  });

  test('375 Player log paginates correctly across at least three pages', async () => {
    test.setTimeout(240000);
    const cid = state.character.id;
    const full = await L.readAllLogRows(memberPage, cid);
    expect(full.length, 'at least three pages of ten rows exist').toBeGreaterThanOrEqual(30);

    const pages = [];
    for (let p = 0; p < 3; p++) {
      pages.push(await L.readLogPage(memberPage, cid, p * 10, 10));
    }

    for (let p = 0; p < 3; p++) {
      expect(pages[p].length, `page ${p} is a full page of ten`).toBe(10);
      expect(pages[p].map(L.fingerprint), `page ${p} equals rows ${p * 10}-${p * 10 + 9} of the full log`)
        .toEqual(full.slice(p * 10, p * 10 + 10).map(L.fingerprint));
    }

    // Gaps and duplicates, stated exactly: the three pages concatenated must
    // be the first thirty rows of the full read, in order and with the same
    // multiplicity. A multiset comparison rather than a distinct-count is
    // deliberate - the rendered table has no id column and `createdAt` is only
    // minute-granular, so two genuinely different `VampireChange` rows can be
    // indistinguishable once rendered (an Art destroyed and immediately
    // re-granted by a Kith change is exactly that shape). What matters is that
    // pagination neither dropped a row nor produced an extra copy of one.
    const tally = (arr) => arr.reduce((m, f) => { m[f] = (m[f] || 0) + 1; return m; }, {});
    const pagedFingerprints = pages.flat().map(L.fingerprint);
    const headFingerprints = full.slice(0, 30).map(L.fingerprint);
    expect(pagedFingerprints, 'the three pages in order are the first thirty rows of the log').toEqual(headFingerprints);
    expect(tally(pagedFingerprints), 'with no row dropped and none duplicated').toEqual(tally(headFingerprints));
    const repeated = Object.entries(tally(pagedFingerprints)).filter(([, n]) => n > 1);
    if (repeated.length) {
      console.log('[pagination] rendered fingerprints that repeat (distinct rows that render identically):',
        JSON.stringify(repeated.map(([f, n]) => ({ n, f }))));
    }

    await L.readLogPage(memberPage, cid, 0, 10);
    await memberPage.locator('#character-log button.next').click();
    await waitForJqmLoader(memberPage);
    await memberPage.waitForFunction(
      (h) => window.location.hash === h,
      `#character/${cid}/log/10/10`,
      { timeout: 20000 }
    );
    await memberPage.waitForFunction((first) => {
      const root = document.querySelector('#character-log');
      const cell = root && root.querySelector('table tbody tr td:nth-child(3)');
      return !!cell && cell.textContent.replace(/\s+/g, ' ').replace(/^name/, '').trim() !== first;
    }, normalize(pages[0][0].name), { timeout: 20000 });
    expect((await readLogRows(memberPage)).map(L.fingerprint), 'the Next button renders page 1')
      .toEqual(pages[1].map(L.fingerprint));
  });

  test('376 Player log rows show populated old/new value and cost cells', async () => {
    const cid = state.character.id;
    const rows = await L.readAllLogRows(memberPage, cid);

    const physical = L.matchingRows(rows, { category: 'attributes', name: 'Physical', type: 'update' })[0];
    expect(physical, 'the second Physical edit is present').toBeTruthy();
    for (const column of ['old_value', 'value', 'old_cost', 'cost']) {
      expect(physical[column], `${column} is populated on the second Physical edit`).not.toBeNull();
    }
    expect(physical).toMatchObject({
      old_value: state.physicalBase + 1,
      value: state.physicalBase + 2,
      old_cost: ATTRIBUTE_PER_POINT,
      cost: 2 * ATTRIBUTE_PER_POINT
    });

    // Exactly one row on a Changeling can carry all four cells at once, and
    // the reason is structural rather than incidental: a row needs a non-zero
    // *old* cost as well as a new one, which means raising something that
    // already cost XP. Every `ctdbs_backgrounds` purchase resolves to zero
    // (finding 4) and so renders blank, Arts here are bought once rather than
    // upgraded, and a first definition has no old value - which leaves the
    // second attribute edit as the only qualifying row.
    const fullyPopulated = rows.filter((r) =>
      r.old_value !== null && r.value !== null && r.old_cost !== null && r.cost !== null);
    expect(fullyPopulated.length, 'at least one row carries all four cells').toBeGreaterThanOrEqual(1);
    expect(fullyPopulated.map((r) => `${r.category}/${r.name}/${r.type}`))
      .toEqual(['attributes/Physical/update']);

    const paidDefine = L.freshestRow(rows, { category: 'ctdbs_arts', name: state.changes.art, type: 'define' });
    expect(paidDefine.value).not.toBeNull();
    expect(paidDefine.cost).not.toBeNull();
    expect(paidDefine.old_value, 'a first definition has no prior value').toBeNull();

    console.log(`[t12-changeling] 376: ${fullyPopulated.length}/${rows.length} rows carry all four value/cost cells`);
  });

  test('377 Admin log via #administration/character/:id matches the player log row for row', async () => {
    test.setTimeout(240000);
    const cid = state.character.id;

    await hardReload(adminPage);
    await navigateToHash(adminPage, `administration/character/${cid}`, '#character');
    await expect(adminPage.locator('#character h2').first()).toHaveText(state.renamedName);
    const logLink = adminPage.locator(`#character a[href="#character/${cid}/log/0/10"]`);
    await expect(logLink, 'the admin sheet offers a Log link').toHaveCount(1);
    await logLink.first().click();
    await waitForJqmLoader(adminPage);
    await adminPage.waitForFunction(() => {
      const el = document.querySelector('.ui-page-active');
      return !!el && el.id === 'character-log';
    }, { timeout: 25000 });
    await expect(adminPage.locator('#character-log h1').first()).toHaveText(state.renamedName);
    expect((await readLogRows(adminPage)).length, 'the first page renders for the admin').toBe(10);

    const playerRows = await L.readAllLogRows(memberPage, cid);
    const adminRows = await L.readAllLogRows(adminPage, cid);
    expect(adminRows.length, 'admin and owner see the same number of rows').toBe(playerRows.length);

    const diffs = L.logDifferences(playerRows, adminRows, 'player', 'admin');
    expect(diffs, `admin and player logs differ:\n${diffs.slice(0, 20).join('\n')}`).toEqual([]);

    const playerSet = new Set(playerRows.map(L.fingerprint));
    const adminOnly = adminRows.filter((r) => !playerSet.has(L.fingerprint(r)));
    console.log('[t12-changeling] 377 admin-only rows:', JSON.stringify(adminOnly));
    expect(adminOnly, 'no row is visible only to the admin').toEqual([]);

    state.parity = { playerRows, adminRows };
    console.log(`[t12-changeling] 377: ${playerRows.length} rows agree across all ${L.PARITY_COLUMNS.length} columns`);
  });

  test('378 The troupe AST can view the log; a stranger user cannot', async () => {
    const cid = state.character.id;
    const playerRows = state.parity.playerRows;

    const astRows = await L.readAllLogRows(astPage, cid);
    expect(astRows.length, 'the AST sees the same rows as the owner').toBe(playerRows.length);
    expect(L.logDifferences(playerRows, astRows, 'player', 'ast')).toEqual([]);

    await hardReload(strangerPage);
    await strangerPage.evaluate((id) => { window.location.hash = `#character/${id}/log/0/10`; }, cid);
    await strangerPage.waitForTimeout(5000);
    const strangerState = await strangerPage.evaluate(() => ({
      hash: window.location.hash,
      active: (document.querySelector('.ui-page-active') || {}).id || null
    }));
    expect(strangerState.active, 'the stranger never reaches the log page').not.toBe('character-log');
    expect(await readLogRows(strangerPage), 'and renders no rows').toEqual([]);

    const strangerVisible = await strangerPage.evaluate(async (id) => {
      const q = new window.Parse.Query('VampireChange');
      q.equalTo('owner', window.Parse.Object.extend('Vampire').createWithoutData(id));
      return q.count();
    }, cid);
    expect(strangerVisible, 'no VampireChange row is readable by the stranger').toBe(0);
    console.log(`[t12-changeling] 378: AST sees ${astRows.length} rows, stranger sees 0 (active page "${strangerState.active}")`);
  });

  // =========================================================================
  // 379-380 - history timeline and cost reconciliation
  // =========================================================================

  test('379 The history timeline steps through at least ten versions with correct snapshots', async () => {
    test.setTimeout(300000);
    const cid = state.character.id;
    const rows = state.parity.playerRows;

    await L.openHistory(memberPage, cid);
    const bounds = await L.readHistoryBounds(memberPage);
    expect(bounds.changeCount, 'the timeline knows about every recorded change').toBe(rows.length);
    expect(bounds.max).toBe(rows.length - 1);
    expect(bounds.value, 'and starts on the newest').toBe(rows.length - 1);

    const steps = [];
    for (let k = 0; k < 12; k++) {
      const index = bounds.max - k;
      const expected = rows[k];
      const tables = await L.setHistoryIndex(memberPage, index, expected);

      expect(tables.applied, `index ${index} renders a "Most Recent Change Applied" row`).toBeTruthy();
      expect(tables.applied.name).toBe(expected.name);
      expect(tables.applied.category).toBe(expected.category);
      expect(tables.applied.type).toBe(expected.type);
      expect(tables.applied.value).toBe(expected.value);

      if (k === 0) {
        expect(tables.tables, 'nothing is reversed at the newest index').toBe(1);
      } else {
        expect(tables.tables).toBe(2);
        expect(tables.reversed.name, `index ${index} reverses log row ${k - 1}`).toBe(rows[k - 1].name);
      }

      const sheet = await L.readHistorySheetText(memberPage);
      expect(sheet.length, `index ${index} renders a printable snapshot`).toBeGreaterThan(400);
      steps.push({ index, applied: tables.applied.name, sheetLength: sheet.length });
    }
    expect(steps.length).toBeGreaterThanOrEqual(10);

    await L.setHistoryIndex(memberPage, bounds.max, rows[0]);
    expect(await L.readHistorySheetText(memberPage), 'the newest snapshot shows the renamed character')
      .toContain(state.renamedName);

    await L.setHistoryIndex(memberPage, bounds.max - 1, rows[1]);
    const rolledBack = await L.readHistorySheetText(memberPage);
    expect(rolledBack, 'one step back restores the pre-rename name').toContain(state.originalName);
    expect(rolledBack, 'and no longer shows the new one').not.toContain(state.renamedName);

    const physicalFirstEditIdx = rows.map((r, i) => ({ r, i }))
      .filter(({ r }) => r.category === 'attributes' && r.name === 'Physical' && r.type === 'update')
      .map(({ i }) => i)
      .sort((a, b) => b - a)[0];
    expect(physicalFirstEditIdx, 'the Physical edits are in the log').toBeGreaterThan(0);
    await L.setHistoryIndex(memberPage, bounds.max - physicalFirstEditIdx - 1, rows[physicalFirstEditIdx + 1]);
    expect(await L.readHistorySheetText(memberPage), 'the pre-raise snapshot shows the creation value of Physical')
      .toMatch(new RegExp(`Physical\\s*${state.physicalBase}(\\D|$)`));
    console.log('[t12-changeling] 379 stepped:', JSON.stringify(steps));
  });

  test('380 The costs view reconciles against the sum of the logged costs', async () => {
    const cid = state.character.id;
    const costs = await L.readCostsView(memberPage, cid);
    expect(costs.length, 'the costs view lists this character\'s traits').toBeGreaterThan(15);

    const rows = await L.readAllLogRows(memberPage, cid);
    const mismatches = [];
    let costsTotal = 0;
    let loggedTotal = 0;

    for (const entry of costs) {
      costsTotal += entry.cost;
      const forName = rows.filter((r) => r.name === entry.name && r.type !== 'remove');
      if (forName.length === 0) {
        mismatches.push(`${entry.name}: no log row`);
        continue;
      }
      const logged = L.numCost(forName[0].cost);
      loggedTotal += logged;
      if (logged !== entry.cost) {
        mismatches.push(`${entry.name}: costs view ${entry.cost}, freshest log row ${logged}`);
      }
    }

    console.log(`[t12-changeling] 380: costs view total ${costsTotal}, summed freshest logged costs ${loggedTotal}`);
    expect(mismatches, `per-trait cost reconciliation:\n${mismatches.join('\n')}`).toEqual([]);
    expect(loggedTotal, 'the totals reconcile exactly').toBe(costsTotal);

    // The purchased Art is the only trait on this character that costs
    // anything beyond the two attribute points, because every
    // `ctdbs_backgrounds` purchase resolves to zero (finding 4). Pinning that
    // explicitly stops the reconciliation from passing vacuously on a sheet
    // of nothing but zeroes.
    const art = costs.find((c) => c.name === state.changes.art);
    expect(art, 'the purchased Art appears in the costs view').toBeTruthy();
    expect(art.cost, 'at the non-affinity price it was charged and logged at').toBe(NON_AFFINITY_ART_AT_1);
    expect(costsTotal, 'the reconciled total is a real, non-trivial number').toBeGreaterThan(NON_AFFINITY_ART_AT_1);
  });
});
