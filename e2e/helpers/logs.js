/**
 * Character change-log helpers.
 *
 * The log renders as a jQuery Mobile responsive table, which repeats the column
 * label inside every cell ("categorydisciplines", "value1"). Reading
 * `td.textContent` raw therefore yields label-prefixed junk, and a test that
 * asserts `toContainText('Celerity')` passes on almost anything. These helpers
 * strip the label and return typed fields.
 *
 * Column names come from the app, not from the plan: the "new value" column is
 * `value` (not `new_value`) and the "new cost" column is `cost` (not
 * `new_cost`). The aliases below let callers use either spelling.
 */

const { navigateToHash, waitForJqmLoader, hardReload } = require('./jqm-helpers');

const PAGE = '#character-log';

/** Columns the log table renders, in order. */
const LOG_COLUMNS = [
  'createdAt', 'category', 'name', 'type',
  'old_value', 'value', 'old_free_value', 'free_value',
  'old_cost', 'cost', 'old_text', 'new_text'
];

/** Friendlier aliases so assertions can read naturally. */
const COLUMN_ALIASES = {
  new_value: 'value',
  new_cost: 'cost',
  new_free_value: 'free_value'
};

function resolveColumn(name) {
  return COLUMN_ALIASES[name] || name;
}

/**
 * Open a character's log page, guaranteed fresh.
 *
 * DEFECT, confirmed live: `CharacterLogView.register(character, start,
 * changeBy)` (views/CharacterLogView.js) only calls `update_collection_query_
 * and_fetch()` - the thing that actually re-queries `VampireChange` - when
 * `start`, `changeBy`, or the character object reference differ from what it
 * already held. It has no way to know the underlying rows changed. The
 * natural test pattern "read the log, act, read the log again" almost always
 * calls this with the *same* characterId/start/changeBy both times, which is
 * exactly the case this view treats as "nothing to do" - the second read
 * silently returns the pre-action rows.
 *
 * Measured on a live server: raising a trait's value produced a correct
 * `VampireChange` row immediately (confirmed by a direct `Parse.Query`
 * alongside the UI read), while `character/:cid/log/0/20` opened a second
 * time with the same `changeBy=20` kept showing the stale pre-raise rows even
 * 1.5s later and after an explicit re-navigation - only a *different*
 * `changeBy` (or a full page reload) forced a fresh fetch. This is the same
 * family of bug as `waitForJqmLoader` "may return immediately" - the page
 * transition completes without the data it's supposed to show.
 *
 * A first fix routed through a throwaway `changeBy` before the real one, to
 * force `register()`'s "changed" check either way. That is correct in
 * isolation but dangerous in practice: firing two `$.mobile.changePage` calls
 * back to back, with no settling time between them, leaves jQuery Mobile's
 * own transition/page-cache bookkeeping confused. Measured live: the very
 * next *unrelated* navigation (to `#simpletrait-new` or `#simpletrait-change`
 * for a trait already visited once before) then stalled for ~42 seconds
 * before `navigateToHash`'s own retry fallback finally recovered it - twice,
 * in one short test, both immediately after a double-navigated `openLog`
 * call. That is a worse defect than the one being fixed.
 *
 * The safe fix is the one `navigateToHash` itself already falls back to for
 * views that short-circuit this same way: a full reload. The Parse session
 * lives in `localStorage`, so the user stays signed in, and a freshly
 * constructed `CharacterLogView` has no memoized `start`/`changeBy` to compare
 * against, so the very next navigation to the log route is guaranteed to be a
 * real, first-ever registration - no race, no back-to-back transitions.
 * Heavier per call than the double-navigation attempt, but it is the "heavy
 * but reliable" tool this codebase already trusts for exactly this failure
 * mode, and it cannot destabilise anything downstream the way the faster fix
 * did. This changes nothing about the function's signature or return value,
 * so every existing caller (this suite's `xp-history.spec.js` included) gets
 * a correctness fix for free.
 */
