/**
 * Task 4 - XP History: Four-Plus Entries, Earned And Spent Recalculation
 *
 * Covers testing_implementation_plan.md items 54-75, driven entirely through the
 * real notations page (`#character/:cid/experience/:start/:changeBy`) and its own
 * Add / Edit / Delete affordances.
 *
 * The suite is `serial` and builds **one** character's history up over the whole
 * file: the fixture seeds four notations, and each test mutates that history and
 * asserts the arithmetic the mutation should have produced. That ordering is the
 * point - a running balance is a chain, and the only way to prove it re-computes
 * is to change a link and watch every later link move by exactly the right amount.
 *
 * A **second**, purchase-only character carries test 73. See the note on that
 * test for why it cannot be the same one.
 *
 * ---
 *
 * ## Why the previous suite's XP tests were meaningless
 *
 * `character-history.spec.js`'s "edit earned" test sets the field to `15` and then
 * asserts `toContainText('15')` against the whole table. A table that renders a
 * date, a reason and two other numbers passes that on almost any input, and it
 * passes in full if `Available` never recalculates at all. There was no
 * spent-value test whatsoever. Every arithmetic item below (61-67) is therefore
 * written as a **delta measured before and after**, never as a substring, and
 * every test re-asserts the *entire* table - all rows, all four fields, every
 * per-row running balance, and the header totals - so a mutation that silently
 * clobbers an unrelated row cannot pass.
 *
 * ---
 *
 * ## Findings confirmed live against this server before any test below was written
 *
 * **1. Each notation renders two `<tr>`s, and the balance a reader sees is in the
 * first of them.** The `experienceNotationsAllView` template emits a *delta row*
 * (mostly empty cells; last data cell = `log.get("earned") - log.get("spent")`,
 * the cumulative balance at that entry) followed by a *value row* carrying the
 * Edit controls and that entry's own `alteration_earned` / `alteration_spent`.
 * `readXpRows` pairs them. Test 57 is about the cumulative number, so it reads
 * `runningAvailable`.
 *
 * **2. DEFECT - the value row's own "Available" cell is permanently blank.** The
 * template asks for `format_entry(log, "available")`, and `available` is neither a
 * column on `ExperienceNotation` nor a property on `CharacterExperienceView`, so
 * the cell renders the column label and nothing else. Measured live: that cell's
 * text is exactly `"Available"`. Test 55 pins it, so a fix trips the test rather
 * than landing unnoticed.
 *
 * **3. New notations are inserted at the top.** Rows sort by `entered`
 * descending (`ExperienceNotationCollection.comparator`), and the Add button
 * stamps `entered: new Date`, so a new row is row 0 - not appended. Addressing a
 * row by a positional guess after an add therefore edits an existing entry
 * instead, which is how a character's original 30 XP creation award gets
 * clobbered. Everything below looks rows up by reason.
 *
 * **4. jQuery Mobile leaves stale popup copies in the DOM.** `enhanceWithin`
 * re-enhances the popup markup on every render and moves each copy into its own
 * `.ui-popup-container` *outside* `div[role=main]`, so the containers survive the
 * next render. A character with four notations carries sixteen elements with
 * `id="alteration-input"`; `page.fill('#alteration-input', ...)` hits a detached
 * one and the edit silently does nothing. `editNotationField` scopes to the
 * visible copy.
 *
 * **5. The page lags the edit, and waiting on the loading overlay does not
 * catch it.** `_propagate_experience_notation_change` raises the overlay
 * synchronously and the `finish_experience_notation_propagation` handler calls
 * `render()` and *then* lowers it, so waiting for the overlay ought to be
 * sufficient. It is not: jQuery Mobile's `.ui-loader` is `position: fixed`, and a
 * fixed-position element reports `offsetParent === null` in Chrome, which is one
 * of the conditions `waitForJqmLoader` treats as "hidden" - so that wait returns
 * immediately, every time, while the propagation is still in flight. Measured
 * live: a `readXpTotals` taken the instant `editNotationField` returned reported
 * the *pre-edit* totals beside *post-edit* row values. Every mutation below is
 * therefore followed by `waitForXp`, which polls until the page's own numbers
 * agree with each other **and** the specific change being waited for is on
 * screen. The generic helper cannot do this itself - only the caller knows which
 * value it is waiting for, and a render that is stale is still internally
 * consistent.
 *
 * **6. DEFECT - re-dating a notation *forwards* double-counts it (test 60b).**
 * The most serious finding here, and it was not on the list this task started
 * from: it surfaced because test 60 asserts the whole table rather than a
 * substring. `Character.on_update_experience_notation` re-sorts the collection,
 * takes the moved notation's **new** index, and passes it to
 * `_propagate_experience_notation_change`, which recomputes `models[0..index]`
 * accumulating from `models[index + 1]`. That window covers the rows a notation
 * passed only when it moves *down* the table (older). Move one *up* (newer) and
 * the rows it passed end up below the new index, outside the window, still
 * holding cumulative totals that include it - and the moved row is then computed
 * on top of one of those, so its earned and spent are counted a second time.
 * Measured live: moving a 4-earned / 3-spent notation up one position took the
 * character from `45 / 6 / 39` to `56 / 11 / 45` when it should not have moved at
 * all. The corruption persists until some later edit happens to re-propagate
 * through the stale row. Test 60 therefore re-dates *backwards* (which the same
 * code path handles correctly, and which item 60 asks for just as well), and test
 * 60b isolates the forwards case as an expected failure - mutating and repairing
 * before its first assertion, so it cannot corrupt the ledger tests 61-75 read.
 *
 * **7. DEFECT - the notations page does not paginate (test 74).** Its route takes
 * `:start/:changeBy` and `CharacterExperienceView.register` accepts both and uses
 * neither; `fetch_experience_notations` sets no `skip`/`limit`, and the `skip`/
 * `limit` lines in `update_collection_query_and_fetch` are commented out, as are
 * the View Previous / View Next buttons in the template. Measured live with 12
 * entries: `/experience/0/10` and `/experience/10/10` both render all 12, so
 * every row appears on both pages. Test 74 is `test.fail()`.
 *
 * **8. DEFECT - no XP notation operation is recorded in the character log (test
 * 75).** `VampireChange` rows are written by `beforeSave`/`beforeDelete` hooks on
 * `SimpleTrait` and by the tracked-text branch of `beforeSave("Vampire")`
 * (cloud/main.js). There is no hook on `ExperienceNotation` at all, and
 * `experience_earned` / `experience_spent` are not in the Vampire hook's
 * `tracked_texts`. Measured live: roughly twenty notation adds, edits and deletes
 * left the character's `VampireChange` count at exactly the five rows its
 * creation had already produced. Test 75 is `test.fail()`. Note that Task 12's
 * items 321, 344 and 364 ("award a 25 XP notation; the log records the
 * transaction") inherit this defect.
 *
 * **9. Overspending is not clamped (test 67).** Measured live: a spent alteration
 * of 500 against a running balance of 41 produced `Available: -449` in the header
 * and negative running balances in the affected rows. That is the correct
 * behaviour for a ledger and is asserted as such.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { navigateToHash, hardReload, normalize } = require('./helpers/jqm-helpers');
const {
  createCompletedCharacter,
  purchaseTrait,
  readSheetXp,
  countCharactersByPrefix,
  destroyCharactersByPrefix
} = require('./helpers/characters');
const {
  PAGE,
  openXp,
  readXpTotals,
  readXpRows,
  addNotation,
  editNotationField,
  deleteNotation,
  seedNotations,
  findNotationIndexByReason,
  DEFAULT_REASON
} = require('./helpers/xp');
const { openLog, readLogRows } = require('./helpers/logs');
const { installPopupTrace, collectTraceConsole, formatTimeline } = require('./helpers/popup-trace');

/**
 * Popup lifecycle tracing, off unless `E2E_POPUP_TRACE=1`.
 *
 * The seeding in `beforeAll` is where this file's long-standing flake fires,
 * and a bare Playwright timeout says nothing about what happened to the popup.
 * Setting the variable records the whole lifecycle - widget events, container
 * class transitions, every removal with the stack that caused it, and every
 * `CharacterExperienceView.render` - and writes it to `tmp-probes/out/`.
 * Diagnostics only: with the variable unset nothing below runs.
 *
 * `E2E_POPUP_TRACE_QUIET=1` keeps the recording but stops it echoing every
 * record to the console. That matters: streaming a few hundred console messages
 * across the CDP connection is itself a delay between the popup opening and the
 * submit click, and it is enough to turn this file's ~50% flake into a
 * reproduction every time. Quiet mode is the one to use when you need a
 * *passing* timeline to diff against.
 */
