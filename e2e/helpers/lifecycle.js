/**
 * Task 12 support: baseline creation -> long-term change -> dual audit log.
 *
 * New in Task 12 and used only by `lifecycle-vampire.spec.js`,
 * `lifecycle-werewolf.spec.js` and `lifecycle-changeling.spec.js`. Nothing
 * that existed before this task imports it, so adding it cannot disturb any
 * previously-green suite.
 *
 * The three lifecycle files run the same twenty-odd-step programme against
 * three venues. Everything venue-independent lives here so the specs stay
 * about *what is being asserted* rather than about jQuery Mobile mechanics.
 *
 * ---------------------------------------------------------------------------
 * Facts these helpers encode, all measured live before they were written
 * ---------------------------------------------------------------------------
 *
 * **The character log genuinely paginates.** This contradicts the note that
 * was handed to this task, which said `register()` accepts `start`/`changeBy`
 * and uses neither. That is true of `CharacterExperienceView` (plan item 74)
 * but *not* of `CharacterLogView`: its `update_collection_query_and_fetch()`
 * really does call `q.skip(self.start)` and `q.limit(self.changeBy)`, and its
 * Previous/Next buttons are live (`events: {"click .previous": ..., "click
 * .next": ...}`), unlike the experience view's, which are commented out of the
 * template. Measured on a 33-row character: `/log/0/10`, `/log/10/10` and
 * `/log/20/10` returned three disjoint ten-row pages, and clicking Next from
 * page 0 moved the hash to `/log/10/10` and rendered page 1. So the
 * "paginates across at least three pages" items are satisfiable and are
 * asserted positionally against a single full read.
 *
 * **A cost of zero is indistinguishable from an absent cost in the log.**
 * `format_entry(log, entry)` returns `log.get(entry)` only when it is truthy,
 * so a stored `0` falls through to `log[entry]` (undefined) and renders as an
 * empty cell. Every creation pick is free, so its `cost`/`old_cost` cells are
 * blank rather than `0`. `numCost` below normalises that, and callers assert
 * numerically instead of pretending the distinction exists.
 *
 * **`createdAt` renders through `moment(...).format('lll')`** - e.g.
 * "Aug 15, 2026 12:52 PM" - so it is minute-granular. It is still a valid
 * field for row-for-row parity between two sessions (both read the same rows
 * in the same server-side order) but is far too coarse to *derive* ordering
 * from, which is why `isNonIncreasing` only requires monotonicity.
 */

const { expect } = require('@playwright/test');
const {
  navigateToHash,
  waitForActivePage,
  waitForJqmLoader,
  hardReload,
  fillBackformInput,
  normalize,
  setJqmSlider
} = require('./jqm-helpers');
const { openLog, readLogRows } = require('./logs');
const { readTraits } = require('./characters');

/** Columns compared when asserting that two sessions see the same log. */
const PARITY_COLUMNS = [
  'createdAt', 'category', 'name', 'type',
  'old_value', 'value', 'old_free_value', 'free_value',
  'old_cost', 'cost', 'old_text', 'new_text'
];

/** Treat a blank cost cell as the zero it actually is (see the header note). */
function numCost(v) {
  return v === null || v === undefined || v === '' ? 0 : Number(v);
}

/**
 * Park on the character sheet between picker visits.
 *
 * `#simpletrait-new` and `#simpletraitcategory-all` are each one page element
 * shared across every category, so navigating picker-to-picker satisfies
 * `waitForActivePage` instantly against the *previous* category's list. Hopping
 * through the sheet makes each visit a real, observable transition.
 *
 * This used to compensate for a second problem as well - the follow-up
 * `changePage` being swallowed - which was the transition-queue leak fixed in
 * `jquery.mobile-1.4.5.js`. That half is gone, and the two parks this helper
 * did internally are removed with it. The remaining callers in the spec files
 * keep it for the observability reason above only.
 */
async function parkOnSheet(page, cid) {
  await navigateToHash(page, `character?${cid}`, '#character');
}

/**
 * Poll the hash to an expected value.
 *
 * A single blocking `page.waitForFunction` on an exact hash intermittently
 * times out on the specialize/remove routes even though the hash settles
 * within a second when polled - the same behaviour `traits-lifecycle.spec.js`
 * documents for these exact routes.
 */
async function waitForHash(page, expectedHash, { timeout = 25000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.location.hash);
    if (last === expectedHash) return;
    await page.waitForTimeout(interval);
  }
  throw new Error(`expected hash "${expectedHash}" within ${timeout}ms; last seen "${last}"`);
}