async function openLog(page, characterId, start = 0, changeBy = 10) {
  await hardReload(page);
  await navigateToHash(page, `character/${characterId}/log/${start}/${changeBy}`, PAGE);
}

/**
 * Read the log table into typed rows.
 * Numeric columns come back as numbers, empty cells as null.
 */
async function readLogRows(page) {
  return page.evaluate(({ sel, columns }) => {
    const root = document.querySelector(sel);
    if (!root) return [];

    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

    return Array.from(root.querySelectorAll('table tbody tr')).map((tr, rowIndex) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      const row = { rowIndex };
      cells.forEach((td, i) => {
        const column = columns[i];
        if (!column) return;
        // The responsive table repeats the column label inside the cell.
        let text = clean(td.textContent);
        if (text.indexOf(column) === 0) text = clean(text.slice(column.length));
        if (text === '') {
          row[column] = null;
        } else if (/^-?\d+(\.\d+)?$/.test(text)) {
          row[column] = parseFloat(text);
        } else {
          row[column] = text;
        }
      });
      return row;
    });
  }, { sel: PAGE, columns: LOG_COLUMNS });
}

/** Total rows currently rendered. */
async function countLogRows(page) {
  return (await readLogRows(page)).length;
}

/**
 * Find the rows matching a partial specification.
 * Keys may use either the app's column names or the friendlier aliases.
 */
function findLogRows(rows, spec) {
  const normalized = {};
  Object.keys(spec).forEach((k) => { normalized[resolveColumn(k)] = spec[k]; });

  return rows.filter((row) => Object.keys(normalized).every((k) => {
    const want = normalized[k];
    if (want instanceof RegExp) return want.test(String(row[k]));
    return row[k] === want;
  }));
}

/**
 * Assert exactly one log row matches, and return it.
 * Failure lists the near misses so the diagnosis is immediate.
 */
function expectLogRow(rows, spec, label = 'log row') {
  const matches = findLogRows(rows, spec);
  if (matches.length === 1) return matches[0];

  const wanted = JSON.stringify(spec);
  if (matches.length === 0) {
    const byName = spec.name ? rows.filter((r) => r.name === spec.name) : [];
    const hint = byName.length
      ? ` Rows with name="${spec.name}": ${JSON.stringify(byName.slice(0, 4))}`
      : ` First rows present: ${JSON.stringify(rows.slice(0, 4))}`;
    throw new Error(`${label}: no log row matched ${wanted}.${hint}`);
  }
  throw new Error(`${label}: expected exactly one row matching ${wanted}, found ${matches.length}: ${JSON.stringify(matches.slice(0, 4))}`);
}

/** Page the log forward or backward using its own controls. */
async function goToLogPage(page, direction) {
  const label = direction === 'next' ? 'Next' : 'Previous';
  const button = page.locator(`${PAGE} button:has-text("${label}"), ${PAGE} a.ui-btn:has-text("${label}")`).first();
  if (await button.count() === 0) {
    throw new Error(`log has no "${label}" control`);
  }
  await button.click();
  await waitForJqmLoader(page);
}

/**
 * Walk every page of the log and return the combined rows.
 * Stops when a page repeats or yields nothing, so a broken pager cannot loop.
 */
async function readAllLogPages(page, characterId, { pageSize = 10, maxPages = 30 } = {}) {
  const all = [];
  const seen = new Set();

  for (let i = 0; i < maxPages; i++) {
    await openLog(page, characterId, i * pageSize, pageSize);
    const rows = await readLogRows(page);
    if (rows.length === 0) break;

    const fingerprint = JSON.stringify(rows.map((r) => [r.createdAt, r.category, r.name, r.value]));
    if (seen.has(fingerprint)) break;
    seen.add(fingerprint);

    all.push(...rows);
    if (rows.length < pageSize) break;
  }

  return all;
}

module.exports = {
  PAGE,
  LOG_COLUMNS,
  COLUMN_ALIASES,
  openLog,
  readLogRows,
  countLogRows,
  findLogRows,
  expectLogRow,
  goToLogPage,
  readAllLogPages
};
