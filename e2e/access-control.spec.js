/**
 * Task 13 - Access Control In The UI
 *
 * Covers testing_implementation_plan.md items 381-393, the final task in the
 * plan. Karma parity with `public/scripts/app/tests/admin-test.js` (role
 * escalation, `make_me_admin`, permission flags, cross-user data access) and
 * `description-test.js`.
 *
 * ---
 *
 * ## The standard this file holds itself to
 *
 * A broken access-control test fails silently and reads as security: if an
 * assertion passes because a page 404'd, because a probe errored before
 * reaching the authorization rule, or because a redirect happened for an
 * unrelated reason, the test is worse than no test at all. Task 5's
 * `approvals.spec.js` hit exactly this - its cross-troupe test initially
 * passed because the probe failed at the *query* stage and never reached the
 * authorization rule - and was only caught by handing the probe a valid id so
 * the refusal came from the rule itself. Every test below was verified live
 * against a running server (not inferred from source alone) before being
 * written, and every refusal is proven one of two ways: a server-side probe
 * that reaches the real authorization rule and quotes its error, or a
 * before/after read-back proving the protected data did not change.
 *
 * ## Findings that drove this file's shape
 *
 * Three of the thirteen numbered items describe a protection that, measured
 * live, does not exist as worded. Per this suite's convention, those are
 * `test.fail()` with the defect named and proven via a real, positive
 * interaction - never weakened into a passing assertion around the hole.
 *
 * 1. **Item 381 is false as written.** `administration: function () { ...
 *    enforce_logged_in().then(function () { ...; $.mobile.changePage
 *    ("#administration", ...); }) }` (mobileRouter.js) has no `is_ad` check at
 *    all, and `#administration`'s markup (public/index.html) is a bare `<ul>`
 *    of links with no template conditional either. Measured live: `sampmem`
 *    reaches `#administration` and sees the identical 13-link menu an admin
 *    sees. This is one further instance of the "route-level gating is
 *    inconsistent" pattern Task 1 and Task 2 already found on sibling routes
 *    (`administration_patronage_new`, the five rule-editor routes) - just on
 *    the landing page itself this time.
 * 2. **A new defect, not in the plan's prose: Patronage records are public.**
 *    `Patronage`'s class-level permissions grant `find`/`get` to `"*"`
 *    (database_seed/_SCHEMA.json), and `PatronageView.js`'s submit handler
 *    additionally sets `acl.setPublicReadAccess(true)` on every record it
 *    saves - the only way a Patronage row is ever created. Measured live: as
 *    `sampmem`, `new Parse.Query('Patronage').get(<sampast's record id>)`
 *    returns the record, `owner` and all. Item 384's literal wording ("cannot
 *    view another user's patronage *page*") is true - the
 *    `administration_user_patronages` route does have a working `is_ad` gate
 *    and never transitions for a non-admin, matching Task 1 test 14's finding
 *    for `sampast` - but the underlying data behind that page is not actually
 *    private. Test 384 proves the page is blocked (as asked); a companion
 *    test 384b - the "60b" pattern Task 4 established for isolating a finding
 *    without destabilising the numbered test - pins the data-level hole red.
 * 3. **Item 389 cannot succeed in this deployment.** `index.js`'s
 *    `ParseServer` settings configure no `emailAdapter`. Measured live:
 *    `Parse.User.requestPasswordReset(email)` rejects with code 1, "An
 *    appName, publicServerURL, and emailAdapter are required for password
 *    reset and email verification functionality." `AdministrationUserView`'s
 *    `ResetButtonView` is wired correctly end to end - it calls the real API
 *    and renders whichever outcome comes back - and the *access* to the
 *    button is correctly admin-gated (the button lives on
 *    `#administration/user/:id`, proven blocked for `sampmem` by test 385);
 *    the button itself is just deterministically unable to produce the
 *    "confirmation" item 389 asks for, in any run against this server
 *    configuration. Test 389 drives the real click and asserts the literal
 *    expectation, which is therefore expected to fail.
 *
 * Two more findings shape tests that do pass, so the right mechanism gets
 * asserted rather than an incidental one:
 *
 * - **Two different denial codes for two different mechanisms, and both are
 *   real.** `bnsmetv1_ClanRule` / `bnsctdbs_KithRule` are protected by
 *   *class-level* permissions (`update`/`create`/`delete`: `role:Administrator`
 *   only) - a non-owner's edit is refused with Parse code 119, "Permission
 *   denied for action update on class X", regardless of the object's own ACL.
 *   `Description` has wide-open class-level permissions (`"*"` on every
 *   action) but each row's *object* ACL (set by `DescriptionsView.js`'s
 *   submit handler) grants write only to `role:Administrator` - a non-owner's
 *   edit or delete is refused with code 101, "Object not found", because
 *   Parse Server hides an ACL-denied object's existence rather than naming
 *   the permission. Measured live for both. Tests 382/383 assert 119; test
 *   391 asserts 101, for both an update attempt and a delete attempt.
 * - **`characterlog`/`characterexperience` have no `.fail()` handler at all**
 *   (mobileRouter.js), unlike `character` (the sheet route), which redirects
 *   cleanly back to `#characters?all` on a denied fetch via an explicit
 *   `.fail(function () { window.location.hash = back_url; })`. Measured live:
 *   for the log/experience routes, a denied fetch leaves the hash pointed at
 *   the attempted route, the active page never changes, and the `ui-loading`
 *   overlay is left permanently shown (`$.mobile.loading("hide")` sits inside
 *   the `.done()` callback that never runs). The character is still
 *   genuinely inaccessible either way - test 393 proves that with the same
 *   direct-fetch probe test 392 uses - but the *symptom* differs from the
 *   sheet route, and asserting the real one (test 392 gets a clean redirect,
 *   test 393 gets a stuck loader and no navigation) is what "no visible error
 *   is a finding, not a reason to weaken a test" means in practice here.
 *
 * ## Two role-toggle mechanisms, not one
 *
 * "Administrator" and "Storyteller" are governed by genuinely different UI
 * surfaces, and item 388 cannot be satisfied by looking for a second checkbox
 * next to the one item 387 uses:
 *
 * - **Administrator** is a single global `Parse.Role` toggled from
 *   `AdministrationUserView`'s "Administrator" checkbox
 *   (`#administration/user/:id`) - the only role-editing control that view
 *   has; `UserForm`'s own fields (realname/email/username/...) are rendered
 *   disabled ahead of it. Submitting adds or removes the target user from the
 *   `Administrator` role directly (never touches the user's own
 *   `admininterface` field), which is why the ground truth this file asserts
 *   is role membership, not the checkbox's own state.
 * - **Storyteller is per-troupe, not global**, and has no admin-view
 *   checkbox at all. `storytellerinterface` (the flag that gates the ST menu)
 *   is a *derived* value the `home` route recomputes from "does this user
 *   hold any `Parse.Role` at all" - there is nothing to toggle directly. The
 *   only real grant mechanism is `#troupe/:id/staff/edit/:uid`
 *   (`TroupeEditStaffView`, already exercised by every troupe suite's
 *   `addStaff`/`readStaffRole` helpers), which adds the target user to
 *   `AST_<troupeId>` / `LST_<troupeId>` / `Narrator_<troupeId>` via the
 *   `change_troupe_staff` cloud function. Test 388 grants `sampmem` an AST
 *   role on a fixture troupe this way and verifies it in the one place
 *   Storyteller status is real: per-troupe role membership.
 *
 * `addStaff(..., 'None')` cannot be used to *revert* that grant: `Troupe.
 * get_staff()` (models/Troupe.js) builds its roster by enumerating the three
 * per-troupe roles' own members, so a user set to "Not on Staff" does not
 * appear in that list *at all* - there is no "None: sampmem" row for `addStaff`'s
 * own success-polling to find, and it would time out waiting for one. This
 * file's local `removeStaffRole` drives the identical form submission and
 * instead confirms success by the user's absence from the roster.
 *
 * ## Accounts
 *
 * `devuser`/`thedumbness` (admin), `sampmem`/`sampmem` (plain member, the
 * actor under test almost throughout), `sampast`/`sampast` (ST on the legacy
 * seeded troupe, used here only as the owner of "another player's" fixture
 * character - a role they hold elsewhere is irrelevant to that fixture, which
 * shares no troupe with `sampmem`). No new account is created; per the
 * assignment, this suite must not add to the 27 ad-hoc probe accounts an
 * earlier task already leaked.
 *
 * ## Four contexts, one of them never logged in
 *
 * `adminPage`, `memberPage`, and `astPage` mirror every other multi-actor
 * suite's reasoning (separate `localStorage`, no re-login cost per actor
 * switch - see `approvals.spec.js`). `loggedOutPage` is a fourth context that
 * is never logged into anything, for item 390's sweep.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, loginAsAST } = require('./helpers/auth');
const {
  navigateToHash,
  activePageId,
  waitForActivePage,
  waitForJqmLoader,
  hardReload,
  clearStuckLoader,
  waitForAppReady,
  selectBackformOption
} = require('./helpers/jqm-helpers');
const {
  createCharacter,
  uniqueName,
  countCharactersByPrefix,
  destroyCharactersByPrefix
} = require('./helpers/characters');
const {
  uniqueTroupeName,
  createTroupe,
  addStaff,
  readStaffRole,
  countTroupesByPrefix,
  destroyTroupesByPrefix
} = require('./helpers/troupes');
const {
  createDescriptionViaAdmin,
  updateDescriptionViaAdmin,
  getDescriptionByName,
  destroyDescriptions
} = require('./helpers/descriptions');
const {
  openRuleEditor,
  submitRuleRow,
  getRuleRowById,
  resolveOnlyReachableClanRule
} = require('./helpers/rules');

/** Every troupe and character this file creates is named with this prefix. */
const FIXTURE_PREFIX = 'E2E T13 ';