/**
 * Open one page of the log and read it once the table has actually settled.
 *
 * Two races have to be closed here, and `logs.js#openLog` closes only the
 * first. It reloads before navigating - correct, because `CharacterLogView.
 * register` refetches only when `start`/`changeBy`/character differ - but
 * `window.location.reload()` keeps the current hash, so if the previous read
 * left the browser on `#character/:cid/log/0/400`, the reload re-runs *that*
 * route first and renders all 400 rows before the intended navigation to
 * `/log/0/10` triggers a second, correctly-limited fetch. Measured live: a
 * request for page 0 at ten-per-page came back with all 42 rows, because the
 * read happened between those two renders. The Vampire suite passed the same
 * code by timing luck.
 *
 * So: park on the character sheet first, *then* reload, so the reload cannot
 * re-run a log route at all; then navigate to the wanted page, which is now a
 * genuine first registration. Then poll until the rendered row count has been
 * stable across consecutive reads and is within the requested limit. The poll
 * returns whatever it last saw when it times out rather than throwing, so a
 * pager that really did ignore `changeBy` fails the caller's own assertion
 * with the real number instead of an opaque timeout.
 */
async function readLogPage(page, cid, start, changeBy, { timeout = 40000, interval = 250 } = {}) {
  await navigateToHash(page, `character?${cid}`, '#character');
  await openLog(page, cid, start, changeBy);

  const deadline = Date.now() + timeout;
  let rows = await readLogRows(page);
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    if (rows.length > 0 && rows.length === last && rows.length <= changeBy) {
      stable += 1;
      if (stable >= 2) return rows;
    } else {
      stable = 0;
    }
    last = rows.length;
    await page.waitForTimeout(interval);
    rows = await readLogRows(page);
  }
  return rows;
}

/** Read the whole log in one request. `changeBy` is passed straight into `q.limit`. */
async function readAllLogRows(page, cid, changeBy = 400) {
  return readLogPage(page, cid, 0, changeBy);
}

/** Rows matching every key in `spec`, newest first (the log's own order). */
function matchingRows(rows, spec) {
  return rows.filter((row) => Object.keys(spec).every((k) => {
    const want = spec[k];
    if (want instanceof RegExp) return want.test(String(row[k]));
    return row[k] === want;
  }));
}

/** The newest row matching `spec`, with a diagnostic listing on failure. */
function freshestRow(rows, spec, label = 'log row') {
  const found = matchingRows(rows, spec);
  if (found.length === 0) {
    const byName = spec.name ? rows.filter((r) => r.name === spec.name) : [];
    throw new Error(
      `${label}: no log row matched ${JSON.stringify(spec)}. ` +
      (byName.length
        ? `Rows named "${spec.name}": ${JSON.stringify(byName.slice(0, 5))}`
        : `Newest rows present: ${JSON.stringify(rows.slice(0, 5))}`)
    );
  }
  return found[0];
}

/** A stable identity for one rendered log row, used for gap/duplicate checks. */
function fingerprint(row) {
  return PARITY_COLUMNS.map((c) => String(row[c])).join('|');
}

/** Parse the log's `lll`-formatted timestamps into epoch milliseconds. */
function parseLogDate(text) {
  const t = Date.parse(String(text));
  return Number.isNaN(t) ? null : t;
}

/** True when every parsed timestamp is <= its predecessor (newest first). */
function isNonIncreasing(rows) {
  const stamps = rows.map((r) => parseLogDate(r.createdAt));
  for (let i = 1; i < stamps.length; i++) {
    if (stamps[i] === null || stamps[i - 1] === null) continue;
    if (stamps[i] > stamps[i - 1]) return { ok: false, at: i, rows: [rows[i - 1], rows[i]] };
  }
  return { ok: true };
}

/**
 * Compare two sessions' renderings of the same log, column by column.
 * Returns a list of human-readable differences (empty when they agree).
 */
function logDifferences(a, b, labelA = 'A', labelB = 'B') {
  const diffs = [];
  if (a.length !== b.length) {
    diffs.push(`${labelA} has ${a.length} rows, ${labelB} has ${b.length}`);
  }
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    for (const col of PARITY_COLUMNS) {
      if (String(a[i][col]) !== String(b[i][col])) {
        diffs.push(`row ${i} column "${col}": ${labelA}=${JSON.stringify(a[i][col])} ${labelB}=${JSON.stringify(b[i][col])}`);
      }
    }
  }
  for (let i = n; i < a.length; i++) diffs.push(`row ${i} only in ${labelA}: ${JSON.stringify(a[i])}`);
  for (let i = n; i < b.length; i++) diffs.push(`row ${i} only in ${labelB}: ${JSON.stringify(b[i])}`);
  return diffs;
}

