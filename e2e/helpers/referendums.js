/**
 * Referendum voting helpers.
 *
 * Two facts, confirmed live against this server before writing any test, drive
 * every function below:
 *
 * 1. **There is no UI to create or edit a Referendum.** `mobileRouter.js`
 *    registers exactly four referendum routes - `referendums`, `referendum`,
 *    `administration_referendums`, `administration_referendum` - all reads.
 *    `ReferendumsListView`'s template (`templates/referendums-list.html`) has
 *    no "Add New" link (contrast `PatronagesListView`, which does), no
 *    `#administration/referendums/new`-shaped route exists anywhere in the
 *    router, and `public/index.html` defines the `#referendums-list` and
 *    `#referendum` pages with no form markup at all. There is likewise no
 *    Backform, no bulk-CSV editor route, and no save control anywhere for an
 *    existing referendum's fields. Both are real, load-bearing findings, not
 *    an oversight in this suite - see admin-referendums.spec.js tests 38, 39
 *    and 53.
 *
 * 2. **Voting is single-shot and has no update path.** `vote_for_referendum`
 *    (cloud/main.js) checks for an existing `ReferendumBallot` for
 *    (referendum, caster) and, if one is found, unconditionally
 *    `response.error("Existing ballot found." + ...)` - there is no branch
 *    that ever updates `choice` on an existing row. The UI compounds this:
 *    `options.html` only renders the vote links when neither `ballot_message`
 *    nor `ballot` is set on the view, and the router populates `ballot` fresh
 *    on every page load once a row exists, so the links are permanently
 *    replaced by static "you voted for X" text with no "change my vote"
 *    control anywhere the UI can reach. See test 46.
 *
 * 3. **Serious: `vote_for_referendum`'s patron-gate does not actually stop a
 *    ballot from being written.** The whole function is one chain of
 *    jQuery-style `.then()`/`.fail()` calls, and every rejection is reported
 *    by calling `response.error(msg); return;` *from inside* a `.then()`
 *    success callback - a plain, non-throwing return, not a rejected promise.
 *    That only ends the one callback it is written in; every later `.then()`
 *    in the chain still runs unconditionally. The patronage check and the
 *    ballot-creation code live in two *different* callbacks, so failing the
 *    patronage check reports an error to the client but does not prevent the
 *    save - a real `ReferendumBallot` gets written anyway, with
 *    `casterpatronagestatus` hardcoded `true` regardless of the check that
 *    just failed. (The recast check in finding 2 above genuinely works
 *    *only* because that check and the mutation it guards happen to share one
 *    callback - it is not evidence the pattern is safe in general.) Confirmed
 *    live via `readBallotsForCaster` after a rejected call - see test 50,
 *    which exists specifically to catch this rather than trust the reported
 *    outcome.
 *
 * Because of (1), the fixture referendum every test in this file depends on is
 * created directly via Parse in `beforeAll` - fixture setup, not the
 * interaction under test, the same category Task 1's suite used to create its
 * own referendum fixture for test 10. Because of (2) and (3),
 * `voteViaCloudFunction` exists to demonstrate both defects using the exact
 * call the UI's own `cast_ballot` handler would issue, not as a substitute
 * for a click that exists and was skipped - and every caller of it re-reads
 * the ballot table afterward via `readBallotsForCaster` rather than trusting
 * the call's own reported outcome, per finding 3 above.
 *
 * Active-Patron status (a precondition for voting at all) is granted the same
 * way Task 1 established: a Patronage record with `expiresOn` in the future.
 * `get_my_patronage_status` and `vote_for_referendum` both key off the record
 * with the *latest* `expiresOn`, so granting it is a one-shot add, never an
 * edit - see `grantActivePatronage`.
 */

const {
  navigateToHash,
  hardReload,
  normalize
} = require('./jqm-helpers');

const PAGE = '#referendum';
const OPTIONS_REGION = '#referendum-options';
const DESCRIPTION_REGION = '#referendum-description';

/** Every Referendum this suite creates carries this name prefix, so teardown can find them all by query rather than only by ids tracked in memory. */
const FIXTURE_PREFIX = 'E2E Referendum ';

