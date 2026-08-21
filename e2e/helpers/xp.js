/**
 * Experience-notation helpers.
 *
 * The notations table has a shape worth stating plainly, because reading it
 * naively is exactly how the previous suite produced meaningless assertions.
 * Each notation renders **two** `<tr>` elements (see the
 * `experienceNotationsAllView` template in public/index.html):
 *
 *   Row A ("delta row")  - mostly empty cells, carrying the per-entry
 *                          `alteration_earned` / `alteration_spent` and, in the
 *                          last data cell, the running balance rendered as
 *                          `earned - spent` (cumulative, not per-entry).
 *   Row B ("value row")  - the Edit buttons plus the entry's own field values.
 *
 * The template asks for `format_entry(log, "available")`, but `available` is
 * neither a column on the model nor a property on the view, so that cell always
 * renders blank. The running balance a reader actually sees is the one in
 * row A. `readXpRows` pairs the rows and exposes both, so tests can assert the
 * running balance without depending on that quirk.
 */

const {
  navigateToHash,
  waitForJqmLoader,
  waitForJqmPopup,
  waitForJqmPopupClosed,
  fillInActivePopup,
  submitActivePopup
} = require('./jqm-helpers');

const PAGE = '#experience-notations-all';

/** Open the notations page for a character. */
async function openXp(page, characterId, start = 0, changeBy = 10) {
  await navigateToHash(page, `character/${characterId}/experience/${start}/${changeBy}`, PAGE);
}

/** The Earned / Spent / Available summary above the table. */
async function readXpTotals(page) {
  return page.evaluate((sel) => {
    const pg = document.querySelector(sel);
    if (!pg) return null;
    const paragraphs = Array.from(pg.querySelectorAll('p')).map((p) => p.textContent.replace(/\s+/g, ' ').trim());
    const grab = (label) => {
      for (const t of paragraphs) {
        const m = t.match(new RegExp('^' + label + ':\\s*(-?\\d+(?:\\.\\d+)?)$'));
        if (m) return parseFloat(m[1]);
      }
      return null;
    };
    return { earned: grab('Earned'), spent: grab('Spent'), available: grab('Available') };
  }, PAGE);
}

/**
 * Read the notations table as one object per notation.
 *
 * Returns `{ index, date, reason, earned, spent, runningAvailable, notationId }`
 * where `earned`/`spent` are the entry's own alterations and `runningAvailable`
 * is the cumulative balance the delta row displays.
 */
async function readXpRows(page) {
  return page.evaluate((sel) => {
    const pg = document.querySelector(sel);
    if (!pg) return [];
    const rows = Array.from(pg.querySelectorAll('table tbody tr'));

    const num = (t) => {
      if (t === null || t === undefined) return null;
      const m = String(t).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    };
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

    const out = [];
    // Rows come in pairs: delta row, then value row.
    for (let i = 0; i + 1 < rows.length; i += 2) {
      const deltaCells = Array.from(rows[i].querySelectorAll('td')).map((td) => clean(td.textContent));
      const valueRow = rows[i + 1];
      const valueCells = Array.from(valueRow.querySelectorAll('td')).map((td) => clean(td.textContent));

      // Delta row layout: 5 empty, earned, empty, spent, empty, running, empty
      const runningAvailable = num(deltaCells[9]);

      // Value row layout: [edit, Date v, edit, Reason v, edit, Earned? v, edit, Spent? v, '', Available, delete]
      const stripLabel = (text, label) => clean(String(text).replace(new RegExp('^' + label + '\\??\\s*'), ''));

      const del = valueRow.querySelector('.experience-notation-delete');

      out.push({
        index: out.length,
        date: stripLabel(valueCells[1], 'Date'),
        reason: stripLabel(valueCells[3], 'Reason'),
        earned: num(stripLabel(valueCells[5], 'Earned')),
        spent: num(stripLabel(valueCells[7], 'Spent')),
        runningAvailable,
        notationId: del ? del.getAttribute('notation-id') : null
      });
    }
    return out;
  }, PAGE);
}

/** Number of notations currently rendered. */
async function countXpRows(page) {
  return (await readXpRows(page)).length;
}

/** Click "Add New Experience Notation" and wait for the table to grow. */
async function addNotation(page) {
  const before = await countXpRows(page);
  await page.locator(`${PAGE} button.add`).click();
  await waitForJqmLoader(page);
  await page.waitForFunction(({ sel, before }) => {
    const pg = document.querySelector(sel);
    if (!pg) return false;
    return pg.querySelectorAll('table tbody tr').length / 2 > before;
  }, { sel: PAGE, before }, { timeout: 20000 });
  return countXpRows(page);
}