/**
 * Remove a trait through the change page's own Remove button, the only removal
 * affordance a player has (`SimpleTraitChangeView.remove` -> `Character.
 * remove_trait`, which destroys the trait, refunds `-cost` and posts an
 * experience notation; `beforeDelete("SimpleTrait")` writes the "remove" row).
 */
async function removeTraitViaChangePage(page, cid, category, traitName, openTraitChange) {
  await openTraitChange(page, cid, category, traitName);
  const remove = page.locator('#simpletrait-changing .remove');
  await expect(remove, `Remove button on the ${traitName} change page`).toHaveCount(1);
  await remove.click();
  await waitForHash(page, `#simpletraits/${category}/${cid}/all`);
  await waitForJqmLoader(page);
}

/**
 * Rename a trait's specialization through `#simpletrait/specialize/...`.
 *
 * Success and rejection land on the same category-listing hash (a defect
 * `traits-lifecycle.spec.js` documents in detail), so callers distinguish them
 * by reading the trait back, never by the destination.
 */
async function specializeRename(page, cid, category, traitId, suffix) {
  await navigateToHash(page, `simpletrait/specialize/${category}/${cid}/${traitId}`, '#simpletrait-specialization');
  await page.fill('#simpletrait-specialization input[name="specialization"]', suffix);
  await page.locator('#simpletrait-specialization .save').click();
  await waitForHash(page, `#simpletraits/${category}/${cid}/all`);
  await waitForJqmLoader(page);
}

/**
 * Add the bare form of a trait whose Description carries
 * `requirement: "requires_specialization"`.
 *
 * `SimpleTraitNewView.clicked` diverts such a pick to the two-step
 * specialize-new form; submitting it with an empty specialization calls
 * `set_specialization("")`, which resets the name to the bare base and
 * redirects (without persisting) to the ordinary "new" change page, which does
 * persist on Save. Tolerates the app landing directly on the change page,
 * which its own render/fetch race occasionally does.
 */
async function addSpecializingBase(page, cid, category, baseName, venueName, { value = 1 } = {}) {
  await navigateToHash(page, `simpletraits/${category}/${cid}/new`, '#simpletrait-new');
  const link = page.locator(`#simpletrait-new a.simpletrait[name="${baseName.replace(/"/g, '\\"')}"]`).first();
  await expect(link, `"${baseName}" offered by the ${category} picker`).toHaveCount(1);
  await link.click();

  const specializeFragment = `simpletrait/specialize/${category}/${cid}/`;
  const spacerFragment = `simpletrait/spacer/${category}/${cid}/`;
  const deadline = Date.now() + 25000;
  let hash = '';
  while (Date.now() < deadline) {
    hash = await page.evaluate(() => window.location.hash);
    if (hash.indexOf(specializeFragment) !== -1 || hash.indexOf(spacerFragment) !== -1) break;
    await page.waitForTimeout(200);
  }
  await waitForJqmLoader(page);

  if (hash.indexOf(specializeFragment) !== -1) {
    await waitForActivePage(page, 'simpletrait-new-specialization');
    await page.fill('#simpletrait-new-specialization input[name="specialization"]', '');
    await page.locator('#simpletrait-new-specialization .save').click();
    await waitForJqmLoader(page);
  }

  await waitForActivePage(page, 'simpletrait-change');
  await setJqmSlider(page, '#simpletrait-changing .value-slider', value);
  await page.locator('.ui-page-active .save').first().click();
  await waitForHash(page, `#simpletraits/${category}/${cid}/all`);
  await waitForJqmLoader(page);

  const traits = await readTraits(page, cid, category, venueName);
  const trait = traits.find((t) => t.name === baseName);
  if (!trait) {
    throw new Error(`expected a bare "${baseName}" in ${category}; owned: ${traits.map((t) => t.name).join(', ') || '(none)'}`);
  }
  return trait;
}

/**
 * Drive the real rename form and report what the page showed.
 * `hardReload` first: `characterRenameView` is memoized on the router and its
 * Backform submit field keeps a stale "Successfully Updated" across visits.
 */
