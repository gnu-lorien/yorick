/**
 * Task 2 - Game Rules Editors: Add And Verify
 *
 * Covers testing_implementation_plan.md items 16-37. Mirrors admin-patronage.spec.js's
 * structure: one continuous admin session (`adminPage`) plus one non-admin persona
 * (`memberPage` = sampmem), created once in `beforeAll`. Tests run in numeric order and
 * later tests depend on state earlier ones capture, because this is one continuous
 * "add rules, verify they reach players, edit, gate by permission" story, not 22
 * independent scenarios.
 *
 * ## The central finding
 *
 * All five rule editors (`bnsmetv1_ClanRule`, `bnsctdbs_KithRule`,
 * `bnsmetv1_ElderDisciplineRule`, `bnsmetv1_TechniqueRule`, `bnsmetv1_RitualRule`) and
 * the Descriptions admin share one bulk-CSV-textarea editor UI (EditRules.js /
 * DescriptionsView.js - see helpers/descriptions.js and helpers/rules.js for the full
 * mechanics and every defect found in it). Two defects in that shared UI, confirmed live
 * and reported prominently below, mean the "add a new rule" half of this task is broken
 * for all five rule classes:
 *
 * 1. **EditRules.js's create path is unconditionally broken** (`self.ruleName` is
 *    `undefined` where the code needs the module-scoped `ruleName`; see the full
 *    writeup in helpers/rules.js). Every attempt to add a brand-new rule row 404s,
 *    silently, for every one of the five classes. This blocks tests 17, 24, 26, 28, 30
 *    outright, and 18/22 cascade from 17 since there is nothing to persist or delete.
 * 2. **No character-facing picker reads any of these five Rule classes at all.** Every
 *    picker (the Vampire clan picker, the Changeling kith picker, and the SimpleTrait
 *    "new" pickers for elder_disciplines/techniques/rituals) reads the `Description`
 *    class exclusively, via `DescriptionFetcher`. `bnsmetv1_ElderDisciplineRule`,
 *    `bnsmetv1_TechniqueRule`, and `bnsmetv1_RitualRule` additionally have **no runtime
 *    consumer anywhere in the app** (confirmed by a full-repository grep) - the cost a
 *    player is actually charged comes from a generic, category-keyed formula in
 *    `BNSMETV1_VampireCosts.js` (generation- and in-clan-status-dependent), never from
 *    any field on the rule row, which has no cost field to read even in principle.
 *    `bnsmetv1_ClanRule` and `bnsctdbs_KithRule` *do* have a live consumer (in-clan
 *    discipline / kith art-affinity lookup, keyed by matching the rule's own
 *    `clan`/`name` field against the character's chosen text value), but that is
 *    orthogonal to "is this offered as a pickable option" - that is Description's job
 *    alone.
 *
 * Tests whose numbered requirement is literally "add a new rule through the form" are
 * therefore written as real interactions with real positive assertions and marked
 * `test.fail()`, per this suite's convention: leave a genuinely broken test failing
 * with the defect named, rather than weaken it to a false green. Tests that ask whether
 * an addition "shows up" somewhere a player would see it are answered honestly against
 * whichever Parse class that surface actually reads (worked out and stated per test) -
 * per the task's explicit instruction, this is not the same defect and is not weakened
 * to compensate for it.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember } = require('./helpers/auth');
const { navigateToHash, waitForAppReady } = require('./helpers/jqm-helpers');
const {
  createCharacter,
  createCompletedCharacter,
  purchaseTrait,
  readSheetXp,
  pickSimpleText,
  listSimpleTextOptions
} = require('./helpers/characters');
const {
  listTraitPickerOptions,
  traitPickerOptionText,
  createDescriptionViaAdmin,
  updateDescriptionViaAdmin,
  getDescriptionByName,
  destroyDescriptions,
  openDescriptionsAdmin,
  readBulkEditorRows,
  selectBulkEditorCategory,
  countDescriptions,
  ADMIN_TEXTAREA_SELECTOR,
  ADMIN_SUBMIT_SELECTOR,
  ADMIN_CATEGORY_SELECT_SELECTOR,
  ADMIN_LIST_SELECTOR
} = require('./helpers/descriptions');
const {
  openRuleEditor,
  selectRuleCategory,
  readRuleTableRows,
  submitRuleRow,
  countRuleRows,
  findRuleRowByField,
  getRuleRowById,
  resolveOnlyReachableClanRule
} = require('./helpers/rules');

let nameCounter = 0;
/** Unique, obviously-test-scoped content name, so nothing this suite adds can collide with real seed data. */
function uniqueTestName(prefix) {
  nameCounter += 1;
  return `E2E ${prefix} ${Date.now().toString(36)}${nameCounter}`;
}

/**
 * BNSMETV1_VampireCosts.js's `calculate_trait_cost`, mirrored for the three categories
 * this file purchases (`elder_disciplines`, `techniques`, `rituals`). Reproduced here -
 * not imported, since it is application source under `public/` - to compute the exact
 * cost the app itself will charge, so purchases are asserted against a real formula
 * rather than an arbitrary expected number.
 */