/** Map a logical field to its edit-button header and popup. */
const FIELD_EDITORS = {
  date:   { header: 'entered',            popup: '#popupEditEntered',   input: '#date-input',      form: '#edit-entered-popup-form' },
  reason: { header: 'reason',             popup: '#popupEditReason',    input: '#reason-input',    form: '#edit-reason-popup-form' },
  earned: { header: 'alteration_earned',  popup: '#alterationpopupEdit', input: '#alteration-input', form: '#edit-alteration-popup-form' },
  spent:  { header: 'alteration_spent',   popup: '#alterationpopupEdit', input: '#alteration-input', form: '#edit-alteration-popup-form' }
};

/**
 * Edit one field of one notation through its popup.
 * `rowIndex` is zero-based over notations, not over `<tr>` elements.
 */
async function editNotationField(page, rowIndex, field, value) {
  const editor = FIELD_EDITORS[field];
  if (!editor) {
    throw new Error(`Unknown notation field "${field}". Expected one of: ${Object.keys(FIELD_EDITORS).join(', ')}`);
  }

  const button = page.locator(`${PAGE} .experience-notation-edit[header="${editor.header}"]`).nth(rowIndex);
  if (await button.count() === 0) {
    throw new Error(`No "${field}" edit control on notation row ${rowIndex}`);
  }
  await button.click();
  await waitForJqmPopup(page, editor.popup);

  // Scope to the popup jQuery Mobile actually opened. Bare id selectors match
  // stale duplicates left behind by earlier renders, which fills a detached
  // input and makes the edit a no-op.
  await fillInActivePopup(page, editor.popup, editor.input, value);
  await submitActivePopup(page, editor.popup);

  await waitForJqmPopupClosed(page, editor.popup);
  await waitForJqmLoader(page);
}

/** Delete a notation by zero-based row index and wait for the table to shrink. */
async function deleteNotation(page, rowIndex) {
  const before = await countXpRows(page);
  const button = page.locator(`${PAGE} .experience-notation-delete`).nth(rowIndex);
  if (await button.count() === 0) {
    throw new Error(`No delete control on notation row ${rowIndex}`);
  }
  await button.click();
  await waitForJqmLoader(page);
  await page.waitForFunction(({ sel, before }) => {
    const pg = document.querySelector(sel);
    if (!pg) return false;
    return pg.querySelectorAll('table tbody tr').length / 2 < before;
  }, { sel: PAGE, before }, { timeout: 20000 });
  return countXpRows(page);
}

/** The reason a freshly added notation carries before it is edited. */
const DEFAULT_REASON = 'Unspecified reason';

/**
 * Index of the first notation whose reason matches exactly.
 * Row order is by date descending, so positional indexes shift as rows are
 * added or dates are edited; look rows up by content instead.
 */
async function findNotationIndexByReason(page, reason) {
  const rows = await readXpRows(page);
  return rows.findIndex((r) => r.reason === reason);
}

/**
 * Seed a character with distinct notations, built the way a user would build
 * them: add a row, then edit its fields.
 *
 * New notations are inserted at the *top* of the table, not appended, because
 * rows render newest-first. Addressing the new row by a positional guess
 * silently edits an existing entry instead — which is how the character's
 * original creation award gets clobbered. Each new row is therefore located by
 * its placeholder reason, and re-located by its final reason before every
 * subsequent edit.
 *
 * `entries` is an array of `{ reason, earned, spent }`.
 */
async function seedNotations(page, characterId, entries) {
  await openXp(page, characterId);

  for (const entry of entries) {
    if (entry.reason === undefined) {
      throw new Error('seedNotations requires a reason for every entry; it is how the new row is identified');
    }

    await addNotation(page);

    const fresh = await findNotationIndexByReason(page, DEFAULT_REASON);
    if (fresh < 0) {
      const rows = await readXpRows(page);
      throw new Error(
        `could not locate the newly added notation (no row with reason "${DEFAULT_REASON}"). ` +
        `Reasons present: ${rows.map((r) => JSON.stringify(r.reason)).join(', ')}`
      );
    }
    await editNotationField(page, fresh, 'reason', entry.reason);

    if (entry.earned !== undefined) {
      const idx = await findNotationIndexByReason(page, entry.reason);
      await editNotationField(page, idx, 'earned', entry.earned);
    }
    if (entry.spent !== undefined) {
      const idx = await findNotationIndexByReason(page, entry.reason);
      await editNotationField(page, idx, 'spent', entry.spent);
    }
  }

  return readXpRows(page);
}

module.exports = {
  PAGE,
  FIELD_EDITORS,
  openXp,
  readXpTotals,
  readXpRows,
  countXpRows,
  addNotation,
  editNotationField,
  deleteNotation,
  seedNotations,
  findNotationIndexByReason,
  DEFAULT_REASON
};