let nameCounter = 0;
/** Unique, obviously-test-scoped referendum name. */
function uniqueReferendumName(prefix) {
  nameCounter += 1;
  return `${prefix}${Date.now().toString(36)}${nameCounter}`;
}

/**
 * Create a Referendum directly via Parse.
 *
 * Fixture setup, not the interaction under test - see the file-level comment.
 * `fields` must include `name` starting with `FIXTURE_PREFIX` so teardown's
 * prefix sweep finds it.
 */
async function createReferendumFixture(page, fields) {
  return page.evaluate(async (f) => {
    const r = new window.Parse.Object('Referendum');
    const acl = new window.Parse.ACL();
    acl.setPublicReadAccess(true);
    acl.setPublicWriteAccess(false);
    acl.setRoleReadAccess('Administrator', true);
    acl.setRoleWriteAccess('Administrator', true);
    r.setACL(acl);
    r.set(f);
    await r.save();
    return Object.assign({ id: r.id }, f);
  }, fields);
}

/** Count Referendum fixtures matching `prefix`, for the before/after row-count proof. */
async function countReferendumFixtures(page, prefix) {
  return page.evaluate(async (p) => {
    const q = new window.Parse.Query('Referendum');
    q.startsWith('name', p);
    return q.count();
  }, prefix);
}

/** Count ReferendumBallot rows cast against any Referendum matching `prefix`. */
async function countBallotsForFixturePrefix(page, prefix) {
  return page.evaluate(async (p) => {
    const rq = new window.Parse.Query('Referendum');
    rq.startsWith('name', p);
    rq.limit(1000);
    const refs = await rq.find();
    if (refs.length === 0) return 0;
    const bq = new window.Parse.Query('ReferendumBallot');
    bq.containedIn('owner', refs);
    return bq.count();
  }, prefix);
}

/**
 * Self-healing teardown: delete every Referendum whose name starts with
 * `prefix`, and every ReferendumBallot cast against one of them - found fresh
 * by query at call time, not only by ids tracked in memory, so a prior run
 * that crashed mid-suite still leaves a clean database for the next one.
 *
 * Deletes one object at a time with its own try/catch (mirroring
 * helpers/descriptions.js's `destroyDescriptions`) rather than a single
 * `Parse.Object.destroyAll(...)` call, deliberately: `destroyAll` rejects the
 * *entire* batch the moment any one object fails, which would otherwise mean
 * one already-gone or permission-edge-case row blocks cleanup of every other
 * row in the same batch. Ballots are always deleted before the referendum
 * that owns them, but one referendum's ballot failing to delete does not
 * stop the next referendum (or its own ballots) from being cleaned up.
 */
async function destroyReferendumFixtures(page, prefix) {
  return page.evaluate(async (p) => {
    const rq = new window.Parse.Query('Referendum');
    rq.startsWith('name', p);
    rq.limit(1000);
    const refs = await rq.find();
    if (refs.length === 0) return { referendums: 0, ballots: 0, errors: [] };

    const bq = new window.Parse.Query('ReferendumBallot');
    bq.containedIn('owner', refs);
    bq.limit(1000);
    const ballots = await bq.find();

    const errors = [];
    let ballotsDeleted = 0;
    for (const ballot of ballots) {
      try {
        await ballot.destroy();
        ballotsDeleted += 1;
      } catch (e) {
        errors.push(`ballot ${ballot.id}: ${e && e.message ? e.message : String(e)}`);
      }
    }

    let referendumsDeleted = 0;
    for (const ref of refs) {
      try {
        await ref.destroy();
        referendumsDeleted += 1;
      } catch (e) {
        errors.push(`referendum ${ref.id}: ${e && e.message ? e.message : String(e)}`);
      }
    }

    return { referendums: referendumsDeleted, ballots: ballotsDeleted, errors };
  }, prefix);
}

/**
 * Grant a user active Patron status: a Patronage whose `paidOn` is in the past
 * and `expiresOn` is in the future. Fixture setup - see the file-level comment
 * for why this can only ever add a record, never edit one, to change status.
 */