let nameCounter = 0;
/** Unique, obviously-test-scoped content name, so nothing this suite adds collides with real data. */
function uniqueTestName(prefix) {
  nameCounter += 1;
  return `E2E T13 ${prefix} ${Date.now().toString(36)}${nameCounter}`;
}

// -----------------------------------------------------------------------
// Local helpers - none of this is shared with other suites, so nothing here
// requires re-running other spec files (per the assignment's instruction
// that only a *shared* helper change carries that obligation).
// -----------------------------------------------------------------------

/**
 * Register a console listener that captures Parse.Error-shaped objects
 * logged via `console.log(e)` - the only place a rejected save's reason ever
 * surfaces in this app's admin bulk-editor and rules-editor views, both of
 * which swallow individual save failures with `.fail(function (e) {
 * console.log(e); })` and show nothing in the DOM. Verbatim copy of the
 * helper `admin-rules.spec.js` already proved correct for tests 36/37.
 */
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
        // Not a plain serializable object (e.g. a DOM node) - ignore.
      }
    }
  };
  page.on('console', onConsole);
  return {
    errors: found,
    stop: () => page.off('console', onConsole)
  };
}

/**
 * Assertion-side read-back of whether a session can see a character at all.
 * Mirrors `approvals.spec.js`'s `tryFetchCharacter`: the probe every "cannot
 * open another player's X" test in this file relies on to prove the refusal
 * is the real ACL rule firing, not an incidental navigation failure.
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

/** The character ids currently listed on a user's own `#characters?all`. */
async function readOwnCharacterIds(page) {
  await navigateToHash(page, 'characters?all', '#characters-all');
  return page.evaluate(() => Array.from(document.querySelectorAll('#characters-all a.character-list-item'))
    .map((a) => a.getAttribute('backendId')));
}

/** Whether `userId` currently belongs to the named global `Parse.Role`. Assertion-side read-back. */
async function isUserInRole(page, roleName, userId) {
  return page.evaluate(async ({ roleName, userId }) => {
    const q = new window.Parse.Query(window.Parse.Role);
    q.equalTo('name', roleName);
    const role = await q.first();
    if (!role) return false;
    const uq = role.getUsers().query();
    uq.equalTo('objectId', userId);
    const found = await uq.first();
    return !!found;
  }, { roleName, userId });
}

/** Remove `userId` from the named global `Parse.Role`, if present. Fixture-teardown / defensive-cleanup use only. */
async function removeUserFromRole(page, roleName, userId) {
  return page.evaluate(async ({ roleName, userId }) => {
    const q = new window.Parse.Query(window.Parse.Role);
    q.equalTo('name', roleName);
    const role = await q.first();
    if (!role) return false;
    role.getUsers().remove(window.Parse.User.createWithoutData(userId));
    await role.save();
    return true;
  }, { roleName, userId });
}

/**
 * Set a troupe staff member to "Not on Staff", driving the real UI.
 *
 * Not `addStaff(page, troupeId, username, 'None')`: that helper's own
 * success-polling looks for a staff-list row beginning "None:", and
 * `Troupe.get_staff()` (models/Troupe.js) builds the roster by enumerating
 * the three per-troupe roles' *members* - a user holding none of them never
 * appears in that list at all, so the row `addStaff` polls for can never
 * exist and it would time out. This drives the identical
 * pick-user -> choose-role -> submit flow and instead confirms success by the
 * user's absence from the roster.
 */
