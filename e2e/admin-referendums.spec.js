/**
 * Task 3 - Referendums: Creation And Voting
 *
 * Covers testing_implementation_plan.md items 38-53. One continuous admin
 * session (`adminPage` = devuser) plus one page per voting persona
 * (`memberPage` = sampmem, `astPage` = sampast, `strangerPage` = sampstranger),
 * all created once in `beforeAll` and reused throughout - this is one
 * continuous "create a referendum, view it, vote in it, verify tallies, gate
 * on patron status and auth" lifecycle, not sixteen independent scenarios.
 * Test order matters: later tests depend on the referendum id and the option
 * choices earlier tests captured, and test 49 specifically depends on
 * `state.firstChoice` being set by test 44.
 *
 * Five defects were confirmed live against this server before any test below
 * was written (full detail and code citations in helpers/referendums.js's
 * file-level comment); per this suite's conventions, the tests whose numbered
 * requirement is literally that defective feature are left failing via
 * `test.fail()` with the defect named, rather than weakened to pass:
 *
 * 1. **There is no UI to create a Referendum at all** - no "Add New" link
 *    anywhere (`ReferendumsListView`'s own template has one only in the
 *    Patronage suite's sibling view, not this one), no
 *    `#administration/referendums/new`-shaped route registered in
 *    mobileRouter.js, no form markup anywhere in index.html. Tests 38, 39.
 * 2. **There is no UI to edit an existing Referendum's fields at all** - the
 *    admin detail route renders the exact same read-only `ReferendumView` the
 *    member-facing route does, with no Backform, no bulk-CSV editor, and no
 *    save control anywhere. Test 53.
 * 3. **Voting has no update path.** `vote_for_referendum` (cloud/main.js)
 *    treats any existing ballot as a hard stop -
 *    `response.error("Existing ballot found." + ...)`, unconditionally, with
 *    no branch that ever updates `choice` on the existing row - and the UI
 *    itself provides no control to even attempt a second vote, since the vote
 *    links are permanently replaced by static "you voted for X" text the
 *    moment a ballot exists. Confirmed live: a recast attempt is flatly
 *    rejected, and the original ballot is left completely unchanged (neither
 *    replaced nor appended to). Test 46.
 * 4. **There is no close-date concept for a Referendum anywhere in the
 *    application.** `database_seed/_SCHEMA.json` declares only `name`,
 *    `shortdescription`, `order`, `portrait`, `option_0..2`, `eligibility`,
 *    `description` - nothing date-shaped - and `vote_for_referendum` never
 *    reads any such field; the only date logic anywhere in that function is
 *    the voter's own `Patronage.expiresOn`. Test 52.
 * 5. **Serious: the patron-gate on voting is not actually enforced against
 *    ballot creation.** `vote_for_referendum` is a chain of jQuery-style
 *    `.then()`/`.fail()` calls where a rejection is reported by calling
 *    `response.error(msg); return;` *from inside* a `.then()` success
 *    callback - a plain, non-throwing return, not a rejected promise. That
 *    only ends the one callback it is written in; every later `.then()` in
 *    the chain still runs unconditionally with whatever value happened to
 *    flow through (frequently `undefined`, which most of them do not
 *    re-check). The patronage check and the ballot-creation code live in two
 *    *different* `.then()` callbacks, so failing the patronage check does not
 *    prevent the save - it only guarantees the client is told "No patronage
 *    found" while a real `ReferendumBallot` is written anyway, with
 *    `casterpatronagestatus` hardcoded `true` regardless. The *only* check in
 *    this function that genuinely works is "does a ballot already exist"
 *    (finding 3 above), because that check and the mutation it guards share
 *    one callback. Confirmed live - test 50 is what caught it, by reading the
 *    ballot back rather than trusting the reported outcome, exactly per this
 *    item's own instruction that a false green here reads as a security
 *    finding. Test 50.
 *
 * A sixth finding is real but minor and does not fail a test: on a
 * *successful* vote, the dedicated confirmation paragraph
 * (`ballot_message.message` in templates/referendum/options.html) renders
 * empty, because `vote_for_referendum` resolves with the bare string
 * `"Ballot has been cast"` rather than an object carrying a `.message`
 * property, and a string has no `.message`. The *adjacent* paragraph - "On
 * <date> you voted for <choice>" - is genuine, correctly-populated
 * confirmation of the same outcome, and is what test 44 asserts against.
 *
 * Because of (1), the fixture referendum every test after 39 depends on is
 * created directly via Parse in `beforeAll` - fixture setup, not the
 * interaction under test, the same category Task 1's suite used for its own
 * referendum fixture (see admin-patronage.spec.js test 10's setup). Because
 * the admin detail view's shared `ReferendumView` only renders the option
 * text list when the *viewing* user's own patronagestatus is true (regardless
 * of whether any ballots exist yet - confirmed live), devuser is granted
 * active-Patron status in `beforeAll` too, purely so `#administration/referendum/:id`
 * is reachable at all for test 41; that status is then reused for test 49,
 * where devuser doubles as a third voting persona rather than requiring a
 * fifth seeded account (nothing in `vote_for_referendum` special-cases the
 * Administrator role).
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, loginAsAST, loginAsStranger } = require('./helpers/auth');
const { navigateToHash, hardReload, waitForAppReady } = require('./helpers/jqm-helpers');
const {
  FIXTURE_PREFIX,
  DESCRIPTION_REGION,
  uniqueReferendumName,
  createReferendumFixture,
  countReferendumFixtures,
  countBallotsForFixturePrefix,
  destroyReferendumFixtures,
  grantActivePatronage,
  countPatronagesForOwners,
  destroyPatronagesForOwners,
  openReferendum,
  openAdminReferendum,
  readVoteOptions,
  isPatronGateShown,
  readMyBallotConfirmation,
  castVote,
  readAdminBallotRows,
  tallyBallotRows,
  readBallotsForCaster,
  voteViaCloudFunction
} = require('./helpers/referendums');

/** Real, distinguishable option text for the fixture referendum's three ballot options. */
const OPTION_TEXTS = ['E2E Choice A', 'E2E Choice B', 'E2E Choice C'];