function expectedRitualCost(value, freeValue = 0) {
  return (value - freeValue) * 2;
}
function expectedTechniqueCost(value, freeValue, generation) {
  let perPoint = 9999;
  if (generation < 3) perPoint = 12;
  else if (generation === 3) perPoint = 20;
  return (value - freeValue) * perPoint;
}
function expectedElderDisciplineCost(value, freeValue, generation, inClan) {
  let icCost = 99999;
  let oocCost = 99999;
  if (generation >= 3) icCost = 18;
  if (generation >= 5) oocCost = 30;
  else if (generation >= 3) oocCost = 24;
  return (value - freeValue) * (inClan ? icCost : oocCost);
}

/** Register a console listener that captures Parse.Error-shaped objects logged via console.log(e). */
function captureParseErrors(page) {
  const found = [];
  const onConsole = async (msg) => {
    const text = msg.text();
    if (/permission denied/i.test(text) || /object not found/i.test(text)) {
      found.push({ code: null, message: text });
    }
    for (const arg of msg.args()) {
      try {
        const val = await arg.jsonValue();
        if (val && typeof val === 'object' && 'code' in val && 'message' in val) {
          found.push(val);
        }
      } catch (e) {
        // Not a plain serializable object (e.g. a DOM node or a circular structure) - ignore.
      }
    }
  };
  page.on('console', onConsole);
  return {
    errors: found,
    stop: () => page.off('console', onConsole)
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('Task 2 - Game Rules Editors: Add And Verify', () => {
  /** @type {import('@playwright/test').Page} */
  let adminPage;
  /** @type {import('@playwright/test').Page} */
  let memberPage;

  // Fixture state threaded across the numbered tests: real ids and names captured as
  // each test creates or discovers them. Nothing below is a hardcoded Parse object id.
  const state = { createdDescriptionIds: [] };

  test.beforeAll(async ({ browser }) => {
    adminPage = await browser.newPage();
    await loginAsAdmin(adminPage);

    memberPage = await browser.newPage();
    await loginAsMember(memberPage);

    // `state.vamp`: driven through the full creation wizard, because the live sheet's
    // "Information" section (where a text attribute like Clan renders) only renders
    // `if (!character.is_being_created())` - confirmed by reading the characterView
    // template in public/index.html. Needed for tests 19-20 only.
    state.vamp = await createCompletedCharacter(adminPage, 'Vampire');

    // `state.vamp2`: a lightweight, never-completed character for the purchase tests
    // (27, 29, 31, 34, 35). Confirmed live that the post-creation trait-purchase routes
    // gate on nothing but a valid character id, so completion is not needed - and
    // deliberately left uncompleted so its creation-time background picks (which take
    // whatever the wizard's pool-spender reaches first) cannot have already claimed
    // "Generation", which these tests need to control precisely.
    state.vamp2 = await createCharacter(adminPage, 'Vampire');

    // `state.changeling`: lightweight, for test 25's Kith picker check only.
    state.changeling = await createCharacter(adminPage, 'Changeling');
  });

  test.afterAll(async () => {
    // Fixture teardown, mirroring Task 1's afterAll Parse cleanup: every Description
    // this suite created gets removed by real id, regardless of which test created it
    // or whether that test passed. Nothing accumulates for other suites to trip over.
    await destroyDescriptions(adminPage, state.createdDescriptionIds).catch(() => {});

    // Characters are destroyed directly rather than through characters.js's
    // `deleteCharacter`: that helper drives the real "Delete Character" UI action, and
    // that action - confirmed by reading `Character.archive()` in models/Character.js -
    // only unsets the character's `owner` and saves; it does not remove the Parse object
    // at all. That is a faithful automation of what the real button does (and this suite
    // does not test character deletion, so it is not the right thing to "fix" here), but
    // it means relying on it for fixture teardown would leave every character this file
    // creates in the database permanently. A direct destroy is fixture teardown, the
    // same permitted category as the Description cleanup above.
    //
    // All three creature types are stored under one Parse class regardless of venue:
    // both models/Werewolf.js and models/ChangelingBetaSlice.js declare
    // `Parse.Object.extend("Vampire", ...)` - confirmed by reading them - so
    // state.changeling's real Parse class is "Vampire" too, not "ChangelingBetaSlice"
    // (that string is only the `type` attribute value characters.js's CREATURE_TYPES
    // records, used to pick the right RequireJS model module - never a distinct Parse
    // class). Destroying it as "ChangelingBetaSlice" would silently 404 and leak it.
    const characterIds = [state.vamp, state.vamp2, state.changeling]
      .filter(Boolean)
      .map((c) => c.id);
    await adminPage.evaluate(async (ids) => {
      for (const id of ids) {
        try {
          const obj = new window.Parse.Object('Vampire');
          obj.id = id;
          await obj.destroy();
        } catch (e) { /* already gone */ }
      }
    }, characterIds).catch(() => {});

    await adminPage.close();
    await memberPage.close();
  });

  test('16 Clan Rules editor renders the rules table and the add/edit form', async () => {
    await openRuleEditor(adminPage, 'clan');

    // The add/edit form: a labelled submit button plus the CSV textarea - see
    // helpers/descriptions.js for why this one textarea is both the rendered table and
    // the add/edit form.
    const submit = adminPage.locator(ADMIN_SUBMIT_SELECTOR);
    await expect(submit).toBeVisible();
    await expect(submit).toHaveText('Update Changes to Server');
    await expect(adminPage.locator(ADMIN_TEXTAREA_SELECTOR)).toBeVisible();
    await expect(adminPage.locator(ADMIN_CATEGORY_SELECT_SELECTOR)).toBeAttached();

    // The rules table: selecting "All" loads a live CSV export of every seeded clan
    // rule. Assert real values against a live Parse count/name set, not just that some
    // text rendered.
    await selectRuleCategory(adminPage, 'All');
    const { rows } = await readRuleTableRows(adminPage);
    const liveCount = await countRuleRows(adminPage, 'clan');
    expect(liveCount).toBeGreaterThan(0);
    expect(rows.length).toBe(liveCount);

    const liveClanNames = await adminPage.evaluate(async () => {
      const all = await new window.Parse.Query('bnsmetv1_ClanRule').select('clan').limit(1000).find();
      return all.map((r) => r.get('clan')).sort();
    });
    expect(rows.map((r) => r.clan).sort()).toEqual(liveClanNames);
  });

  test('17 Add a new Clan Rule through the form; the new row appears in the rules table', async () => {
    // FIXED by remediation R10 and R26. Two defects had to be cleared before
    // this could pass, and the first hid the second:
    //
    //   R10 - `new Parse.Object(self.ruleName, {...})` used a property the
    //   DataForm view never has; the correct value is the module-scoped
    //   `ruleName` the lookup query two lines earlier already uses. With
    //   `undefined` as the class name Parse fell through to its
    //   `(attributes, options)` signature and the save 404'd.
    //   R26 - every CSV field was sent as a string except the literal column
    //   "order", so `default_cost: 2` below 400'd with "expected Number but
    //   got String". EditRules now learns each column's type from live rows
    //   of the class and coerces before saving.
    //
    // R2 is what made either diagnosable: the per-row `.fail(console.log)`
    // that swallowed both errors now reports them.
    //
    // The original writeup, kept because it names the mechanism precisely:
    // EditRules.js's DataForm.submit handler constructs a new rule
    // via `new Parse.Object(self.ruleName, {...})`. `self` is the DataForm view, which
    // never has a `.ruleName` property - the correct value is the module-scoped
    // `ruleName` variable, used correctly two lines earlier for the lookup query but not
    // here. `self.ruleName` is `undefined`, and because the base Parse.Object
    // constructor's real signature is `(attributes, options)` - the string-shortcut path
    // requires the first argument to literally be a string - the call binds `undefined`
    // to `attributes` and the row's real data to `options` instead, so no class name is
    // ever set and the row's data is discarded before the save is even attempted. Saving
    // a class-less object 404s (`POST /parse/1/classes`, no class segment - confirmed
    // live via the network log). The per-row `.fail(function (e) { console.log(e); ...
    // })` swallows that error and the outer chain still logs "Saved all of that" -
    // nothing is surfaced anywhere in the DOM, so a test that only checks "did the form
    // look like it submitted" would be fooled. This reproduces identically for all five
    // rule classes; confirmed independently for bnsmetv1_ClanRule, bnsctdbs_KithRule,
    // and bnsmetv1_TechniqueRule via before/after Parse counts.
    state.newClanName = uniqueTestName('Clan');
    const before = await countRuleRows(adminPage, 'clan');

    await submitRuleRow(adminPage, 'clan', {
      clan: state.newClanName,
      // `category`/`name` are not fields this class's own game logic reads (only
      // `clan`, `discipline_1..3`, and the cost fields are) - they are included purely
      // so the create-lookup below has *some* concrete value to miss on, rather than
      // colliding with all 42 existing rows that share the class's missing name/category
      // (see the third defect documented in helpers/rules.js).
      category: 'e2e_test',
      name: state.newClanName,
      default_cost: 2,
      discipline_1: 'Obfuscate',
      discipline_2: 'Auspex',
      discipline_3: 'Celerity'
    });

    const after = await countRuleRows(adminPage, 'clan');
    expect(after).toBe(before + 1);

    const created = await findRuleRowByField(adminPage, 'clan', 'clan', state.newClanName);
    expect(created).not.toBeNull();
    expect(created.default_cost).toBe(2);

    await selectRuleCategory(adminPage, 'All');
    const { rows } = await readRuleTableRows(adminPage);
    expect(rows.some((r) => r.clan === state.newClanName)).toBe(true);
  });

  test('18 The added Clan Rule persists across a full page reload', async () => {
    // FIXED with test 17 (R10 + R26). It only ever cascaded from that defect:
    // nothing was actually added, so there was nothing for a reload to have
    // persisted either.
    expect(state.newClanName).toBeTruthy();
    await adminPage.evaluate(() => { window.location.reload(); });
    await waitForAppReady(adminPage);
    const found = await findRuleRowByField(adminPage, 'clan', 'clan', state.newClanName);
    expect(found).not.toBeNull();
  });

  test('19 The added Clan Rule is offered as a selectable Clan in the Vampire creation clan picker', async () => {
    // Which Parse class the picker actually reads (per this task's explicit
    // instruction): the clan picker is SimpleTextNewView, whose collection is built by
    // `DescriptionFetcher(category)` (helpers/DescriptionFetcher.js) - a plain
    // `Parse.Query(Description).equalTo("category", category)`. It never queries
    // `bnsmetv1_ClanRule`. So even setting test 17's defect aside, a ClanRule add alone
    // would never have made a new clan pickable - the two classes are unrelated from the
    // picker's point of view. This creates the Description a working admin would add
    // alongside it (through the Descriptions admin, which - unlike EditRules.js - has no
    // create-path defect; see helpers/descriptions.js), reusing test 17's name so the
    // two are conceptually the same clan even though only this half of a real add
    // actually succeeds today.
    state.newClanName = state.newClanName || uniqueTestName('Clan');

    const created = await createDescriptionViaAdmin(adminPage, {
      category: 'clans',
      name: state.newClanName,
      value: state.newClanName
    });
    state.createdDescriptionIds.push(created.id);

    const options = await listSimpleTextOptions(adminPage, state.vamp.id, 'clans', 'clan', { duringCreation: false });
    expect(options).toContain(state.newClanName);
  });

  test('20 Selecting the new Clan on a Vampire sets it on the sheet and print header', async () => {
    await pickSimpleText(adminPage, state.vamp.id, 'clans', 'clan', state.newClanName, { duringCreation: false });

    await navigateToHash(adminPage, `character?${state.vamp.id}`, '#character');
    // The live sheet's "Information" section renders `<li data-role="list-divider">Clan
    // <p>VALUE</p></li>` (characterView template) - real value, not just visibility.
    await expect(adminPage.locator('#character')).toContainText(state.newClanName);

    await navigateToHash(adminPage, `character/${state.vamp.id}/print`, '#printable-sheet');
    // character-print-view.html: `<h2>Clan: <%= format_simpletext("clan") %></h2>`.
    await expect(adminPage.locator('#printable-sheet')).toContainText(`Clan: ${state.newClanName}`);
  });

  test("21 Edit an existing Clan Rule's fields; the updated values render in the table", async () => {
    // Two defects used to shape this test, and remediation cleared both.
    //
    // R27: bnsmetv1_ClanRule has neither a `name` nor a `category` field (0 of 42
    // seeded rows have either), while the submit handler's update-vs-insert lookup
    // was always `.equalTo("category", d.category).equalTo("name", d.name)`. For this
    // class that resolved to `doesNotExist("category") AND doesNotExist("name")` -
    // matched by all 42 rows indiscriminately - so `.first()` returned whichever row
    // Parse's default ordering put first, regardless of which clan the submitted row
    // was actually about. There was no way through this UI to choose which clan an
    // edit targeted. The lookup is now keyed on the columns that really identify a
    // row of each class: `clan` here. This test deliberately targets a row that is
    // *not* the one default ordering returns first, and asserts that row is
    // untouched, which is exactly what the old lookup could not do.
    //
    // R26: every CSV column used to be sent verbatim as the string Papa Parse
    // produces, special-casing only the literal column "order", so any schema-numeric
    // field (default_cost, camarilla_cost, ...) 400'd with "expected Number but got
    // String". Columns are now coerced to the type the class really uses, so this
    // edit exercises a numeric field alongside the string one.
    const { target, firstByDefaultOrder } = await adminPage.evaluate(async () => {
      const all = await new window.Parse.Query('bnsmetv1_ClanRule').limit(1000).find();
      const first = all[0];
      const usable = all.filter((r) => r.id !== first.id && r.get('clan') && r.get('weakness_1'));
      usable.sort((a, b) => a.get('clan').localeCompare(b.get('clan')));
      const chosen = usable[0];
      return {
        target: chosen ? Object.assign({ id: chosen.id }, chosen.attributes) : null,
        firstByDefaultOrder: Object.assign({ id: first.id }, first.attributes)
      };
    });
    expect(target, 'a seeded clan rule other than the first one by default ordering').not.toBeNull();
    expect(target.id).not.toBe(firstByDefaultOrder.id);
    expect(target.weakness_1, 'the chosen row has a value to restore').toBeTruthy();

    const newWeakness = uniqueTestName('EditedWeakness');
    const originalWeakness = target.weakness_1;
    const originalDefaultCost = target.default_cost;
    const newDefaultCost = (originalDefaultCost || 0) + 1;

    await submitRuleRow(adminPage, 'clan', {
      clan: target.clan,
      weakness_1: newWeakness,
      default_cost: newDefaultCost
    });

    const updated = await getRuleRowById(adminPage, 'clan', target.id);
    expect(updated.weakness_1).toBe(newWeakness);
    expect(updated.default_cost, 'a numeric field is editable too').toBe(newDefaultCost);

    // The row default ordering would have hit is untouched: the edit really did
    // target the clan the submitted row named.
    const untouched = await getRuleRowById(adminPage, 'clan', firstByDefaultOrder.id);
    expect(untouched.weakness_1).toBe(firstByDefaultOrder.weakness_1);

    await selectRuleCategory(adminPage, 'All');
    const { rows } = await readRuleTableRows(adminPage);
    const row = rows.find((r) => r.clan === target.clan);
    expect(row).toBeTruthy();
    expect(row.weakness_1).toBe(newWeakness);

    // Restore, so this suite leaves the seed exactly as it found it.
    await submitRuleRow(adminPage, 'clan', {
      clan: target.clan,
      weakness_1: originalWeakness,
      default_cost: originalDefaultCost
    });
    const restored = await getRuleRowById(adminPage, 'clan', target.id);
    expect(restored.weakness_1).toBe(originalWeakness);
    expect(restored.default_cost).toBe(originalDefaultCost);
  });

  test.fail('22 Delete the added Clan Rule; it disappears from the table and from the creation picker', async () => {
    // DEFECT: there is no delete affordance anywhere in this editor. DataForm's fields
    // are only [Update-Changes-to-Server button, descriptiondata textarea]
    // (EditRules.js), and its submit handler only ever creates/updates rows *present* in
    // the submitted CSV - it never diffs against previously-loaded rows to detect
    // removals, so there is no way to express "delete this row" through the UI at all
    // (mirroring the missing Patronage delete UI Task 1 found).
    //
    // Still pinned red after remediation R10/R26. Those fixed *adding* a rule
    // (test 17 now passes and really does create a row), but deleting one
    // remains an unbuilt feature, not a broken one - the same shape as R43's
    // missing Patronage delete. The remediation plan lists 22 alongside the
    // other six R10 tests; that is an error in the plan, since no promise-chain
    // fix can conjure a delete control. This suite still cleans
    // up everything *it* adds - every Description created below is destroyed by real id
    // in `afterAll`, the same fixture-teardown pattern Task 1 used - which is not the
    // same thing as this numbered UI feature existing.
    await openRuleEditor(adminPage, 'clan');
    const deleteControl = adminPage.locator([
      `${ADMIN_LIST_SELECTOR} button:has-text("Delete")`,
      `${ADMIN_LIST_SELECTOR} a:has-text("Delete")`,
      `${ADMIN_LIST_SELECTOR} [class*="delete" i]`
    ].join(', '));
    await expect(deleteControl).toBeVisible({ timeout: 5000 });
  });

  test('23 Kith Rules editor renders the table and form', async () => {
    await openRuleEditor(adminPage, 'kith');
    await expect(adminPage.locator(ADMIN_SUBMIT_SELECTOR)).toHaveText('Update Changes to Server');
    await expect(adminPage.locator(ADMIN_TEXTAREA_SELECTOR)).toBeVisible();

    // Unlike ClanRule, bnsctdbs_KithRule genuinely has a `category` field (confirmed:
    // all 11 seeded rows carry category "ctdbs_kiths"), so its dropdown offers that real
    // bucket alongside "All" - not the lone unusable "undefined" bucket ClanRule/
    // ElderDisciplineRule/TechniqueRule/RitualRule are stuck with.
    const optionTexts = await adminPage.locator(ADMIN_CATEGORY_SELECT_SELECTOR).locator('option').allTextContents();
    expect(optionTexts.map((t) => t.trim())).toContain('ctdbs_kiths');
    expect(optionTexts.map((t) => t.trim())).toContain('All');
    expect(optionTexts.map((t) => t.trim())).not.toContain('undefined');

    await selectRuleCategory(adminPage, 'ctdbs_kiths');
    const { rows } = await readRuleTableRows(adminPage);
    const liveCount = await countRuleRows(adminPage, 'kith');
    expect(liveCount).toBeGreaterThan(0);
    expect(rows.length).toBe(liveCount);

    const liveNames = await adminPage.evaluate(async () => {
      const all = await new window.Parse.Query('bnsctdbs_KithRule').select('name').limit(1000).find();
      return all.map((r) => r.get('name')).sort();
    });
    expect(rows.map((r) => r.name).sort()).toEqual(liveNames);
  });

  test('24 Add a new Kith Rule; the new row appears in the table', async () => {
    // FIXED with test 17 (R10). This class's submitted fields are all
    // strings, so R26 was not needed here - R10 alone was enough.
    state.newKithName = uniqueTestName('Kith');
    const before = await countRuleRows(adminPage, 'kith');

    await submitRuleRow(adminPage, 'kith', {
      name: state.newKithName,
      category: 'ctdbs_kiths',
      realm: 'Actor',
      art_1: 'Chicanery',
      art_2: 'Legerdemain',
      art_3: 'Naming'
    });

    const after = await countRuleRows(adminPage, 'kith');
    expect(after).toBe(before + 1);
    const created = await findRuleRowByField(adminPage, 'kith', 'name', state.newKithName);
    expect(created).not.toBeNull();
  });

  test('25 The added Kith Rule is offered as a selectable Kith in Changeling creation', async () => {
    // As with Clan (test 19): the Kith picker is DescriptionFetcher-backed
    // (category "ctdbs_kiths"), not bnsctdbs_KithRule. Creates the matching Description
    // directly, reusing test 24's name.
    state.newKithName = state.newKithName || uniqueTestName('Kith');

    const created = await createDescriptionViaAdmin(adminPage, {
      category: 'ctdbs_kiths',
      name: state.newKithName,
      value: state.newKithName
    });
    state.createdDescriptionIds.push(created.id);

    const options = await listSimpleTextOptions(adminPage, state.changeling.id, 'ctdbs_kiths', 'ctdbs_kith');
    expect(options).toContain(state.newKithName);
  });

  test('26 Elder Discipline Rules: add a rule; it appears in the table', async () => {
    // FIXED with test 17 (R10, plus R26 for the numeric columns below).
    state.newElderName = uniqueTestName('Discipline: Elder Power');
    const before = await countRuleRows(adminPage, 'elderDiscipline');

    await submitRuleRow(adminPage, 'elderDiscipline', {
      name: state.newElderName,
      discipline: 'Obeah',
      level_name: 'E2E Power'
    });

    const after = await countRuleRows(adminPage, 'elderDiscipline');
    expect(after).toBe(before + 1);
    const created = await findRuleRowByField(adminPage, 'elderDiscipline', 'name', state.newElderName);
    expect(created).not.toBeNull();
  });

  test('27 The added Elder Discipline is purchasable on a Vampire and shows the cost defined by the rule', async () => {
    // Which "rule" actually governs this (per this task's explicit instruction to work
    // this out before asserting): bnsmetv1_ElderDisciplineRule has *no runtime consumer
    // anywhere in this app* - confirmed by grepping the whole repository outside this
    // suite and mobileRouter.js's admin route registration. Its schema
    // (database_seed/_SCHEMA.json) does not even declare a cost field. What is
    // purchasable, and at what cost, is driven entirely by (a) a Description in category
    // "elder_disciplines" - the same DescriptionFetcher mechanism as every other picker
    // in this file - and (b) the generic, category-keyed cost formula in
    // BNSMETV1_VampireCosts.js#calculate_trait_cost, mirrored at the top of this file:
    // generation-tiered, and cheaper in-clan than out-of-clan. That formula *is* "the
    // rule" this game applies to elder disciplines; this purchases against it and
    // asserts the exact XP delta it predicts.
    //
    // Generation 3 is deliberately established first (state.vamp2 has no clan and was
    // never driven through creation-pool spending, so Generation is guaranteed not
    // already owned): it is the one value where both this test's elder-discipline
    // purchase and test 29's technique purchase are simultaneously "available" rather
    // than landing on the formula's generation-too-low/too-high sentinel costs.
    await purchaseTrait(adminPage, state.vamp2.id, 'backgrounds', 'Generation', { value: 3 });

    state.newElderName = state.newElderName || uniqueTestName('Discipline: Elder Power');
    const desc = await createDescriptionViaAdmin(adminPage, {
      category: 'elder_disciplines',
      name: state.newElderName,
      value: '1'
    });
    state.createdDescriptionIds.push(desc.id);

    const options = await listTraitPickerOptions(adminPage, state.vamp2.id, 'elder_disciplines');
    expect(options).toContain(state.newElderName);

    const before = await readSheetXp(adminPage, state.vamp2.id);
    await purchaseTrait(adminPage, state.vamp2.id, 'elder_disciplines', state.newElderName);
    const after = await readSheetXp(adminPage, state.vamp2.id);

    // state.vamp2 has no clan set, so `discipline_is_in_clan` is unconditionally false -
    // the out-of-clan branch applies regardless of which discipline name was chosen.
    const expectedCost = expectedElderDisciplineCost(1, 0, 3, false);
    expect(expectedCost).toBe(24);
    expect(after.spent - before.spent).toBe(expectedCost);
    expect(before.available - after.available).toBe(expectedCost);
  });

  test('28 Technique Rules: add a rule; it appears in the table', async () => {
    // FIXED with test 17 (R10, plus R26 for the numeric columns below).
    state.newTechniqueName = uniqueTestName('Technique');
    const before = await countRuleRows(adminPage, 'technique');

    await submitRuleRow(adminPage, 'technique', {
      name: state.newTechniqueName,
      prerequisite_1_name: 'Celerity',
      prerequisite_1_level: 1
    });

    const after = await countRuleRows(adminPage, 'technique');
    expect(after).toBe(before + 1);
    const created = await findRuleRowByField(adminPage, 'technique', 'name', state.newTechniqueName);
    expect(created).not.toBeNull();
  });

  test('29 The added Technique is purchasable on a Vampire at the rule-defined cost', async () => {
    // Same architecture as test 27: bnsmetv1_TechniqueRule has no runtime consumer and
    // no cost field; the picker reads Description (category "techniques"), and the cost
    // is `calculate_trait_cost`'s generation-tiered technique formula. Reuses
    // state.vamp2, whose Generation is already 3 from test 27 - exactly the tier where
    // the technique formula is also sane (`generation === 3` -> 20/point) rather than the
    // formula's unavailable-sentinel for any generation above 3.
    state.newTechniqueName = state.newTechniqueName || uniqueTestName('Technique');
    const desc = await createDescriptionViaAdmin(adminPage, {
      category: 'techniques',
      name: state.newTechniqueName,
      value: '1'
    });
    state.createdDescriptionIds.push(desc.id);

    const options = await listTraitPickerOptions(adminPage, state.vamp2.id, 'techniques');
    expect(options).toContain(state.newTechniqueName);

    const before = await readSheetXp(adminPage, state.vamp2.id);
    await purchaseTrait(adminPage, state.vamp2.id, 'techniques', state.newTechniqueName);
    const after = await readSheetXp(adminPage, state.vamp2.id);

    const expectedCost = expectedTechniqueCost(1, 0, 3);
    expect(expectedCost).toBe(20);
    expect(after.spent - before.spent).toBe(expectedCost);
    expect(before.available - after.available).toBe(expectedCost);
  });

  test('30 Ritual Rules: add a rule; it appears in the table', async () => {
    // FIXED with test 17 (R10, plus R26 for `level` and `time` below).
    state.newRitualName = uniqueTestName('Ritual: E2E Working');
    const before = await countRuleRows(adminPage, 'ritual');

    await submitRuleRow(adminPage, 'ritual', {
      name: state.newRitualName,
      type: 'Thaumaturgy',
      ritual: 'E2E Working',
      level: 1,
      time: 5
    });

    const after = await countRuleRows(adminPage, 'ritual');
    expect(after).toBe(before + 1);
    const created = await findRuleRowByField(adminPage, 'ritual', 'name', state.newRitualName);
    expect(created).not.toBeNull();
  });

  test("31 The added Ritual is purchasable via #simpletraits/rituals/:cid/new at the rule-defined cost", async () => {
    // Same architecture as tests 27/29. Rituals are the one category among the three
    // whose formula does not depend on generation at all (`mod_value * 2`, flat), so
    // this is deterministic regardless of state.vamp2's generation.
    state.newRitualName = state.newRitualName || uniqueTestName('Ritual: E2E Working');
    const desc = await createDescriptionViaAdmin(adminPage, {
      category: 'rituals',
      name: state.newRitualName,
      value: '1'
    });
    state.createdDescriptionIds.push(desc.id);

    const options = await listTraitPickerOptions(adminPage, state.vamp2.id, 'rituals');
    expect(options).toContain(state.newRitualName);

    const before = await readSheetXp(adminPage, state.vamp2.id);
    await purchaseTrait(adminPage, state.vamp2.id, 'rituals', state.newRitualName);
    const after = await readSheetXp(adminPage, state.vamp2.id);

    const expectedCost = expectedRitualCost(1, 0);
    expect(expectedCost).toBe(2);
    expect(after.spent - before.spent).toBe(expectedCost);
    expect(before.available - after.available).toBe(expectedCost);
  });

  test('32 Descriptions admin renders the category selector and filters the list by category', async () => {
    await openDescriptionsAdmin(adminPage);
    await expect(adminPage.locator(ADMIN_SUBMIT_SELECTOR)).toHaveText('Update Changes to Server');
    await expect(adminPage.locator(ADMIN_TEXTAREA_SELECTOR)).toBeVisible();

    const optionTexts = await adminPage.locator(ADMIN_CATEGORY_SELECT_SELECTOR).locator('option').allTextContents();
    expect(optionTexts.map((t) => t.trim())).toEqual(expect.arrayContaining(['clans', 'skills', 'All']));

    await selectBulkEditorCategory(adminPage, 'clans');
    const { rows } = await readBulkEditorRows(adminPage);
    const liveCount = await countDescriptions(adminPage, 'clans');
    expect(liveCount).toBeGreaterThan(0);
    expect(rows.length).toBe(liveCount);
    expect(rows.every((r) => r.category === 'clans')).toBe(true);
  });

  test('33 Create a new Description through the admin UI; it appears in the filtered list', async () => {
    state.newBackgroundName = uniqueTestName('Background');
    const created = await createDescriptionViaAdmin(adminPage, {
      category: 'backgrounds',
      name: state.newBackgroundName,
      value: '1'
    });
    state.createdDescriptionIds.push(created.id);

    expect(created.name).toBe(state.newBackgroundName);
    expect(created.category).toBe('backgrounds');
    expect(created.value).toBe('1');

    await openDescriptionsAdmin(adminPage);
    await selectBulkEditorCategory(adminPage, 'backgrounds');
    const { rows } = await readBulkEditorRows(adminPage);
    const row = rows.find((r) => r.name === state.newBackgroundName);
    expect(row).toBeTruthy();
    expect(row.value).toBe('1');
  });

  test('34 The new Description is offered in the matching trait "new" picker for a character', async () => {
    const options = await listTraitPickerOptions(adminPage, state.vamp2.id, 'backgrounds');
    expect(options).toContain(state.newBackgroundName);

    // Real value, not just presence: the picker renders "<name> x<value>" when the
    // Description has a value (simpletrait-new-list.html) - confirm the actual value
    // reached the picker, not just the name.
    const text = await traitPickerOptionText(adminPage, state.vamp2.id, 'backgrounds', state.newBackgroundName);
    expect(text).toBe(`${state.newBackgroundName} x1`);
  });

  test("35 Update the Description's text through the admin UI; the change is reflected in the picker", async () => {
    const updated = await updateDescriptionViaAdmin(adminPage, {
      category: 'backgrounds',
      name: state.newBackgroundName,
      value: '3'
    });
    expect(updated).not.toBeNull();
    expect(updated.value).toBe('3');

    const text = await traitPickerOptionText(adminPage, state.vamp2.id, 'backgrounds', state.newBackgroundName);
    expect(text).toBe(`${state.newBackgroundName} x3`);
  });

  test('36 Non-admin sampmem is blocked from #administration/bnsmetv1_clan_rules', async () => {
    // Two layers, and both are asserted - the title's "blocked" is now true at both.
    //
    // It used not to be. administration_bnsmetv1_clan_rules called only
    // enforce_logged_in() - the same gap Task 1 found on the Patronage admin routes -
    // so sampmem's navigation was not redirected and the page genuinely rendered
    // (find/get on this class are public per its schema CLP). Remediation R37 added the
    // route gate. The server-side protection was and remains the one that matters:
    // bnsmetv1_ClanRule's class-level permissions restrict update/create to
    // role:Administrator (database_seed/_SCHEMA.json), probed directly here because the
    // editor that used to carry the probe is no longer reachable by this user.
    await navigateToHash(memberPage, 'administration/bnsmetv1_clan_rules');
    await memberPage.waitForTimeout(2000);
    const activeId = await memberPage.evaluate(() => {
      const el = document.querySelector('.ui-page-active');
      return el ? el.id : null;
    });
    expect(activeId, 'the rule editor does not render for a non-admin').not.toBe('administration-descriptions');

    const target = await findRuleRowByField(adminPage, 'clan', 'clan', state.newClanName);
    expect(target, 'test 17 left a clan rule to probe').not.toBeNull();

    const probe = await memberPage.evaluate(async (id) => {
      const obj = new window.Parse.Object('bnsmetv1_ClanRule');
      obj.id = id;
      obj.set('weakness_1', 'SAMPMEM SHOULD NOT PERSIST');
      try {
        await obj.save();
        return { ok: true };
      } catch (e) {
        return { ok: false, code: e && e.code, message: e && e.message };
      }
    }, target.id);
    expect(probe.ok, 'the save is refused server-side').toBe(false);
    expect(probe.code).toBe(119);
    expect(probe.message).toMatch(/permission denied/i);

    const stillOriginal = await getRuleRowById(adminPage, 'clan', target.id);
    expect(stillOriginal.weakness_1).toBe(target.weakness_1);
  });

  test('37 Non-admin sampmem attempting to save a global Description edit gets a surfaced permission error', async () => {
    // A different protection mechanism from test 36, and worth telling apart:
    // Description's class-level permissions are wide open (`create`/`update`/`delete`:
    // "*" - database_seed/_SCHEMA.json), unlike the rule classes. What actually protects
    // an individual Description is its own object ACL, set by DescriptionsView.js's
    // submit handler to public-read / Administrator-write. Confirmed live: this denial
    // surfaces as Parse code 101 "Object not found" (an ACL-scoped update query simply
    // finds nothing to update), not code 119 "Permission denied" - Parse Server reports
    // ACL-based denials by hiding the object's existence rather than naming the
    // permission, which is different enough from test 36 to assert precisely rather than
    // assume it matches.
    //
    // Remediation R36 additionally gated `#administration/descriptions` behind
    // `enforce_admin()`, alongside its ungated `administration/*` siblings, so the bulk
    // editor this used to drive is - deliberately - no longer reachable by sampmem.
    // Both layers are asserted: the page does not render, and the object ACL still
    // refuses a direct write.
    const permDesc = await createDescriptionViaAdmin(adminPage, {
      category: 'e2e_test_perm_category',
      name: uniqueTestName('PermTarget'),
      value: 'original value'
    });
    state.createdDescriptionIds.push(permDesc.id);

    await navigateToHash(memberPage, 'administration/descriptions');
    await memberPage.waitForTimeout(2000);
    const activeId = await memberPage.evaluate(() => {
      const el = document.querySelector('.ui-page-active');
      return el ? el.id : null;
    });
    expect(activeId, 'the Descriptions admin does not render for a non-admin')
      .not.toBe('administration-descriptions');

    const probe = await memberPage.evaluate(async (id) => {
      const obj = new window.Parse.Object('Description');
      obj.id = id;
      obj.set('value', 'sampmem tampered value');
      try {
        await obj.save();
        return { ok: true };
      } catch (e) {
        return { ok: false, code: e && e.code, message: e && e.message };
      }
    }, permDesc.id);
    expect(probe.ok, 'the write is refused').toBe(false);
    expect(probe.code, 'Parse hides an ACL-denied row rather than naming the permission').toBe(101);

    const stillOriginal = await getDescriptionByName(adminPage, permDesc.category, permDesc.name);
    expect(stillOriginal.value).toBe('original value');
  });
});