async function removeStaffRole(page, troupeId, username, { timeout = 20000 } = {}) {
  await navigateToHash(page, `troupe/${troupeId}/staff/add`, '#troupe-add-staff');
  const entry = page.locator('#troupe-add-staff ul li a').filter({ hasText: new RegExp(`\\b${username}\\b`) }).first();
  await entry.waitFor({ state: 'attached', timeout });
  await entry.click();
  await waitForActivePage(page, 'troupe-edit-staff', timeout);
  await selectBackformOption(page, '#troupe-edit-staff-form select[name="role"]', 'Not on Staff');
  await page.locator('#troupe-edit-staff-form button[type="submit"], #troupe-edit-staff-form button').first().click();
  await page.waitForFunction((h) => window.location.hash === h, `#troupe/${troupeId}`, { timeout }).catch(() => {});
  await waitForJqmLoader(page, timeout);

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const role = await readStaffRole(page, troupeId, username);
    if (role === null) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`"${username}" still appears on troupe ${troupeId}'s staff list after being set to "Not on Staff"`);
}

test.describe.configure({ mode: 'serial' });

test.describe('Task 13 - Access Control In The UI', () => {
  /** @type {import('@playwright/test').Page} */
  let adminPage;
  /** @type {import('@playwright/test').Page} */
  let memberPage;
  /** @type {import('@playwright/test').Page} */
  let astPage;
  /** @type {import('@playwright/test').Page} */
  let loggedOutPage;
  const contexts = [];

  const state = { createdDescriptionIds: [] };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300000);

    for (const [name, login] of [
      ['admin', loginAsAdmin],
      ['member', loginAsMember],
      ['ast', loginAsAST]
    ]) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await login(page);
      if (name === 'admin') adminPage = page;
      if (name === 'member') memberPage = page;
      if (name === 'ast') astPage = page;
    }

    // Never logged in - this is the whole point of it, for item 390.
    const loggedOutContext = await browser.newContext();
    contexts.push(loggedOutContext);
    loggedOutPage = await loggedOutContext.newPage();
    await loggedOutPage.goto('/');
    await waitForAppReady(loggedOutPage);

    // Self-heal first, so the baseline measured immediately afterwards is trustworthy on a repeat run.
    const sweptChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX);
    const sweptTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX);
    console.log('[e2e access-control] self-heal swept characters:', JSON.stringify(sweptChars));
    console.log('[e2e access-control] self-heal swept troupes:', JSON.stringify(sweptTroupes));

    state.baseline = {
      allUsers: (await adminPage.evaluate(() => new window.Parse.Query(window.Parse.User).count())),
      allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()),
      allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()),
      fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX),
      fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX)
    };
    console.log('[e2e access-control] baseline counts:', JSON.stringify(state.baseline));

    const resolveUserId = async (username) => adminPage.evaluate(async (u) => {
      const q = new window.Parse.Query(window.Parse.User);
      q.equalTo('username', u);
      const found = await q.first();
      if (!found) throw new Error(`seeded user "${u}" not found`);
      return found.id;
    }, username);
    state.sampmemId = await resolveUserId('sampmem');
    state.sampastId = await resolveUserId('sampast');

    // Baseline: confirm sampmem starts this suite as a genuine plain member.
    // Every test from here on depends on this being true at the start.
    expect(await isUserInRole(adminPage, 'Administrator', state.sampmemId), 'sampmem starts as a non-admin').toBe(false);
    expect(await isUserInRole(adminPage, 'SiteAdministrator', state.sampmemId), 'sampmem starts as a non-admin').toBe(false);

    // Fixture for 392/393: a lightweight character owned by sampast - "another
    // player" who shares no troupe with sampmem. No wizard completion needed;
    // the point is that sampmem cannot see whether it even exists.
    state.strangerCharacter = await createCharacter(astPage, 'Vampire', uniqueName(`${FIXTURE_PREFIX}Stranger`));

    // Fixture for 384/384b: a Patronage record for sampast, built with the
    // exact ACL PatronageView.js's submit handler sets on every record it
    // saves (the only way a Patronage row is ever created in this app) - so
    // this fixture is faithful to what a real admin action produces, not a
    // synthetic shortcut. Direct Parse call in beforeAll is fixture setup,
    // permitted by this suite's own conventions; creating a Patronage through
    // the UI is Task 1's job, not this file's.
    state.patronageFixtureId = await adminPage.evaluate(async (ownerId) => {
      const Patronage = window.Parse.Object.extend('Patronage');
      const p = new Patronage();
      const acl = new window.Parse.ACL();
      acl.setPublicReadAccess(true);
      acl.setPublicWriteAccess(false);
      acl.setRoleReadAccess('Administrator', true);
      acl.setRoleWriteAccess('Administrator', true);
      p.setACL(acl);
      p.set({
        owner: window.Parse.User.createWithoutData(ownerId),
        paidOn: new Date(Date.now() - 30 * 86400000),
        expiresOn: new Date(Date.now() + 300 * 86400000)
      });
      await p.save();
      return p.id;
    }, state.sampastId);

    // Fixture for 383: an existing seeded Kith Rule row to probe. Not created
    // fresh - EditRules.js's create path is unconditionally broken (Task 2) -
    // an existing row is what a real edit attempt would target anyway.
    state.kithTarget = await adminPage.evaluate(() => {
      return new window.Parse.Query('bnsctdbs_KithRule').first().then((r) => (r ? Object.assign({ id: r.id }, r.attributes) : null));
    });
    expect(state.kithTarget, 'a seeded Kith Rule exists to probe').not.toBeNull();

    console.log('[e2e access-control] fixture:', JSON.stringify({
      sampmemId: state.sampmemId,
      sampastId: state.sampastId,
      strangerCharacter: state.strangerCharacter.id,
      patronageFixtureId: state.patronageFixtureId,
      kithTarget: state.kithTarget.id
    }));
  });

  test.afterAll(async () => {
    if (adminPage) {
      // Defensive: if test 387 failed after promoting sampmem but before
      // demoting them, do not leave a real Administrator account behind for
      // every later suite (and every later test in *this* file, had ordering
      // differed) to trip over.
      const stillAdmin = await isUserInRole(adminPage, 'Administrator', state.sampmemId).catch(() => false);
      if (stillAdmin) {
        console.warn('[e2e access-control] sampmem was still Administrator at teardown - removing');
        await removeUserFromRole(adminPage, 'Administrator', state.sampmemId).catch(() => {});
      }

      if (state.patronageFixtureId) {
        await adminPage.evaluate(async (id) => {
          const obj = new window.Parse.Object('Patronage');
          obj.id = id;
          await obj.destroy();
        }, state.patronageFixtureId).catch((e) => console.warn('[e2e access-control] could not destroy patronage fixture:', e.message));
      }

      const descResult = await destroyDescriptions(adminPage, state.createdDescriptionIds).catch((e) => ({ destroyed: 0, failed: [String(e)] }));
      console.log('[e2e access-control] destroyed Description fixtures:', JSON.stringify(descResult));

      const destroyedChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX).catch((e) => ({ characters: 0, children: 0, errors: [String(e)] }));
      const destroyedTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX).catch((e) => ({ troupes: 0, roles: 0, errors: [String(e)] }));
      console.log('[e2e access-control] destroyed characters:', JSON.stringify(destroyedChars));
      console.log('[e2e access-control] destroyed troupes:', JSON.stringify(destroyedTroupes));

      const final = {
        allUsers: await adminPage.evaluate(() => new window.Parse.Query(window.Parse.User).count()).catch(() => -1),
        allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
        allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()).catch(() => -1),
        fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1),
        fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1)
      };
      console.log(
        '[e2e access-control] final counts (should equal baseline ' + JSON.stringify(state.baseline) + '):',
        JSON.stringify(final)
      );
    }

    for (const context of contexts) {
      await context.close().catch(() => {});
    }
  });

  // -------------------------------------------------------------------------
  // 381 - the administration landing page itself
  // -------------------------------------------------------------------------

  test.fail('381 sampmem is blocked from #administration', async () => {
    // DEFECT: no such block exists. mobileRouter.js's `administration` handler
    // is `enforce_logged_in().then(function () { ...; $.mobile.changePage
    // ("#administration", ...); })` - no `is_ad` check, unlike its own sibling
    // routes one click away (`administration_users`, `administration_user`,
    // `administration_patronages`, `administration_patronages_csv` all guard
    // on `Parse.User.current().get("admininterface")`). The `#administration`
    // template (public/index.html) is a bare `<ul>` of links with no
    // conditional either.
    //
    // This asserts what item 381's own claim requires - that the route
    // genuinely does not become active for sampmem - which is what actually
    // fails and is why `test.fail()` is correct here. The stronger, positive
    // proof of the defect (sampmem sees the *identical* link set an admin
    // does, not merely "a page rendered") is captured via console.log first
    // so it reaches the report even though the assertion below throws before
    // a second `expect` could run.
    await navigateToHash(memberPage, 'characters?all', '#characters-all');
    const before = await activePageId(memberPage);

    await memberPage.evaluate((h) => { window.location.hash = '#' + h; }, 'administration');
    await memberPage.waitForTimeout(2000);
    const after = await activePageId(memberPage);

    const memberLinks = after === 'administration'
      ? await memberPage.locator('#administration a').evaluateAll((els) => els.map((e) => e.getAttribute('href')).sort())
      : [];
    await navigateToHash(adminPage, 'administration', '#administration');
    const adminLinks = await adminPage.locator('#administration a').evaluateAll((els) => els.map((e) => e.getAttribute('href')).sort());

    console.log('[e2e access-control] 381 evidence: parked on', before, '-> after attempt:', after);
    console.log('[e2e access-control] 381 evidence: sampmem sees links', JSON.stringify(memberLinks));
    console.log('[e2e access-control] 381 evidence: devuser sees links', JSON.stringify(adminLinks));
    console.log('[e2e access-control] 381 evidence: identical menu offered to both?', JSON.stringify(memberLinks) === JSON.stringify(adminLinks));

    expect(after, 'sampmem should be blocked from #administration, the way every sibling admin route blocks a non-admin').not.toBe('administration');
  });

  // -------------------------------------------------------------------------
  // 382 - global Clan Rules
  // -------------------------------------------------------------------------

  test('382 sampmem cannot save an edit to global Clan Rules', async () => {
    // Reality check first: the route itself renders for sampmem (no `is_ad`
    // gate - Task 2 found this too). The real protection is server-side:
    // bnsmetv1_ClanRule's class-level permissions restrict update/create to
    // role:Administrator (database_seed/_SCHEMA.json). The rejection is
    // surfaced only to the console - EditRules.js's DataForm swallows every
    // individual save failure with console.log and shows nothing in the DOM -
    // so a test that only checks page appearance would be fooled.
    const capture = captureParseErrors(memberPage);
    try {
      await openRuleEditor(memberPage, 'clan');
      expect(await activePageId(memberPage)).toBe('administration-descriptions');

      const target = await resolveOnlyReachableClanRule(memberPage);
      expect(target, 'a Clan Rule row exists to probe').not.toBeNull();

      await submitRuleRow(memberPage, 'clan', { clan: target.clan, weakness_1: 'SAMPMEM SHOULD NOT PERSIST' });

      const denied = capture.errors.find((e) => e.code === 119 && /permission denied/i.test(e.message));
      console.log('[e2e access-control] 382 refusal:', JSON.stringify(denied));
      expect(denied, 'the server refuses the update with a named permission error').toBeTruthy();
      expect(denied.message).toContain('bnsmetv1_ClanRule');

      const stillOriginal = await getRuleRowById(adminPage, 'clan', target.id);
      expect(stillOriginal.weakness_1, 'the row is unchanged server-side').toBe(target.weakness_1);
    } finally {
      capture.stop();
    }
  });

  // -------------------------------------------------------------------------
  // 383 - global Kith Rules
  // -------------------------------------------------------------------------

  test('383 sampmem cannot save an edit to global Kith Rules', async () => {
    // Same mechanism as 382, a different rule class: bnsctdbs_KithRule's
    // class-level permissions also restrict update/create/delete to
    // role:Administrator. Unlike ClanRule, KithRule genuinely has `name` and
    // `category` fields, so the target row is addressed by them rather than
    // by the "only reachable row" workaround Task 2 needed for Clan.
    const capture = captureParseErrors(memberPage);
    try {
      await openRuleEditor(memberPage, 'kith');
      expect(await activePageId(memberPage)).toBe('administration-descriptions');

      await submitRuleRow(memberPage, 'kith', {
        name: state.kithTarget.name,
        category: state.kithTarget.category,
        realm: 'SAMPMEM SHOULD NOT PERSIST'
      });

      const denied = capture.errors.find((e) => e.code === 119 && /permission denied/i.test(e.message));
      console.log('[e2e access-control] 383 refusal:', JSON.stringify(denied));
      expect(denied, 'the server refuses the update with a named permission error').toBeTruthy();
      expect(denied.message).toContain('bnsctdbs_KithRule');

      const stillOriginal = await getRuleRowById(adminPage, 'kith', state.kithTarget.id);
      expect(stillOriginal.realm, 'the row is unchanged server-side').toBe(state.kithTarget.realm);
    } finally {
      capture.stop();
    }
  });

  // -------------------------------------------------------------------------
  // 384 - another user's patronage page, and the data hole behind it
  // -------------------------------------------------------------------------

  test('384 sampmem cannot view another user\'s patronage page', async () => {
    // administration_user_patronages gates on `admininterface` before doing
    // anything else: `if (is_ad) { ...; $.mobile.changePage(...); }` with no
    // else branch - for sampmem the whole body is skipped and the page simply
    // never transitions. Identical mechanism to Task 1 test 14 (which proved
    // this for sampast viewing sampmem's patronage); this proves it for
    // sampmem viewing sampast's. Deliberately not using navigateToHash's
    // targetSelector wait, which would retry and eventually reload trying to
    // reach a page that is never going to become active.
    await navigateToHash(memberPage, 'characters?all', '#characters-all');
    const before = await activePageId(memberPage);
    expect(before).toBe('characters-all');

    await memberPage.evaluate((h) => { window.location.hash = '#' + h; }, `administration/patronages/user/${state.sampastId}`);
    await memberPage.waitForTimeout(2500);

    const after = await activePageId(memberPage);
    expect(after, 'the route never transitions away from where sampmem was').toBe('characters-all');
    expect(after).not.toBe('administration-user-patronages-view');

    const bodyText = await memberPage.evaluate(() => document.body.textContent);
    expect(bodyText, 'no trace of the target record renders anywhere on screen').not.toContain(state.patronageFixtureId);
  });

  test('384b Patronage records are world-readable by design, so any user can verify a paid Patron', async () => {
    // INTENDED BEHAVIOUR, not a defect. Patronage visibility is deliberately
    // public: anyone must be able to confirm that a character is associated
    // with a paid Patron, which is only possible if the records themselves are
    // readable. Both layers implement that on purpose - Patronage's
    // class-level permissions grant find/get to "*"
    // (database_seed/_SCHEMA.json), and PatronageView.js's submit handler sets
    // acl.setPublicReadAccess(true) on every record it saves, which is the
    // only way a Patronage row is ever created in this app.
    //
    // This test previously asserted the opposite and was pinned red as a data
    // exposure. That reading was wrong, and inverting it matters: a test
    // demanding that patronages be private would, if anyone "fixed" it, break
    // the verification the feature exists to provide. It is kept as a positive
    // test so that privacy added here in future fails loudly instead of
    // silently removing a guarantee.
    //
    // Note the deliberate asymmetry with test 384: the admin *page* at
    // #administration/patronages/user/:id stays gated, because administering
    // patronages is not the same act as verifying one. Both halves are
    // asserted - 384 that the page is blocked, this that the data is not.
    const direct = await memberPage.evaluate(async (id) => {
      try {
        const obj = await new window.Parse.Query('Patronage').get(id);
        return { ok: true, id: obj.id, ownerId: obj.get('owner') ? obj.get('owner').id : null };
      } catch (e) {
        return { ok: false, code: e && e.code, message: e && e.message };
      }
    }, state.patronageFixtureId);
    console.log('[e2e access-control] 384b direct Patronage read as sampmem:', JSON.stringify(direct));

    const found = await memberPage.evaluate(async (ownerId) => {
      const q = new window.Parse.Query('Patronage');
      q.equalTo('owner', window.Parse.User.createWithoutData(ownerId));
      const rows = await q.find();
      return rows.map((r) => r.id);
    }, state.sampastId);
    console.log('[e2e access-control] 384b unfiltered find() for sampast\'s records as sampmem:', JSON.stringify(found));

    expect(direct.ok, 'any user must be able to read a Patronage record by id, to verify a paid Patron').toBe(true);
    expect(direct.ownerId, 'and the record must identify whose patronage it is').toBe(state.sampastId);
    expect(found, 'and must be able to find a user\'s patronages by owner').toContain(state.patronageFixtureId);
  });

  // -------------------------------------------------------------------------
  // 385 - the admin's per-user view
  // -------------------------------------------------------------------------

  test('385 sampmem cannot open #administration/user/:id', async () => {
    // administration_user has the same `if (is_ad) {...}`-with-no-else gate
    // as administration_user_patronages (test 384): the page never
    // transitions for a non-admin. Proven for sampmem's own id, so this is
    // not merely "cannot view someone else's" but "cannot reach this view at
    // all", and that neither the Administrator checkbox nor the
    // Reset-Password control ever reaches the DOM.
    await navigateToHash(memberPage, 'characters?all', '#characters-all');
    expect(await activePageId(memberPage)).toBe('characters-all');

    await memberPage.evaluate((h) => { window.location.hash = '#' + h; }, `administration/user/${state.sampmemId}`);
    await memberPage.waitForTimeout(2500);

    const after = await activePageId(memberPage);
    expect(after, 'the route never transitions').toBe('characters-all');
    expect(after).not.toBe('administration-user-view');

    const hasAdminCheckbox = await memberPage.evaluate(() => !!document.querySelector('#administration-user-view input[name="admininterface"]'));
    const hasResetButton = await memberPage.evaluate(() => !!document.querySelector('#reset-password-view button'));
    expect(hasAdminCheckbox, 'the Administrator toggle never rendered').toBe(false);
    expect(hasResetButton, 'the Reset Password control never rendered').toBe(false);
  });

  // -------------------------------------------------------------------------
  // 386 - the self-service profile view carries no privilege toggle
  // -------------------------------------------------------------------------

  test('386 Role toggles are absent from the profile view for non-admins', async () => {
    // #profile (UserSettingsProfileView) is a different view from
    // #administration/user/:id (AdministrationUserView) - both are built on
    // the same base UserForm, but only the admin's view of *another* user
    // appends the "Administrator" checkbox field; UserSettingsProfileView.js
    // never does. Proven by real DOM enumeration: every input the page
    // actually renders, not merely the absence of one name we guessed.
    await navigateToHash(memberPage, 'profile', '#user-settings-profile');
    expect(await activePageId(memberPage)).toBe('user-settings-profile');

    const inputs = await memberPage.locator('#user-settings-profile input').evaluateAll((els) => els.map((e) => ({ name: e.name, type: e.type })));
    const names = inputs.map((i) => i.name);
    expect(names, 'no admininterface control anywhere on the page').not.toContain('admininterface');
    expect(names, 'no storytellerinterface control anywhere on the page').not.toContain('storytellerinterface');

    const bodyText = await memberPage.evaluate(() => document.querySelector('#user-settings-profile').textContent);
    expect(bodyText, 'the word "Administrator" never appears on sampmem\'s own profile').not.toContain('Administrator');

    // Prove the page genuinely rendered real content (not merely an empty
    // page that trivially lacks everything), and that the absence above is
    // specific to the role toggle, not a broken render.
    expect(names, 'the ordinary profile fields are present').toEqual(expect.arrayContaining(['realname', 'email', 'username']));

    // Cross-check with an actual admin's own #profile: the control is absent
    // from this *view* for everyone, not merely hidden by permission for
    // sampmem specifically - it structurally does not exist here at all.
    await navigateToHash(adminPage, 'profile', '#user-settings-profile');
    const adminNames = await adminPage.locator('#user-settings-profile input').evaluateAll((els) => els.map((e) => e.name));
    expect(adminNames, 'not even devuser\'s own profile carries the toggle').not.toContain('admininterface');
  });

  // -------------------------------------------------------------------------
  // 387 - admin toggles the Administrator role
  // -------------------------------------------------------------------------

  test('387 Admin can toggle a user\'s Administrator role and the change persists across reload', async () => {
    const ADMIN_CHECKBOX = '#administration-user-view input[name="admininterface"]';
    // jQuery Mobile's checkboxradio enhancement leaves the real `<input>` in
    // the DOM (assertions read its `.checked` directly) but visually
    // replaces it with a styled `<label class="ui-btn ui-checkbox-...">`
    // sitting on top of it - confirmed live: clicking the raw input throws
    // "label ... intercepts pointer events" every time. The label is what a
    // real user actually clicks, and jQuery Mobile wires its click to toggle
    // the real input and fire `change` (confirmed live: the input's
    // `.checked` flips and Backform's own `change input` listener picks it
    // up), so that is what this test drives instead.
    const ADMIN_LABEL = adminPage.locator('#administration-user-view label.ui-btn', { hasText: 'Administrator' });
    const SUBMIT = '#administration-user-view button[name="submit"]';
    const STATUS = '#administration-user-view .status';

    await navigateToHash(adminPage, `administration/user/${state.sampmemId}`, '#administration-user-view');
    // register() re-derives the checkbox's initial state from real
    // Administrator/SiteAdministrator role membership on every fresh
    // registration (not from the User row's own stored field) - this is
    // already a value assertion, not merely visibility.
    await expect(adminPage.locator(ADMIN_CHECKBOX)).not.toBeChecked();

    await ADMIN_LABEL.click();
    await expect(adminPage.locator(ADMIN_CHECKBOX)).toBeChecked();
    await adminPage.locator(SUBMIT).click();

    const status1 = adminPage.locator(STATUS);
    await expect(status1).toHaveText('Made them an admin!');
    await expect(status1).toHaveClass(/text-success/);

    // Ground truth is Role membership, not the checkbox: the submit handler
    // never saves `admininterface` on the User row itself, only the Role's
    // `users` relation (AdministrationUserView.js).
    expect(await isUserInRole(adminPage, 'Administrator', state.sampmemId), 'sampmem is now a real Administrator role member').toBe(true);

    // Persists across reload: AdministrationUserView is memoized per router
    // instance, so only a full reload forces a genuinely fresh register().
    await hardReload(adminPage);
    await navigateToHash(adminPage, `administration/user/${state.sampmemId}`, '#administration-user-view');
    await expect(adminPage.locator(ADMIN_CHECKBOX)).toBeChecked();

    // Revert, so every test after this one still finds sampmem a plain member.
    await ADMIN_LABEL.click();
    await expect(adminPage.locator(ADMIN_CHECKBOX)).not.toBeChecked();
    await adminPage.locator(SUBMIT).click();

    const status2 = adminPage.locator(STATUS);
    await expect(status2).toHaveText('Removed their admin privileges!');
    expect(await isUserInRole(adminPage, 'Administrator', state.sampmemId), 'the role membership is genuinely gone').toBe(false);

    await hardReload(adminPage);
    await navigateToHash(adminPage, `administration/user/${state.sampmemId}`, '#administration-user-view');
    await expect(adminPage.locator(ADMIN_CHECKBOX)).not.toBeChecked();
  });

  // -------------------------------------------------------------------------
  // 388 - admin toggles the Storyteller (per-troupe) role
  // -------------------------------------------------------------------------

  test('388 Admin can toggle a user\'s Storyteller role and the change persists across reload', async () => {
    // "Storyteller" has no global toggle anywhere - see the file header.
    // The real grant mechanism is per-troupe: #troupe/:id/staff/edit/:uid.
    // A fresh fixture troupe keeps this independent of sampast's pre-existing
    // legacy AST role on the seeded "Sample Troupe".
    const troupe = await createTroupe(adminPage, uniqueTroupeName(FIXTURE_PREFIX));

    expect(await readStaffRole(adminPage, troupe.id, 'sampmem'), 'sampmem starts with no role on the fixture troupe').toBeNull();
    expect(await isUserInRole(adminPage, `AST_${troupe.id}`, state.sampmemId)).toBe(false);

    const granted = await addStaff(adminPage, troupe.id, 'sampmem', 'AST');
    expect(granted.role).toBe('AST');
    expect(await readStaffRole(adminPage, troupe.id, 'sampmem')).toBe('AST');
    expect(await isUserInRole(adminPage, `AST_${troupe.id}`, state.sampmemId), 'sampmem is a real AST_<troupeId> role member').toBe(true);

    // Persists across reload.
    await hardReload(adminPage);
    expect(await readStaffRole(adminPage, troupe.id, 'sampmem'), 'the role survives a reload').toBe('AST');
    expect(await isUserInRole(adminPage, `AST_${troupe.id}`, state.sampmemId)).toBe(true);

    // Revert (see file header for why this is not addStaff(..., 'None')).
    await removeStaffRole(adminPage, troupe.id, 'sampmem');
    expect(await readStaffRole(adminPage, troupe.id, 'sampmem'), 'the role is genuinely gone').toBeNull();
    expect(await isUserInRole(adminPage, `AST_${troupe.id}`, state.sampmemId)).toBe(false);

    await hardReload(adminPage);
    expect(await readStaffRole(adminPage, troupe.id, 'sampmem'), 'the removal survives a reload too').toBeNull();
  });

  // -------------------------------------------------------------------------
  // 389 - password reset (unsatisfiable in this deployment - see file header)
  // -------------------------------------------------------------------------

  test.fail('389 Admin can trigger a password reset for a user and sees confirmation', async () => {
    // DEFECT (environment configuration, not access control): index.js's
    // ParseServer settings configure no `emailAdapter`. Measured live:
    // Parse.User.requestPasswordReset always rejects with code 1, "An
    // appName, publicServerURL, and emailAdapter are required for password
    // reset and email verification functionality." The button itself is
    // wired correctly - ResetButtonView.js calls the real API and renders
    // whichever outcome comes back into `.message` - and access to it is
    // correctly admin-gated (test 385 proves sampmem cannot even reach this
    // page); it is the underlying feature that cannot produce item 389's
    // literal "confirmation" against this server configuration. Driven for
    // real, not skipped, so the actual message is captured and reported.
    await navigateToHash(adminPage, `administration/user/${state.sampmemId}`, '#administration-user-view');

    const button = adminPage.locator('#reset-password-view button');
    await expect(button).toHaveText('Reset Password');
    const message = adminPage.locator('#reset-password-view .message');

    await button.click();
    await expect(message).not.toHaveText('', { timeout: 15000 });

    const text = await message.textContent();
    console.log('[e2e access-control] 389 password reset result:', JSON.stringify(text));

    expect(text, 'the admin sees a password-reset confirmation').toBe('Password Reset Email Sent');
  });

  // -------------------------------------------------------------------------
  // 390 - logged-out sweep over a real route table
  // -------------------------------------------------------------------------

  /**
   * Every route here is confirmed, by reading mobileRouter.js's handler body,
   * to call `enforce_logged_in()` itself or through `get_character()` /
   * `show_character_helper()` (which both wrap it) - i.e. genuinely gated,
   * not merely assumed to be.
   *
   * `characternew` was the one exception when this list was first compiled:
   * alone among the character/troupe/admin routes it rendered `#character-new`
   * unconditionally, for a fully anonymous visitor. It was reported rather
   * than worked around, and has since been given the same
   * `enforce_logged_in()` call every sibling route makes, so it now belongs in
   * this sweep like any other gated route. The anonymous-writable `Vampire`
   * create permission found behind it is a data-level hole a page-transition
   * assertion cannot speak to at all, so it gets its own server-side probe in
   * 390b - the same "companion test" shape 384b uses.
   *
   * Spans every route family: the bare home route, profile, the character
   * list and sheet, two character sub-routes with the missing-`.fail()`
   * defect from the file header, both creation entry points, both troupe
   * routes, five distinct `#administration/*` destinations, and referendums.
   */
  const PROTECTED_ROUTES = [
    { hash: '', label: 'home' },
    { hash: 'profile', label: 'profile' },
    { hash: 'characters?all', label: 'own character list' },
    { hash: 'character?bogus000000', label: 'character sheet' },
    { hash: 'character/bogus000000/log/0/10', label: 'character log' },
    { hash: 'character/bogus000000/experience/0/10', label: 'character experience' },
    { hash: 'characternew', label: 'new character form' },
    { hash: 'charactercreate/bogus000000', label: 'character creation wizard' },
    { hash: 'troupes', label: 'troupe directory' },
    { hash: 'troupe/new', label: 'new troupe form' },
    { hash: 'administration', label: 'administration landing' },
    { hash: 'administration/users/all', label: 'administration users list' },
    { hash: 'administration/patronages', label: 'administration patronages list' },
    { hash: 'administration/descriptions', label: 'administration descriptions admin' },
    { hash: 'administration/bnsmetv1_clan_rules', label: 'administration clan rules' },
    { hash: 'referendums', label: 'referendums list' }
  ];

  for (const route of PROTECTED_ROUTES) {
    test(`390 A logged-out visitor is redirected to login for #${route.hash} (${route.label})`, async () => {
      const stillAnonymousBefore = await loggedOutPage.evaluate(() => !window.Parse.User.current());
      expect(stillAnonymousBefore, 'this probe genuinely starts with no session').toBe(true);

      // enforce_logged_in() calls $.mobile.changePage("#login", { changeHash:
      // false }) - the hash is deliberately left at the attempted route, so
      // the active page (not the hash) is the real signal here.
      await navigateToHash(loggedOutPage, route.hash);
      await waitForActivePage(loggedOutPage, 'login');

      expect(await activePageId(loggedOutPage)).toBe('login');
      await expect(loggedOutPage.locator('#login-username')).toBeAttached();
      await expect(loggedOutPage.locator('#login-password')).toBeAttached();

      const stillAnonymousAfter = await loggedOutPage.evaluate(() => !window.Parse.User.current());
      expect(stillAnonymousAfter, 'no session was established by the attempt').toBe(true);
    });
  }

  test('390b A logged-out visitor cannot write a character straight into the Vampire class', async () => {
    // The route gate above is only half of the protection, and the weaker
    // half: #characternew is a thin wrapper over Vampire.create, and
    // Vampire's class-level permissions granted create to "*", so a visitor
    // who never loads that page at all could POST a row into the character
    // table directly. Measured live before the fix, from a context with no
    // Parse session: the save returned a real object id.
    //
    // Werewolf and ChangelingBetaSlice are both Parse.Object.extend("Vampire",
    // ...) over this same underlying class, so one probe covers all three
    // creature types.
    //
    // A server-side probe rather than a UI assertion, for exactly the reason
    // 384b is one: a page that refuses to render proves nothing about what the
    // server will accept. The refusal is then confirmed the second way this
    // file accepts - a before/after read-back proving the table did not grow.
    const stillAnonymous = await loggedOutPage.evaluate(() => !window.Parse.User.current());
    expect(stillAnonymous, 'this probe genuinely has no session').toBe(true);

    const before = await adminPage.evaluate(() => new window.Parse.Query('Vampire').count());

    const attempt = await loggedOutPage.evaluate(async () => {
      try {
        const Vampire = window.Parse.Object.extend('Vampire');
        const v = new Vampire();
        await v.save({ name: 'E2E T13 anonymous create probe' });
        return { ok: true, id: v.id };
      } catch (e) {
        return { ok: false, code: e && e.code, message: e && e.message };
      }
    });
    console.log('[e2e access-control] 390b anonymous Vampire create:', JSON.stringify(attempt));

    expect(attempt.ok, 'the server refuses to create a character for a request with no user attached').toBe(false);

    const after = await adminPage.evaluate(() => new window.Parse.Query('Vampire').count());
    console.log('[e2e access-control] 390b Vampire row count before/after:', JSON.stringify({ before, after }));
    expect(after, 'no row reached the character table').toBe(before);

    // Belt and braces: if the refusal ever regresses to a client-side-only
    // error while the write still lands, the id lookup catches it even though
    // the count above would not distinguish it from a concurrent delete.
    if (attempt.id) {
      const orphan = await adminPage.evaluate(async (id) => {
        try {
          const found = await new window.Parse.Query('Vampire').get(id);
          return { exists: true, name: found.get('name') };
        } catch (e) {
          return { exists: false, code: e && e.code };
        }
      }, attempt.id);
      expect(orphan.exists, 'no orphaned character row was left behind').toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // 391 - global Descriptions
  // -------------------------------------------------------------------------

  test('391 sampmem cannot delete or overwrite a global Description', async () => {
    // A different protection mechanism from 382/383, and worth telling
    // apart: Description's class-level permissions are wide open
    // (create/update/delete: "*"), unlike the rule classes. What actually
    // protects an individual row is its own object ACL, set by
    // DescriptionsView.js's submit handler to public-read /
    // Administrator-write. Both halves of item 391 - overwrite and delete -
    // are proven, and both are refused the same way: Parse code 101, "Object
    // not found", because Parse Server hides an ACL-denied object's
    // existence rather than naming the permission (different from 382/383's
    // 119, on purpose - see the file header).
    const fixture = await createDescriptionViaAdmin(adminPage, {
      category: 'e2e_t13_probe_category',
      name: uniqueTestName('DescProbe'),
      value: 'original value'
    });
    state.createdDescriptionIds.push(fixture.id);
    expect(fixture.value).toBe('original value');

    // Overwrite attempt, driven through the real admin bulk-editor UI - the
    // same one Task 2's test 37 already proved this mechanism against for a
    // different fixture.
    const capture = captureParseErrors(memberPage);
    try {
      await updateDescriptionViaAdmin(memberPage, {
        category: fixture.category,
        name: fixture.name,
        value: 'sampmem tampered value'
      });
      const denied = capture.errors.find((e) => e.code === 101);
      console.log('[e2e access-control] 391 overwrite refusal:', JSON.stringify(denied));
      expect(denied, 'the overwrite is refused with Object not found').toBeTruthy();
    } finally {
      capture.stop();
    }

    const afterOverwrite = await getDescriptionByName(adminPage, fixture.category, fixture.name);
    expect(afterOverwrite.value, 'the value is unchanged after the overwrite attempt').toBe('original value');

    // Delete attempt: there is no delete affordance anywhere in this app for
    // Descriptions (DescriptionsView.js's DataForm has only [button,
    // textarea] fields, the same "no delete UI" shape Task 1 and Task 2 found
    // for Patronage and the rule classes), so this is a direct server-side
    // probe - the only way to exercise "delete" at all, and it hands the
    // server a request for a row this suite knows is real.
    const deleteProbe = await memberPage.evaluate(async (id) => {
      try {
        const obj = new window.Parse.Object('Description');
        obj.id = id;
        await obj.destroy();
        return { ok: true };
      } catch (e) {
        return { ok: false, code: e && e.code, message: e && e.message };
      }
    }, fixture.id);
    console.log('[e2e access-control] 391 delete refusal:', JSON.stringify(deleteProbe));
    expect(deleteProbe.ok, 'the delete is refused server-side').toBe(false);
    expect(deleteProbe.code).toBe(101);

    const stillThere = await getDescriptionByName(adminPage, fixture.category, fixture.name);
    expect(stillThere, 'the row still exists after the delete attempt').not.toBeNull();
    expect(stillThere.value).toBe('original value');
  });

  // -------------------------------------------------------------------------
  // 392 - another player's character sheet
  // -------------------------------------------------------------------------

  test('392 sampmem cannot open another player\'s character sheet', async () => {
    const cid = state.strangerCharacter.id;

    const fetched = await tryFetchCharacter(memberPage, cid);
    expect(fetched.ok, 'the character is not readable by sampmem at all').toBe(false);
    expect(fetched.code, 'Parse.Error.OBJECT_NOT_FOUND').toBe(101);

    // Park somewhere reachable first (memberPage may still be sitting on
    // #administration-descriptions from test 391), so the redirect below is a
    // real, observed transition rather than an artefact of wherever an
    // earlier test happened to leave the page.
    await navigateToHash(memberPage, 'characters?all', '#characters-all');
    expect(await activePageId(memberPage)).toBe('characters-all');

    // Unlike the log/experience routes (item 393), `character` genuinely
    // handles the denied fetch: show_character_helper's
    // .fail(PromiseFailReport).fail(function () { window.location.hash =
    // back_url; }) explicitly resets the hash to #characters?all once its own
    // async chain (enforce_logged_in -> get_user_characters -> changePage)
    // resolves. `waitForActivePage` polls for that real completion rather
    // than the hash, which flips synchronously well before the page does -
    // a bare hash-equality wait here raced the redirect and caught the page
    // still mid-transition on the very next test written.
    await navigateToHash(memberPage, `character?${cid}`);
    await waitForActivePage(memberPage, 'characters-all', 15000);
    expect(await memberPage.evaluate(() => window.location.hash), 'the hash is reset too, not just the page').toBe('#characters?all');

    const ownIds = await readOwnCharacterIds(memberPage);
    expect(ownIds, 'the other player\'s character never appears in sampmem\'s own list').not.toContain(cid);
  });

  // -------------------------------------------------------------------------
  // 393 - another player's XP history and character log
  // -------------------------------------------------------------------------

  test('393 sampmem cannot open another player\'s XP history or character log', async () => {
    const cid = state.strangerCharacter.id;

    await navigateToHash(memberPage, 'characters?all', '#characters-all');
    const parkedOn = await activePageId(memberPage);
    expect(parkedOn).toBe('characters-all');

    // DEFECT distinct from 392's clean redirect: characterlog's handler is
    // `self.get_character(cid, "all").done(function (character) {...})` with
    // no `.fail()` at all (mobileRouter.js) - a denied fetch leaves the hash
    // pointed at the attempted route, the active page never changes, and
    // `$.mobile.loading("hide")` (inside the never-run .done() callback)
    // never fires, so the loading overlay is left stuck. The character is
    // still genuinely inaccessible either way (proven below by the same
    // direct-fetch probe test 392 used) - this is "no visible error is a
    // finding, not a reason to weaken a test" in practice: the real, if
    // ungraceful, behaviour is what gets asserted.
    await navigateToHash(memberPage, `character/${cid}/log/0/10`);
    await memberPage.waitForTimeout(2500);
    expect(await activePageId(memberPage), 'the log route never transitions away from where sampmem was').toBe(parkedOn);
    expect(await memberPage.evaluate(() => window.location.hash), 'the hash is left pointed at the attempted route').toContain('/log/0/10');
    const stuckLog = await memberPage.evaluate(() => document.documentElement.classList.contains('ui-loading'));
    await clearStuckLoader(memberPage);

    await navigateToHash(memberPage, `character/${cid}/experience/0/10`);
    await memberPage.waitForTimeout(2500);
    expect(await activePageId(memberPage), 'the experience route also never transitions').toBe(parkedOn);
    expect(await memberPage.evaluate(() => window.location.hash)).toContain('/experience/0/10');
    const stuckExp = await memberPage.evaluate(() => document.documentElement.classList.contains('ui-loading'));
    await clearStuckLoader(memberPage);

    console.log('[e2e access-control] 393 stuck-loader symptom observed:', JSON.stringify({ stuckLog, stuckExp }));
    expect(stuckLog, 'the missing .fail() handler leaves the loading overlay stuck on the log route').toBe(true);
    expect(stuckExp, 'same defect on the experience route').toBe(true);

    // The rule that actually did the refusing, proven directly - the same
    // probe test 392 used, since both routes' first step is the identical
    // plain Vampire fetch (_get_character in mobileRouter.js).
    const fetched = await tryFetchCharacter(memberPage, cid);
    expect(fetched.ok, 'the underlying character fetch is refused, which is why neither view could ever have rendered').toBe(false);
    expect(fetched.code).toBe(101);
  });
});