test.describe.configure({ mode: 'serial' });

test.describe('Task 3 - Referendums: Creation And Voting', () => {
  /** @type {import('@playwright/test').Page} */
  let adminPage;
  /** @type {import('@playwright/test').Page} */
  let memberPage;
  /** @type {import('@playwright/test').Page} */
  let astPage;
  /** @type {import('@playwright/test').Page} */
  let strangerPage;

  // Fixture state threaded across the numbered tests: real ids and the exact
  // option text captured as each test creates or claims them. Nothing below
  // is a hardcoded Parse object id.
  const state = {
    options: OPTION_TEXTS.map((text, i) => ({ option: `option_${i}`, text }))
  };

  test.beforeAll(async ({ browser }) => {
    adminPage = await browser.newPage();
    await loginAsAdmin(adminPage);
    memberPage = await browser.newPage();
    await loginAsMember(memberPage);
    astPage = await browser.newPage();
    await loginAsAST(astPage);
    strangerPage = await browser.newPage();
    await loginAsStranger(strangerPage);

    const resolveUserId = async (username) => adminPage.evaluate(async (u) => {
      // Via the Cloud function, not a _User query. Clients may no longer
      // find or count _User -- see database_seed/_SCHEMA.json -- so resolving a
      // username in the browser is now the server's job. This runs as the admin
      // page's session, which the function answers with the whole directory.
      const payload = await window.Parse.Cloud.run('list_users');
      const found = (payload.users || []).filter((x) => x.get('username') === u)[0];
      if (!found) throw new Error(`seeded user "${u}" not found`);
      return found.id;
    }, username);

    state.devuserId = await resolveUserId('devuser');
    state.sampmemId = await resolveUserId('sampmem');
    state.sampastId = await resolveUserId('sampast');
    state.sampstrangerId = await resolveUserId('sampstranger');
    state.ownerIds = [state.devuserId, state.sampmemId, state.sampastId, state.sampstrangerId];

    // Self-heal first: sweep up anything a previous crashed run left behind
    // (by query, not by ids this run has not seen yet), so the baseline
    // measured immediately after is trustworthy across repeat runs.
    await destroyReferendumFixtures(adminPage, FIXTURE_PREFIX);
    await destroyPatronagesForOwners(adminPage, state.ownerIds);

    state.baseline = {
      referendums: await countReferendumFixtures(adminPage, FIXTURE_PREFIX),
      ballots: await countBallotsForFixturePrefix(adminPage, FIXTURE_PREFIX),
      patronages: await countPatronagesForOwners(adminPage, state.ownerIds)
    };
    console.log('[e2e referendums] baseline row counts (after self-heal):', JSON.stringify(state.baseline));

    // The fixture referendum tests 40-53 depend on. See the file-level
    // comment: there is no UI path to create this, so it is fixture setup via
    // Parse, not the interaction under test (that is what test 39 itself
    // exercises and documents as broken).
    state.referendumName = uniqueReferendumName(FIXTURE_PREFIX);
    state.shortdescription = 'E2E fixture referendum for Task 3 voting tests';
    state.description = 'This referendum exists only to exercise referendum-detail rendering and the voting lifecycle end to end.';
    const created = await createReferendumFixture(adminPage, {
      name: state.referendumName,
      shortdescription: state.shortdescription,
      description: state.description,
      option_0: state.options[0].text,
      option_1: state.options[1].text,
      option_2: state.options[2].text,
      order: 999
    });
    state.referendumId = created.id;

    // Active-Patron status for every persona that needs to vote. sampstranger
    // is deliberately never granted one anywhere in this file - test 50
    // depends on that absence.
    await grantActivePatronage(adminPage, state.devuserId);
    await grantActivePatronage(adminPage, state.sampmemId);
    await grantActivePatronage(adminPage, state.sampastId);
  });

  test.afterAll(async () => {
    // Delete everything this suite created, keyed by query (name prefix for
    // Referendum/ReferendumBallot, owner for Patronage) rather than only by
    // ids tracked in memory - self-healing across a crashed run, the same
    // pattern Task 1's afterAll established after its own leftover-row
    // problem. See the report for the three-run before/after proof.
    if (adminPage) {
      const refResult = await destroyReferendumFixtures(adminPage, FIXTURE_PREFIX)
        .catch((e) => ({ referendums: 0, ballots: 0, errors: [String(e)] }));
      const patronageResult = await destroyPatronagesForOwners(adminPage, state.ownerIds)
        .catch((e) => ({ deleted: 0, errors: [String(e)] }));

      console.log('[e2e referendums] deleted in teardown:', JSON.stringify({
        referendums: refResult.referendums,
        ballots: refResult.ballots,
        patronages: patronageResult.deleted
      }));
      const allErrors = [...(refResult.errors || []), ...(patronageResult.errors || [])];
      if (allErrors.length > 0) {
        console.log('[e2e referendums] teardown had per-object errors (see final counts below for whether anything was actually left behind):', JSON.stringify(allErrors));
      }

      const final = {
        referendums: await countReferendumFixtures(adminPage, FIXTURE_PREFIX).catch(() => -1),
        ballots: await countBallotsForFixturePrefix(adminPage, FIXTURE_PREFIX).catch(() => -1),
        patronages: await countPatronagesForOwners(adminPage, state.ownerIds).catch(() => -1)
      };
      console.log('[e2e referendums] final row counts (should equal baseline ' + JSON.stringify(state.baseline) + '):', JSON.stringify(final));
    }

    if (adminPage) await adminPage.close();
    if (memberPage) await memberPage.close();
    if (astPage) await astPage.close();
    if (strangerPage) await strangerPage.close();
  });

  test.fail('38 Admin referendums list renders with a create action', async () => {
    // DEFECT (see file-level comment, finding 1): unlike PatronagesListView,
    // which renders `a[href="#administration/patronages/new"]`,
    // ReferendumsListView's template (templates/referendums-list.html) has no
    // create-action markup at all, and mobileRouter.js registers no
    // `administration/referendums/new`-shaped route. Confirmed live: nothing
    // resembling "Add"/"New"/"Create" renders anywhere on this page.
    await navigateToHash(adminPage, 'administration/referendums', '#referendums-list');
    await expect(adminPage.locator('#referendums-list')).toBeVisible();

    const createAction = adminPage.locator('#referendums-list a, #referendums-list button')
      .filter({ hasText: /add|new|create/i });
    await expect(createAction.first()).toBeVisible({ timeout: 5000 });
  });

  test.fail('39 Create a referendum with a title, description, and at least three ballot options', async () => {
    // DEFECT (finding 1): with no create link to click (test 38) and no
    // registered route, the closest real attempt is the URL pattern every
    // sibling admin "new" form actually uses (Patronage:
    // `#administration/patronages/new`; every rule editor similarly
    // patterned). Confirmed live: changing the hash to the guessed
    // equivalent changes nothing - the app stays on whatever page it was
    // already showing, because Backbone's router has no handler for it, and
    // no form-shaped input appears anywhere in the document.
    const before = await countReferendumFixtures(adminPage, FIXTURE_PREFIX);

    await navigateToHash(adminPage, 'administration/referendums', '#referendums-list');
    await adminPage.evaluate(() => { window.location.hash = '#administration/referendums/new'; });
    await adminPage.waitForTimeout(2000);

    const createForm = adminPage.locator('input[name="name"], textarea[name="description"], input[name="option_0"]');
    await expect(createForm.first()).toBeVisible({ timeout: 5000 });

    // Not reached given the expectation above, but documents the fuller
    // check a working create flow would need to satisfy.
    const after = await countReferendumFixtures(adminPage, FIXTURE_PREFIX);
    expect(after).toBe(before);
  });

  test('40 The created referendum appears in #administration/referendums', async () => {
    // Per test 39's finding, "the created referendum" is the fixture this
    // suite creates via Parse in beforeAll - there is no UI-created
    // referendum to reference instead. Located by its real id via the
    // `backendId` attribute the list template renders
    // (templates/referendums-list.html), never a hardcoded id.
    await navigateToHash(adminPage, 'administration/referendums', '#referendums-list');
    const row = adminPage.locator(`a.referendum-listing[backendId="${state.referendumId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(state.referendumName);
    await expect(row).toContainText(state.shortdescription);
  });

  test('41 Admin referendum detail shows all ballot options with zero initial tallies', async () => {
    // Checked before any vote exists anywhere in this suite. The admin
    // detail route reuses the exact same member-facing options view; the
    // option-text list only renders in the branch gated on the *viewing*
    // user's own patronagestatus (see the file-level comment) - devuser was
    // granted one in beforeAll specifically so this page shows anything at
    // all here.
    await openAdminReferendum(adminPage, state.referendumId);

    const options = await readVoteOptions(adminPage);
    expect(options.map((o) => o.option).sort()).toEqual(['option_0', 'option_1', 'option_2']);
    for (const expected of state.options) {
      const rendered = options.find((o) => o.option === expected.option);
      expect(rendered).toBeTruthy();
      expect(rendered.text).toBe(expected.text);
    }

    // "Zero initial tallies": the admin-only ballot dump - independent of the
    // patronagestatus branch above, always rendered when `ballots` was
    // fetched - has no rows yet.
    const rows = await readAdminBallotRows(adminPage);
    expect(rows).toHaveLength(0);
  });

  test('42 The referendum is visible to a member at #referendums', async () => {
    await navigateToHash(memberPage, 'referendums', '#referendums-list');
    const row = memberPage.locator(`a.referendum-listing[backendId="${state.referendumId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(state.referendumName);
    await expect(row).toContainText(state.shortdescription);
  });

  test('43 A member opening #referendum/:id sees the description child view and the options child view', async () => {
    await openReferendum(memberPage, state.referendumId);

    const description = memberPage.locator(DESCRIPTION_REGION);
    await expect(description).toContainText(state.referendumName);
    await expect(description).toContainText(state.shortdescription);
    await expect(description).toContainText(state.description);

    // sampmem is already an active Patron (granted in beforeAll), so the
    // options child view renders the real, live ballot option list.
    const options = await readVoteOptions(memberPage);
    expect(options.map((o) => o.option).sort()).toEqual(['option_0', 'option_1', 'option_2']);
    expect(options.map((o) => o.text).sort()).toEqual([...OPTION_TEXTS].sort());
  });

  test('44 A patron member casts a vote; the ballot is recorded and a confirmation message is displayed', async () => {
    await openReferendum(memberPage, state.referendumId);
    state.firstChoice = state.options[0];

    await castVote(memberPage, state.firstChoice.option);

    // NOTE (minor defect, not failing this test over it - see file-level
    // comment, finding 5): the dedicated `ballot_message.message` paragraph
    // renders empty on success. This asserts the *other*, correctly-working
    // confirmation the same render produces.
    const confirmation = await readMyBallotConfirmation(memberPage);
    expect(confirmation).not.toBeNull();
    expect(confirmation.choiceText).toBe(state.firstChoice.text);

    // Assertion-side read-back of the actual recorded ballot, not merely the
    // rendered confirmation text.
    const ballots = await readBallotsForCaster(memberPage, state.referendumId, state.sampmemId);
    expect(ballots).toHaveLength(1);
    expect(ballots[0].choice).toBe(state.firstChoice.option);
  });

  test('45 Reloading #referendum/:id shows the member\'s existing ballot as their current selection', async () => {
    await hardReload(memberPage);
    await openReferendum(memberPage, state.referendumId);

    const confirmation = await readMyBallotConfirmation(memberPage);
    expect(confirmation).not.toBeNull();
    expect(confirmation.choiceText).toBe(state.firstChoice.text);

    // The vote links themselves are gone now that a ballot exists - see the
    // file-level comment, finding 3, for why that also forecloses any UI path
    // to recasting.
    const options = await readVoteOptions(memberPage);
    expect(options).toHaveLength(0);
  });

  test.fail('46 Recasting the vote for a different option replaces the ballot - the member still has exactly one ballot', async () => {
    // DEFECT (finding 3, confirmed live - see file-level comment and
    // helpers/referendums.js): `vote_for_referendum` has no update path.
    // Once a ReferendumBallot exists for (referendum, caster), the cloud
    // function's own existing-ballot check unconditionally does
    // `response.error("Existing ballot found." + ...)` and returns - there is
    // no branch that ever writes a new `choice` onto the existing row.
    // Independently, the UI provides no way to even attempt this: the vote
    // links only render when neither `ballot_message` nor `ballot` is set on
    // the view, and the router populates `ballot` fresh on every load once a
    // row exists, so they are permanently replaced by static "you voted for
    // X" text with no "change my vote" control anywhere. The closest real
    // interaction available is therefore the exact
    // `Parse.Cloud.run("vote_for_referendum", ...)` call the (nonexistent)
    // second link would have made - not standing in for a click that exists
    // and was skipped, but the same call the feature would need to issue if
    // it existed at all.
    const secondChoice = state.options[1];
    expect(secondChoice.option).not.toBe(state.firstChoice.option);

    const before = await readBallotsForCaster(memberPage, state.referendumId, state.sampmemId);
    expect(before).toHaveLength(1);
    expect(before[0].choice).toBe(state.firstChoice.option);

    const attempt = await voteViaCloudFunction(memberPage, state.referendumId, secondChoice.option);

    const after = await readBallotsForCaster(memberPage, state.referendumId, state.sampmemId);
    // The real invariant this item asks for: exactly one ballot, now
    // reflecting the *new* choice - not merely "still exactly one", which is
    // trivially true of an attempt that was silently ignored, as this one in
    // fact is.
    expect(after).toHaveLength(1);
    expect(attempt.ok).toBe(true);
    expect(after[0].choice).toBe(secondChoice.option);
  });

  test('47 The tally in the admin view increments to match after the vote', async () => {
    await openAdminReferendum(adminPage, state.referendumId);
    const rows = await readAdminBallotRows(adminPage);
    const tally = tallyBallotRows(rows);

    expect(tally[state.firstChoice.option]).toBe(1);
    expect(tally[state.options[1].option] || 0).toBe(0);
    expect(tally[state.options[2].option] || 0).toBe(0);

    const sampmemRow = rows.find((r) => r.username === 'sampmem');
    expect(sampmemRow).toBeTruthy();
    expect(sampmemRow.choice).toBe(state.firstChoice.option);
  });

  test('48 A second user votes for a different option; both tallies are correct in the admin view', async () => {
    state.secondChoice = state.options[1];
    expect(state.secondChoice.option).not.toBe(state.firstChoice.option);

    await openReferendum(astPage, state.referendumId);
    await castVote(astPage, state.secondChoice.option);

    const ballots = await readBallotsForCaster(astPage, state.referendumId, state.sampastId);
    expect(ballots).toHaveLength(1);
    expect(ballots[0].choice).toBe(state.secondChoice.option);

    await openAdminReferendum(adminPage, state.referendumId);
    const tally = tallyBallotRows(await readAdminBallotRows(adminPage));
    expect(tally[state.firstChoice.option]).toBe(1);
    expect(tally[state.secondChoice.option]).toBe(1);
    expect(tally[state.options[2].option] || 0).toBe(0);
  });

  test('49 A third user votes for the same option as the first; that tally reaches 2', async () => {
    // devuser: granted active-Patron status in beforeAll (see the file-level
    // comment for why) and reused here as the third voting persona rather
    // than seeding a fifth account - nothing in vote_for_referendum
    // special-cases the Administrator role, so this exercises the exact same
    // path any patron member's vote does.
    await openReferendum(adminPage, state.referendumId);
    await castVote(adminPage, state.firstChoice.option);

    const ballots = await readBallotsForCaster(adminPage, state.referendumId, state.devuserId);
    expect(ballots).toHaveLength(1);
    expect(ballots[0].choice).toBe(state.firstChoice.option);

    await openAdminReferendum(adminPage, state.referendumId);
    const tally = tallyBallotRows(await readAdminBallotRows(adminPage));
    expect(tally[state.firstChoice.option]).toBe(2);
    expect(tally[state.secondChoice.option]).toBe(1);
    expect(tally[state.options[2].option] || 0).toBe(0);
  });

  test('50 A non-patron user is prevented from voting and shown the patron-required message', async () => {
    // sampstranger is never granted a Patronage anywhere in this suite.
    //
    // FIXED by remediation R11. `vote_for_referendum` is now a single chain in
    // which every refusal returns a *rejected* promise, so a rejection really
    // does terminate it, and `casterpatronagestatus` is recorded from the
    // patronage check that actually ran rather than hardcoded `true`. The
    // last assertion below - nothing persisted - is the one that was failing
    // and is the whole point of the item.
    //
    // The original writeup, kept because it names the mechanism precisely:
    // the *UI* correctly hid
    // the voting affordance, and a direct call to the cloud function *reports*
    // rejection - both asserted below, and both genuinely true - but neither
    // actually stops the vote from being recorded. `vote_for_referendum`'s
    // patronage check lives in a `.then()` callback that is a *different* one
    // from the ballot-creation code several steps later; its
    // `response.error("No patronage found"); return;` only ends that one
    // callback with a plain (non-rejected) return value, so every later
    // `.then()` in the chain still runs unconditionally - reaching the
    // ballot-creation code and persisting a real ReferendumBallot for this
    // caster anyway, with `casterpatronagestatus` hardcoded `true`
    // regardless of the check that supposedly just failed. Confirmed live -
    // this exact test is what caught it. The only check in this function
    // that actually prevents a save is "does a ballot already exist" (see
    // test 46): that check and the mutation it guards share one callback, so
    // its early return genuinely works. This one does not: a non-patron's
    // *first* vote on a referendum is silently recorded despite the caller
    // being told it was rejected - precisely the false-green-reads-as-security
    // failure mode this item warns against, caught only by reading the
    // recorded ballot back rather than trusting the reported outcome.
    await openReferendum(strangerPage, state.referendumId);

    expect(await isPatronGateShown(strangerPage)).toBe(true);
    const options = await readVoteOptions(strangerPage);
    expect(options).toHaveLength(0);

    const ballotsBefore = await readBallotsForCaster(strangerPage, state.referendumId, state.sampstrangerId);
    expect(ballotsBefore).toHaveLength(0);

    const attempt = await voteViaCloudFunction(strangerPage, state.referendumId, state.options[0].option);
    expect(attempt.ok).toBe(false);
    expect(attempt.message).toMatch(/patronage/i);

    // The real invariant "prevented from voting" requires: nothing persisted.
    const ballotsAfter = await readBallotsForCaster(strangerPage, state.referendumId, state.sampstrangerId);
    expect(ballotsAfter).toHaveLength(0);
  });

  test('51 An unauthenticated visitor cannot reach #referendum/:id', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto('/');
      await waitForAppReady(page);

      const loggedIn = await page.evaluate(() => !!(window.Parse && window.Parse.User.current()));
      expect(loggedIn).toBe(false);

      // `enforce_logged_in()` (mobileRouter.js) redirects straight to #login
      // before the referendum route does anything else - deliberately not
      // using navigateToHash's targetSelector wait here, since it would keep
      // retrying (and eventually reloading) trying to reach a page that is
      // never going to become active.
      await navigateToHash(page, `referendum/${state.referendumId}`);
      await page.waitForTimeout(2000);

      const activeId = await page.evaluate(() => {
        const el = document.querySelector('.ui-page-active');
        return el ? el.id : null;
      });
      expect(activeId).toBe('login');

      const bodyText = await page.evaluate(() => document.body.textContent);
      expect(bodyText).not.toContain(state.referendumName);
      expect(bodyText).not.toContain(state.description);
    } finally {
      await context.close();
    }
  });

  test.fail('52 A referendum past its close date does not accept new votes', async () => {
    // DEFECT (finding 4, see file-level comment): there is no close-date
    // concept for Referendum anywhere in the application - not in the
    // schema, not read anywhere in vote_for_referendum. The precondition this
    // item describes cannot be constructed through any means the app
    // provides, so this demonstrates it concretely instead of merely citing
    // the source: even after adding the most plausible close-date field this
    // app's own naming convention would use (Patronage already has
    // `paidOn`/`expiresOn`; this uses the equivalent `closesOn`), set in the
    // past, on a brand-new referendum, an active patron can still vote
    // successfully - because nothing anywhere reads that field.
    const closedReferendum = await createReferendumFixture(adminPage, {
      name: uniqueReferendumName(FIXTURE_PREFIX + 'Closed '),
      shortdescription: 'E2E fixture referendum for the close-date defect (test 52)',
      description: 'Carries a closesOn date in the past to demonstrate nothing checks it.',
      option_0: 'E2E Closed Option A',
      option_1: 'E2E Closed Option B',
      option_2: 'E2E Closed Option C',
      closesOn: new Date(Date.now() - 24 * 60 * 60 * 1000),
      order: 998
    });

    // sampmem is an active patron and has not voted on this second,
    // just-created referendum yet.
    const attempt = await voteViaCloudFunction(memberPage, closedReferendum.id, 'option_0');
    expect(attempt.ok).toBe(false);
  });

  test.fail("53 Editing a referendum's ballot options through the admin UI is reflected on the member-facing view", async () => {
    // DEFECT (finding 2, see file-level comment): there is no edit UI for
    // Referendum anywhere - the admin detail route renders the identical
    // read-only ReferendumView the member-facing route does, with no
    // Backform, no bulk-CSV editor, and no save control. Confirmed live: no
    // input, textarea, or "Save"/"Edit" control exists anywhere on this page.
    await openAdminReferendum(adminPage, state.referendumId);

    const editControl = adminPage.locator([
      '#referendum input',
      '#referendum textarea',
      '#referendum button:has-text("Save")',
      '#referendum a:has-text("Edit")'
    ].join(', '));
    await expect(editControl.first()).toBeVisible({ timeout: 5000 });
  });
});
