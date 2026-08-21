/**
 * Task 5 - Approvals: Ten Steps, Snapshot Verified At Each Step
 *
 * Covers testing_implementation_plan.md items 76-98. One Vampire owned by
 * `sampmem`, joined to a troupe on which `sampast` is Assistant Storyteller,
 * takes ten player-side changes; `sampast` approves each one; every approval is
 * verified three ways before the next change is made.
 *
 * ---
 *
 * ## What the approval UI actually is (measured, not inferred)
 *
 * The plan's wording implies a list of pending changes with a button beside
 * each. It is nothing of the sort - see the header of `e2e/helpers/approvals.js`
 * for the full anatomy. The three facts that drive this suite:
 *
 * 1. **Three sliders, all `input[type="number"]`.** `historyBaseRange`
 *    (`#sliderbaserange`) and `historyChangePicker` (`#slider`) bound the range
 *    of recorded changes; `approvalChangePicker` (`#approval-slider`) selects a
 *    previously recorded approval and its `max` *is* the approval count. A
 *    selector written for `input[type="range"]` - which is what the templates
 *    literally contain - matches nothing after jQuery Mobile enhances them.
 *    Confirmed live: `{"id":"slider","name":"historyChangePicker","type":"number"}`.
 * 2. **One button, one approval.** `EditView.approve_change` saves a single
 *    `VampireApproval` pointing at `recorded_changes.at(picked.right)`, so a
 *    click always increments the approval count by exactly one no matter how
 *    many changes the range spans. Both sliders arrive covering the whole
 *    history, which is why the button already reads a full index on arrival
 *    ("Approve changes up to 13" on this suite's freshly built fixture).
 * 3. **The approve control is replaced by the literal text `No unapproved
 *    changes`** once the newest approval points at the newest recorded change,
 *    and reappears the moment a new change is recorded. That flip is the
 *    application's *only* rendering of "this character has unapproved edits",
 *    and it is what test 93 leans on.
 *
 * ## Corrections to the plan's wording, measured against the running app
 *
 * - **Item 77 is wrong about the baseline.** With no approvals at all,
 *   `character_show_approved` gets `null` back from
 *   `get_transformed_last_approved` and swaps to `#character-print-no-approval`,
 *   which reads "No approved versions of your character". There is no creation
 *   baseline snapshot; the test asserts the real behaviour.
 * - **Item 88's "approver's name" is an object id.** `format_approval` returns
 *   `sub.id` for any pointer, so the approval table's `approver` cell renders
 *   the `_User` object id. In this seeded database those ids are literally
 *   `user_sampast` / `user_devuser`, so the cell is legible by luck rather than
 *   by design; the test asserts the rendered id *and* resolves it back to a
 *   username so the assertion survives a database whose ids are random.
 * - **Item 89's "links to the change" is not a link.** The `change` cell is a
 *   plain `<td>` holding the `VampireChange` object id. What genuinely
 *   associates an approval with its change is the approvals slider: selecting
 *   approval *i* re-points `picked.left`/`picked.right` at the range that
 *   approval covers, and `#approval-viewing` then renders those change rows with
 *   their `old_value` / `value` / `old_cost` / `cost` columns. That is what the
 *   test drives and asserts.
 * - **Item 90 cannot pass.** `#character` renders XP, a portrait and a menu of
 *   links; there is no unapproved-edits indicator anywhere in `characterView`
 *   (public/index.html) and no approval state is even fetched by that route. The
 *   test is `test.fail()` and pins the gap; the real signal lives in the
 *   approval view and is asserted by test 93.
 *
 * ## Application defects confirmed while writing this suite
 *
 * - **The approval view strands the router.** Leaving `#character/:cid/approval`
 *   for an unrelated route updates the hash but never changes the page, and
 *   re-running the route handler does not clear it - only a full reload does.
 *   `navigateToHash` already falls back to a reload so tests get through, but it
 *   makes every navigation *out* of this view cost a page load. Reproduced on
 *   every one of the ten approval steps below.
 * - **`CharacterApprovalView.register` is missing a `return`.** Its last
 *   statement is `p.then(function () { Parse.Promise.as(self); })`, so the chain
 *   resolves with `undefined` rather than the view. The router only uses the
 *   resolution as a signal, which is why this has never been visible - but it is
 *   also why `register`'s short-circuit (`if (model != self.model)`) can hand the
 *   route a resolved promise before any region has rendered.
 * - **The router's character cache never refetches.** `Vampire.get_character`
 *   keeps `character_cache._character` for the life of the page and
 *   `fetchAllIfNeeded` will not re-read a trait it already holds, so a
 *   storyteller session that loaded the character before the player's change
 *   renders stale values indefinitely. Every approval cycle below therefore
 *   starts with `freshApproval`, which reloads first. Without it the ST would
 *   approve a change the screen never showed.
 *
 * ## Fixture shape, and why it is built this way
 *
 * The character is created with `spendPools: false` - completed but with no
 * creation picks at all - and then given a deliberate baseline through the real
 * change page with the *free* slider matching the value slider, so each baseline
 * trait costs exactly 0 XP (`calculate_trait_cost` works on `value -
 * free_value`). That buys two things: every one of the ten steps is a genuine
 * change *from a known previous value* rather than a first purchase (which is
 * what makes "the approved snapshot no longer shows the previous value" a real
 * assertion), and the trait names the plan asks for - Athletics, Brawl,
 * Celerity, Dominate, Resources - are guaranteed not to collide with whatever
 * `spendAllCreationPools` would otherwise have picked.
 *
 * A single +30 XP notation is awarded through the real experience view so the
 * ten steps (29 XP in total) plus the later pending change fit inside the
 * budget without the character going XP-negative. XP notations produce no
 * `VampireChange` rows at all (`experience_earned` is absent from
 * `beforeSave("Vampire")`'s `tracked_texts`), so this adds nothing to the
 * approval history - confirmed live: the fixture's history is 14 changes with
 * or without the award.
 *
 * The order is the one the assignment mandates and Task 0 measured: create ->
 * complete -> join the troupe -> staff the troupe -> only then approve. Approval
 * tightens the character's ACL, and joining afterwards fails.
 *
 * ## Four browser contexts, not one page with four logins
 *
 * `sampmem`, `sampast`, `devuser` and `sampstranger` each get their own context.
 * Every other suite re-logs a single page, which costs a full app boot per actor
 * switch; here the actors alternate on every one of the ten steps, so that would
 * be forty boots of the slowest route in the application. Separate contexts have
 * separate `localStorage`, so the four Parse sessions never collide.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, loginAsAST, loginAsStranger } = require('./helpers/auth');
const {
  navigateToHash,
  activePageId,
  hardReload,
  normalize
} = require('./helpers/jqm-helpers');
const {
  createCompletedCharacter,
  purchaseTrait,
  openNewTraitChange,
  openTraitChange,
  setTraitChangeSliders,
  readTraitChangeView,
  saveTraitChange,
  pickSimpleText,
  listSimpleTextOptions,
  readSheetXp,
  readTraits,
  readCharacterTexts,
  readInClanDisciplines,
  isCompleted,
  countCharactersByPrefix,
  destroyCharactersByPrefix
} = require('./helpers/characters');
const {
  uniqueTroupeName,
  createTroupe,
  addStaff,
  readStaffRole,
  joinTroupe,
  readRoster,
  countTroupesByPrefix,
  destroyTroupesByPrefix
} = require('./helpers/troupes');
const { seedNotations } = require('./helpers/xp');
const A = require('./helpers/approvals');

/** Every troupe and character this file creates is named with this prefix, so teardown is a query. */
const FIXTURE_PREFIX = 'E2E T5 ';