async function renameCharacter(page, cid, newName) {
  await hardReload(page);
  await navigateToHash(page, `character/${cid}/rename`, '#character-rename');
  const submit = page.locator('#character-rename button[name="submit"]');
  await expect(submit, 'submit starts disabled until the form is touched').toBeDisabled();
  await fillBackformInput(page, '#character-rename input[name="name"]', newName);
  await expect(submit, 'submit is enabled once the form registers a change').toBeEnabled();
  await submit.click();
  await page.waitForFunction(() => {
    const el = document.querySelector('#character-rename span.status');
    return !!el && (el.classList.contains('text-success') || el.classList.contains('text-danger'));
  }, { timeout: 20000 });
  const status = page.locator('#character-rename span.status');
  return {
    text: normalize(await status.textContent()),
    isSuccess: await status.evaluate((el) => el.classList.contains('text-success'))
  };
}

/** Fill and submit a long-text form (`CharacterLongTextView`, Backform textarea). */
async function updateLongText(page, pageSel, text) {
  await fillBackformInput(page, `${pageSel} textarea[name="text"]`, text);
  await page.locator(`${pageSel} button[name="submit"]`).click();
  await waitForJqmLoader(page);
  await expect(page.locator(`${pageSel} .status`)).toHaveText('Successfully Updated');
}

/** The three long-text routes and the jQuery Mobile page each lands on. */
const LONG_TEXT_ROUTES = [
  { key: 'extended_print_text', hash: 'extendedprinttext', page: '#extended-print-text' },
  { key: 'background', hash: 'backgroundlt', page: '#long-text' },
  { key: 'notes', hash: 'noteslt', page: '#long-text' }
];

/** Edit all three long texts through their real forms; returns what was written. */
async function editAllLongTexts(page, cid, prefix) {
  const written = {};
  for (const route of LONG_TEXT_ROUTES) {
    const text = `${prefix} ${route.key} ${Date.now().toString(36)}`;
    await navigateToHash(page, `character/${cid}/${route.hash}`, route.page);
    await updateLongText(page, route.page, text);
    written[route.key] = text;
  }
  return written;
}

/** Read a long text back off its own edit page. */
async function readLongText(page, cid, key) {
  const route = LONG_TEXT_ROUTES.find((r) => r.key === key);
  await navigateToHash(page, `character/${cid}/${route.hash}`, route.page);
  return page.locator(`${route.page} textarea[name="text"]`).inputValue();
}

// ---------------------------------------------------------------------------
// History timeline (`#character/:cid/history/:id`)
// ---------------------------------------------------------------------------

/**
 * Open the history timeline, freshly.
 *
 * `CharacterHistoryView`'s `register(model)` short-circuits whenever the model
 * object is the one it already holds - the same memoization defect
 * `CharacterLogView` has - and it ignores the route's `:id` parameter
 * entirely, so the only way to move through versions is the slider. A reload
 * guarantees a genuinely first registration.
 */
async function openHistory(page, cid) {
  await hardReload(page);
  await navigateToHash(page, `character/${cid}/history/0`, '#character-history');
  await page.waitForFunction(() => {
    const el = document.querySelector('#history-main input[name="historyChangePicker"]');
    return !!el && el.getAttribute('max') !== null;
  }, { timeout: 25000 });
}

/** How many recorded changes the timeline knows about, and where it starts. */
async function readHistoryBounds(page) {
  return page.evaluate(() => {
    const slider = document.querySelector('#history-main input[name="historyChangePicker"]');
    return {
      max: slider ? parseInt(slider.getAttribute('max'), 10) : null,
      value: slider ? parseInt(slider.value, 10) : null,
      changeCount: document.querySelectorAll('#history-main input[type="hidden"]').length
    };
  });
}

/**
 * Move the timeline to one index and wait for the sheet to catch up.
 *
 * `MainView`'s delegated `"change"` handler recomputes the rolled-back
 * character; `CharacterPrintView` re-renders off a 100ms-debounced listener on
 * the shared `override` model, so the sheet lags the slider. Polling for the
 * "Most Recent Change Applied" table to actually show the expected row is the
 * only honest completion signal.
 *
 * `expected` must be matched on more than the trait name. A trait that is
 * bought and then removed produces two adjacent rows sharing a name (`define
 * Resources`, then `remove Resources`), so a name-only wait returns
 * immediately against the *previous* index's still-rendered table and the
 * caller silently asserts against a stale snapshot. Name + type + value is
 * the smallest key that separates every adjacent pair these suites produce.
 *
 * Note also that jQuery Mobile rewrites the template's `input[type="range"]`
 * to `type="number"` in place (adding `class="ui-slider-input"`) rather than
 * inserting a second control, so `input[name="historyChangePicker"]` is the
 * only stable way to address it.
 */