const POPUP_TRACE = process.env.E2E_POPUP_TRACE === '1';
const POPUP_TRACE_QUIET = process.env.E2E_POPUP_TRACE_QUIET === '1';
let popupTraceRecords = null;

/** Every character this file creates is named with this prefix, so teardown is a query. */
const FIXTURE_PREFIX = 'E2E T4 ';

/** The reason `Vampire.create` gives the 30 XP award every new character starts with. */
const CREATION_REASON = 'Character Creation XP';

/**
 * The three seeded notations. Their earned values, spent values, dates and
 * reasons are all distinct from each other and from the creation award (item
 * 54), and - deliberately - so are their *net* contributions (5, 1, 3), because
 * test 60 re-orders two rows and a re-order is only observable when the rows
 * being swapped contribute different amounts.
 */
const SEED = [
  { reason: `${FIXTURE_PREFIX}Session One`, earned: 6, spent: 1, date: '01/02/2020 12:00:00 PM' },
  { reason: `${FIXTURE_PREFIX}Session Two`, earned: 4, spent: 3, date: '01/03/2020 12:00:00 PM' },
  { reason: `${FIXTURE_PREFIX}Session Three`, earned: 5, spent: 2, date: '01/04/2020 12:00:00 PM' }
];

/** The creation award is backdated below everything else so the history reads oldest-last. */
const CREATION_DATE = '01/01/2020 12:00:00 PM';

/**
 * Dates are rendered by moment as `L LTS`; these are the exact strings that come
 * back, so an edit can be waited for by comparing against what was submitted.
 */
const DATE_RESORTED_OLDER = '01/01/2020 6:00:00 PM';
const DATE_RESORTED_NEWER = '01/05/2020 12:00:00 PM';
const DATE_BACKDATED = '12/31/2019 9:00:00 AM';

const R = {
  creation: CREATION_REASON,
  one: SEED[0].reason,
  two: SEED[1].reason,
  three: SEED[2].reason,
  threeRenamed: `${FIXTURE_PREFIX}Session Three (renamed)`,
  four: `${FIXTURE_PREFIX}Session Four`,
  backdated: `${FIXTURE_PREFIX}Backdated Award`,
  logProbe: `${FIXTURE_PREFIX}Log Probe`
};

// ---------------------------------------------------------------------------
// Expectation model
//
// `state.expected` is the whole table as it should be, top row first. Every test
// mutates it and then re-asserts the entire thing, so an edit that silently
// damages an unrelated row (the creation award, most importantly) fails here
// rather than surviving to the end of the file.
// ---------------------------------------------------------------------------

/** Running balance per row: row i is the cumulative net of rows i..end (oldest last). */
function expectedRunning(rows) {
  const out = new Array(rows.length);
  let acc = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    acc += rows[i].earned - rows[i].spent;
    out[i] = acc;
  }
  return out;
}

/** Header totals: the column sums, with Available derived from the other two. */
function expectedTotals(rows) {
  const earned = rows.reduce((a, r) => a + r.earned, 0);
  const spent = rows.reduce((a, r) => a + r.spent, 0);
  return { earned, spent, available: earned - spent };
}

/** Read the page as `{ rows, totals }` without waiting for anything. */
async function readXpState(page) {
  const rows = await readXpRows(page);
  const totals = await readXpTotals(page);
  return { rows, totals };
}

/**
 * Is this render finished and self-consistent?
 *
 * Returns a description of the problem, or null when the page is settled. Two
 * conditions, both of which hold of every completed render and neither of which
 * holds mid-propagation:
 *
 *  - the header's own three numbers agree (`Available = Earned - Spent`);
 *  - the header's Available equals the top row's running balance, which it must,
 *    since `_propagate_experience_notation_change` assigns the character's
 *    totals from the newest notation it just recomputed.
 */
function renderProblem({ rows, totals }) {
  if (!totals) return 'the Earned/Spent/Available paragraphs are missing';
  if (totals.earned === null || totals.spent === null || totals.available === null) {
    return `header totals unreadable: ${JSON.stringify(totals)}`;
  }
  if (totals.earned - totals.spent !== totals.available) {
    return `header Available ${totals.available} != Earned ${totals.earned} - Spent ${totals.spent}`;
  }
  if (rows.length === 0) return 'no notation rows rendered';
  if (rows[0].runningAvailable !== totals.available) {
    return `top row running balance ${rows[0].runningAvailable} != header Available ${totals.available}`;
  }
  return null;
}

/**
 * Poll until the page has re-rendered with `predicate` satisfied.
 *
 * `predicate` returns a string describing what is still wrong, or null when it is
 * satisfied - so a timeout reports the actual state rather than "waitForFunction
 * timed out". See file-level finding 5 for why polling is necessary at all.
 */
async function waitForXp(page, description, predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last = null;
  let problem = 'the page was never read';

  while (Date.now() < deadline) {
    last = await readXpState(page);
    problem = renderProblem(last) || (predicate ? predicate(last) : null);
    if (!problem) return last;
    await page.waitForTimeout(150);
  }

  throw new Error(
    `the notations page never settled while waiting for ${description}: ${problem}. ` +
    `Last state: ${JSON.stringify(last)}`
  );
}

/** Predicate factory: the notation with this reason shows this field value. */
function rowShows(reason, field, value) {
  return ({ rows }) => {
    const row = rows.find((r) => r.reason === reason);
    if (!row) return `no row with reason "${reason}" (present: ${rows.map((r) => r.reason).join(' | ')})`;
    if (row[field] !== value) return `"${reason}" shows ${field}=${JSON.stringify(row[field])}, expected ${JSON.stringify(value)}`;
    return null;
  };
}

/** Predicate factory: exactly this many notations are rendered. */
function rowCountIs(count) {
  return ({ rows }) => (rows.length === count ? null : `${rows.length} rows rendered, expected ${count}`);
}

/** Edit one field of the notation carrying `reason`, then wait for it to land. */
async function editByReason(page, reason, field, value) {
  const index = await findNotationIndexByReason(page, reason);
  if (index < 0) {
    const rows = await readXpRows(page);
    throw new Error(`no notation with reason "${reason}"; present: ${rows.map((r) => r.reason).join(' | ')}`);
  }
  await editNotationField(page, index, field, value);
  return waitForXp(page, `${field} of "${reason}" to become ${value}`, rowShows(reason, field, value));
}

/**
 * Rename a notation, then wait for the new reason to appear.
 *
 * Counted rather than tested for presence, because the placeholder reason
 * ("Unspecified reason") is shared by every freshly added row: after test 71
 * there are several of them at once, so "the old reason is gone" is never true
 * and would hang.
 */
async function renameByReason(page, oldReason, newReason) {
  const rowsBefore = await readXpRows(page);
  const index = rowsBefore.findIndex((r) => r.reason === oldReason);
  if (index < 0) {
    throw new Error(`no notation with reason "${oldReason}"; present: ${rowsBefore.map((r) => r.reason).join(' | ')}`);
  }
  const oldCount = rowsBefore.filter((r) => r.reason === oldReason).length;
  const newCount = rowsBefore.filter((r) => r.reason === newReason).length;

  await editNotationField(page, index, 'reason', newReason);
  return waitForXp(page, `"${oldReason}" to be renamed "${newReason}"`, ({ rows }) => {
    const nowNew = rows.filter((r) => r.reason === newReason).length;
    const nowOld = rows.filter((r) => r.reason === oldReason).length;
    if (nowNew !== newCount + 1) return `${nowNew} rows named "${newReason}", expected ${newCount + 1}`;
    if (nowOld !== oldCount - 1) return `${nowOld} rows named "${oldReason}", expected ${oldCount - 1}`;
    return null;
  });
}

/**
 * Parse a rendered `L LTS` timestamp ("01/05/2020 12:00:00 PM").
 *
 * Done by hand rather than through `Date.parse`, which is only specified for ISO
 * strings and treats a 12-hour clock as implementation-defined.
 */
function parseRenderedDate(text) {
  const m = String(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP])M$/);
  if (!m) throw new Error(`"${text}" is not a rendered L LTS timestamp`);
  const hour = (parseInt(m[4], 10) % 12) + (m[7] === 'P' ? 12 : 0);
  return Date.UTC(+m[3], +m[1] - 1, +m[2], hour, +m[5], +m[6]);
}