async function grantActivePatronage(page, ownerId, { pastDays = 30, futureDays = 60 } = {}) {
  return page.evaluate(async ({ ownerId, pastDays, futureDays }) => {
    const p = new window.Parse.Object('Patronage');
    p.set('owner', window.Parse.User.createWithoutData(ownerId));
    p.set('paidOn', new Date(Date.now() - pastDays * 24 * 60 * 60 * 1000));
    p.set('expiresOn', new Date(Date.now() + futureDays * 24 * 60 * 60 * 1000));
    await p.save();
    return p.id;
  }, { ownerId, pastDays, futureDays });
}

/** Count Patronage rows owned by any of `ownerIds`, for the before/after row-count proof. */
async function countPatronagesForOwners(page, ownerIds) {
  return page.evaluate(async (ids) => {
    const q = new window.Parse.Query('Patronage');
    q.containedIn('owner', ids.map((id) => window.Parse.User.createWithoutData(id)));
    return q.count();
  }, ownerIds);
}

/**
 * Self-healing teardown: delete every Patronage owned by any of `ownerIds`.
 * Mirrors Task 1's afterAll cleanup, generalised to several owners so one
 * call cleans up every persona this suite granted patron status to. Deletes
 * one row at a time with its own try/catch, for the same reason
 * `destroyReferendumFixtures` does - one failure must not block the rest.
 */
async function destroyPatronagesForOwners(page, ownerIds) {
  return page.evaluate(async (ids) => {
    const q = new window.Parse.Query('Patronage');
    q.containedIn('owner', ids.map((id) => window.Parse.User.createWithoutData(id)));
    q.limit(1000);
    const rows = await q.find();
    let deleted = 0;
    const errors = [];
    for (const row of rows) {
      try {
        await row.destroy();
        deleted += 1;
      } catch (e) {
        errors.push(`patronage ${row.id}: ${e && e.message ? e.message : String(e)}`);
      }
    }
    return { deleted, errors };
  }, ownerIds);
}

/**
 * Navigate to the member-facing referendum page.
 *
 * FIX (local to this suite - see report): both `referendum/:id` and
 * `administration/referendum/:id` render into the exact same `#referendum`
 * page element, and this suite deliberately revisits that element on the
 * same `Page` object several times expecting *fresh* data each time (an
 * updated tally after a vote, say). `jqm-helpers.js`'s `waitForActivePage`
 * confirms a page transition by checking "is this the active page id, and is
 * its content non-empty" - a check that is already satisfied the instant a
 * page is revisited while still showing its *previous* render, before the
 * new route handler's own asynchronous fetch-then-render has even started.
 * An early fix for this lived directly in `navigateToHash` (clearing the
 * target page's content up front whenever it was already active) and did
 * solve it - but it also changed timing broadly enough to intermittently
 * disrupt `admin-patronage.spec.js`'s own same-page revisits elsewhere in
 * the admin project, so it was reverted rather than shipped as a shared
 * change. `hardReload` sidesteps the ambiguity entirely: it is already used
 * elsewhere in this codebase specifically to force a genuinely fresh view
 * past router-level memoization, and after a reload no page is active yet at
 * all, so the very first `waitForActivePage` check this suite's own
 * `navigateToHash` call makes cannot be satisfied by stale leftover content -
 * there is none. The cost is a few extra seconds of reload per navigation;
 * given several of this suite's own steps already take 40+ seconds on real
 * Parse round trips, that is a fully acceptable, purely local trade-off.
 */
async function openReferendum(page, referendumId) {
  await hardReload(page);
  await navigateToHash(page, `referendum/${referendumId}`, PAGE);
}

/** Navigate to the admin referendum detail page - the same `#referendum` page element, populated with admin-only data (the ballots dump). See `openReferendum`'s comment for why this reloads first. */
async function openAdminReferendum(page, referendumId) {
  await hardReload(page);
  await navigateToHash(page, `administration/referendum/${referendumId}`, PAGE);
}

/**
 * The currently rendered vote options: `[{option: 'option_0', text: '...'}, ...]`.
 * Empty once the viewing user already has a ballot, or if they are not a
 * Patron - `options.html` only renders these links in the one branch where
 * neither is true.
 */
async function readVoteOptions(page) {
  return page.evaluate((sel) => {
    const region = document.querySelector(sel);
    if (!region) return [];
    return Array.from(region.querySelectorAll('a[name^="option_"]')).map((a) => ({
      option: a.getAttribute('name'),
      text: a.textContent.replace(/\s+/g, ' ').trim()
    }));
  }, OPTIONS_REGION);
}

