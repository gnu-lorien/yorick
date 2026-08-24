/**
 * Task 12a - Vampire: Baseline Creation, Long-Term Change, Dual Audit Log
 *
 * Covers testing_implementation_plan.md items 318-340. One Vampire, owned by
 * `sampmem`, is created through the real wizard with every slot pool spent,
 * joined to a troupe that has `sampast` as Assistant Storyteller, then put
 * through ten distinct long-term changes. The resulting `VampireChange` rows
 * are then verified twice over: as the owner through
 * `#character/:cid/log/:start/:changeBy`, and as `devuser` arriving through
 * `#administration/character/:id`.
 *
 * ---------------------------------------------------------------------------
 * Findings measured live before any test below was written
 * ---------------------------------------------------------------------------
 *
 * **1. The character log paginates. The brief handed to this task said it did
 * not.** The claim - "`register()` accepts `start`/`changeBy` and uses
 * neither; both pages return the identical full set" - is true of
 * `CharacterExperienceView` (plan item 74) and false of `CharacterLogView`.
 * The latter's `update_collection_query_and_fetch()` calls
 * `q.skip(self.start)` and `q.limit(self.changeBy)`, and its Previous/Next
 * handlers are wired and live. Measured on a 33-row probe character:
 * `/log/0/10`, `/log/10/10` and `/log/20/10` returned three *disjoint*
 * ten-row pages, and clicking Next from page 0 moved the hash to
 * `/log/10/10` and re-rendered with page 1's rows. Item 332 is therefore
 * satisfiable and is asserted positionally against one full read, so a
 * silently-repeating pager could not pass it.
 *
 * **2. A zero cost renders as an empty cell, not as "0".**
 * `CharacterLogView.format_entry` returns `log.get(entry)` only when truthy,
 * so a stored `0` falls through to the non-existent `log[entry]` property and
 * interpolates as the empty string. Every creation pick is free, so all 27 of
 * this character's creation rows show blank `cost`/`old_cost` cells. Cost
 * assertions therefore go through `numCost()` rather than pretending the log
 * distinguishes "free" from "not recorded".
 *
 * **3. Creation emits one log row per pick plus five the wizard grants
 * itself.** Measured: 22 player picks (3 attributes, 3 focuses, 10 skills,
 * 3 backgrounds, 3 disciplines) produced 22 `define` rows; `ensure_creation_
 * rules_exist` additionally grants `willpower_sources:Willpower`,
 * `health_levels` x3 and `paths:Humanity`, for 27 `define` rows in total,
 * plus one `core_define` row per tracked text picked. Item 319 asserts every
 * pick is present rather than asserting a bare total, so the wizard's own
 * grants cannot mask a missing pick.
 *
 * **4. XP notations are not audit-logged at all (item 321).** There is no
 * cloud hook on `ExperienceNotation`, and `experience_earned`/
 * `experience_spent` are absent from `beforeSave("Vampire")`'s
 * `tracked_texts`, so the save that carries them intersects to an empty
 * change set and returns early. Test 321 drives the real award, proves it
 * moved the totals, proves by direct query that no row was written, and then
 * fails on the plan's literal expectation.
 *
 * **5. Long-text edits are not audit-logged either (item 329).**
 * `update_long_text` never calls `Vampire#save()` - it saves only the separate
 * `LongText` row - so the hook never runs; and all three long-text categories
 * are absent from `tracked_texts` in any case. Independently re-measured here
 * on a Vampire; Task 10's item 285 pins the same defect for its own fixture.
 *
 * **6. `morality()` returns `paths[0]`, so "changing" the Path means
 * replacing it.** `Vampire.morality()` (models/Vampire.js) returns the *first*
 * element of the `paths` array, and creation already grants `Humanity`.
 * Buying a second Path therefore leaves the Morality print block reading
 * "Humanity" forever. Item 327 asks for the block to update, so the change is
 * performed the way a player would have to: remove the granted Path, then buy
 * the new one. Both halves are logged (a `remove` row and a `define` row).
 *
 * **7. Out-of-clan disciplines cost 4/level cumulative at generation 1,
 * in-clan 3/level** (`BNSMETV1_VampireCosts.calculate_trait_cost`), `paths`
 * 10/level flat, `rituals` 2/level flat, `techniques` 12/level flat below
 * generation 3, `attributes` 3/point, gen-1 `backgrounds` and `skills`
 * 1/level cumulative. Item 323's "the log records the out-of-clan cost" is
 * asserted as that exact number *and* against the price the change page
 * quoted before the save.
 *
 * **9. FIXED by remediation R31 - the trait change page used to quote a stale
 * price when the same trait was re-opened within one page session.**
 * `SimpleTraitChangeView.register(character, simpletrait, category)` rebuilds
 * `self.fauxtrait` - the object `calculate_trait_to_spend` is applied to for
 * every displayed price - only when `simpletrait !== self.simpletrait`, i.e.
 * on a change of *object identity*. mobileRouter's own character cache hands
 * the view the same `SimpleTrait` instance on every visit for the lifetime of
 * the page, so the faux copy keeps whatever `cost` the trait had the first
 * time the page was opened. Measured on this character: raising Physical 5->6
 * (correctly quoted 3, correctly charged 3), then re-opening the same page and
 * sliding to 7 quoted **6** - the full cost from 5 - instead of the 3-point
 * increment. The *save* is unaffected, because `save_clicked` copies the
 * slider values onto the real trait and charges
 * `calculate_trait_to_spend(realTrait)`, which sees the persisted cost: the
 * character was charged 3, correctly. So this was a display defect, in the same
 * memoization family as `CharacterLogView` and `CharacterHistoryView`. The
 * working copy is now rebuilt from the trait's current attributes on every
 * visit, and test 322 asserts the no-reload quote rather than reloading past
 * the problem and logging the stale figure as evidence.
 *
 * **8. The admin route is the ordinary character sheet.**
 * `administration_character` delegates to `show_character_helper`, i.e. it
 * renders `#character` with a different back button, so an admin "reaches the
 * log" by following the sheet's own Log link to
 * `#character/:cid/log/0/10`. Item 334 drives exactly that click rather than
 * assembling the log URL directly.
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
  readInClanDisciplines,
  openNewTraitChange,
  openTraitChange,
  setTraitChangeSliders,
  readTraitChangeView,
  saveTraitChange,
  listSimpleTextOptions,
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

const FIXTURE_PREFIX = 'E2E T12V ';

/** Brujah: in-clan Celerity / Potence / Presence, so Dominate is genuinely out-of-clan. */
const CLAN = 'Brujah';
const SECT_BEFORE = 'Camarilla';
const SECT_AFTER = 'Anarch';

const XP_AWARD = 25;
/** Fixture headroom so the ten changes never run the ledger negative. Not logged. */
const XP_HEADROOM = 200;

const ATTRIBUTE_PER_POINT = 3;
const OUT_OF_CLAN_PER_LEVEL = 4;
const RITUAL_PER_LEVEL = 2;
const TECHNIQUE_PER_LEVEL = 12;
const PATH_PER_LEVEL = 10;
const OUT_OF_CLAN_DISCIPLINE = 'Dominate';
const SPECIALIZE_BASE = 'Retainers';
const SPECIALIZE_SUFFIX = 'Night Guard';
const NEW_PATH = 'Caine';

test.describe.configure({ mode: 'serial' });