/** Assertion-side read-back of what the server actually holds. */
async function storedNotations(page, characterId) {
  return page.evaluate((id) => {
    return new window.Parse.Query('Vampire').get(id).then((c) => {
      const q = new window.Parse.Query('ExperienceNotation');
      q.equalTo('owner', c);
      q.addDescending('entered').addDescending('createdAt');
      q.limit(1000);
      return q.find().then((rows) => ({
        character: {
          earned: c.get('experience_earned'),
          spent: c.get('experience_spent')
        },
        notations: rows.map((r) => ({
          reason: r.get('reason'),
          entered: r.get('entered') ? r.get('entered').toISOString() : null,
          alterationEarned: r.get('alteration_earned'),
          alterationSpent: r.get('alteration_spent'),
          earned: r.get('earned'),
          spent: r.get('spent')
        }))
      }));
    });
  }, characterId);
}

/** How many audit-log rows the character carries right now. */
async function countChangeRows(page, characterId) {
  return page.evaluate((id) => {
    return new window.Parse.Query('Vampire').get(id).then((c) => {
      const q = new window.Parse.Query('VampireChange');
      q.equalTo('owner', c);
      return q.count();
    });
  }, characterId);
}

test.describe.configure({ mode: 'serial' });

test.describe('Task 4 - XP History', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  const state = {
    /** The whole table as it should currently render, top row first. */
    expected: []
  };

  /**
   * Assert the *entire* rendered table against `state.expected`: every row's
   * reason, earned, spent and (where pinned) date, every per-row running
   * balance, and the header totals.
   */
  function assertTable(actual, label) {
    const expected = state.expected;

    expect(
      actual.rows.map((r) => ({ reason: r.reason, earned: r.earned, spent: r.spent })),
      `${label}: rows, newest first`
    ).toEqual(expected.map((r) => ({ reason: r.reason, earned: r.earned, spent: r.spent })));

    expected.forEach((r, i) => {
      if (r.date) {
        expect(actual.rows[i].date, `${label}: date of row ${i} ("${r.reason}")`).toBe(r.date);
      } else {
        expect(actual.rows[i].date, `${label}: date of row ${i} ("${r.reason}")`)
          .toMatch(/^\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2}:\d{2} [AP]M$/);
      }
    });

    expect(
      actual.rows.map((r) => r.runningAvailable),
      `${label}: per-row running Available`
    ).toEqual(expectedRunning(expected));

    expect(actual.totals, `${label}: header Earned / Spent / Available`).toEqual(expectedTotals(expected));
  }

  /** The row object inside `state.expected` carrying this reason. */
  function expectedRow(reason) {
    const row = state.expected.find((r) => r.reason === reason);
    if (!row) throw new Error(`the expectation holds no row named "${reason}"`);
    return row;
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600000);
    page = await browser.newPage();
    if (POPUP_TRACE) {
      popupTraceRecords = POPUP_TRACE_QUIET ? [] : collectTraceConsole(page);
      await installPopupTrace(page, { console: !POPUP_TRACE_QUIET });
    }
    await loginAsAdmin(page);

    // Self-heal first: sweep anything a crashed earlier run left behind, keyed by
    // the name prefix rather than by ids this run has never seen, so the baseline
    // measured immediately afterwards is trustworthy on a repeat run.
    const swept = await destroyCharactersByPrefix(page, FIXTURE_PREFIX);

    state.baseline = {
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX)
    };
    console.log('[e2e xp-history] self-heal swept:', JSON.stringify(swept));
    console.log('[e2e xp-history] baseline Vampire row counts:', JSON.stringify(state.baseline));

    // The character under test. Creation pools are left unspent deliberately -
    // they cost nothing either way, and every pick would add trait-driven
    // notations ("Update Athletics to 2") to the very history these tests count.
    const character = await createCompletedCharacter(page, 'Vampire', {
      name: `${FIXTURE_PREFIX}History ${Date.now().toString(36)}`,
      spendPools: false
    });
    state.characterId = character.id;
    state.characterName = character.name;
    expect(character.xp, 'a freshly completed Vampire starts at 30/0/30').toEqual({
      earned: 30, spent: 0, available: 30
    });

    // One notation exists already: the 30 XP creation award (`Vampire.create`).
    await openXp(page, state.characterId);
    const initial = await readXpRows(page);
    expect(initial.map((r) => r.reason), 'a new character carries exactly the creation award').toEqual([CREATION_REASON]);

    // Three more, built the way a player builds them - add a row, then edit its
    // fields. `seedNotations` locates each new row by its placeholder reason
    // rather than by position, because new rows land on top (finding 3).
    await seedNotations(page, state.characterId, SEED.map((s) => ({
      reason: s.reason, earned: s.earned, spent: s.spent
    })));

    // Give all four distinct, deterministic dates so ordering is fixed rather
    // than a function of how fast the seeding ran (the three adds above can land
    // inside the same second, which would make the "four distinct dates" of item
    // 54 an accident of timing). The creation award goes first, so the history
    // reads oldest-last the way a real one does.
    await editByReason(page, CREATION_REASON, 'date', CREATION_DATE);
    for (const seed of SEED) {
      await editByReason(page, seed.reason, 'date', seed.date);
    }

    state.expected = [
      { reason: R.three, date: SEED[2].date, earned: SEED[2].earned, spent: SEED[2].spent },
      { reason: R.two, date: SEED[1].date, earned: SEED[1].earned, spent: SEED[1].spent },
      { reason: R.one, date: SEED[0].date, earned: SEED[0].earned, spent: SEED[0].spent },
      { reason: R.creation, date: CREATION_DATE, earned: 30, spent: 0 }
    ];

    // The second character for test 73. Everything it spends, it spends through
    // the trait editor, which is what makes the costs view reconcilable at all.
    state.costsCharacter = await createCompletedCharacter(page, 'Vampire', {
      name: `${FIXTURE_PREFIX}Costs ${Date.now().toString(36)}`,
      texts: { clan: 'Brujah' },
      spendPools: false
    });
    await purchaseTrait(page, state.costsCharacter.id, 'skills', 'Athletics', { value: 2 });
    await purchaseTrait(page, state.costsCharacter.id, 'disciplines', 'Celerity', { value: 1 });

    await openXp(page, state.characterId);
  });

  test.afterAll(async () => {
    if (!page) return;

    if (POPUP_TRACE && popupTraceRecords) {
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(__dirname, '..', 'tmp-probes', 'out');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshot = await page.evaluate(() => window.__popupTrace.snapshot()).catch(() => null);
      // The in-page buffer is the complete record; the console stream is only a
      // live echo of it. Prefer whichever is longer so quiet mode still writes.
      const inPage = await page.evaluate(() => window.__popupTrace.dump()).catch(() => []);
      const records = inPage.length >= popupTraceRecords.length ? inPage : popupTraceRecords;
      fs.writeFileSync(path.join(dir, `spec-${stamp}.json`),
        JSON.stringify({ snapshot, records }, null, 1));
      fs.writeFileSync(path.join(dir, `spec-${stamp}.txt`),
        `snapshot: ${JSON.stringify(snapshot)}

${formatTimeline(records)}
`);
      console.log(`[e2e xp-history] popup trace: ${records.length} records -> tmp-probes/out/spec-${stamp}.txt`);
    }

    const destroyed = await destroyCharactersByPrefix(page, FIXTURE_PREFIX)
      .catch((e) => ({ characters: 0, children: 0, errors: [String(e)] }));
    console.log('[e2e xp-history] destroyed in teardown:', JSON.stringify(destroyed));

    const final = {
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX).catch(() => -1)
    };
    console.log(
      '[e2e xp-history] final Vampire row counts (should equal baseline ' +
      JSON.stringify(state.baseline) + '):', JSON.stringify(final)
    );

    await page.close();
  });

  // -------------------------------------------------------------------------
  // 54-57 - the fixture, and what the four rows say
  // -------------------------------------------------------------------------

  test('54 The character has exactly four XP notations with four distinct dates and reasons', async () => {
    await openXp(page, state.characterId);
    const actual = await waitForXp(page, 'the seeded fixture', rowCountIs(4));
    assertTable(actual, '54 fixture');

    expect(new Set(actual.rows.map((r) => r.reason)).size, 'four distinct reasons').toBe(4);
    expect(new Set(actual.rows.map((r) => r.date)).size, 'four distinct dates').toBe(4);
    expect(new Set(actual.rows.map((r) => r.earned)).size, 'four distinct earned values').toBe(4);
    expect(new Set(actual.rows.map((r) => r.spent)).size, 'four distinct spent values').toBe(4);

    // Read back what the server holds, not merely what the page drew.
    const stored = await storedNotations(page, state.characterId);
    expect(stored.notations, 'four ExperienceNotation rows on the server').toHaveLength(4);
    expect(stored.notations.map((n) => n.reason)).toEqual(state.expected.map((r) => r.reason));
    expect(stored.notations.map((n) => n.alterationEarned)).toEqual(state.expected.map((r) => r.earned));
    expect(stored.notations.map((n) => n.alterationSpent)).toEqual(state.expected.map((r) => r.spent));
    expect(stored.character).toEqual({ earned: 45, spent: 6 });
    // Stored `entered` values are strictly descending, which is the ordering the
    // whole page depends on.
    const entered = stored.notations.map((n) => Date.parse(n.entered));
    for (let i = 1; i < entered.length; i++) {
      expect(entered[i - 1], `row ${i - 1} is newer than row ${i}`).toBeGreaterThan(entered[i]);
    }
  });

  test('55 The experience page renders exactly four rows with Date, Reason, Earned, Spent and Available columns', async () => {
    await openXp(page, state.characterId, 0, 10);

    const headers = await page.evaluate((sel) => {
      const pg = document.querySelector(sel);
      return Array.from(pg.querySelectorAll('table thead th'))
        .map((th) => th.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    }, PAGE);
    expect(headers, 'the five column labels, in order').toEqual(['Date', 'Reason', 'Earned?', 'Spent?', 'Available']);

    // Two `<tr>` per notation - a delta row then a value row (finding 1).
    const trCount = await page.locator(`${PAGE} table tbody tr`).count();
    expect(trCount, 'eight <tr> for four notations').toBe(8);

    const actual = await waitForXp(page, 'the four seeded rows', rowCountIs(4));
    assertTable(actual, '55 four rows');

    // FIXED by remediation R50. The value row's Available cell was permanently
    // blank, because the template asked `format_entry(log, "available")` for a
    // property that exists on neither the model nor the view - a column headed
    // "Available" with nothing under it. It now carries the same running
    // balance the delta row does. jQuery Mobile's responsive table prepends the
    // column label to every cell, which is why each reads "Available <n>"
    // rather than a bare number.
    const valueRowAvailableCells = await page.evaluate((sel) => {
      const pg = document.querySelector(sel);
      const rows = Array.from(pg.querySelectorAll('table tbody tr'));
      const out = [];
      for (let i = 1; i < rows.length; i += 2) {
        const cells = Array.from(rows[i].querySelectorAll('td'));
        out.push(cells[9] ? cells[9].textContent.replace(/\s+/g, ' ').trim() : null);
      }
      return out;
    }, PAGE);
    expect(
      valueRowAvailableCells,
      'the per-entry Available cell shows that row\'s running balance'
    ).toEqual(actual.rows.map((r) => `Available ${r.runningAvailable}`));
  });

  test('56 The header totals equal the column sums of the four rows', async () => {
    const actual = await waitForXp(page, 'the four seeded rows', rowCountIs(4));

    const sumEarned = actual.rows.reduce((a, r) => a + r.earned, 0);
    const sumSpent = actual.rows.reduce((a, r) => a + r.spent, 0);

    expect(actual.totals.earned, 'Earned equals the sum of the Earned column').toBe(sumEarned);
    expect(actual.totals.spent, 'Spent equals the sum of the Spent column').toBe(sumSpent);
    expect(actual.totals.available, 'Available equals Earned minus Spent').toBe(sumEarned - sumSpent);
    expect(actual.totals).toEqual({ earned: 45, spent: 6, available: 39 });

    // And the same three numbers on the server, so this is not a rendering
    // coincidence: the character row carries the newest notation's cumulative
    // totals (`_propagate_experience_notation_change`).
    const stored = await storedNotations(page, state.characterId);
    expect(stored.character).toEqual({ earned: sumEarned, spent: sumSpent });
    expect(stored.notations[0].earned - stored.notations[0].spent).toBe(actual.totals.available);
  });

  test('57 The per-row running Available equals cumulative earned-minus-spent at every one of the four rows', async () => {
    const actual = await waitForXp(page, 'the four seeded rows', rowCountIs(4));

    // Computed from the rows themselves, oldest first, so the expectation is
    // derived from the page's own per-entry values rather than restated.
    const cumulative = [];
    let acc = 0;
    for (let i = actual.rows.length - 1; i >= 0; i--) {
      acc += actual.rows[i].earned - actual.rows[i].spent;
      cumulative[i] = acc;
    }
    expect(actual.rows.map((r) => r.runningAvailable), 'running balance at every row').toEqual(cumulative);
    expect(cumulative, 'the fixture history, oldest last').toEqual([39, 36, 35, 30]);

    // The newest row's running balance is the character's Available, by
    // construction, and every row's balance is its own net plus the row below it.
    expect(actual.rows[0].runningAvailable).toBe(actual.totals.available);
    for (let i = 0; i < actual.rows.length - 1; i++) {
      expect(
        actual.rows[i].runningAvailable - actual.rows[i + 1].runningAvailable,
        `row ${i} ("${actual.rows[i].reason}") adds exactly its own net to the row below`
      ).toBe(actual.rows[i].earned - actual.rows[i].spent);
    }

    // The oldest row's balance is just its own net - nothing precedes it.
    const oldest = actual.rows[actual.rows.length - 1];
    expect(oldest.runningAvailable).toBe(oldest.earned - oldest.spent);
  });

  // -------------------------------------------------------------------------
  // 58-60 - adding, renaming, re-dating
  // -------------------------------------------------------------------------

  test('58 Add a fifth notation; the table shows five rows and the totals update by the added amounts', async () => {
    const before = await waitForXp(page, 'the four seeded rows', rowCountIs(4));

    const count = await addNotation(page);
    expect(count, 'five notations after the Add button').toBe(5);

    // A fresh notation carries zero alterations, so the totals must not move yet.
    // Stated explicitly rather than skipped: "the totals update by the added
    // amounts" is only meaningful if adding *nothing* changes nothing.
    const afterAdd = await waitForXp(page, 'the added row', ({ rows }) => {
      if (rows.length !== 5) return `${rows.length} rows, expected 5`;
      if (rows[0].reason !== DEFAULT_REASON) return `top row is "${rows[0].reason}", expected the placeholder`;
      return null;
    });
    expect(afterAdd.rows[0], 'the new row lands on top with zero alterations').toMatchObject({
      reason: DEFAULT_REASON, earned: 0, spent: 0
    });
    expect(afterAdd.totals, 'an empty notation moves no total').toEqual(before.totals);
    expect(
      afterAdd.rows.slice(1).map((r) => r.runningAvailable),
      'the existing rows keep their running balances'
    ).toEqual(before.rows.map((r) => r.runningAvailable));

    // Now give it real amounts and measure the deltas.
    const ADDED = { earned: 7, spent: 2 };
    await renameByReason(page, DEFAULT_REASON, R.four);
    await editByReason(page, R.four, 'earned', ADDED.earned);
    const after = await editByReason(page, R.four, 'spent', ADDED.spent);

    expect(after.totals.earned - before.totals.earned, 'Earned rises by exactly the added earned').toBe(ADDED.earned);
    expect(after.totals.spent - before.totals.spent, 'Spent rises by exactly the added spent').toBe(ADDED.spent);
    expect(after.totals.available - before.totals.available, 'Available rises by exactly the net').toBe(ADDED.earned - ADDED.spent);

    state.expected.unshift({ reason: R.four, date: null, earned: ADDED.earned, spent: ADDED.spent });
    assertTable(after, '58 five rows');
  });

  test('59 Edit the Reason on row 2; the new reason persists in the table after a reload', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    // Row 2 of the table, one-based: index 1.
    expect(before.rows[1].reason, 'row 2 before the rename').toBe(R.three);

    const renamed = await renameByReason(page, R.three, R.threeRenamed);
    expect(renamed.rows[1].reason, 'row 2 after the rename').toBe(R.threeRenamed);
    expect(renamed.totals, 'a reason carries no arithmetic').toEqual(before.totals);

    expectedRow(R.three).reason = R.threeRenamed;
    assertTable(renamed, '59 after rename');

    // Reload the whole application, so nothing below is read out of the
    // in-memory collection the edit went through.
    await hardReload(page);
    await openXp(page, state.characterId);
    const reloaded = await waitForXp(page, 'the reloaded table', rowCountIs(5));
    assertTable(reloaded, '59 after reload');
    expect(reloaded.rows[1].reason, 'the rename survived the reload').toBe(R.threeRenamed);

    const stored = await storedNotations(page, state.characterId);
    expect(stored.notations.map((n) => n.reason)).toEqual(state.expected.map((r) => r.reason));
  });

  test('60 Edit the Date on row 3; the row re-sorts to the correct chronological position', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    expect(before.rows[2].reason, 'row 3 before the date edit').toBe(R.two);
    expect(before.rows[2].date).toBe(SEED[1].date);

    // Backwards, deliberately: 01/01 18:00 is older than row 4's 01/02 but newer
    // than row 5's 01/01 12:00, so the row must move *down* exactly one position.
    // Re-dating a row *forwards* re-sorts it correctly too but corrupts every
    // balance it passes - that is a real defect, and test 60b isolates it rather
    // than letting it wreck the ledger tests 61-75 depend on.
    const after = await editByReason(page, R.two, 'date', DATE_RESORTED_OLDER);

    expect(after.rows.map((r) => r.reason), 'the new row order').toEqual([
      R.four, R.threeRenamed, R.one, R.two, R.creation
    ]);
    const dates = after.rows.map((r) => parseRenderedDate(r.date));
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1], 'rows stay in descending date order').toBeGreaterThan(dates[i]);
    }

    // Re-ordering moves no money, but it does move the balances: the two swapped
    // rows contribute different nets, so each one's running balance changes even
    // though the totals do not. The two nets are read off the rows themselves
    // rather than restated, so this stays true if the fixture values change.
    expect(after.totals, 'a re-sort changes no total').toEqual(before.totals);

    const movedNet = before.rows[2].earned - before.rows[2].spent;      // the row that moved down
    const passedNet = before.rows[3].earned - before.rows[3].spent;     // the row it moved past
    expect(movedNet, 'the two swapped rows must differ, or this proves nothing').not.toBe(passedNet);

    const runningBefore = Object.fromEntries(before.rows.map((r) => [r.reason, r.runningAvailable]));
    const runningAfter = Object.fromEntries(after.rows.map((r) => [r.reason, r.runningAvailable]));
    expect(runningAfter[R.two], 'the moved row loses the net of the row it passed').toBe(runningBefore[R.two] - passedNet);
    expect(runningAfter[R.one], 'the passed row gains the moved row\'s net').toBe(runningBefore[R.one] + movedNet);
    expect(runningAfter[R.four], 'rows above both are unaffected').toBe(runningBefore[R.four]);
    expect(runningAfter[R.threeRenamed], 'rows above both are unaffected').toBe(runningBefore[R.threeRenamed]);
    expect(runningAfter[R.creation], 'the creation award is unaffected').toBe(runningBefore[R.creation]);

    const two = expectedRow(R.two);
    two.date = DATE_RESORTED_OLDER;
    state.expected = [
      expectedRow(R.four),
      expectedRow(R.threeRenamed),
      expectedRow(R.one),
      two,
      expectedRow(R.creation)
    ];
    assertTable(after, '60 after re-sort');
  });

  test('60b Re-dating a notation forwards must not double-count it (defect found while implementing 60)', async () => {
    // FIXED by remediation R17.
    //
    // Was: `Character.on_update_experience_notation` re-sorted the
    // collection, took the moved notation's *new* index, and handed it to
    // `_propagate_experience_notation_change`, which recomputes
    // `models[0..index]` accumulating from `models[index + 1]`. That window is
    // correct only when a row moves *down*: the rows it passed then lie inside
    // [0..index] and get recomputed. When a row moves *up* the rows it passed end
    // up *below* the new index, outside the window, still holding cumulative
    // totals that include the moved row - and the moved row is then computed on
    // top of one of them, so its earned and spent are counted twice. Measured
    // live: moving a 4-earned / 3-spent notation up one position took Earned from
    // 52 to 56 and Spent from 8 to 11.
    //
    // Now: the handler captures the row's index *before* the re-sort and
    // widens the propagation window to the further of the two positions, so
    // every row between them is recomputed whichever way the row moved.
    //
    // Everything is mutated and repaired *before* the first assertion, so this
    // test leaves the ledger exactly as it found it however it ends. The repair
    // is a downward move, which the same code path handles correctly - asserted
    // below, since a repair that did not work would invalidate every later test.
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    expect(before.rows[3].reason, 'the row about to move').toBe(R.two);

    const moved = await editByReason(page, R.two, 'date', DATE_RESORTED_NEWER);
    const repaired = await editByReason(page, R.two, 'date', DATE_RESORTED_OLDER);

    // The repair worked: a downward re-date recomputes every row above it.
    expect(repaired.rows.map((r) => r.reason), 'the ledger is back in its pre-test order').toEqual(
      before.rows.map((r) => r.reason)
    );
    expect(repaired.totals, 'the ledger is back to its pre-test totals').toEqual(before.totals);
    expect(repaired.rows.map((r) => r.runningAvailable), 'and to its pre-test balances').toEqual(
      before.rows.map((r) => r.runningAvailable)
    );

    // What the forwards move should have produced. Moving a row changes where its
    // own contribution lands in the chain; it never changes the column sums.
    expect(moved.rows.map((r) => r.reason), 'it did re-sort to the right position').toEqual([
      R.four, R.two, R.threeRenamed, R.one, R.creation
    ]);
    const movedNet = before.rows[3].earned - before.rows[3].spent;
    expect(moved.totals, 'a forwards re-sort must change no total').toEqual(before.totals);
    expect(
      moved.rows.find((r) => r.reason === R.threeRenamed).runningAvailable,
      'the passed row must drop the moved row\'s net'
    ).toBe(before.rows.find((r) => r.reason === R.threeRenamed).runningAvailable - movedNet);
  });

  // -------------------------------------------------------------------------
  // 61-67 - the arithmetic, measured as deltas
  // -------------------------------------------------------------------------

  test('61 Edit Earned on row 2 upward by 20; Available increases by exactly 20 and Earned by exactly 20', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    // Row 2 of the table, one-based. Test 60 re-ordered the history, so this is
    // asserted rather than assumed - addressing a row by a stale positional guess
    // is exactly the mistake that clobbers the creation award.
    expect(before.rows[1].reason, 'row 2').toBe(R.threeRenamed);
    const row = before.rows[1];

    const after = await editByReason(page, R.threeRenamed, 'earned', row.earned + 20);

    expect(after.totals.available - before.totals.available, 'Available rises by exactly 20').toBe(20);
    expect(after.totals.earned - before.totals.earned, 'Earned rises by exactly 20').toBe(20);
    expect(after.totals.spent - before.totals.spent, 'Spent is untouched').toBe(0);

    // The edited row and every row above it move by 20; nothing below moves.
    const runningBefore = before.rows.map((r) => r.runningAvailable);
    const runningAfter = after.rows.map((r) => r.runningAvailable);
    expect(runningAfter.slice(0, 2).map((v, i) => v - runningBefore[i]), 'the edited row and the row above it').toEqual([20, 20]);
    expect(runningAfter.slice(2), 'every older row is untouched').toEqual(runningBefore.slice(2));

    expectedRow(R.threeRenamed).earned = row.earned + 20;
    assertTable(after, '61 earned +20');

    const stored = await storedNotations(page, state.characterId);
    expect(stored.character.earned, 'the server agrees').toBe(after.totals.earned);
    expect(stored.character.earned - stored.character.spent).toBe(after.totals.available);
  });

  test('62 Edit Earned on row 2 downward by 15; Available decreases by exactly 15', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    const row = before.rows[1];
    expect(row.reason, 'row 2').toBe(R.threeRenamed);
    expect(row.earned, 'test 61 left it at 25').toBe(25);

    const after = await editByReason(page, R.threeRenamed, 'earned', row.earned - 15);

    expect(after.totals.available - before.totals.available, 'Available falls by exactly 15').toBe(-15);
    expect(after.totals.earned - before.totals.earned, 'Earned falls by exactly 15').toBe(-15);
    expect(after.totals.spent - before.totals.spent, 'Spent is untouched').toBe(0);
    expect(after.rows[1].runningAvailable - before.rows[1].runningAvailable, 'the edited row falls by 15').toBe(-15);
    expect(
      after.rows.slice(2).map((r) => r.runningAvailable),
      'every older row is untouched'
    ).toEqual(before.rows.slice(2).map((r) => r.runningAvailable));

    expectedRow(R.threeRenamed).earned = row.earned - 15;
    assertTable(after, '62 earned -15');
  });

  test('63 Set Earned on row 2 to 0; Available decreases by exactly that row\'s prior earned value', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    const row = before.rows[1];
    expect(row.reason, 'row 2').toBe(R.threeRenamed);
    const priorEarned = row.earned;
    expect(priorEarned, 'test 62 left it at 10').toBe(10);

    const after = await editByReason(page, R.threeRenamed, 'earned', 0);

    expect(after.totals.available - before.totals.available, 'Available falls by exactly the prior earned').toBe(-priorEarned);
    expect(after.totals.earned - before.totals.earned, 'Earned falls by exactly the prior earned').toBe(-priorEarned);
    expect(after.rows[1].earned, 'the row now earns nothing').toBe(0);
    // The row still exists and still carries its spent value - zeroing earned is
    // not the same as deleting the entry.
    expect(after.rows[1].spent, 'its spent value is untouched').toBe(row.spent);
    expect(after.rows).toHaveLength(5);

    expectedRow(R.threeRenamed).earned = 0;
    assertTable(after, '63 earned = 0');
  });

  test('64 Edit Spent on row 3 upward by 10; Available decreases by exactly 10 and Spent increases by exactly 10', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    const row = before.rows[2];
    expect(row.reason, 'row 3').toBe(R.one);

    state.preSpentEdit = { totals: before.totals, spent: row.spent };

    const after = await editByReason(page, R.one, 'spent', row.spent + 10);

    expect(after.totals.available - before.totals.available, 'Available falls by exactly 10').toBe(-10);
    expect(after.totals.spent - before.totals.spent, 'Spent rises by exactly 10').toBe(10);
    expect(after.totals.earned - before.totals.earned, 'Earned is untouched').toBe(0);

    // The edited row and the two above it fall by 10; the two below do not move.
    const deltas = after.rows.map((r, i) => r.runningAvailable - before.rows[i].runningAvailable);
    expect(deltas, 'only the edited row and its successors move').toEqual([-10, -10, -10, 0, 0]);

    expectedRow(R.one).spent = row.spent + 10;
    assertTable(after, '64 spent +10');
  });

  test('65 Reset Spent on row 3 to 0; Available returns to exactly its pre-edit balance', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    const row = before.rows[2];
    expect(row.reason, 'row 3').toBe(R.one);
    expect(row.spent, 'test 64 left it at 11').toBe(11);

    const zeroed = await editByReason(page, R.one, 'spent', 0);

    // Zeroing gives back the whole 11 the row was charging.
    expect(zeroed.totals.available - before.totals.available, 'Available rises by exactly the spent it dropped').toBe(row.spent);
    expect(zeroed.totals.spent - before.totals.spent, 'Spent falls by exactly the same').toBe(-row.spent);
    expect(zeroed.totals.earned, 'Earned is untouched').toBe(before.totals.earned);

    // This row's spent was 1 before test 64 touched it, not 0 - item 54 requires
    // four distinct spent values and 0 is the creation award's - so "returns to
    // its pre-edit balance" is asserted in both halves: zeroing lands exactly
    // that 1 above the balance test 64 started from, and putting the 1 back lands
    // exactly on it.
    const pre = state.preSpentEdit;
    expect(zeroed.totals.available, 'zeroed balance = pre-edit balance + the row\'s original spent')
      .toBe(pre.totals.available + pre.spent);

    expectedRow(R.one).spent = 0;
    assertTable(zeroed, '65 spent = 0');

    const restored = await editByReason(page, R.one, 'spent', pre.spent);
    expect(restored.totals, 'the round trip 1 -> 11 -> 0 -> 1 returns every total exactly').toEqual(pre.totals);

    expectedRow(R.one).spent = pre.spent;
    assertTable(restored, '65 spent restored');
  });

  test('66 Edit both Earned and Spent on the same row; Available reflects the net of both deltas', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    const row = before.rows[3];
    expect(row.reason, 'row 4').toBe(R.two);

    const EARNED_DELTA = 10;
    const SPENT_DELTA = 4;

    const afterEarned = await editByReason(page, R.two, 'earned', row.earned + EARNED_DELTA);
    expect(afterEarned.totals.available - before.totals.available, 'the earned half alone').toBe(EARNED_DELTA);

    const after = await editByReason(page, R.two, 'spent', row.spent + SPENT_DELTA);
    expect(after.totals.available - afterEarned.totals.available, 'the spent half alone').toBe(-SPENT_DELTA);

    // The point of the item: the net across both edits, on one row.
    expect(after.totals.available - before.totals.available, 'Available reflects the net of both deltas')
      .toBe(EARNED_DELTA - SPENT_DELTA);
    expect(after.totals.earned - before.totals.earned).toBe(EARNED_DELTA);
    expect(after.totals.spent - before.totals.spent).toBe(SPENT_DELTA);
    expect(
      after.rows[3].runningAvailable - before.rows[3].runningAvailable,
      'the row\'s own running balance moves by the same net'
    ).toBe(EARNED_DELTA - SPENT_DELTA);

    const edited = expectedRow(R.two);
    edited.earned = row.earned + EARNED_DELTA;
    edited.spent = row.spent + SPENT_DELTA;
    assertTable(after, '66 earned and spent on one row');
  });

  test('67 Set Spent higher than the running Available; the negative balance is displayed rather than clamped', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    const row = before.rows[3];
    expect(row.reason, 'row 4').toBe(R.two);

    // Comfortably more than anything the character has ever earned.
    const OVERSPEND = 500;
    expect(OVERSPEND, 'the overspend exceeds the balance available at that row').toBeGreaterThan(row.runningAvailable);

    const after = await editByReason(page, R.two, 'spent', OVERSPEND);

    const spentDelta = OVERSPEND - row.spent;
    expect(after.totals.spent - before.totals.spent, 'Spent rises by the full amount, uncapped').toBe(spentDelta);
    expect(after.totals.available - before.totals.available, 'Available falls by the full amount').toBe(-spentDelta);
    expect(after.totals.available, 'the header shows a negative balance').toBeLessThan(0);
    expect(after.totals.available, 'and it is exactly Earned - Spent, not clamped at zero')
      .toBe(after.totals.earned - after.totals.spent);

    // The row itself and every row above it go negative too.
    expect(after.rows[3].runningAvailable, 'the overspent row\'s own balance is negative').toBeLessThan(0);
    expect(after.rows.slice(0, 4).every((r) => r.runningAvailable < 0), 'every row from the overspend up is negative').toBe(true);
    expect(after.rows[4].runningAvailable, 'the row below it is untouched').toBe(before.rows[4].runningAvailable);

    expectedRow(R.two).spent = OVERSPEND;
    assertTable(after, '67 overspent');

    const stored = await storedNotations(page, state.characterId);
    expect(stored.character.earned - stored.character.spent, 'the server stores the negative too').toBe(after.totals.available);

    // Restore, so the rest of the file works in legible numbers - and so the
    // negative is proven not to be sticky.
    const restored = await editByReason(page, R.two, 'spent', row.spent);
    expect(restored.totals, 'clearing the overspend returns every total exactly').toEqual(before.totals);
    expectedRow(R.two).spent = row.spent;
    assertTable(restored, '67 overspend cleared');
  });

  // -------------------------------------------------------------------------
  // 68-71 - insertion, deletion, and concurrent adds
  // -------------------------------------------------------------------------

  test('68 Insert a backdated notation; it lands first and every subsequent row\'s Available re-propagates', async () => {
    // "Lands first" is read chronologically - dated before every existing entry,
    // so it is the *first* thing that happened and therefore the *last* row of a
    // newest-first table. That is the only reading under which "every subsequent
    // row re-propagates" means anything: a row inserted at the top has no
    // subsequent rows.
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    const runningBefore = Object.fromEntries(before.rows.map((r) => [r.reason, r.runningAvailable]));

    const ADDED = { earned: 9, spent: 1 };
    const net = ADDED.earned - ADDED.spent;

    await addNotation(page);
    await renameByReason(page, DEFAULT_REASON, R.backdated);
    await editByReason(page, R.backdated, 'earned', ADDED.earned);
    const beforeBackdating = await editByReason(page, R.backdated, 'spent', ADDED.spent);

    // While it is still stamped "now" it sits on top, and being on top means it
    // changes nobody else's balance - which is exactly what makes the backdating
    // below the thing under test.
    expect(beforeBackdating.rows[0].reason, 'the new row starts on top').toBe(R.backdated);
    expect(
      Object.fromEntries(beforeBackdating.rows.slice(1).map((r) => [r.reason, r.runningAvailable])),
      'a newest-first insert moves no existing balance'
    ).toEqual(runningBefore);

    const after = await editByReason(page, R.backdated, 'date', DATE_BACKDATED);

    // Now it is the oldest entry, and every row above it has re-propagated.
    expect(after.rows[after.rows.length - 1].reason, 'the backdated row is now the oldest').toBe(R.backdated);
    expect(after.rows[after.rows.length - 1].date).toBe(DATE_BACKDATED);
    expect(after.rows[after.rows.length - 1].runningAvailable, 'the oldest row\'s balance is its own net').toBe(net);

    const runningAfter = Object.fromEntries(after.rows.map((r) => [r.reason, r.runningAvailable]));
    for (const reason of Object.keys(runningBefore)) {
      expect(
        runningAfter[reason] - runningBefore[reason],
        `"${reason}" re-propagated by exactly the backdated net`
      ).toBe(net);
    }

    expect(after.totals.earned - before.totals.earned, 'Earned rises by the inserted earned').toBe(ADDED.earned);
    expect(after.totals.spent - before.totals.spent, 'Spent rises by the inserted spent').toBe(ADDED.spent);
    expect(after.totals.available - before.totals.available, 'Available rises by the net').toBe(net);

    state.expected.push({ reason: R.backdated, date: DATE_BACKDATED, earned: ADDED.earned, spent: ADDED.spent });
    assertTable(after, '68 backdated insert');
  });

  test('69 Delete a middle notation; the remaining rows re-propagate their running Available correctly', async () => {
    // The plan says "the four remaining rows"; by this point the history has
    // grown to six, so five remain. The count is asserted either way.
    const before = await waitForXp(page, 'six rows', rowCountIs(6));
    // Deliberately a row with non-zero amounts in the middle of the chain, so
    // the re-propagation is visible: deleting a 0/0 row would pass this test
    // even if nothing recalculated at all.
    const victim = before.rows[2];
    expect(victim.reason, 'the middle row under test').toBe(R.one);
    expect(victim.earned, 'it carries a non-zero earned').toBeGreaterThan(0);
    expect(victim.spent, 'and a non-zero spent').toBeGreaterThan(0);
    const net = victim.earned - victim.spent;

    const remaining = await deleteNotation(page, 2);
    expect(remaining, 'five notations remain').toBe(5);

    const after = await waitForXp(page, 'the deleted row to disappear', ({ rows }) => {
      if (rows.length !== 5) return `${rows.length} rows, expected 5`;
      if (rows.some((r) => r.reason === victim.reason)) return 'the deleted row is still rendered';
      return null;
    });

    // Rows newer than the deleted one lose its net; older rows do not move.
    const runningBefore = Object.fromEntries(before.rows.map((r) => [r.reason, r.runningAvailable]));
    const newer = [R.four, R.threeRenamed];
    const older = [R.two, R.creation, R.backdated];
    for (const reason of newer) {
      const row = after.rows.find((r) => r.reason === reason);
      expect(row.runningAvailable - runningBefore[reason], `"${reason}" loses the deleted net`).toBe(-net);
    }
    for (const reason of older) {
      const row = after.rows.find((r) => r.reason === reason);
      expect(row.runningAvailable, `"${reason}" is older and untouched`).toBe(runningBefore[reason]);
    }

    expect(after.totals.earned - before.totals.earned).toBe(-victim.earned);
    expect(after.totals.spent - before.totals.spent).toBe(-victim.spent);
    expect(after.totals.available - before.totals.available).toBe(-net);

    state.expected = state.expected.filter((r) => r.reason !== victim.reason);
    assertTable(after, '69 middle deleted');

    const stored = await storedNotations(page, state.characterId);
    expect(stored.notations, 'the row is gone from the server too').toHaveLength(5);
    expect(stored.notations.map((n) => n.reason)).not.toContain(victim.reason);
  });

  test('70 Delete the top-most notation; the totals recalculate correctly', async () => {
    const before = await waitForXp(page, 'five rows', rowCountIs(5));
    const victim = before.rows[0];
    expect(victim.reason, 'the newest row').toBe(R.four);
    const net = victim.earned - victim.spent;

    const remaining = await deleteNotation(page, 0);
    expect(remaining, 'four notations remain').toBe(4);

    const after = await waitForXp(page, 'the top row to disappear', ({ rows }) => {
      if (rows.length !== 4) return `${rows.length} rows, expected 4`;
      if (rows.some((r) => r.reason === victim.reason)) return 'the deleted row is still rendered';
      return null;
    });

    expect(after.totals.earned - before.totals.earned, 'Earned drops by the deleted earned').toBe(-victim.earned);
    expect(after.totals.spent - before.totals.spent, 'Spent drops by the deleted spent').toBe(-victim.spent);
    expect(after.totals.available - before.totals.available, 'Available drops by the net').toBe(-net);

    // Deleting the newest entry hands the totals to whatever is now newest -
    // every surviving row keeps the balance it already had.
    expect(after.totals.available, 'the totals now come from the new top row').toBe(after.rows[0].runningAvailable);
    expect(
      after.rows.map((r) => r.runningAvailable),
      'no surviving row re-propagates, because nothing older changed'
    ).toEqual(before.rows.slice(1).map((r) => r.runningAvailable));

    state.expected = state.expected.filter((r) => r.reason !== victim.reason);
    assertTable(after, '70 top deleted');
  });

  test('71 Four rapid sequential additions produce the correct aggregate totals with no lost updates', async () => {
    const before = await waitForXp(page, 'four rows', rowCountIs(4));
    const target = before.rows.length + 4;

    // Fired back to back with no wait between them, which is the point of the
    // item: `add_experience_notation` serialises them onto one promise chain
    // (`_addExperienceEntryWrapper`), and a lost update would show up as a
    // missing row or a total that skipped one.
    for (let i = 0; i < 4; i++) {
      await page.locator(`${PAGE} button.add`).click();
    }

    const added = await waitForXp(page, 'four added rows', rowCountIs(target), 60000);
    expect(added.rows.slice(0, 4).map((r) => r.reason), 'four placeholder rows on top')
      .toEqual([DEFAULT_REASON, DEFAULT_REASON, DEFAULT_REASON, DEFAULT_REASON]);
    expect(added.rows.slice(0, 4).every((r) => r.earned === 0 && r.spent === 0), 'each starts empty').toBe(true);
    expect(added.totals, 'four empty notations move no total').toEqual(before.totals);
    expect(
      added.rows.slice(4).map((r) => r.runningAvailable),
      'the pre-existing rows are untouched'
    ).toEqual(before.rows.map((r) => r.runningAvailable));

    // Every one of the four reached the server - a lost update would leave the
    // page showing rows the database does not have.
    const stored = await storedNotations(page, state.characterId);
    expect(stored.notations, 'all four adds persisted').toHaveLength(target);

    // Give each a distinct amount, addressed by position because they all still
    // carry the placeholder reason, and check the aggregate.
    const AMOUNTS = [4, 3, 2, 1];
    for (let i = 0; i < AMOUNTS.length; i++) {
      await editNotationField(page, i, 'earned', AMOUNTS[i]);
      await waitForXp(page, `row ${i} to earn ${AMOUNTS[i]}`, ({ rows }) => {
        if (rows.length !== target) return `${rows.length} rows, expected ${target}`;
        if (rows[i].earned !== AMOUNTS[i]) return `row ${i} shows earned=${rows[i].earned}`;
        return null;
      });
    }

    const sum = AMOUNTS.reduce((a, b) => a + b, 0);
    const after = await readXpState(page);
    expect(after.totals.earned - before.totals.earned, 'Earned rises by the sum of all four').toBe(sum);
    expect(after.totals.available - before.totals.available, 'Available rises by the same sum').toBe(sum);
    expect(after.totals.spent - before.totals.spent, 'nothing was spent').toBe(0);

    for (let i = 0; i < AMOUNTS.length; i++) {
      state.expected.splice(i, 0, { reason: DEFAULT_REASON, date: null, earned: AMOUNTS[i], spent: 0 });
    }
    assertTable(after, '71 four rapid adds');
  });

  // -------------------------------------------------------------------------
  // 72-75 - reconciliation against the rest of the application
  // -------------------------------------------------------------------------

  test('72 The sheet header Available XP matches the XP page Available after all the above edits', async () => {
    const onXpPage = await waitForXp(page, 'the settled table', rowCountIs(state.expected.length));

    const sheet = await readSheetXp(page, state.characterId);
    expect(sheet, 'the sheet shows the same three numbers as the XP page').toEqual({
      earned: onXpPage.totals.earned,
      spent: onXpPage.totals.spent,
      available: onXpPage.totals.available
    });

    // And both agree with the row the server holds.
    const stored = await storedNotations(page, state.characterId);
    expect(stored.character).toEqual({ earned: onXpPage.totals.earned, spent: onXpPage.totals.spent });
    expect(stored.character.earned - stored.character.spent).toBe(sheet.available);

    // The totals are the column sums of the history, not an independent counter.
    const sumEarned = onXpPage.rows.reduce((a, r) => a + r.earned, 0);
    const sumSpent = onXpPage.rows.reduce((a, r) => a + r.spent, 0);
    expect({ earned: sumEarned, spent: sumSpent, available: sumEarned - sumSpent }).toEqual(sheet);

    await openXp(page, state.characterId);
  });

  test('73 The costs view reconciles: total trait cost equals the Spent total from the history', async () => {
    const cid = state.costsCharacter.id;

    await navigateToHash(page, `character/${cid}/costs`, '#character-costs');
    const items = (await page.locator('#character-costs li').allTextContents()).map(normalize);
    expect(items.length, 'the two traits this character bought').toBe(2);

    const costs = items.map((text) => {
      const m = text.match(/^(.+):\s*(-?\d+)$/);
      expect(m, `costs row "${text}" parses as "Name: cost"`).not.toBeNull();
      return { name: m[1], cost: parseInt(m[2], 10) };
    });
    expect(costs.map((c) => c.name).sort()).toEqual(['Athletics', 'Celerity']);
    const totalCost = costs.reduce((a, c) => a + c.cost, 0);
    expect(totalCost, 'both purchases cost something').toBeGreaterThan(0);

    await openXp(page, cid);
    const history = await waitForXp(page, 'the purchase history', rowCountIs(3));

    // The identity under test.
    expect(history.totals.spent, 'Spent equals the sum of every trait cost').toBe(totalCost);

    // And it holds row by row: each purchase wrote its own notation charging
    // exactly that trait's cost.
    expect(history.rows.map((r) => r.reason)).toEqual([
      'Update Celerity to 1', 'Update Athletics to 2', CREATION_REASON
    ]);
    const byTrait = Object.fromEntries(costs.map((c) => [c.name, c.cost]));
    expect(history.rows[0].spent, 'the Celerity notation charges the Celerity cost').toBe(byTrait.Celerity);
    expect(history.rows[1].spent, 'the Athletics notation charges the Athletics cost').toBe(byTrait.Athletics);
    expect(history.totals, 'the character still has its 30 XP award, less what it spent').toEqual({
      earned: 30, spent: totalCost, available: 30 - totalCost
    });

    // Why this needs its own character: the costs view lists trait costs only, so
    // the identity holds exactly when every spent point came from a purchase. The
    // character the rest of this file has been editing spends through hand-written
    // notations, so its costs view is empty while its Spent total is not - stated
    // here so the reconciliation above is understood as conditional, not universal.
    await navigateToHash(page, `character/${state.characterId}/costs`, '#character-costs');
    await expect(page.locator('#character-costs li')).toHaveCount(0);
    await openXp(page, state.characterId);
    const edited = await waitForXp(page, 'the edited history', rowCountIs(state.expected.length));
    expect(edited.totals.spent, 'hand-written spend has no trait behind it').toBeGreaterThan(0);
  });

  test('74 With more than ten entries, /experience/0/10 and /experience/10/10 paginate with no duplicates', async () => {
    // FIXED by remediation R48.
    //
    // Was: `characterexperience` passed `:start`/`:changeBy` to
    // `CharacterExperienceView.register`, which accepted both parameters and
    // used neither - `initialize` hardcoded `start = 0` / `changeBy = 10`,
    // the query carried no `skip` or `limit`, and the `skip`/`limit` lines in
    // `update_collection_query_and_fetch` were commented out, as were the View
    // Previous / View Next buttons. Every page of the route rendered the whole
    // history.
    //
    // The page is now taken at render time rather than in the query, which is
    // the one difference from `CharacterLogView`: this view renders the
    // character's own `experience_notations` collection, the same one
    // `_propagate_experience_notation_change` walks to keep every running
    // balance correct, so skipping rows in that query would corrupt the ledger.
    const start = await waitForXp(page, 'the settled table', rowCountIs(state.expected.length));

    // Seed on a page big enough to hold everything. The default page size is
    // ten, and now that the route really paginates, a table already showing
    // ten rows does not grow when an eleventh notation is added - which is the
    // whole point of the item, but it also means `addNotation`'s "wait for the
    // table to grow" check has to be given a page it can grow on.
    await openXp(page, state.characterId, 0, 50);
    while ((await readXpRows(page)).length <= 10) {
      await addNotation(page);
    }
    const all = await waitForXp(page, 'more than ten entries', ({ rows }) => (rows.length > 10 ? null : `only ${rows.length} rows`));
    expect(all.rows.length, 'more than ten entries exist').toBeGreaterThan(10);
    expect(all.totals, 'the padding rows are empty, so nothing moved').toEqual(start.totals);

    const stored = await storedNotations(page, state.characterId);
    const total = stored.notations.length;
    expect(total, 'a page of fifty shows the whole history').toBe(all.rows.length);

    await openXp(page, state.characterId, 0, 10);
    const firstPage = await readXpRows(page);
    await navigateToHash(page, `character/${state.characterId}/experience/10/10`, PAGE);
    const secondPage = await readXpRows(page);

    expect(firstPage.length, 'the first page holds exactly ten entries').toBe(10);
    expect(secondPage.length, 'the second page holds the remainder').toBe(total - 10);

    // Keyed on the notation's real id, not on its rendered values: the padding
    // rows above are all "Unspecified reason" with the same zero deltas and are
    // created within the same second, so a value fingerprint collapses several
    // distinct rows into one and would report a duplicate that is not there.
    const seen = firstPage.map((r) => r.notationId);
    const second = secondPage.map((r) => r.notationId);
    expect(seen.filter((id) => !id), 'every rendered row exposes its notation id').toEqual([]);
    expect(second.filter((id) => seen.indexOf(id) !== -1), 'no entry appears on both pages').toEqual([]);
    expect(new Set(seen.concat(second)).size, 'the two pages cover every entry exactly once').toBe(total);
  });

  test('75 Every XP notation add, edit and delete produces a corresponding entry in the character log', async () => {
    // FIXED by remediation R47b.
    //
    // Was: `VampireChange` rows came only from the `SimpleTrait` before/after
    // hooks and from the tracked-text branch of `beforeSave("Vampire")`.
    // Nothing hooked `ExperienceNotation`, and `experience_earned` /
    // `experience_spent` are not tracked texts, so a hand-written XP award -
    // the thing a storyteller does most often - left no audit trail at all.
    //
    // `beforeSave`/`beforeDelete` hooks on `ExperienceNotation` now record the
    // operation, the reason and the earned/spent deltas. They deliberately
    // ignore saves that touch only `earned`/`spent`: those are the running
    // balances every row above an edited one gets re-saved with, and logging
    // them would bury the operation under its own bookkeeping.
    // A page big enough to hold the whole history, for the same reason test 74
    // needs one: the ledger is past ten rows by now and the route really
    // paginates, so on the default page of ten the table would not grow when
    // the probe row below is added.
    const WHOLE_HISTORY = 50;
    await openXp(page, state.characterId, 0, WHOLE_HISTORY);
    const before = await waitForXp(page, 'the settled table', ({ rows }) => (rows.length ? null : 'no rows'));
    const changesBefore = await countChangeRows(page, state.characterId);
    await openLog(page, state.characterId, 0, 200);
    const logBefore = await readLogRows(page);

    // One of each operation, on a row created and destroyed by this test.
    await openXp(page, state.characterId, 0, WHOLE_HISTORY);
    await addNotation(page);
    await renameByReason(page, DEFAULT_REASON, R.logProbe);
    await editByReason(page, R.logProbe, 'earned', 25);
    const withProbe = await waitForXp(page, 'the probe row', rowShows(R.logProbe, 'earned', 25));
    expect(withProbe.totals.earned - before.totals.earned, 'the award landed').toBe(25);

    const index = await findNotationIndexByReason(page, R.logProbe);
    await deleteNotation(page, index);
    await waitForXp(page, 'the probe row to be deleted', ({ rows }) => (
      rows.some((r) => r.reason === R.logProbe) ? 'the probe row is still rendered' : null
    ));

    const changesAfter = await countChangeRows(page, state.characterId);
    // A page big enough to show the growth. The log paginates too, and by this
    // point in the file it is well past ten rows, so a full first page of ten
    // cannot get longer no matter how many rows are added behind it.
    await openLog(page, state.characterId, 0, 200);
    const logAfter = await readLogRows(page);

    expect(
      changesAfter - changesBefore,
      'an add, an edit and a delete should each be recorded'
    ).toBeGreaterThanOrEqual(3);
    expect(logAfter.length, 'and should be visible in the log view').toBeGreaterThan(logBefore.length);
    expect(
      logAfter.some((r) => String(r.name).indexOf(R.logProbe) !== -1 ||
                           String(r.new_text).indexOf(R.logProbe) !== -1),
      `the log should name the notation ("${R.logProbe}"); rows present: ${JSON.stringify(logAfter.slice(0, 4))}`
    ).toBe(true);
  });
});