/** True when the options region is showing the "not currently a Patron" gating message. */
async function isPatronGateShown(page) {
  const text = await page.locator(OPTIONS_REGION).textContent();
  return /not currently a Patron/i.test(text || '');
}

/**
 * The "On <date> you voted for <choice>" confirmation, or null if not shown.
 * Returns both the full normalised region text and just the choice text
 * (everything after "you voted for"), so callers can assert on the exact
 * option text without re-deriving the parse themselves.
 */
async function readMyBallotConfirmation(page) {
  const text = normalize(await page.locator(OPTIONS_REGION).textContent());
  const m = text.match(/you voted for (.+)$/i);
  if (!m) return null;
  return { full: text, choiceText: m[1].trim() };
}

/**
 * Click the real vote link for `optionField` (e.g. "option_0") and wait for
 * the view's own asynchronous cast-then-render cycle to settle.
 *
 * `cast_ballot` (ReferendumView.js) calls `Parse.Cloud.run` - a genuine
 * network round trip - then re-queries the ballot and re-renders; polling for
 * the region to reach one of its two possible settled states is more reliable
 * than a fixed delay.
 */
async function castVote(page, optionField) {
  const link = page.locator(`${OPTIONS_REGION} a[name="${optionField}"]`);
  await link.waitFor({ state: 'visible', timeout: 10000 });
  await link.click();
  await page.waitForFunction((sel) => {
    const region = document.querySelector(sel);
    if (!region) return false;
    const text = region.textContent || '';
    return /you voted for/i.test(text) || /not currently a Patron/i.test(text);
  }, OPTIONS_REGION, { timeout: 15000 });
}

/**
 * Parse the admin-only ballot dump into structured rows.
 *
 * Only `#administration/referendum/:id` passes a `ballots` collection into
 * the view, and `options.html` renders it as bare quoted-CSV text -
 * `"username","realname","email","choice","updatedAt"<br/>` per ballot, not a
 * table - so this reads the region's own text via regex rather than any DOM
 * structure.
 */
async function readAdminBallotRows(page) {
  const text = await page.locator(OPTIONS_REGION).textContent();
  const rows = [];
  const re = /"([^"]*)","([^"]*)","([^"]*)","(option_\d+)","([^"]*)"/g;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    rows.push({ username: m[1], realname: m[2], email: m[3], choice: m[4], updatedAt: m[5] });
  }
  return rows;
}

/** Reduce ballot rows into per-option counts, e.g. `{option_0: 2, option_1: 1}`. */
function tallyBallotRows(rows) {
  const tally = {};
  for (const row of rows) {
    tally[row.choice] = (tally[row.choice] || 0) + 1;
  }
  return tally;
}

/** Assertion-side read-back (permitted): the real ReferendumBallot row(s) for one (referendum, caster) pair, straight from Parse. */
async function readBallotsForCaster(page, referendumId, casterId) {
  return page.evaluate(async ({ referendumId, casterId }) => {
    const q = new window.Parse.Query('ReferendumBallot');
    q.equalTo('owner', window.Parse.Object.extend('Referendum').createWithoutData(referendumId));
    q.equalTo('caster', window.Parse.User.createWithoutData(casterId));
    const rows = await q.find();
    return rows.map((r) => ({
      id: r.id,
      choice: r.get('choice'),
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null
    }));
  }, { referendumId, casterId });
}

/**
 * Call the exact cloud function `cast_ballot`'s click handler issues, from
 * inside the page. Used only where the UI itself provides no reachable
 * control to attempt the interaction (the recast defect - see the file-level
 * comment and test 46) - not a substitute for a click that exists and was
 * skipped, but the same call the feature would need to make if it existed.
 */
async function voteViaCloudFunction(page, referendumId, optionField) {
  return page.evaluate(async ({ referendumId, optionField }) => {
    try {
      const result = await window.Parse.Cloud.run('vote_for_referendum', {
        referendum_id: referendumId,
        ballot_option: optionField
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  }, { referendumId, optionField });
}

module.exports = {
  FIXTURE_PREFIX,
  PAGE,
  OPTIONS_REGION,
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
};