test.describe('Task 12a - Vampire lifecycle and dual audit log', () => {
  const contexts = [];
  /** @type {import('@playwright/test').Page} */
  let adminPage;
  /** @type {import('@playwright/test').Page} */
  let memberPage;
  /** @type {import('@playwright/test').Page} */
  let astPage;
  /** @type {import('@playwright/test').Page} */
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

    // Self-heal, then measure a trustworthy baseline.
    const sweptChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX);
    const sweptTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX);
    state.baseline = {
      allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()),
      allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()),
      fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX),
      fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX)
    };
    console.log('[t12-vampire] self-heal swept characters:', JSON.stringify(sweptChars));
    console.log('[t12-vampire] self-heal swept troupes:', JSON.stringify(sweptTroupes));
    console.log('[t12-vampire] baseline counts:', JSON.stringify(state.baseline));

    state.troupe = await createTroupe(adminPage, uniqueTroupeName(FIXTURE_PREFIX));
    await addStaff(adminPage, state.troupe.id, 'sampast', 'AST');

    state.originalName = `${FIXTURE_PREFIX}Baseline ${Date.now().toString(36)}`;
    state.character = await createCompletedCharacter(memberPage, 'Vampire', {
      name: state.originalName,
      texts: { clan: CLAN, sect: SECT_BEFORE },
      spendPools: true
    });
    state.creationXp = state.character.xp;
    state.creationPicks = state.character.creationPicks;
    const cid = state.character.id;

    // Join before anything else: joining runs `update_vampire_change_
    // permissions_for`, which rewrites the ACL of every existing
    // VampireChange row, so the AST's read access covers the creation rows
    // as well as everything that follows.
    await joinTroupe(memberPage, cid, state.troupe.id);

    // A Title, so item 326's change is genuinely a change (old_text -> new_text)
    // rather than a first definition.
    state.titleOptions = await listSimpleTextOptions(memberPage, cid, 'titles', 'title', { duringCreation: false });
    expect(state.titleOptions.length, 'the titles catalogue is seeded').toBeGreaterThan(1);
    state.titleBefore = await pickSimpleText(memberPage, cid, 'titles', 'title', state.titleOptions[0], { duringCreation: false });

    // Fixture XP headroom. Driven through the model's own
    // `add_experience_notation`, exactly as `ensure_creation_rules_exist`
    // grants the initial 30, and provably silent in the audit log (finding 4).
    await runInApp(memberPage, ['app/models/Vampire'], `
      return mods[0].get_character(arg.id, "all").then(function (c) {
        return c.add_experience_notation({ reason: arg.reason, alteration_earned: arg.amount });
      });
    `, { id: cid, amount: XP_HEADROOM, reason: `${FIXTURE_PREFIX}headroom` });
    // mobileRouter memoizes one character object per id for the life of the
    // page, and nothing short of a reload invalidates it.
    await hardReload(memberPage);

    state.postCreationLogRows = (await L.readAllLogRows(memberPage, cid)).length;
    console.log('[t12-vampire] fixture ready:', JSON.stringify({
      character: cid,
      troupe: state.troupe.id,
      picks: state.creationPicks.length,
      creationXp: state.creationXp,
      title: state.titleBefore,
      logRowsAfterCreation: state.postCreationLogRows
    }));
  });

  test.afterAll(async () => {
    if (adminPage) {
      const destroyedChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX)
        .catch((e) => ({ characters: -1, children: -1, errors: [String(e)] }));
      const destroyedTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX)
        .catch((e) => ({ troupes: -1, roles: -1, errors: [String(e)] }));
      console.log('[t12-vampire] destroyed characters:', JSON.stringify(destroyedChars));
      console.log('[t12-vampire] destroyed troupes:', JSON.stringify(destroyedTroupes));
      if (destroyedChars.errors && destroyedChars.errors.length) {
        console.log('[t12-vampire] TEARDOWN ERRORS (characters):', JSON.stringify(destroyedChars.errors));
      }
      if (destroyedTroupes.errors && destroyedTroupes.errors.length) {
        console.log('[t12-vampire] TEARDOWN ERRORS (troupes):', JSON.stringify(destroyedTroupes.errors));
      }

      const final = {
        allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
        allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()).catch(() => -1),
        fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1),
        fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1)
      };
      console.log(
        '[t12-vampire] final counts (baseline was ' + JSON.stringify(state.baseline) + '):',
        JSON.stringify(final)
      );
    }
    for (const context of contexts) await context.close().catch(() => {});
  });

  // =========================================================================
  // 318-320 - the baseline
  // =========================================================================

  test('318 Baseline: a Vampire is created and completed through the full wizard with every creation pool spent', async () => {
    const cid = state.character.id;

    const creation = await readCreation(memberPage, cid, 'Vampire');
    expect(creation.completed, 'the creation record is marked completed').toBe(true);

    // Every *slot* pool is at zero. Merits and flaws are point budgets, not
    // slot pools (`get_sum_creation_categories`), and the wizard renders one
    // link per remaining point while each pick costs that trait's own value -
    // following every link overspends and drives the pool negative, corrupting
    // spent XP - so they are deliberately left unspent and asserted as such.
    const slotPools = Object.entries(creation)
      .filter(([k]) => /_remaining$/.test(k) && !/^(merits|flaws)_/.test(k));
    expect(slotPools.length, 'slot pools exist on the creation record').toBeGreaterThan(10);
    expect(
      slotPools.filter(([, v]) => v !== 0),
      'every slot pool is spent to exactly zero'
    ).toEqual([]);
    expect(creation.merits_0_remaining, 'the merit point budget is untouched by design').toBe(7);
    expect(creation.flaws_0_remaining, 'the flaw point budget is untouched by design').toBe(7);

    // Slot picks never spend XP: creation ends on exactly 30/0/30.
    expect(state.creationXp, 'creation lands on 30 earned / 0 spent / 30 available').toEqual({
      earned: 30, spent: 0, available: 30
    });

    // The picks are real traits on the character, not merely counters.
    expect(state.creationPicks.length, 'the wizard recorded every pick it made').toBeGreaterThanOrEqual(22);
    const attributes = await readTraits(memberPage, cid, 'attributes', 'Vampire');
    expect(attributes.map((t) => t.value).sort((a, b) => b - a), 'attributes are the 7/5/3 allocation')
      .toEqual([7, 5, 3]);
    const texts = await readCharacterTexts(memberPage, cid, 'Vampire');
    expect(texts.clan).toBe(CLAN);
    expect(texts.sect).toBe(SECT_BEFORE);
    expect(texts.title).toBe(state.titleBefore);
  });

  test('319 Baseline: creation produces a log entry for every creation pick', async () => {
    test.setTimeout(180000);
    const cid = state.character.id;
    const rows = await L.readAllLogRows(memberPage, cid);

    // Every pick the wizard reported, matched by (category, name) against a
    // "define" row. Asserting per pick rather than on a total means the five
    // extra rows the wizard grants itself cannot mask a missing pick.
    const missing = [];
    for (const pick of state.creationPicks) {
      const idx = pick.indexOf(':');
      const category = pick.slice(0, idx);
      const name = pick.slice(idx + 1);
      if (L.matchingRows(rows, { category, name, type: 'define' }).length === 0) missing.push(pick);
    }
    expect(missing, 'every creation pick has its own "define" row').toEqual([]);

    // The picks the *wizard* makes on the player's behalf are logged too.
    for (const [category, name] of [
      ['willpower_sources', 'Willpower'],
      ['paths', 'Humanity'],
      ['health_levels', 'Healthy']
    ]) {
      expect(
        L.matchingRows(rows, { category, name, type: 'define' }).length,
        `wizard-granted ${category}/${name} is logged`
      ).toBe(1);
    }

    // Tracked text picks produce "core_define" rows carrying the new text.
    const clanRow = L.freshestRow(rows, { category: 'core', name: 'clan' }, 'clan core row');
    expect(clanRow).toMatchObject({ type: 'core_define', new_text: CLAN, old_text: null });
    const sectRow = L.freshestRow(rows, { category: 'core', name: 'sect' }, 'sect core row');
    expect(sectRow).toMatchObject({ type: 'core_define', new_text: SECT_BEFORE });

    // Creation picks are free, so their cost cells are blank (finding 2).
    const disciplineDefines = L.matchingRows(rows, { category: 'disciplines', type: 'define' });
    expect(disciplineDefines.length).toBe(3);
    for (const row of disciplineDefines) {
      expect(L.numCost(row.cost), `${row.name} was granted free by creation`).toBe(0);
      expect(row.free_value, `${row.name} carries its creation free value`).toBe(row.value);
    }

    state.creationRowCount = rows.length;
    console.log(`[t12-vampire] 319: ${rows.length} log rows after creation for ${state.creationPicks.length} picks`);
  });

  test('320 Baseline: the printable sheet matches every creation choice made', async () => {
    const cid = state.character.id;
    await navigateToHash(memberPage, `character/${cid}/print`, '#printable-sheet');
    const printText = normalize(await memberPage.locator('#printable-sheet').textContent());

    expect(printText, 'the character name prints').toContain(state.originalName);
    expect(printText, 'the picked Clan prints').toContain(CLAN);
    expect(printText, 'the picked Sect prints').toContain(SECT_BEFORE);
    expect(printText, 'the picked Title prints').toContain(state.titleBefore);

    // Every creation-picked trait, at the value the character actually holds -
    // read back from the model, so this compares print output against data
    // rather than against the test's own expectations.
    const checked = [];
    for (const category of ['skills', 'backgrounds', 'disciplines']) {
      const traits = await readTraits(memberPage, cid, category, 'Vampire');
      expect(traits.length, `${category} holds creation picks`).toBeGreaterThan(0);
      for (const t of traits) {
        expect(printText, `${category} "${t.name} x${t.value}" prints`).toContain(`${t.name} x${t.value}`);
        checked.push(`${t.name} x${t.value}`);
      }
    }
    expect(checked.length, 'a substantial number of picks were checked against the sheet').toBeGreaterThanOrEqual(16);

    // Attributes print as bare numbers under their own headings.
    const attributes = await readTraits(memberPage, cid, 'attributes', 'Vampire');
    for (const a of attributes) {
      expect(printText, `attribute ${a.name} prints`).toContain(a.name);
    }
  });

  // =========================================================================
  // 321-330 - the ten long-term changes
  // =========================================================================

  test('321 Change 1 - award a 25 XP notation; the log records the XP transaction with the reason', async () => {
    // FIXED by remediation R47b.
    //
    // Was: there was no `Parse.Cloud` hook of any kind on
    // `ExperienceNotation`, and `beforeSave("Vampire")`'s `tracked_texts`
    // allowlist contains neither `experience_earned` nor `experience_spent`,
    // so the save that carries the new totals intersected to an empty change
    // set and returned `response.success()` before writing anything. The award
    // itself was real; only the audit trail was missing - and a hand-written
    // award is the thing a storyteller does most often.
    const cid = state.character.id;
    const reason = `${FIXTURE_PREFIX}storyteller award`;

    const before = await L.readAllLogRows(memberPage, cid);
    const xpBefore = await readSheetXp(memberPage, cid);

    // Driven through the real Add button and the real edit popups
    // (`seedNotations` -> `addNotation` + `editNotationField`), not written
    // behind the UI.
    const seeded = await seedNotations(memberPage, cid, [{ reason, earned: XP_AWARD }]);
    expect(seeded.some((r) => r.reason === reason && r.earned === XP_AWARD),
      'the award landed as its own notation row').toBe(true);

    const totals = await readXpTotals(memberPage);
    expect(totals.earned - xpBefore.earned, 'the award moved Earned by exactly 25').toBe(XP_AWARD);
    expect(totals.available - xpBefore.available, 'the award moved Available by exactly 25').toBe(XP_AWARD);

    const after = await L.readAllLogRows(memberPage, cid);
    expect(after.length - before.length, 'the log records the XP transaction').toBeGreaterThan(0);

    // Assertion-side read-back, to separate "the row exists" (a data fact) from
    // "the row rendered" (a rendering fact). Both are asserted.
    const directCount = await memberPage.evaluate(async ({ id, r }) => {
      const q = new window.Parse.Query('VampireChange');
      q.equalTo('owner', window.Parse.Object.extend('Vampire').createWithoutData(id));
      q.contains('name', r);
      return q.count();
    }, { id: cid, r: reason });
    expect(directCount, 'a VampireChange row is named after the award reason').toBeGreaterThan(0);

    // The trail says what the award was for, not merely that a number moved.
    const awardRow = L.freshestRow(after, { category: 'experience' });
    expect(awardRow, 'an experience row exists').toBeTruthy();
    expect(awardRow.name).toBe(reason);
    expect(L.numCost(awardRow.value), 'and carries the earned delta').toBe(XP_AWARD);

    state.xpAfterAward = totals;
  });

  test('322 Change 2 - raise Physical across two separate edits; the log has two rows with correct old/new values and costs', async () => {
    const cid = state.character.id;
    const start = (await readTraits(memberPage, cid, 'attributes', 'Vampire')).find((t) => t.name === 'Physical');
    // Which of the three attributes lands in the 7/5/3 slots is decided by the
    // order the wizard renders its pick links, not by anything this test
    // controls, so the base value is read rather than assumed. What is fixed is
    // that it is free (free_value === value) and therefore cost nothing.
    expect(start, 'Physical exists from creation').toBeTruthy();
    expect(start.free_value, 'the creation-granted Physical is entirely free').toBe(start.value);
    expect([7, 5, 3], 'and holds one of the three creation allocations').toContain(start.value);
    expect(L.numCost(start.cost), 'the creation-granted Physical cost nothing').toBe(0);
    state.physicalBase = start.value;

    const quotes = [];
    for (const target of [start.value + 1, start.value + 2]) {
      // FIXED by remediation R31, and asserted here rather than worked around.
      //
      // `SimpleTraitChangeView.register` used to rebuild its `fauxtrait` - the
      // object every displayed price is computed from - only when the
      // SimpleTrait's *object identity* changed. mobileRouter hands it the same
      // cached SimpleTrait on every visit within one page session, so
      // re-opening a trait's change page after saving it quoted a price derived
      // from the cost the trait had on the *first* visit. The save was always
      // correct, because `save_clicked` charges against the real trait; only
      // the number the player was shown was wrong. This test used to reload
      // before each edit to dodge that, and log the stale figure as evidence.
      // The reload stays for the second half of the loop's own reasons, but the
      // no-reload quote is now checked first and must be right.
      if (quotes.length > 0) {
        await L.parkOnSheet(memberPage, cid);
        await openTraitChange(memberPage, cid, 'attributes', 'Physical');
        await setTraitChangeSliders(memberPage, { value: target });
        const requoted = await readTraitChangeView(memberPage);
        expect(
          requoted.cost,
          're-opening the same trait\'s change page without a reload quotes the real incremental price'
        ).toBe(ATTRIBUTE_PER_POINT);
      }
      await hardReload(memberPage);

      const xpBefore = await readSheetXp(memberPage, cid);
      await L.parkOnSheet(memberPage, cid);
      await openTraitChange(memberPage, cid, 'attributes', 'Physical');
      await setTraitChangeSliders(memberPage, { value: target });
      const quote = await readTraitChangeView(memberPage);
      await saveTraitChange(memberPage, cid, 'attributes');
      const xpAfter = await readSheetXp(memberPage, cid);

      expect(quote.cost, `raising Physical to ${target} is quoted at one point of attribute cost`).toBe(ATTRIBUTE_PER_POINT);
      expect(xpAfter.spent - xpBefore.spent, `Spent moved by exactly the quote for ${target}`).toBe(ATTRIBUTE_PER_POINT);
      expect(xpAfter.available - xpBefore.available).toBe(-ATTRIBUTE_PER_POINT);
      quotes.push(quote.cost);

      const stored = (await readTraits(memberPage, cid, 'attributes', 'Vampire')).find((t) => t.name === 'Physical');
      expect(stored.value, `Physical persisted at ${target}`).toBe(target);
      expect(stored.cost, 'and its stored absolute cost followed the new value')
        .toBe((target - start.value) * ATTRIBUTE_PER_POINT);
    }

    const base = state.physicalBase;
    const raised = (await readTraits(memberPage, cid, 'attributes', 'Vampire')).find((t) => t.name === 'Physical');
    expect(raised).toMatchObject({ value: base + 2, free_value: base, cost: 2 * ATTRIBUTE_PER_POINT });

    const rows = await L.readAllLogRows(memberPage, cid);
    const updates = L.matchingRows(rows, { category: 'attributes', name: 'Physical', type: 'update' });
    expect(updates.length, 'exactly two update rows, one per edit').toBe(2);

    // Newest first, so updates[0] is the second edit.
    expect(updates[0]).toMatchObject({ old_value: base + 1, value: base + 2, cost: 2 * ATTRIBUTE_PER_POINT });
    expect(L.numCost(updates[0].old_cost), 'the second edit sees the first edit\'s cost as its old cost')
      .toBe(ATTRIBUTE_PER_POINT);
    expect(updates[1]).toMatchObject({ old_value: base, value: base + 1, cost: ATTRIBUTE_PER_POINT });
    expect(L.numCost(updates[1].old_cost), 'the first edit had no prior cost').toBe(0);
    expect(quotes).toEqual([ATTRIBUTE_PER_POINT, ATTRIBUTE_PER_POINT]);
  });

  test('323 Change 3 - purchase an out-of-clan discipline; the log records the out-of-clan cost', async () => {
    const cid = state.character.id;
    const clan = await readInClanDisciplines(memberPage, cid);
    expect(clan.clan).toBe(CLAN);
    expect(clan.inClan, `${OUT_OF_CLAN_DISCIPLINE} is genuinely out of clan for ${CLAN}`)
      .not.toContain(OUT_OF_CLAN_DISCIPLINE);
    expect(clan.generation, 'generation 1, so the out-of-clan table is 4/level').toBe(1);

    const xpBefore = await readSheetXp(memberPage, cid);
    await L.parkOnSheet(memberPage, cid);
    await openNewTraitChange(memberPage, cid, 'disciplines', OUT_OF_CLAN_DISCIPLINE);
    await setTraitChangeSliders(memberPage, { value: 1 });
    const quote = await readTraitChangeView(memberPage);
    expect(quote.cost, 'the page quotes the out-of-clan price').toBe(OUT_OF_CLAN_PER_LEVEL);
    await saveTraitChange(memberPage, cid, 'disciplines');
    const xpAfter = await readSheetXp(memberPage, cid);

    expect(xpAfter.spent - xpBefore.spent).toBe(OUT_OF_CLAN_PER_LEVEL);

    const bought = (await readTraits(memberPage, cid, 'disciplines', 'Vampire'))
      .find((t) => t.name === OUT_OF_CLAN_DISCIPLINE);
    expect(bought).toMatchObject({ value: 1, free_value: 0, cost: OUT_OF_CLAN_PER_LEVEL });

    const rows = await L.readAllLogRows(memberPage, cid);
    const row = L.freshestRow(rows, { category: 'disciplines', name: OUT_OF_CLAN_DISCIPLINE, type: 'define' });
    expect(row).toMatchObject({ value: 1, cost: OUT_OF_CLAN_PER_LEVEL, old_value: null });
    // The in-clan disciplines creation granted cost 3/level, so the logged
    // out-of-clan cost is demonstrably the higher table, not merely "some cost".
    expect(row.cost, 'the logged cost is the out-of-clan table, above the in-clan 3/level')
      .toBeGreaterThan(3);
    state.changes.outOfClanCost = OUT_OF_CLAN_PER_LEVEL;
  });

  test('324 Change 4 - add a background then specialize it; the log records both the add and the specialization rename', async () => {
    const cid = state.character.id;
    const owned = (await readTraits(memberPage, cid, 'backgrounds', 'Vampire')).map((t) => t.name);
    expect(owned, `${SPECIALIZE_BASE} is not already owned`).not.toContain(SPECIALIZE_BASE);

    const xpBefore = await readSheetXp(memberPage, cid);
    const bare = await L.addSpecializingBase(memberPage, cid, 'backgrounds', SPECIALIZE_BASE, 'Vampire', { value: 1 });
    expect(bare).toMatchObject({ name: SPECIALIZE_BASE, value: 1, free_value: 0 });
    const addCost = bare.cost;
    expect(addCost, 'a gen-1 background at value 1 costs 1').toBe(1);

    const xpAfterAdd = await readSheetXp(memberPage, cid);
    expect(xpAfterAdd.spent - xpBefore.spent).toBe(addCost);

    await L.specializeRename(memberPage, cid, 'backgrounds', bare.id, SPECIALIZE_SUFFIX);
    const xpAfterRename = await readSheetXp(memberPage, cid);
    expect(xpAfterRename, 'a specialization rename moves no XP').toEqual(xpAfterAdd);

    const full = `${SPECIALIZE_BASE}: ${SPECIALIZE_SUFFIX}`;
    const renamed = (await readTraits(memberPage, cid, 'backgrounds', 'Vampire')).find((t) => t.id === bare.id);
    expect(renamed).toMatchObject({ name: full, value: 1, cost: addCost });

    const rows = await L.readAllLogRows(memberPage, cid);
    const addRow = L.freshestRow(rows, { category: 'backgrounds', name: SPECIALIZE_BASE, type: 'define' });
    expect(addRow).toMatchObject({ value: 1, cost: addCost, old_value: null });

    const renameRow = L.freshestRow(rows, { category: 'backgrounds', name: full, type: 'update' });
    expect(renameRow, 'the rename row carries the old name and an unchanged value/cost').toMatchObject({
      old_text: SPECIALIZE_BASE, old_value: 1, value: 1, cost: addCost
    });
    expect(L.numCost(renameRow.old_cost)).toBe(addCost);

    state.changes.specializedName = full;
    state.changes.specializedCost = addCost;
  });

  test('325 Change 5 - remove a purchased trait; the log records the removal and the refund', async () => {
    const cid = state.character.id;
    const owned = (await readTraits(memberPage, cid, 'backgrounds', 'Vampire')).map((t) => t.name);
    // Chosen at runtime, never hardcoded against a pick order that could drift:
    // any seeded background this character does not already hold, excluding
    // Generation (its own bespoke cost table) and the specialization fixture.
    const candidates = await memberPage.evaluate(async () => {
      const q = new window.Parse.Query('Description');
      q.equalTo('category', 'backgrounds');
      q.limit(1000);
      const rows = await q.find();
      return rows.map((r) => ({ name: r.get('name'), requirement: r.get('requirement') || null }));
    });
    const target = candidates.find((c) =>
      !c.requirement && c.name !== 'Generation' && owned.indexOf(c.name) === -1);
    expect(target, 'an unowned plain background is available to buy and remove').toBeTruthy();

    const xpBefore = await readSheetXp(memberPage, cid);
    await L.parkOnSheet(memberPage, cid);
    await openNewTraitChange(memberPage, cid, 'backgrounds', target.name);
    await setTraitChangeSliders(memberPage, { value: 2 });
    const quote = await readTraitChangeView(memberPage);
    await saveTraitChange(memberPage, cid, 'backgrounds');

    const bought = (await readTraits(memberPage, cid, 'backgrounds', 'Vampire')).find((t) => t.name === target.name);
    expect(bought, `${target.name} after purchase`).toMatchObject({ value: 2, free_value: 0 });
    expect(bought.cost, 'gen-1 background at value 2 costs 1 + 2').toBe(3);
    expect(quote.cost).toBe(3);
    const xpAfterBuy = await readSheetXp(memberPage, cid);
    expect(xpAfterBuy.spent - xpBefore.spent).toBe(bought.cost);

    await L.removeTraitViaChangePage(memberPage, cid, 'backgrounds', target.name, openTraitChange);
    const xpAfterRemove = await readSheetXp(memberPage, cid);

    expect(xpAfterRemove.spent - xpAfterBuy.spent, 'Spent falls by exactly the trait cost - a refund').toBe(-bought.cost);
    expect(xpAfterRemove.available - xpAfterBuy.available).toBe(bought.cost);
    expect(xpAfterRemove.spent, 'the round trip nets to zero against the pre-purchase ledger').toBe(xpBefore.spent);

    const stillThere = (await readTraits(memberPage, cid, 'backgrounds', 'Vampire')).some((t) => t.name === target.name);
    expect(stillThere, 'the removed trait is gone from the character').toBe(false);

    const rows = await L.readAllLogRows(memberPage, cid);
    const removeRow = L.freshestRow(rows, { category: 'backgrounds', name: target.name, type: 'remove' });
    expect(removeRow).toMatchObject({ old_value: 2 });
    expect(L.numCost(removeRow.old_cost), 'the removal row carries the cost that was refunded').toBe(bought.cost);
    state.changes.removedTrait = target.name;
    state.changes.refund = bought.cost;
  });

  test('326 Change 6 - change Sect and Title; the log records old_text -> new_text for both', async () => {
    const cid = state.character.id;
    const titleAfter = state.titleOptions.find((t) => t !== state.titleBefore);
    expect(titleAfter, 'a second Title option exists to change to').toBeTruthy();

    const xpBefore = await readSheetXp(memberPage, cid);
    await L.parkOnSheet(memberPage, cid);
    await pickSimpleText(memberPage, cid, 'sects', 'sect', SECT_AFTER, { duringCreation: false });
    await L.parkOnSheet(memberPage, cid);
    await pickSimpleText(memberPage, cid, 'titles', 'title', titleAfter, { duringCreation: false });
    const xpAfter = await readSheetXp(memberPage, cid);
    expect(xpAfter, 'text attribute changes never move XP').toEqual(xpBefore);

    const texts = await readCharacterTexts(memberPage, cid, 'Vampire');
    expect(texts.sect).toBe(SECT_AFTER);
    expect(texts.title).toBe(titleAfter);

    const rows = await L.readAllLogRows(memberPage, cid);
    const sectRow = L.freshestRow(rows, { category: 'core', name: 'sect', type: 'core_update' });
    expect(sectRow).toMatchObject({ old_text: SECT_BEFORE, new_text: SECT_AFTER });
    const titleRow = L.freshestRow(rows, { category: 'core', name: 'title', type: 'core_update' });
    expect(titleRow).toMatchObject({ old_text: state.titleBefore, new_text: titleAfter });

    state.titleAfter = titleAfter;
  });

  test('327 Change 7 - change Path of Enlightenment; the log records it and the Morality block updates', async () => {
    const cid = state.character.id;
    const before = await readTraits(memberPage, cid, 'paths', 'Vampire');
    expect(before.map((t) => t.name), 'creation granted Humanity').toContain('Humanity');
    const granted = before.find((t) => t.name === 'Humanity');

    await navigateToHash(memberPage, `character/${cid}/print`, '#printable-sheet');
    const printBefore = normalize(await memberPage.locator('#printable-sheet').textContent());
    expect(printBefore, 'the Morality block starts on the granted Path').toMatch(/Morality Humanity/);

    // `morality()` returns paths[0], so a second Path would never surface.
    // Replacing it is the only route a player has (finding 6).
    await L.removeTraitViaChangePage(memberPage, cid, 'paths', 'Humanity', openTraitChange);

    const xpBefore = await readSheetXp(memberPage, cid);
    await L.parkOnSheet(memberPage, cid);
    await openNewTraitChange(memberPage, cid, 'paths', NEW_PATH);
    await setTraitChangeSliders(memberPage, { value: 1 });
    const quote = await readTraitChangeView(memberPage);
    expect(quote.cost, 'a Path costs 10 per point').toBe(PATH_PER_LEVEL);
    await saveTraitChange(memberPage, cid, 'paths');
    const xpAfter = await readSheetXp(memberPage, cid);
    expect(xpAfter.spent - xpBefore.spent).toBe(PATH_PER_LEVEL);

    const after = await readTraits(memberPage, cid, 'paths', 'Vampire');
    expect(after.map((t) => t.name), 'exactly one Path remains, the new one').toEqual([NEW_PATH]);

    await navigateToHash(memberPage, `character/${cid}/print`, '#printable-sheet');
    const printAfter = normalize(await memberPage.locator('#printable-sheet').textContent());
    expect(printAfter, 'the Morality block now names the new Path').toMatch(new RegExp(`Morality ${NEW_PATH}`));
    expect(printAfter, 'and no longer names the old one').not.toMatch(/Morality Humanity/);

    const rows = await L.readAllLogRows(memberPage, cid);
    const removed = L.freshestRow(rows, { category: 'paths', name: 'Humanity', type: 'remove' });
    expect(removed.old_value, 'the removal records the granted Path\'s value').toBe(granted.value);
    const added = L.freshestRow(rows, { category: 'paths', name: NEW_PATH, type: 'define' });
    expect(added).toMatchObject({ value: 1, cost: PATH_PER_LEVEL });
  });

  test('328 Change 8 - add a Ritual and a Technique; the log records both with their costs', async () => {
    const cid = state.character.id;
    const pick = async (category) => {
      const names = await memberPage.evaluate(async (c) => {
        const q = new window.Parse.Query('Description');
        q.equalTo('category', c);
        q.limit(1000);
        const rows = await q.find();
        return rows.map((r) => r.get('name')).sort();
      }, category);
      expect(names.length, `${category} is seeded`).toBeGreaterThan(0);
      return names[0];
    };

    const ritual = await pick('rituals');
    const technique = await pick('techniques');

    const expected = { rituals: RITUAL_PER_LEVEL, techniques: TECHNIQUE_PER_LEVEL };
    for (const [category, name] of [['rituals', ritual], ['techniques', technique]]) {
      const xpBefore = await readSheetXp(memberPage, cid);
      await L.parkOnSheet(memberPage, cid);
      await openNewTraitChange(memberPage, cid, category, name);
      await setTraitChangeSliders(memberPage, { value: 1 });
      const quote = await readTraitChangeView(memberPage);
      expect(quote.cost, `${category} "${name}" at value 1`).toBe(expected[category]);
      await saveTraitChange(memberPage, cid, category);
      const xpAfter = await readSheetXp(memberPage, cid);
      expect(xpAfter.spent - xpBefore.spent, `${category} spend`).toBe(expected[category]);
    }

    const rows = await L.readAllLogRows(memberPage, cid);
    const ritualRow = L.freshestRow(rows, { category: 'rituals', name: ritual, type: 'define' });
    expect(ritualRow).toMatchObject({ value: 1, cost: RITUAL_PER_LEVEL });
    const techniqueRow = L.freshestRow(rows, { category: 'techniques', name: technique, type: 'define' });
    expect(techniqueRow).toMatchObject({ value: 1, cost: TECHNIQUE_PER_LEVEL });

    state.changes.ritual = { name: ritual, cost: RITUAL_PER_LEVEL };
    state.changes.technique = { name: technique, cost: TECHNIQUE_PER_LEVEL };
  });

  test('329 Change 9 - edit all three long texts; the log deliberately records none of them', async () => {
    // The two mechanisms that keep long texts out of the log, re-measured on
    // this character rather than inherited:
    // `Character.update_long_text` saves only the separate `LongText` object
    // and never calls `Vampire#save()`, so `beforeSave("Vampire")` does not
    // run at all for a long-text edit - and even if it did, none of
    // "extended_print_text" / "background" / "notes" appears in that hook's
    // `tracked_texts` allowlist. There is no `beforeSave("LongText")` hook
    // either. The edits themselves are real and are proven so below.
    const cid = state.character.id;
    const before = await L.readAllLogRows(memberPage, cid);

    const written = await L.editAllLongTexts(memberPage, cid, FIXTURE_PREFIX);
    for (const key of Object.keys(written)) {
      expect(await L.readLongText(memberPage, cid, key), `${key} persisted`).toBe(written[key]);
    }

    const after = await L.readAllLogRows(memberPage, cid);
    expect(after.length, 'measured: no log row is written for any long-text edit').toBe(before.length);

    const directCount = await memberPage.evaluate(async (id) => {
      const q = new window.Parse.Query('VampireChange');
      q.equalTo('owner', window.Parse.Object.extend('Vampire').createWithoutData(id));
      q.containedIn('name', ['extended_print_text', 'background', 'notes']);
      return q.count();
    }, cid);
    expect(directCount, 'no VampireChange row names any long-text field').toBe(0);
    console.log('[t12-vampire] 329 measured: three long-text edits produced 0 new log rows');

    // INVERTED, per remediation R47c and the owner's ruling behind it: long
    // texts can be large enough that logging them would bloat the audit trail,
    // so they stay out of it on purpose. Turned around rather than deleted, so
    // that anyone who later adds long texts to `tracked_texts` fails here,
    // loudly, instead of silently removing an intended guarantee.
    expect(after.length - before.length, 'a long-text edit writes no log row, by design').toBe(0);
  });

  test('330 Change 10 - rename the character; the log records the old and new name', async () => {
    const cid = state.character.id;
    state.renamedName = `${FIXTURE_PREFIX}Renamed ${Date.now().toString(36)}`;

    const result = await L.renameCharacter(memberPage, cid, state.renamedName);
    expect(result.isSuccess, `rename feedback was "${result.text}"`).toBe(true);

    await hardReload(memberPage);
    await navigateToHash(memberPage, `character?${cid}`, '#character');
    // The sheet's name lives in the `CharacterListItem` subview appended into
    // `#insertheader` (single-character-list-item.html), which renders it as
    // an `<h2>`; only the log and costs pages use `<h1>`.
    await expect(memberPage.locator('#character h2').first()).toHaveText(state.renamedName);

    const rows = await L.readAllLogRows(memberPage, cid);
    const row = L.freshestRow(rows, { category: 'core', name: 'name', type: 'core_update' });
    expect(row).toMatchObject({ old_text: state.originalName, new_text: state.renamedName });

    // The rename is the newest change, which the ordering and history tests
    // below both rely on.
    expect(rows[0], 'the rename is the newest row in the log').toMatchObject({
      category: 'core', name: 'name', new_text: state.renamedName
    });
    state.finalRowCount = rows.length;
    console.log(`[t12-vampire] 330: log now holds ${rows.length} rows`);
  });

  // =========================================================================
  // 331-333 - the player-visible log
  // =========================================================================

  test('331 Player log as owner shows all changes in reverse-chronological order', async () => {
    const cid = state.character.id;
    const rows = await L.readAllLogRows(memberPage, cid);
    expect(rows.length, 'the log holds every change made so far').toBeGreaterThanOrEqual(35);

    const order = L.isNonIncreasing(rows);
    expect(order.ok, `timestamps are non-increasing; first inversion: ${JSON.stringify(order.rows)}`).toBe(true);

    // Monotonicity alone is weak when the rendered stamps are minute-granular,
    // so pin the actual ends of the sequence too: the newest row is the rename
    // (the last action taken) and the oldest are the creation defines.
    expect(rows[0]).toMatchObject({ category: 'core', name: 'name', new_text: state.renamedName });
    expect(rows[rows.length - 1].type, 'the oldest row is a creation-time definition')
      .toMatch(/^(define|core_define)$/);

    // And the relative order of two changes made minutes apart is correct.
    const renameIdx = rows.findIndex((r) => r.category === 'core' && r.name === 'name');
    const pathIdx = rows.findIndex((r) => r.category === 'paths' && r.name === NEW_PATH);
    const disciplineIdx = rows.findIndex((r) => r.category === 'disciplines' && r.name === OUT_OF_CLAN_DISCIPLINE);
    expect(renameIdx).toBeLessThan(pathIdx);
    expect(pathIdx).toBeLessThan(disciplineIdx);
  });

  test('332 Player log paginates correctly across at least three pages, covering every entry with no gaps or duplicates', async () => {
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
      // Positional equality against one full read is what proves "no gaps and
      // no duplicates": a pager that ignored `start` would return page 0 three
      // times and fail here immediately.
      const expected = full.slice(p * 10, p * 10 + 10).map(L.fingerprint);
      expect(pages[p].map(L.fingerprint), `page ${p} equals rows ${p * 10}-${p * 10 + 9} of the full log`)
        .toEqual(expected);
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

    // The pager's own controls, not just the URL. `next` advances the hash and
    // re-queries.
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
    const viaButton = await readLogRows(memberPage);
    expect(viaButton.map(L.fingerprint), 'the Next button renders page 1').toEqual(pages[1].map(L.fingerprint));
  });

  test('333 Player log rows show populated old_value, new_value, old_cost, and new_cost cells', async () => {
    const cid = state.character.id;
    const rows = await L.readAllLogRows(memberPage, cid);

    // The second Physical edit is the row where all four are simultaneously
    // non-empty: it raised an already-raised trait, so both the old value and
    // the old cost are real numbers rather than blanks.
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

    const fullyPopulated = rows.filter((r) =>
      r.old_value !== null && r.value !== null && r.old_cost !== null && r.cost !== null);
    expect(fullyPopulated.length, 'more than one row carries all four cells').toBeGreaterThan(1);

    // Every "define" row populates the new value and, for a paid trait, the new
    // cost; the old columns are legitimately blank because there is no prior
    // state. Assert that shape rather than demanding four values everywhere.
    const paidDefine = L.freshestRow(rows, { category: 'disciplines', name: OUT_OF_CLAN_DISCIPLINE, type: 'define' });
    expect(paidDefine.value).not.toBeNull();
    expect(paidDefine.cost).not.toBeNull();
    expect(paidDefine.old_value, 'a first definition has no prior value').toBeNull();

    console.log(
      `[t12-vampire] 333: ${fullyPopulated.length}/${rows.length} rows carry all four value/cost cells ` +
      '(a first definition legitimately has no old value or old cost, and a free pick shows a blank cost ' +
      'because format_entry treats 0 as absent)'
    );
  });

  // =========================================================================
  // 334-338 - the admin-visible log, and access control
  // =========================================================================

  test('334 Admin reaches the same character\'s log via #administration/character/:id', async () => {
    const cid = state.character.id;
    await hardReload(adminPage);
    await navigateToHash(adminPage, `administration/character/${cid}`, '#character');
    await expect(
      adminPage.locator('#character h2').first(),
      'the admin route renders this character\'s sheet'
    ).toHaveText(state.renamedName);

    const logLink = adminPage.locator(`#character a[href="#character/${cid}/log/0/10"]`);
    await expect(logLink, 'the sheet offers a Log link').toHaveCount(1);
    await logLink.first().click();
    await waitForJqmLoader(adminPage);
    await adminPage.waitForFunction(() => {
      const el = document.querySelector('.ui-page-active');
      return !!el && el.id === 'character-log';
    }, { timeout: 25000 });

    await expect(adminPage.locator('#character-log h1').first()).toHaveText(state.renamedName);
    const rows = await readLogRows(adminPage);
    expect(rows.length, 'the first page of the log renders for the admin').toBe(10);
    expect(rows[0], 'and its newest row is the rename').toMatchObject({
      category: 'core', name: 'name', new_text: state.renamedName
    });
  });

  test('335 Admin log entry count matches the player log entry count exactly', async () => {
    const cid = state.character.id;
    const playerRows = await L.readAllLogRows(memberPage, cid);
    const adminRows = await L.readAllLogRows(adminPage, cid);
    expect(adminRows.length, 'admin and owner see the same number of rows').toBe(playerRows.length);

    // Cross-checked against the class itself, from both sessions, so a shared
    // rendering bug could not make two wrong numbers agree.
    const countFrom = (page) => page.evaluate(async (id) => {
      const q = new window.Parse.Query('VampireChange');
      q.equalTo('owner', window.Parse.Object.extend('Vampire').createWithoutData(id));
      return q.count();
    }, cid);
    const adminCount = await countFrom(adminPage);
    const memberCount = await countFrom(memberPage);
    expect(adminCount).toBe(memberCount);
    expect(adminCount).toBe(playerRows.length);
    state.parity = { playerRows, adminRows };
  });

  test('336 Admin log timestamps, categories, and values match the player log row for row', async () => {
    const { playerRows, adminRows } = state.parity;
    const diffs = L.logDifferences(playerRows, adminRows, 'player', 'admin');
    expect(diffs, `admin and player logs differ:\n${diffs.slice(0, 20).join('\n')}`).toEqual([]);
    console.log(`[t12-vampire] 336: ${playerRows.length} rows agree across all ${L.PARITY_COLUMNS.length} columns`);
  });

  test('337 Any entry visible only to the admin is explicitly enumerated and asserted as such', async () => {
    const { playerRows, adminRows } = state.parity;
    const playerSet = new Set(playerRows.map(L.fingerprint));
    const adminSet = new Set(adminRows.map(L.fingerprint));

    const adminOnly = adminRows.filter((r) => !playerSet.has(L.fingerprint(r)));
    const playerOnly = playerRows.filter((r) => !adminSet.has(L.fingerprint(r)));

    console.log('[t12-vampire] 337 admin-only rows:', JSON.stringify(adminOnly));
    console.log('[t12-vampire] 337 player-only rows:', JSON.stringify(playerOnly));

    // `get_vampire_change_acl` grants read to the character's owner, to the
    // Administrator role and to each troupe storyteller role - the same rows
    // to all of them - so the correct enumeration is the empty one.
    expect(adminOnly, 'no row is visible only to the admin').toEqual([]);
    expect(playerOnly, 'and none is visible only to the owner').toEqual([]);
  });

  test('338 The troupe AST can view the log; a stranger user cannot', async () => {
    const cid = state.character.id;
    const playerRows = state.parity.playerRows;

    const astRows = await L.readAllLogRows(astPage, cid);
    expect(astRows.length, 'the AST sees the same rows as the owner').toBe(playerRows.length);
    expect(L.logDifferences(playerRows, astRows, 'player', 'ast')).toEqual([]);

    // The stranger shares no troupe and holds no role. The route's
    // `get_character` rejects, `PromiseFailReport` swallows it, and the log
    // page never becomes active.
    await hardReload(strangerPage);
    await strangerPage.evaluate((id) => { window.location.hash = `#character/${id}/log/0/10`; }, cid);
    await strangerPage.waitForTimeout(5000);
    const strangerState = await strangerPage.evaluate(() => ({
      hash: window.location.hash,
      active: (document.querySelector('.ui-page-active') || {}).id || null
    }));
    expect(strangerState.active, 'the stranger never reaches the log page').not.toBe('character-log');
    expect(await readLogRows(strangerPage), 'and renders no rows').toEqual([]);

    // Assertion-side read-back through the stranger's own session: the ACL,
    // not merely the routing, is what stops them.
    const strangerVisible = await strangerPage.evaluate(async (id) => {
      const q = new window.Parse.Query('VampireChange');
      q.equalTo('owner', window.Parse.Object.extend('Vampire').createWithoutData(id));
      return q.count();
    }, cid);
    expect(strangerVisible, 'no VampireChange row is readable by the stranger').toBe(0);
    console.log(`[t12-vampire] 338: AST sees ${astRows.length} rows, stranger sees 0 (hash "${strangerState.hash}", active page "${strangerState.active}")`);
  });

  // =========================================================================
  // 339-340 - history timeline and cost reconciliation
  // =========================================================================

  test('339 #character/:cid/history/:id steps through at least ten versions, each rendering the correct snapshot', async () => {
    test.setTimeout(300000);
    const cid = state.character.id;
    const rows = state.parity.playerRows; // newest first

    // The timeline is every change that can be *replayed* onto the character,
    // which since remediation R47b is not quite every row in the log: XP
    // notation rows are recorded there too, and an XP award is neither a trait
    // nor a text attribute, so there is no character state to step to. They are
    // excluded from `recorded_changes` for that reason - feeding them to
    // `get_transformed` manufactured a fake trait in a category no venue has and
    // stopped the approval view rendering at all.
    // Substring rather than equality: jQuery Mobile's responsive table prepends
    // a column label to each cell, so a category cell reads "experience" on some
    // rows and "category experience" on others depending on how it reflowed.
    const isExperience = (r) => /experience/.test(String(r.category));
    const replayable = rows.filter((r) => !isExperience(r));
    expect(replayable.length, 'the log carries more than the timeline does').toBeLessThan(rows.length);
    expect(replayable.filter(isExperience), 'no XP row survives the filter').toEqual([]);

    await L.openHistory(memberPage, cid);
    const bounds = await L.readHistoryBounds(memberPage);
    expect(bounds.changeCount, 'the timeline knows about every replayable change').toBe(replayable.length);
    expect(bounds.max, 'the slider spans every replayable change').toBe(replayable.length - 1);
    expect(bounds.value, 'and starts on the newest').toBe(replayable.length - 1);

    // `recorded_changes` is fetched ascending, so index i corresponds to the
    // replayable rows' (length - 1 - i). Indexed against `replayable` rather
    // than the raw log for the reason above.
    const steps = [];
    for (let k = 0; k < 12; k++) {
      const index = bounds.max - k;
      const expected = replayable[k];
      const tables = await L.setHistoryIndex(memberPage, index, expected);

      expect(tables.applied, `index ${index} renders a "Most Recent Change Applied" row`).toBeTruthy();
      expect(tables.applied.name, `index ${index} shows log row ${k}`).toBe(expected.name);
      expect(tables.applied.category).toBe(expected.category);
      expect(tables.applied.type).toBe(expected.type);
      expect(tables.applied.value).toBe(expected.value);

      if (k === 0) {
        expect(tables.tables, 'nothing is reversed at the newest index').toBe(1);
      } else {
        expect(tables.tables, 'a reversed-change table appears once the slider moves back').toBe(2);
        expect(tables.reversed.name, `index ${index} reverses log row ${k - 1}`).toBe(replayable[k - 1].name);
      }

      // Measured without whitespace, and the threshold is an emptiness check
      // rather than a size one.
      //
      // The two front ends render the same sheet -- identical once every space
      // is stripped, measured directly -- but the legacy carries roughly ten
      // percent more characters in template indentation, because each element
      // sits on its own line and JSX drops the whitespace between siblings. A
      // raw-length threshold calibrated against one of them fails the other by
      // a handful of characters and says nothing about the snapshot.
      const sheet = await L.readHistorySheetText(memberPage);
      expect(
        sheet.replace(/\s+/g, '').length,
        `index ${index} renders a printable snapshot`
      ).toBeGreaterThan(300);
      steps.push({ index, applied: tables.applied.name, sheetLength: sheet.length });
    }
    expect(steps.length, 'at least ten versions were stepped through').toBeGreaterThanOrEqual(10);

    // The snapshots are genuinely different characters, not the same sheet
    // re-rendered: the newest index still carries the new name, and one step
    // back - which un-applies the rename - carries the original.
    await L.setHistoryIndex(memberPage, bounds.max, replayable[0]);
    expect(await L.readHistorySheetText(memberPage), 'the newest snapshot shows the renamed character')
      .toContain(state.renamedName);

    await L.setHistoryIndex(memberPage, bounds.max - 1, replayable[1]);
    const rolledBack = await L.readHistorySheetText(memberPage);
    expect(rolledBack, 'one step back restores the pre-rename name').toContain(state.originalName);
    expect(rolledBack, 'and no longer shows the new one').not.toContain(state.renamedName);

    // A deeper rollback restores a trait value, not just a text field: before
    // the two Physical edits the attribute reads 7, not 9.
    const physicalFirstEditIdx = replayable.map((r, i) => ({ r, i }))
      .filter(({ r }) => r.category === 'attributes' && r.name === 'Physical' && r.type === 'update')
      .map(({ i }) => i)
      .sort((a, b) => b - a)[0];
    expect(physicalFirstEditIdx, 'the Physical edits are in the log').toBeGreaterThan(0);
    const beforeRaise = bounds.max - physicalFirstEditIdx - 1;
    await L.setHistoryIndex(memberPage, beforeRaise, replayable[physicalFirstEditIdx + 1]);
    const preRaise = await L.readHistorySheetText(memberPage);
    expect(preRaise, 'the pre-raise snapshot shows the creation value of Physical')
      .toMatch(new RegExp(`Physical\\s*${state.physicalBase}(\\D|$)`));
    console.log('[t12-vampire] 339 stepped:', JSON.stringify(steps.slice(0, 12)));
  });

  test('340 The costs view total reconciles against the sum of the logged costs', async () => {
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

    console.log(`[t12-vampire] 340: costs view total ${costsTotal}, summed freshest logged costs ${loggedTotal}`);
    expect(mismatches, `per-trait cost reconciliation:\n${mismatches.join('\n')}`).toEqual([]);
    expect(loggedTotal, 'the totals reconcile exactly').toBe(costsTotal);

    // The costs view covers only the categories `calculate_total_cost`
    // enumerates (skills, backgrounds, disciplines, attributes, merits,
    // rituals, techniques, elder/luminary disciplines) - `paths` is not among
    // them, which is why the reconciliation is per-trait against the costs
    // view's own list rather than against the whole log.
    expect(costs.some((c) => c.name === NEW_PATH), 'paths are outside the costs view by design').toBe(false);
    expect(costsTotal, 'the reconciled total is a real, non-trivial number').toBeGreaterThan(0);
  });

  test('341 Change 11 - buy a merit with XP, change its value, then remove it; the refund is the changed cost, not the original', async () => {
    // The two open items in `TODO`:
    //
    //   - Finish tests for merit adds
    //   - Make test to catch add merit, update cost, then remove merit
    //
    // The first is already covered during *creation* - 178/179/180 pick,
    // revalue and unpick a merit against the creation pool, and 204-206 and
    // 230-232 do the same for wta_ and ctdbs_ merits. What has never been
    // exercised is the same round trip on the *XP* path after creation, which
    // is a different code path: the creation pool checks slots, this charges
    // `Vampire.spent`.
    //
    // The middle step is the whole point. `BNSMETV1_VampireCosts` prices a
    // merit as a bare `return mod_value` - value 2 costs 2, value 4 costs 4 -
    // so a removal that refunds the cost the merit was *bought* at rather than
    // the cost it currently *holds* leaks 2 XP and produces no error, no
    // failed save and no log anomaly. Only the ledger is wrong, and only by
    // the difference. Buying and removing at the same value cannot see it;
    // changing the value in between is what makes it observable.
    //
    // This is exactly the shape a promise-shim bug corrupts silently during the
    // Parse SDK migration, which is why it is worth having before that starts.
    const cid = state.character.id;

    const owned = (await readTraits(memberPage, cid, 'merits', 'Vampire')).map((t) => t.name);
    // Picked at runtime like 325's background: any seeded merit this character
    // does not already hold and that carries no requirement, so the test never
    // depends on a pick order that could drift.
    const candidates = await memberPage.evaluate(async () => {
      const q = new window.Parse.Query('Description');
      q.equalTo('category', 'merits');
      q.limit(1000);
      const rows = await q.find();
      return rows.map((r) => ({ name: r.get('name'), requirement: r.get('requirement') || null }));
    });
    const target = candidates.find((c) => !c.requirement && owned.indexOf(c.name) === -1);
    expect(target, 'an unowned merit with no requirement is available to buy').toBeTruthy();

    const BUY_AT = 2;
    const RAISE_TO = 4;

    // ---- buy ----------------------------------------------------------
    const xpBefore = await readSheetXp(memberPage, cid);
    await L.parkOnSheet(memberPage, cid);
    await openNewTraitChange(memberPage, cid, 'merits', target.name);
    await setTraitChangeSliders(memberPage, { value: BUY_AT });
    const buyQuote = await readTraitChangeView(memberPage);
    await saveTraitChange(memberPage, cid, 'merits');

    const bought = (await readTraits(memberPage, cid, 'merits', 'Vampire')).find((t) => t.name === target.name);
    expect(bought, `${target.name} after purchase`).toMatchObject({ value: BUY_AT, free_value: 0 });
    expect(bought.cost, 'a merit costs its value, one for one').toBe(BUY_AT);
    expect(buyQuote.cost, 'and the quote the player was shown agrees').toBe(BUY_AT);

    const xpAfterBuy = await readSheetXp(memberPage, cid);
    expect(xpAfterBuy.spent - xpBefore.spent, 'Spent rises by the merit cost').toBe(BUY_AT);

    // ---- change the value ---------------------------------------------
    await L.parkOnSheet(memberPage, cid);
    await openTraitChange(memberPage, cid, 'merits', target.name);
    await setTraitChangeSliders(memberPage, { value: RAISE_TO });
    const raiseQuote = await readTraitChangeView(memberPage);
    expect(raiseQuote.cost, 'raising 2 -> 4 is quoted as the incremental 2, not the full 4')
      .toBe(RAISE_TO - BUY_AT);
    await saveTraitChange(memberPage, cid, 'merits');

    const raised = (await readTraits(memberPage, cid, 'merits', 'Vampire')).find((t) => t.name === target.name);
    expect(raised, `${target.name} after the change`).toMatchObject({ value: RAISE_TO, free_value: 0 });
    expect(raised.cost, 'the merit now costs its new value').toBe(RAISE_TO);

    const xpAfterRaise = await readSheetXp(memberPage, cid);
    expect(xpAfterRaise.spent - xpAfterBuy.spent, 'Spent rises by the increment only').toBe(RAISE_TO - BUY_AT);
    expect(xpAfterRaise.spent - xpBefore.spent, 'and by the full new cost against the pre-purchase ledger')
      .toBe(RAISE_TO);

    // ---- remove --------------------------------------------------------
    await L.removeTraitViaChangePage(memberPage, cid, 'merits', target.name, openTraitChange);

    const gone = (await readTraits(memberPage, cid, 'merits', 'Vampire')).some((t) => t.name === target.name);
    expect(gone, 'the removed merit is gone from the character').toBe(false);

    const xpAfterRemove = await readSheetXp(memberPage, cid);
    // The assertion this test exists for.
    expect(
      xpAfterRemove.spent - xpAfterRaise.spent,
      'the refund is the cost the merit currently holds (4), not the cost it was bought at (2)'
    ).toBe(-RAISE_TO);
    expect(
      xpAfterRemove.spent,
      'so the whole buy -> change -> remove round trip nets to zero against the pre-purchase ledger'
    ).toBe(xpBefore.spent);
    expect(xpAfterRemove.available, 'and Available is restored in step').toBe(xpBefore.available);

    // ---- the log tells the same story ----------------------------------
    const rows = await L.readAllLogRows(memberPage, cid);

    const defineRow = L.freshestRow(rows, { category: 'merits', name: target.name, type: 'define' });
    expect(defineRow, 'the purchase is logged').toBeTruthy();
    expect(L.numCost(defineRow.cost), 'the purchase row carries the buy cost').toBe(BUY_AT);

    const updateRow = L.freshestRow(rows, { category: 'merits', name: target.name, type: 'update' });
    expect(updateRow, 'the value change is logged').toBeTruthy();
    expect(updateRow).toMatchObject({ old_value: BUY_AT, value: RAISE_TO });
    expect(L.numCost(updateRow.old_cost), 'the change row records the cost before').toBe(BUY_AT);
    expect(L.numCost(updateRow.cost), 'and the cost after').toBe(RAISE_TO);

    const removeRow = L.freshestRow(rows, { category: 'merits', name: target.name, type: 'remove' });
    expect(removeRow, 'the removal is logged').toBeTruthy();
    expect(removeRow).toMatchObject({ old_value: RAISE_TO });
    expect(
      L.numCost(removeRow.old_cost),
      'and the removal row carries the refunded amount, which is the changed cost'
    ).toBe(RAISE_TO);
  });
});