/** Brujah: in-clan Celerity / Potence / Presence, out-of-clan Dominate. Asserted, never assumed. */
const CLAN = 'Brujah';

/** Baseline values the fixture grants for free, so every step below is a change from a known value. */
const BASELINE = [
  { category: 'attributes', name: 'Physical', value: 3 },
  { category: 'attributes', name: 'Social', value: 2 },
  { category: 'attributes', name: 'Mental', value: 2 },
  { category: 'skills', name: 'Brawl', value: 1 },
  { category: 'disciplines', name: 'Celerity', value: 1 },
  { category: 'disciplines', name: 'Dominate', value: 1 },
  { category: 'backgrounds', name: 'Resources', value: 1 }
];

const AWARD_XP = 30;

test.describe.configure({ mode: 'serial' });

test.describe('Task 5 - Approvals', () => {
  /** @type {import('@playwright/test').Page} */
  let memberPage;
  /** @type {import('@playwright/test').Page} */
  let astPage;
  /** @type {import('@playwright/test').Page} */
  let adminPage;
  /** @type {import('@playwright/test').Page} */
  let strangerPage;
  const contexts = [];

  const state = {
    /** Approval ids after each step, in the order the UI reports them. */
    approvalIds: [],
    /** The approved snapshot as it stood after the previous step. */
    snapshot: null,
    /** One entry per approval step, for tests 88/89/98 to re-verify. */
    steps: [],
    xp: []
  };

  // -------------------------------------------------------------------------
  // Suite-local helpers
  // -------------------------------------------------------------------------

  /**
   * Park on the character sheet before driving a trait picker.
   *
   * `#simpletrait-new` is one page element shared by every category, so a
   * `navigateToHash(..., '#simpletrait-new')` issued while that page is already
   * active satisfies `waitForActivePage` instantly against the *previous*
   * category's list. The `$.mobile.changePage` that should follow the click
   * used to be swallowed too — the transition-queue leak this branch fixed in
   * `jquery.mobile-1.4.5.js` — and that half no longer happens. What remains is
   * only the instant-satisfaction problem above, so hopping through the
   * character sheet still buys a genuinely observable transition. Kept for that
   * reason, not because the app swallows anything.
   */
  async function parkOnSheet(page, cid) {
    await navigateToHash(page, `character?${cid}`, '#character');
  }

  /**
   * Make one player-side trait change through the real change page, returning
   * the cost the player was quoted before committing.
   */
  async function applyTraitChange(cid, { category, name, value, freeValue, fresh = false }) {
    await parkOnSheet(memberPage, cid);
    if (fresh) {
      await openNewTraitChange(memberPage, cid, category, name);
    } else {
      await openTraitChange(memberPage, cid, category, name);
    }
    await setTraitChangeSliders(memberPage, { value, freeValue });
    const quote = await readTraitChangeView(memberPage);
    await saveTraitChange(memberPage, cid, category);
    return quote;
  }

  /**
   * The whole approve-and-verify cycle for one step.
   *
   * Returns everything the caller needs for its own value assertions, having
   * already made the two assertions that are identical for all ten steps: the
   * approval count grew by exactly one, and the approvals already recorded are
   * untouched and still in the same order.
   */
  async function approveStep(cid, { expectedChangeDelta = 1 } = {}) {
    const before = state.approvalIds.slice();
    const previousSnapshot = state.snapshot;

    await A.freshApproval(astPage, cid);

    const edit = await A.readEditRegion(astPage);
    expect(edit.mode, `the AST is offered an approve control (edit region reads "${edit.text}")`).toBe('button');
    if (state.lastUpTo !== undefined && expectedChangeDelta !== null) {
      expect(edit.upTo - state.lastUpTo, 'exactly one new recorded change since the last approval').toBe(expectedChangeDelta);
    }
    state.lastUpTo = edit.upTo;

    const changeIds = await A.readRecordedChangeIds(astPage);
    const approvedChangeId = changeIds[edit.upTo];

    const after = await A.approveFromOpenView(astPage);
    expect(after, 'the approval count grew by exactly one').toHaveLength(before.length + 1);
    expect(after.slice(0, before.length), 'previously recorded approvals are untouched and in order').toEqual(before);

    const slider = await A.readApprovalSliderFromView(astPage);
    expect(slider.max, "the approvals slider's max tracks the approval count").toBe(after.length);

    const snapshot = await A.readApprovedSheet(astPage, cid);
    expect(snapshot.pageId, 'the approved route reached the printable sheet').toBe('printable-sheet');

    state.approvalIds = after;
    state.snapshot = snapshot;
    state.steps.push({ approvalId: after[after.length - 1], changeId: approvedChangeId, upTo: edit.upTo });

    return { previousSnapshot, snapshot, edit, approvalId: after[after.length - 1], changeId: approvedChangeId };
  }

  /** Every `VampireApproval` row for the character, straight from Parse, oldest first. */
  async function readApprovalRows(page, cid) {
    return page.evaluate(async (id) => {
      const Vampire = window.Parse.Object.extend('Vampire');
      const q = new window.Parse.Query('VampireApproval');
      q.equalTo('owner', new Vampire({ id }));
      q.include('approver');
      q.ascending('createdAt');
      q.limit(1000);
      const rows = await q.find();
      return rows.map((r) => ({
        id: r.id,
        approved: r.get('approved'),
        changeId: r.get('change') ? r.get('change').id : null,
        approverId: r.get('approver') ? r.get('approver').id : null,
        approverName: r.get('approver') && r.get('approver').get ? r.get('approver').get('username') : null,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null
      }));
    }, cid);
  }

  /**
   * Assertion-side read-back of whether the *current* session can see the
   * character at all. Mirrors the Karma suite's own access assertion rather
   * than inferring access from a UI redirect.
   */
  async function tryFetchCharacter(page, cid) {
    return page.evaluate(async (id) => {
      try {
        const obj = await new window.Parse.Query('Vampire').get(id);
        return { ok: true, id: obj.id };
      } catch (e) {
        return { ok: false, code: e && e.code, message: e && e.message };
      }
    }, cid);
  }

  /**
   * Ask the server directly whether this session may create an approval.
   *
   * Secondary evidence only - the UI drive is the test - but it is the only way
   * to read the *reason* the application refuses, because `approve_change` calls
   * `a.save()` with no failure handler at all, so a rejected save leaves no
   * trace anywhere on screen or in the console.
   *
   * `changeId` matters for the denied actors. Their ACL hides the character's
   * `VampireChange` rows entirely, so a probe that *queries* for a change to
   * point at fails at the query and never reaches
   * `beforeSave("VampireApproval")` at all - which would make the probe pass for
   * the wrong reason and prove nothing about the authorization rule. Handing in
   * a change id the test already knows lets the request arrive at the server
   * fully formed, so what comes back is the authorization rule's own verdict.
   */
  async function probeApprovalSave(page, cid, changeId) {
    return page.evaluate(async ({ id, changeId }) => {
      try {
        const Vampire = window.Parse.Object.extend('Vampire');
        const VampireChange = window.Parse.Object.extend('VampireChange');
        let change;
        if (changeId) {
          change = new VampireChange({ id: changeId });
        } else {
          const q = new window.Parse.Query('VampireChange');
          q.equalTo('owner', new Vampire({ id }));
          q.ascending('createdAt');
          q.limit(1000);
          const changes = await q.find();
          if (changes.length === 0) {
            return { ok: false, code: null, message: 'no recorded changes are visible to this session' };
          }
          change = changes[changes.length - 1];
        }
        const Approval = window.Parse.Object.extend('VampireApproval');
        const a = new Approval();
        a.set({
          approved: true,
          change: change,
          approver: window.Parse.User.current(),
          owner: new Vampire({ id })
        });
        const saved = await a.save();
        return { ok: true, id: saved.id };
      } catch (e) {
        return { ok: false, code: e && e.code, message: e && e.message };
      }
    }, { id: cid, changeId: changeId || null });
  }

  /** How many change rows this session can actually see for the character. */
  async function countVisibleChanges(page, cid) {
    return page.evaluate((id) => {
      const Vampire = window.Parse.Object.extend('Vampire');
      const q = new window.Parse.Query('VampireChange');
      q.equalTo('owner', new Vampire({ id }));
      return q.count();
    }, cid);
  }

  // -------------------------------------------------------------------------
  // Fixture
  // -------------------------------------------------------------------------

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600000);

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

    // Self-heal first: sweep anything a crashed earlier run left behind, keyed
    // by the name prefix, so the baseline measured immediately afterwards is
    // trustworthy on a repeat run.
    const sweptChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX);
    const sweptTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX);

    state.baseline = {
      allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()),
      allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()),
      allApprovals: await adminPage.evaluate(() => new window.Parse.Query('VampireApproval').count()),
      fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX),
      fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX)
    };
    console.log('[e2e approvals] self-heal swept characters:', JSON.stringify(sweptChars));
    console.log('[e2e approvals] self-heal swept troupes:', JSON.stringify(sweptTroupes));
    console.log('[e2e approvals] baseline counts:', JSON.stringify(state.baseline));

    // A merit whose Description value is 1 and which needs no specialization, so
    // step 9 is a plain one-point purchase and prints as "Name (1)". Read from
    // the live catalogue rather than hardcoded - "Chicanery"-style ghosts are a
    // documented hazard in this seed data.
    state.merit = await adminPage.evaluate(() => {
      const q = new window.Parse.Query('Description');
      q.equalTo('category', 'merits');
      q.limit(1000);
      return q.find().then((rows) => {
        const usable = rows
          .map((r) => ({ name: r.get('name'), value: r.get('value'), requirement: r.get('requirement') }))
          .filter((r) => String(r.value) === '1' && !r.requirement && r.name.indexOf(':') === -1)
          .sort((a, b) => a.name.localeCompare(b.name));
        return usable[0] || null;
      });
    });
    expect(state.merit, 'a one-point Merit with no specialization requirement is seeded').not.toBeNull();

    // Troupe and its Assistant Storyteller, before the character exists.
    state.troupe = await createTroupe(adminPage, uniqueTroupeName(FIXTURE_PREFIX));
    await addStaff(adminPage, state.troupe.id, 'sampast', 'AST');

    // The character, owned by sampmem, created and completed through the wizard.
    state.character = await createCompletedCharacter(memberPage, 'Vampire', {
      name: `${FIXTURE_PREFIX}Approved ${Date.now().toString(36)}`,
      texts: { clan: CLAN },
      spendPools: false
    });
    const cid = state.character.id;

    // Join before approving: approval tightens the character's ACL and a join
    // attempted afterwards fails (Task 0).
    await joinTroupe(memberPage, cid, state.troupe.id);

    // Budget for the ten steps. Produces no VampireChange rows.
    await seedNotations(memberPage, cid, [{ reason: `${FIXTURE_PREFIX}storyteller award`, earned: AWARD_XP }]);

    // A Title to change in step 10, so that step is a change and not a first pick.
    state.titles = await listSimpleTextOptions(memberPage, cid, 'titles', 'title', { duringCreation: false });
    expect(state.titles.length, 'the titles catalogue is seeded').toBeGreaterThan(1);
    state.firstTitle = await pickSimpleText(memberPage, cid, 'titles', 'title', state.titles[0], { duringCreation: false });

    // Free baseline: value slider and free slider together, so each costs 0 XP.
    for (const trait of BASELINE) {
      await parkOnSheet(memberPage, cid);
      await purchaseTrait(memberPage, cid, trait.category, trait.name, {
        value: trait.value,
        freeValue: trait.value
      });
    }

    state.baselineXp = await readSheetXp(memberPage, cid);
    console.log('[e2e approvals] fixture:', JSON.stringify({
      character: cid,
      troupe: state.troupe.id,
      merit: state.merit,
      title: state.firstTitle,
      xp: state.baselineXp
    }));
  });

  test.afterAll(async () => {
    if (adminPage) {
      const approvalSweep = await adminPage.evaluate(async (prefix) => {
        const q = new window.Parse.Query('Vampire');
        q.startsWith('name', prefix);
        q.limit(1000);
        const characters = await q.find();
        if (characters.length === 0) return { approvals: 0, errors: [] };
        const aq = new window.Parse.Query('VampireApproval');
        aq.containedIn('owner', characters);
        aq.limit(1000);
        const rows = await aq.find();
        const result = { approvals: rows.length, errors: [] };
        try {
          if (rows.length) await window.Parse.Object.destroyAll(rows);
        } catch (e) {
          result.errors.push(e && e.message ? e.message : String(e));
        }
        return result;
      }, FIXTURE_PREFIX).catch((e) => ({ approvals: -1, errors: [String(e)] }));
      console.log('[e2e approvals] destroyed VampireApproval rows:', JSON.stringify(approvalSweep));

      const destroyedChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX)
        .catch((e) => ({ characters: 0, children: 0, errors: [String(e)] }));
      const destroyedTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX)
        .catch((e) => ({ troupes: 0, roles: 0, errors: [String(e)] }));
      console.log('[e2e approvals] destroyed in teardown (characters):', JSON.stringify(destroyedChars));
      console.log('[e2e approvals] destroyed in teardown (troupes):', JSON.stringify(destroyedTroupes));

      const final = {
        allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()).catch(() => -1),
        allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
        allApprovals: await adminPage.evaluate(() => new window.Parse.Query('VampireApproval').count()).catch(() => -1),
        fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1),
        fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1)
      };
      console.log(
        '[e2e approvals] final counts (should equal baseline ' + JSON.stringify(state.baseline) + '):',
        JSON.stringify(final)
      );
    }

    for (const context of contexts) {
      await context.close().catch(() => {});
    }
  });

  // -------------------------------------------------------------------------
  // 76-77 - the fixture, and the state before any approval exists
  // -------------------------------------------------------------------------

  test('76 Setup: baseline Vampire is created and completed by sampmem and joined to the troupe', async () => {
    const cid = state.character.id;

    expect(await isCompleted(memberPage, cid, 'Vampire'), 'creation is marked complete').toBe(true);

    const owner = await memberPage.evaluate((id) => {
      return new window.Parse.Query('Vampire').include('owner').get(id).then((c) => {
        const o = c.get('owner');
        return o ? o.get('username') : null;
      });
    }, cid);
    expect(owner, 'owned by sampmem').toBe('sampmem');

    const roster = await readRoster(memberPage, state.troupe.id);
    expect(roster.map((r) => r.id), 'the character is on the troupe roster').toContain(cid);

    expect(await readStaffRole(adminPage, state.troupe.id, 'sampast'), 'sampast is the troupe AST').toBe('AST');

    const texts = await readCharacterTexts(memberPage, cid, 'Vampire');
    expect(texts.clan).toBe(CLAN);
    expect(texts.title).toBe(state.firstTitle);

    const clan = await readInClanDisciplines(memberPage, cid);
    expect(clan.inClan, 'Celerity is in-clan for this character').toContain('Celerity');
    expect(clan.inClan, 'Dominate is out-of-clan for this character').not.toContain('Dominate');

    // The free baseline cost nothing: 30 from creation plus the 30 award, none spent.
    expect(state.baselineXp).toEqual({ earned: 30 + AWARD_XP, spent: 0, available: 30 + AWARD_XP });

    for (const trait of BASELINE) {
      const found = (await readTraits(memberPage, cid, trait.category)).find((t) => t.name === trait.name);
      expect(found, `${trait.name} exists at the baseline`).toBeTruthy();
      expect(found.value, `${trait.name} value`).toBe(trait.value);
      expect(found.free_value, `${trait.name} is entirely free, so it charged no XP`).toBe(trait.value);
      expect(found.cost, `${trait.name} cost`).toBe(0);
    }
  });

  test('77 Before any approval, #character/:cid/approved shows no approved version at all', async () => {
    const cid = state.character.id;

    // CORRECTION to item 77's wording. There is no creation baseline snapshot:
    // `get_transformed_last_approved` returns null when the approvals collection
    // is empty, and the route swaps to a different page entirely.
    const landed = await A.openApprovedAllowingNone(memberPage, cid);
    expect(landed.activePage, 'no approvals means the approved route lands on the no-approval page').toBe('character-print-no-approval');
    expect(landed.text).toContain('No approved versions of your character');
    expect(landed.sheet, 'no printable snapshot was rendered').toBeNull();

    const rows = await readApprovalRows(memberPage, cid);
    expect(rows, 'no VampireApproval rows exist yet').toHaveLength(0);

    // The approval view itself: zero approvals, whole history selected, one button.
    await A.freshApproval(astPage, cid);
    const slider = await A.readApprovalSliderFromView(astPage);
    expect(slider, 'the approvals slider is rendered').not.toBeNull();
    expect(slider.max, 'zero approvals so far').toBe(0);
    expect(await A.readApprovalsFromView(astPage), 'no approval ids are rendered').toEqual([]);

    const history = await A.readSlider(astPage);
    expect(history.left.value, 'the range starts at the first recorded change').toBe(0);
    expect(history.right.value, 'and ends at the last').toBe(history.right.max);

    const edit = await A.readEditRegion(astPage);
    expect(edit.mode).toBe('button');
    expect(edit.upTo, 'the button offers the whole history').toBe(history.right.max);
    state.lastUpTo = edit.upTo;
    state.historyBeforeApprovals = history.right.max;

    // What the character currently looks like, for step 1 to contrast against.
    state.snapshot = await A.readPrintSheet(memberPage, cid, { reload: true });
    expect(state.snapshot.attributes).toEqual({ Physical: 3, Social: 2, Mental: 2 });
    expect(state.snapshot.sections.Skills).toEqual(['Brawl x1']);
    expect(state.snapshot.sections.Backgrounds).toEqual(['Resources x1']);
    expect(state.snapshot.sections.Disciplines.sort()).toEqual(['Celerity x1', 'Dominate x1']);
    expect(state.snapshot.sections.Merits, 'no merits yet').toBeUndefined();
    expect(state.snapshot.bars.Title).toBe(state.firstTitle);
  });

  // -------------------------------------------------------------------------
  // 78-87 - ten changes, ten approvals, snapshot verified at each step
  // -------------------------------------------------------------------------

  test('78 Approval 1/10 - Physical attribute raised by 1; approved snapshot matches step 1', async () => {
    const cid = state.character.id;
    const before = await readSheetXp(memberPage, cid);
    const quote = await applyTraitChange(cid, { category: 'attributes', name: 'Physical', value: 4 });
    expect(quote.cost, 'attributes cost 3 per point above the free value').toBe(3);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.attributes.Physical, 'the previous snapshot showed 3').toBe(3);
    expect(snapshot.attributes.Physical, 'the approved snapshot now shows 4').toBe(4);
    expect(snapshot.attributes.Social, 'nothing else moved').toBe(2);
    expect(snapshot.attributes.Mental).toBe(2);
  });

  test('79 Approval 2/10 - Social attribute raised by 1; approved snapshot matches step 2', async () => {
    const cid = state.character.id;
    const before = await readSheetXp(memberPage, cid);
    const quote = await applyTraitChange(cid, { category: 'attributes', name: 'Social', value: 3 });
    expect(quote.cost).toBe(3);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.attributes.Social, 'the step-1 snapshot showed 2').toBe(2);
    expect(snapshot.attributes.Social, 'the approved snapshot now shows 3').toBe(3);
    expect(snapshot.attributes.Physical, 'step 1 is still approved').toBe(4);
  });

  test('80 Approval 3/10 - Mental attribute raised by 1; approved snapshot matches step 3', async () => {
    const cid = state.character.id;
    const before = await readSheetXp(memberPage, cid);
    const quote = await applyTraitChange(cid, { category: 'attributes', name: 'Mental', value: 3 });
    expect(quote.cost).toBe(3);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.attributes.Mental, 'the step-2 snapshot showed 2').toBe(2);
    expect(snapshot.attributes, 'all three attributes now read their step-3 values').toEqual({
      Physical: 4, Social: 3, Mental: 3
    });
  });

  test('81 Approval 4/10 - Skill Athletics purchased at 1; approved snapshot matches step 4', async () => {
    const cid = state.character.id;
    const before = await readSheetXp(memberPage, cid);
    const quote = await applyTraitChange(cid, { category: 'skills', name: 'Athletics', value: 1, freeValue: 0, fresh: true });
    expect(quote.cost, 'a generation-1 skill costs 1 at value 1').toBe(1);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.sections.Skills, 'the step-3 snapshot listed only Brawl').toEqual(['Brawl x1']);
    expect(snapshot.sections.Skills.sort(), 'Athletics now appears on the approved sheet').toEqual(['Athletics x1', 'Brawl x1']);
  });

  test('82 Approval 5/10 - Skill Brawl raised to 2; approved snapshot matches step 5', async () => {
    const cid = state.character.id;
    const before = await readSheetXp(memberPage, cid);
    // Brawl sits at value 1 with free_value 1, so the upgrade is charged only the
    // increment between the cumulative totals: 3 - 1.
    const quote = await applyTraitChange(cid, { category: 'skills', name: 'Brawl', value: 2 });
    expect(quote.cost).toBe(2);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.sections.Skills, 'the step-4 snapshot showed Brawl at 1').toContain('Brawl x1');
    expect(snapshot.sections.Skills, 'the approved snapshot now shows Brawl at 2').toContain('Brawl x2');
    expect(snapshot.sections.Skills, 'and no longer shows the previous value').not.toContain('Brawl x1');
    expect(snapshot.sections.Skills, 'Athletics is untouched').toContain('Athletics x1');
  });

  test('83 Approval 6/10 - In-clan discipline Celerity +1; approved snapshot matches step 6', async () => {
    const cid = state.character.id;
    const before = await readSheetXp(memberPage, cid);
    // In-clan disciplines cost 3 per level cumulatively: total(2) - total(1) = 9 - 3.
    const quote = await applyTraitChange(cid, { category: 'disciplines', name: 'Celerity', value: 2 });
    expect(quote.cost).toBe(6);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.sections.Disciplines).toContain('Celerity x1');
    expect(snapshot.sections.Disciplines).toContain('Celerity x2');
    expect(snapshot.sections.Disciplines, 'the previous value is gone').not.toContain('Celerity x1');
    expect(snapshot.sections.Disciplines, 'Dominate has not moved').toContain('Dominate x1');
  });

  test('84 Approval 7/10 - Out-of-clan discipline Dominate +1; approved snapshot matches step 7', async () => {
    const cid = state.character.id;
    const before = await readSheetXp(memberPage, cid);
    // Out-of-clan costs 4 per level cumulatively: total(2) - total(1) = 12 - 4.
    const quote = await applyTraitChange(cid, { category: 'disciplines', name: 'Dominate', value: 2 });
    expect(quote.cost).toBe(8);
    expect(quote.cost, 'out-of-clan is dearer than the in-clan upgrade in step 6').toBeGreaterThan(6);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.sections.Disciplines).toContain('Dominate x1');
    expect(snapshot.sections.Disciplines.sort()).toEqual(['Celerity x2', 'Dominate x2']);
    expect(snapshot.sections.Disciplines).not.toContain('Dominate x1');
  });

  test('85 Approval 8/10 - Background Resources +1; approved snapshot matches step 8', async () => {
    const cid = state.character.id;
    const before = await readSheetXp(memberPage, cid);
    const quote = await applyTraitChange(cid, { category: 'backgrounds', name: 'Resources', value: 2 });
    expect(quote.cost).toBe(2);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.sections.Backgrounds).toEqual(['Resources x1']);
    expect(snapshot.sections.Backgrounds).toEqual(['Resources x2']);
  });

  test('86 Approval 9/10 - Merit added; approved snapshot matches step 9', async () => {
    const cid = state.character.id;
    const meritName = state.merit.name;
    const before = await readSheetXp(memberPage, cid);
    const quote = await applyTraitChange(cid, { category: 'merits', name: meritName, value: 1, freeValue: 0, fresh: true });
    // Merits are charged their own modified value - deliberate, per Task 0.
    expect(quote.cost, 'a one-point Merit costs one XP').toBe(1);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.sections.Merits, 'the step-8 snapshot had no Merits section at all').toBeUndefined();
    // Merits render with print style 4, i.e. "Name (value)", not "Name xN".
    expect(snapshot.sections.Merits, 'the merit appears on the approved sheet').toEqual([`${meritName} (1)`]);

    const stored = (await readTraits(memberPage, cid, 'merits')).find((t) => t.name === meritName);
    expect(stored, 'assertion-side read-back of the stored merit').toMatchObject({ value: 1, free_value: 0, cost: 1 });
  });

  test('87 Approval 10/10 - Text attribute Title changed; approved snapshot matches step 10', async () => {
    const cid = state.character.id;
    const nextTitle = state.titles.find((t) => t !== state.firstTitle);
    expect(nextTitle, 'a second seeded Title exists to change to').toBeTruthy();

    const before = await readSheetXp(memberPage, cid);
    await parkOnSheet(memberPage, cid);
    const chosen = await pickSimpleText(memberPage, cid, 'titles', 'title', nextTitle, { duringCreation: false });
    expect(chosen).toBe(nextTitle);
    expect(await readSheetXp(memberPage, cid), 'a text attribute change costs nothing').toEqual(before);

    const { previousSnapshot, snapshot } = await approveStep(cid);

    expect(previousSnapshot.bars.Title, 'the step-9 snapshot carried the original Title').toBe(state.firstTitle);
    expect(snapshot.bars.Title, 'the approved snapshot carries the new Title').toBe(nextTitle);
    expect(snapshot.text, 'and no longer shows the previous one').not.toContain(`Title: ${state.firstTitle}`);
    expect((await readCharacterTexts(memberPage, cid, 'Vampire')).title).toBe(nextTitle);

    state.secondTitle = nextTitle;
    state.tenthSnapshot = snapshot;
    expect(state.approvalIds, 'ten approvals have now been recorded').toHaveLength(10);
  });

  // -------------------------------------------------------------------------
  // 88-89 - reading the ten approvals back
  // -------------------------------------------------------------------------

  test('88 #character/:cid/approval lists all ten approvals in chronological order with the approver on each', async () => {
    const cid = state.character.id;

    await A.freshApproval(astPage, cid);
    const rendered = await A.readApprovalsFromView(astPage);
    expect(rendered, 'ten approval ids are rendered').toHaveLength(10);
    expect(rendered, 'in exactly the order the ten steps produced them').toEqual(state.approvalIds);

    const slider = await A.readApprovalSliderFromView(astPage);
    expect(slider.max, "the approvals slider's max is the approval count").toBe(10);

    // Chronological order, proven against the rows themselves rather than
    // against the order this suite happened to record.
    const rows = await readApprovalRows(astPage, cid);
    expect(rows.map((r) => r.id)).toEqual(rendered);
    const times = rows.map((r) => Date.parse(r.createdAt));
    expect(times.slice(1).every((t, i) => t >= times[i]), 'createdAt ascending').toBe(true);

    // The approver is rendered on each row. Walk the slider 0..9 rather than
    // jumping to the end: EditView only listens to `change:right`, so a move
    // that leaves the right-hand change index alone does not re-render it.
    const astUserId = await astPage.evaluate(() => window.Parse.User.current().id);
    const observed = [];
    for (let i = 0; i < 10; i++) {
      await A.setApprovalIndex(astPage, i);
      const edit = await A.readEditRegion(astPage);
      expect(edit.mode, `approval ${i} renders its own row`).toBe('table');
      expect(edit.headers).toEqual(['createdAt', 'approved', 'change', 'approver', 'owner']);
      expect(edit.row.approved, `approval ${i} is an approval, not a rejection`).toBe('true');
      expect(edit.row.owner, `approval ${i} names this character as owner`).toBe(cid);
      expect(edit.row.approver, `approval ${i} names sampast as approver`).toBe(astUserId);
      observed.push(edit.row);
    }

    // `format_approval` renders pointers as their object id, so "the approver's
    // name" is really the _User object id; resolve it to prove it is sampast.
    const approverNames = [...new Set(rows.map((r) => r.approverName))];
    expect(approverNames, 'every one of the ten was approved by sampast').toEqual(['sampast']);
    expect([...new Set(rows.map((r) => r.approverId))]).toEqual([astUserId]);

    state.approvalRows = observed;
    state.parseRows = rows;
  });

  test('89 Each approval identifies the change it approved and displays that change\'s old to new values', async () => {
    const cid = state.character.id;

    const expected = [
      { category: 'attributes', name: 'Physical', type: 'update', old_value: '3', value: '4' },
      { category: 'attributes', name: 'Social', type: 'update', old_value: '2', value: '3' },
      { category: 'attributes', name: 'Mental', type: 'update', old_value: '2', value: '3' },
      { category: 'skills', name: 'Athletics', type: 'define', old_value: '', value: '1' },
      { category: 'skills', name: 'Brawl', type: 'update', old_value: '1', value: '2' },
      { category: 'disciplines', name: 'Celerity', type: 'update', old_value: '1', value: '2' },
      { category: 'disciplines', name: 'Dominate', type: 'update', old_value: '1', value: '2' },
      { category: 'backgrounds', name: 'Resources', type: 'update', old_value: '1', value: '2' },
      { category: 'merits', name: state.merit.name, type: 'define', old_value: '', value: '1' },
      { category: 'core', name: 'title', type: 'core_update', old_value: '', value: '' }
    ];

    await A.freshApproval(astPage, cid);

    for (let i = 0; i < 10; i++) {
      await A.setApprovalIndex(astPage, i);

      const edit = await A.readEditRegion(astPage);
      expect(edit.mode).toBe('table');
      expect(edit.row.change, `approval ${i} points at the change step ${i + 1} recorded`).toBe(state.steps[i].changeId);

      // Selecting an approval re-points the change range onto what it covered,
      // which is what actually associates an approval with its change rows.
      const rows = await A.readSelectedChanges(astPage);
      expect(rows.length, `approval ${i} covers at least one change row`).toBeGreaterThan(0);
      const last = rows[rows.length - 1];
      expect(last.id, `the last covered row is the approved change`).toBe(state.steps[i].changeId);
      expect(last.category).toBe(expected[i].category);
      expect(last.name).toBe(expected[i].name);
      expect(last.type).toBe(expected[i].type);
      expect(last.old_value, `approval ${i} shows the old value`).toBe(expected[i].old_value);
      expect(last.value, `approval ${i} shows the new value`).toBe(expected[i].value);
    }

    // The tenth is the Title change, whose before/after live in the text columns
    // rather than the numeric ones.
    await A.setApprovalIndex(astPage, 9);
    const titleRows = await A.readSelectedChanges(astPage);
    const titleRow = titleRows[titleRows.length - 1];
    expect(titleRow.old_text, 'the Title change records the previous title').toBe(state.firstTitle);
    expect(titleRow.new_text, 'and the new one').toBe(state.secondTitle);
  });

  // -------------------------------------------------------------------------
  // 90-93 - one further, unapproved change
  // -------------------------------------------------------------------------

  test.fail('90 After a further unapproved change, the sheet flags the character as containing unapproved edits', async () => {
    const cid = state.character.id;

    // The pending change every test from here on depends on: Athletics, whose
    // purchase was approved back in step 4, is raised from 1 to 2.
    const before = await readSheetXp(memberPage, cid);
    const quote = await applyTraitChange(cid, { category: 'skills', name: 'Athletics', value: 2 });
    expect(quote.cost).toBe(2);
    expect((await readSheetXp(memberPage, cid)).available - before.available).toBe(-quote.cost);
    state.pending = { category: 'skills', name: 'Athletics', from: 1, to: 2, cost: quote.cost };

    // KNOWN GAP, pinned red deliberately. `characterView` (public/index.html)
    // renders XP, a portrait, and a menu of links; it never fetches approvals or
    // recorded changes, and no template anywhere on `#character` mentions
    // approval state. The application's only "unapproved edits" signal is in the
    // approval view - see test 93, which asserts it for real.
    await parkOnSheet(memberPage, cid);
    const sheet = normalize(await memberPage.locator('#character').textContent());
    expect(sheet, 'the character sheet flags unapproved edits').toMatch(/unapproved|pending approval|awaiting approval/i);
  });

  test('91 #character/:cid/approved still shows the step-10 snapshot while the pending change exists', async () => {
    const cid = state.character.id;
    expect(state.pending, 'test 90 made the pending change').toBeTruthy();

    const approved = await A.readApprovedSheet(astPage, cid, { reload: true });
    expect(approved.pageId).toBe('printable-sheet');
    expect(approved.sections.Skills, 'the approved sheet still shows Athletics at its approved value')
      .toContain('Athletics x1');
    expect(approved.sections.Skills, 'and not the pending value').not.toContain('Athletics x2');

    // Byte-for-byte the same snapshot test 87 recorded, not merely "close".
    expect(approved.attributes).toEqual(state.tenthSnapshot.attributes);
    expect(approved.sections.Skills.sort()).toEqual(state.tenthSnapshot.sections.Skills.sort());
    expect(approved.sections.Disciplines.sort()).toEqual(state.tenthSnapshot.sections.Disciplines.sort());
    expect(approved.sections.Backgrounds).toEqual(state.tenthSnapshot.sections.Backgrounds);
    expect(approved.sections.Merits).toEqual(state.tenthSnapshot.sections.Merits);
    expect(approved.bars.Title).toBe(state.secondTitle);
  });

  test('92 #character/:cid/print shows the current pending values, demonstrably different from the approved snapshot', async () => {
    const cid = state.character.id;

    const live = await A.readPrintSheet(astPage, cid, { reload: true });
    expect(live.pageId).toBe('printable-sheet');
    expect(live.sections.Skills, 'the live sheet shows the pending value').toContain('Athletics x2');
    expect(live.sections.Skills, 'and not the approved one').not.toContain('Athletics x1');

    const approved = await A.readApprovedSheet(astPage, cid, { reload: true });
    expect(approved.sections.Skills).toContain('Athletics x1');

    // The two sheets differ in exactly the pending change and nothing else.
    expect(live.sections.Skills.sort()).not.toEqual(approved.sections.Skills.sort());
    expect(live.attributes).toEqual(approved.attributes);
    expect(live.sections.Disciplines.sort()).toEqual(approved.sections.Disciplines.sort());
    expect(live.sections.Backgrounds).toEqual(approved.sections.Backgrounds);
    expect(live.bars.Title).toBe(approved.bars.Title);
  });

  test('93 False-approval detection: modifying a trait after its approval marks that approval as stale', async () => {
    const cid = state.character.id;

    await A.freshApproval(astPage, cid);

    // The invariant the Karma suite (`approvals-test.js`, "detects false
    // approvals when modifications occur after approval") asserts at the model
    // layer: the newest approval must no longer point at the newest recorded
    // change once the player has edited an already-approved trait.
    const changeIds = await A.readRecordedChangeIds(astPage);
    const rows = await readApprovalRows(astPage, cid);
    const lastApprovedChangeId = rows[rows.length - 1].changeId;
    expect(changeIds[changeIds.length - 1], 'a newer change than the newest approval exists')
      .not.toBe(lastApprovedChangeId);
    expect(changeIds.indexOf(lastApprovedChangeId), 'the approved change is still in the history')
      .toBe(changeIds.length - 2);

    // ...and how that surfaces in the UI. `EditView.templateHelpers` compares the
    // last approved change id with the last recorded one; while they matched, the
    // region rendered the literal text "No unapproved changes". It now offers the
    // approve button again, one change further along.
    const edit = await A.readEditRegion(astPage);
    expect(edit.mode, 'the approve control is back, so the character reads as unapproved').toBe('button');
    expect(edit.upTo, 'and it points one change past the last approval').toBe(state.lastUpTo + 1);
    expect(edit.text, 'the "No unapproved changes" state is gone').not.toContain('No unapproved changes');

    // The stale approval is specifically the one that approved this trait -
    // step 4's, which bought Athletics at 1. Selecting it still shows the value
    // it approved, not the value the trait now holds.
    await A.setApprovalIndex(astPage, 3);
    const stale = await A.readEditRegion(astPage);
    expect(stale.mode).toBe('table');
    expect(stale.row.change).toBe(state.steps[3].changeId);
    const covered = await A.readSelectedChanges(astPage);
    const approvedRow = covered[covered.length - 1];
    expect(approvedRow.name).toBe('Athletics');
    expect(approvedRow.value, 'the approval still records Athletics at 1').toBe('1');

    // No new approval appeared, and none was silently retracted.
    expect(await A.readApprovalsFromView(astPage), 'still exactly the ten approvals').toEqual(state.approvalIds);
  });

  // -------------------------------------------------------------------------
  // 94-97 - who may approve
  // -------------------------------------------------------------------------

  test('94 sampmem cannot approve their own character\'s changes', async () => {
    const cid = state.character.id;

    // The owner *can* open the view and is even offered the control - the
    // template performs no permission check at all - so the refusal has to be
    // demonstrated by driving it.
    await A.freshApproval(memberPage, cid);
    const before = await A.readApprovalsFromView(memberPage);
    expect(before, 'the owner sees the same ten approvals').toEqual(state.approvalIds);

    const edit = await A.readEditRegion(memberPage);
    expect(edit.mode, 'the owner is offered an approve control regardless of permission').toBe('button');

    await memberPage.locator('#character-approval .approve-change').first().click();
    await memberPage.waitForTimeout(5000);

    // Nothing was persisted: no eleventh approval, and the button did not flip
    // to "No unapproved changes" the way a successful approval makes it.
    const after = await A.readApprovalsFromView(memberPage);
    expect(after, 'no approval was persisted by the owner\'s click').toEqual(before);
    const afterEdit = await A.readEditRegion(memberPage);
    expect(afterEdit.mode, 'the approve control is still offered, so nothing was approved').toBe('button');
    expect(afterEdit.upTo).toBe(edit.upTo);

    // What remediation R3 added. `approve_change` used to call `a.save()` with
    // no failure handler at all, so the server's refusal had nowhere to go: the
    // button simply did nothing and said nothing, and only a direct probe could
    // observe that the character was protected. The reason now reaches the
    // player.
    const banner = memberPage.locator('#global-error-region');
    await expect(banner, 'the refusal is surfaced, not swallowed').toBeVisible();
    expect(await banner.textContent()).toContain('Players cannot approve their own character changes');

    // Read-back through a fresh storyteller view, so this is not just the
    // owner's own stale DOM.
    const rows = await readApprovalRows(adminPage, cid);
    expect(rows, 'still exactly ten approvals server-side').toHaveLength(10);
    expect(rows.map((r) => r.approverName), 'none of them by sampmem').not.toContain('sampmem');

    // And the server-side rule itself, probed directly, so the refusal is
    // proven at both layers rather than only where it is rendered.
    const probe = await probeApprovalSave(memberPage, cid);
    expect(probe.ok, 'the server refuses an owner-created approval').toBe(false);
    expect(probe.message).toContain('Players cannot approve their own character changes');
    console.log('[e2e approvals] 94 refusal:', JSON.stringify(probe));
  });

  test('95 A stranger user sharing no troupe cannot open #character/:cid/approval', async () => {
    const cid = state.character.id;

    const troupes = await strangerPage.evaluate(async () => {
      const q = new window.Parse.Query(window.Parse.Role);
      q.equalTo('users', window.Parse.User.current());
      q.limit(1000);
      const found = await q.find();
      return found.map((r) => r.get('name'));
    });
    expect(troupes, 'the stranger holds no storyteller role on this character\'s troupe')
      .not.toContain(`AST_${state.troupe.id}`);
    expect(troupes).not.toContain(`LST_${state.troupe.id}`);

    const fetched = await tryFetchCharacter(strangerPage, cid);
    expect(fetched.ok, 'the character is not readable by a stranger at all').toBe(false);
    expect(fetched.code, 'Parse.Error.OBJECT_NOT_FOUND').toBe(101);
    expect(await countVisibleChanges(strangerPage, cid), 'nor is any of its change history').toBe(0);

    // Park somewhere the stranger *can* reach first, so "the previous page is
    // still active" is a real observation rather than an artefact of never
    // having navigated at all.
    await navigateToHash(strangerPage, 'characters?all', '#characters-all');
    expect(await activePageId(strangerPage)).toBe('characters-all');

    const landed = await A.attemptOpenApproval(strangerPage, cid);
    expect(landed.activePage, 'the approval route leaves the stranger where they were').toBe('characters-all');
    expect(landed.hash, 'even though the hash did change').toContain('/approval');
    expect(landed.approveControls, 'no approve control is rendered anywhere').toBe(0);
    console.log('[e2e approvals] 95 stranger landed on:', JSON.stringify(landed));

    // And the server refuses even a fully-formed request, so this is not merely
    // a client-side routing failure.
    const probe = await probeApprovalSave(strangerPage, cid, state.steps[0].changeId);
    expect(probe.ok, 'the approval save is refused server-side').toBe(false);
    expect(probe.message).toContain('does not have Storyteller role for this troupe');
    console.log('[e2e approvals] 95 refusal:', JSON.stringify(probe));

    const rows = await readApprovalRows(adminPage, cid);
    expect(rows, 'no approval was created').toHaveLength(10);
  });

  test('96 An AST from a different troupe cannot approve this character', async () => {
    const cid = state.character.id;

    // Give the stranger a genuine Assistant Storyteller role - on a *different*
    // troupe. This is what separates test 96 from test 95: the actor now holds a
    // real per-troupe storyteller role, just not this character's.
    const otherTroupe = await createTroupe(adminPage, uniqueTroupeName(FIXTURE_PREFIX));
    const staff = await addStaff(adminPage, otherTroupe.id, 'sampstranger', 'AST');
    expect(staff.role).toBe('AST');
    expect(await readStaffRole(adminPage, otherTroupe.id, 'sampstranger')).toBe('AST');
    state.otherTroupe = otherTroupe;

    await hardReload(strangerPage);
    const roles = await strangerPage.evaluate(async () => {
      const q = new window.Parse.Query(window.Parse.Role);
      q.equalTo('users', window.Parse.User.current());
      q.limit(1000);
      const found = await q.find();
      return found.map((r) => r.get('name'));
    });
    expect(roles, 'the stranger really is an AST somewhere').toContain(`AST_${otherTroupe.id}`);
    expect(roles, 'but not on this character\'s troupe').not.toContain(`AST_${state.troupe.id}`);

    // Being staff elsewhere buys no access here.
    const fetched = await tryFetchCharacter(strangerPage, cid);
    expect(fetched.ok, 'the character is still unreadable').toBe(false);
    expect(fetched.code).toBe(101);

    await navigateToHash(strangerPage, 'troupes', '#troupes-list');
    const landed = await A.attemptOpenApproval(strangerPage, cid);
    expect(landed.activePage, 'the approval route leaves the other troupe\'s AST where they were').toBe('troupes-list');
    expect(landed.approveControls).toBe(0);

    // And the server-side rule refuses independently of the ACL. This is the
    // `beforeSave("VampireApproval")` branch that looks for AST_/LST_ on one of
    // the *character's own* troupes: the request is handed a valid change id, so
    // it arrives fully formed and the verdict is the authorization rule's own,
    // not an incidental failure to read the history.
    const probe = await probeApprovalSave(strangerPage, cid, state.steps[0].changeId);
    expect(probe.ok, 'the approval save is refused').toBe(false);
    expect(probe.message, 'refused specifically for holding no storyteller role on this troupe')
      .toContain('does not have Storyteller role for this troupe');
    console.log('[e2e approvals] 96 refusal:', JSON.stringify(probe));

    const rows = await readApprovalRows(adminPage, cid);
    expect(rows, 'still exactly ten approvals, none of them the stranger\'s').toHaveLength(10);
    expect(rows.map((r) => r.approverName)).not.toContain('sampstranger');
  });

  test('97 Administrator devuser can approve and is recorded as the approver', async () => {
    const cid = state.character.id;

    await A.freshApproval(adminPage, cid);
    const before = await A.readApprovalsFromView(adminPage);
    expect(before, 'the admin sees the ten approvals sampast made').toEqual(state.approvalIds);

    const edit = await A.readEditRegion(adminPage);
    expect(edit.mode, 'the pending change from test 90 is still outstanding').toBe('button');

    const changeIds = await A.readRecordedChangeIds(adminPage);
    const pendingChangeId = changeIds[edit.upTo];

    const after = await A.approveFromOpenView(adminPage);
    expect(after, 'an eleventh approval was created').toHaveLength(11);
    expect(after.slice(0, 10), 'the ten earlier approvals are untouched').toEqual(state.approvalIds);

    const rows = await readApprovalRows(adminPage, cid);
    expect(rows).toHaveLength(11);
    expect(rows[10].approverName, 'devuser is recorded as the approver').toBe('devuser');
    expect(rows[10].changeId, 'and it approved the pending change').toBe(pendingChangeId);
    expect(rows.slice(0, 10).map((r) => r.approverName), 'the first ten are still sampast\'s')
      .toEqual(new Array(10).fill('sampast'));

    // The character now reads as fully approved, and the approved snapshot has
    // caught up with the pending change.
    const nowEdit = await A.readEditRegion(adminPage);
    expect(nowEdit.mode, 'nothing is left unapproved').toBe('none');
    expect(nowEdit.text).toContain('No unapproved changes');

    const approved = await A.readApprovedSheet(adminPage, cid);
    expect(approved.sections.Skills, 'the approved sheet has caught up to Athletics 2').toContain('Athletics x2');
    expect(approved.sections.Skills).not.toContain('Athletics x1');

    state.eleventhApprovalId = after[10];
    state.allApprovalIds = after;
  });

  test('98 All ten approvals survive a reload and re-render identically', async () => {
    const cid = state.character.id;

    await hardReload(astPage);
    await A.freshApproval(astPage, cid);

    const rendered = await A.readApprovalsFromView(astPage);
    expect(rendered.slice(0, 10), 'the ten original approvals survive, in order').toEqual(state.approvalIds);
    expect(rendered, 'together with the eleventh, made by devuser in test 97').toEqual(state.allApprovalIds);

    const slider = await A.readApprovalSliderFromView(astPage);
    expect(slider.max).toBe(11);

    // Re-render every one of the ten and compare against what test 88 captured.
    for (let i = 0; i < 10; i++) {
      await A.setApprovalIndex(astPage, i);
      const edit = await A.readEditRegion(astPage);
      expect(edit.mode, `approval ${i} re-renders as a row`).toBe('table');
      expect(edit.row, `approval ${i} re-renders identically after a reload`).toEqual(state.approvalRows[i]);
    }

    const rows = await readApprovalRows(astPage, cid);
    expect(rows.slice(0, 10).map((r) => ({ id: r.id, changeId: r.changeId, approverName: r.approverName })))
      .toEqual(state.parseRows.map((r) => ({ id: r.id, changeId: r.changeId, approverName: r.approverName })));
  });
});