async function setHistoryIndex(page, index, expected) {
  const want = typeof expected === 'string' ? { name: expected } : (expected || null);
  await setJqmSlider(page, '#history-main input[name="historyChangePicker"]', index);
  const deadline = Date.now() + 20000;
  let seen = null;
  const matches = (row) => !!row && ['name', 'type', 'value', 'category'].every(
    (k) => want[k] === undefined || row[k] === want[k]
  );
  while (Date.now() < deadline) {
    seen = await readHistoryTables(page);
    if (!want || matches(seen.applied)) return seen;
    await page.waitForTimeout(200);
  }
  throw new Error(
    `history index ${index} never rendered a "Most Recent Change Applied" row matching ` +
    `${JSON.stringify(want)}; last saw ${JSON.stringify(seen)}`
  );
}

/**
 * The two tables `#history-viewing` renders: the change being reversed (absent
 * at the newest index) and the newest change still applied.
 */
async function readHistoryTables(page) {
  return page.evaluate(() => {
    const columns = [
      'createdAt', 'category', 'name', 'type',
      'old_value', 'value', 'old_free_value', 'free_value',
      'old_cost', 'cost', 'old_text', 'new_text'
    ];
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('#history-viewing');
    if (!root) return { reversed: null, applied: null, tables: 0 };

    const readTable = (table) => {
      const tr = table.querySelector('tbody tr');
      if (!tr) return null;
      const row = {};
      Array.from(tr.querySelectorAll('td')).forEach((td, i) => {
        const col = columns[i];
        if (!col) return;
        let text = clean(td.textContent);
        if (text.indexOf(col) === 0) text = clean(text.slice(col.length));
        if (text === '') row[col] = null;
        else if (/^-?\d+(\.\d+)?$/.test(text)) row[col] = parseFloat(text);
        else row[col] = text;
      });
      return row;
    };

    const tables = Array.from(root.querySelectorAll('table'));
    // Two tables => [reversed, applied]; one table => [applied] only.
    if (tables.length >= 2) {
      return { reversed: readTable(tables[0]), applied: readTable(tables[1]), tables: tables.length };
    }
    if (tables.length === 1) {
      return { reversed: null, applied: readTable(tables[0]), tables: 1 };
    }
    return { reversed: null, applied: null, tables: 0 };
  });
}

/** The rolled-back printable sheet the timeline is currently showing. */
async function readHistorySheetText(page) {
  return normalize(await page.locator('#history-sheet').textContent());
}

// ---------------------------------------------------------------------------
// Costs view (`#character/:cid/costs`)
// ---------------------------------------------------------------------------

/**
 * Read `#character-costs` into `[{ name, cost }]`.
 *
 * The template emits `<li><%= cost.trait.get("name") %>: <%= cost.cost %></li>`
 * and plenty of trait names contain their own colon ("Thaumaturgy: Recure of
 * the Homeland"), so the split has to be on the *last* colon, not the first.
 * The numbers are `calculate_trait_cost` recomputed live, not the trait's
 * stored `cost` field - which is exactly what makes reconciling them against
 * the log meaningful rather than tautological.
 */
async function readCostsView(page, cid) {
  await navigateToHash(page, `character/${cid}/costs`, '#character-costs');
  await page.waitForFunction(() => {
    const el = document.querySelector('#character-costs div[role="main"]');
    return !!el && el.querySelectorAll('li').length > 0;
  }, { timeout: 25000 });
  return page.evaluate(() => {
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('#character-costs div[role="main"] li')).map((li) => {
      const text = clean(li.textContent);
      const idx = text.lastIndexOf(':');
      return {
        name: clean(text.slice(0, idx)),
        cost: parseInt(clean(text.slice(idx + 1)), 10)
      };
    });
  });
}

module.exports = {
  PARITY_COLUMNS,
  LONG_TEXT_ROUTES,
  numCost,
  parkOnSheet,
  waitForHash,
  readLogPage,
  readAllLogRows,
  matchingRows,
  freshestRow,
  fingerprint,
  parseLogDate,
  isNonIncreasing,
  logDifferences,
  removeTraitViaChangePage,
  specializeRename,
  addSpecializingBase,
  renameCharacter,
  updateLongText,
  editAllLongTexts,
  readLongText,
  openHistory,
  readHistoryBounds,
  setHistoryIndex,
  readHistoryTables,
  readHistorySheetText,
  readCostsView
};
