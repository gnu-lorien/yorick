/**
 * Approval helpers.
 *
 * The approval view is slider-driven rather than a per-change button list: a
 * range slider selects how far through the change history to approve, and a
 * single `.approve-change` button commits it, labelled "Approve changes up to
 * N". Approving "the latest change" therefore means pushing the slider to its
 * maximum and clicking once.
 *
 * ---
 *
 * ## The four regions of `#character-approval`, and what each one really is
 *
 * `CharacterApprovalView` is a LayoutView over five regions, none of which is
 * the table a reader of the plan would expect:
 *
 * - `#approval-changes` (`ChangesView`) — **two** range sliders, not a change
 *   list: `historyBaseRange` (`#sliderbaserange`, left bound) and
 *   `historyChangePicker` (`#slider`, right bound), plus one hidden
 *   `#history-changes-<i>` input per recorded change holding that change's
 *   object id. Both default to covering the whole history.
 * - `#approval-approvals` (`ApprovalsView`) — a *third* slider,
 *   `approvalChangePicker` (`#approval-slider`), whose `max` is the number of
 *   approvals and whose default value is that same number (the "about to make a
 *   new approval" slot), plus one hidden `#approval-changes-<i>` input per
 *   approval holding that *approval's* object id.
 * - `#approval-edit` (`EditView`) — when the approvals slider sits at its max
 *   this renders either `<button class="approve-change">Approve changes up to
 *   N</button>` or, once the newest approval already points at the newest
 *   recorded change, the literal text `No unapproved changes`. When the slider
 *   selects an *existing* approval it instead renders a one-row table with the
 *   columns `createdAt / approved / change / approver / owner`.
 * - `#approval-viewing` (`ChangesSelectedView`) — the change rows themselves,
 *   `logs.slice(left, right + 1)`, with `old_value`/`value`/`old_cost`/`cost`/
 *   `old_text`/`new_text` columns. Selecting an approval moves left/right onto
 *   the range that approval covers, which is how "what did this approval
 *   approve" is actually surfaced.
 * - `#approval-sheet` — a nested `CharacterPrintView`. Note that it renders the
 *   same `cpp-*` element ids as the standalone `#printable-sheet` page, so any
 *   read of a printable sheet must be scoped to one page or the other.
 *
 * Two further quirks are load-bearing for tests:
 *
 * 1. `EditView` listens only to `change:right` on the shared `picked` model, so
 *    moving the approvals slider between two approvals that resolve to the same
 *    right-hand change index does **not** re-render it. Walking the slider
 *    0,1,2,… (never jumping straight from the default max to the last approval)
 *    keeps every step a genuine change of `right`.
 * 2. `approve_change` approves `recorded_changes.at(picked.right)` — exactly one
 *    `VampireApproval` row per click, pointing at a single change — and then
 *    re-renders in place, so a click can be waited on by watching the approvals
 *    region grow rather than by re-navigating.
 */

const {
  navigateToHash,
  waitForJqmLoader,
  activePageId,
  hardReload,
  setJqmSlider,
  normalize
} = require('./jqm-helpers');

const PAGE = '#character-approval';
const SHEET_PAGE = '#printable-sheet';
const NO_APPROVAL_PAGE = '#character-print-no-approval';

/**
 * Open a character's approval view.
 *
 * Two app-side quirks make this less straightforward than the other routes.
 *
 * 1. The view renders one region per recorded change plus a slider, so on a
 *    character with a full creation history it is much slower to settle than
 *    the rest of the app and needs a longer wait than the default.
 *
 * 2. Navigating here directly after another character view can strand the
 *    router: the route only calls `$.mobile.changePage` once
 *    `CharacterApprovalView.register` resolves, `register` short-circuits when
 *    handed the same model instance it already holds, and its final
 *    `p.then(function () { Parse.Promise.as(self); })` is missing a `return`
 *    (CharacterApprovalView.js). The result is a silent no-op with no error
 *    logged and the previous page left active. Routing via the character sheet
 *    first clears that state reliably.
 */
async function openApproval(page, characterId, { timeout = 60000 } = {}) {
  try {
    await navigateToHash(page, `character/${characterId}/approval`, PAGE, timeout);
    return;
  } catch (first) {
    // Bounce through the sheet and retry once before giving up.
    await navigateToHash(page, `character?${characterId}`, '#character', timeout).catch(() => {});
    try {
      await navigateToHash(page, `character/${characterId}/approval`, PAGE, timeout);
    } catch (second) {
      throw new Error(
        `could not open the approval view for ${characterId}, even after routing via the ` +
        `character sheet. ${second.message}`
      );
    }
  }
}

/**
 * Reload the app and open the approval view on a genuinely fresh character.
 *
 * `Vampire.get_character` caches the character on the router and never
 * refetches it (models/Vampire.js: once `character_cache._character` is set,
 * only a *different* id clears it, and `fetchAllIfNeeded` will not re-read a
 * trait it already holds). A storyteller session that loaded the character
 * before the player's latest change therefore renders the *old* trait values
 * for as long as the page lives — approving from that state would approve a
 * change the view never showed. Reloading is the established remedy.
 *
 * The hash is parked on the character sheet *before* reloading so the app boots
 * on a cheap route rather than re-running the expensive approval route twice.
 */
async function freshApproval(page, characterId, { timeout = 60000 } = {}) {
  await page.evaluate((h) => { window.location.hash = h; }, `#character?${characterId}`);
  await hardReload(page);
  await openApproval(page, characterId, { timeout });
}

/**
 * Read the change-range sliders.
 *
 * jQuery Mobile renders its slider control as `input[type="number"]`, not
 * `input[type="range"]`, so the obvious selector finds nothing. There are two:
 * `historyBaseRange` (`#sliderbaserange`) is the left bound and
 * `historyChangePicker` (`#slider`) is the right bound. Both default to
 * covering the whole history, which is why the approve button already reads
 * "Approve changes up to N" on arrival.
 */
async function readSlider(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;

    const read = (name) => {
      const input = root.querySelector(`input[name="${name}"]`);
      if (!input) return null;
      return {
        value: parseInt(input.value, 10),
        min: parseInt(input.getAttribute('min') || '0', 10),
        max: parseInt(input.getAttribute('max') || '0', 10),
        id: input.id
      };
    };

    const left = read('historyBaseRange');
    const right = read('historyChangePicker');
    if (!left && !right) return null;
    return { left, right, value: right ? right.value : null, max: right ? right.max : null };
  }, PAGE);
}

/** Move the approval range to cover changes `from`..`to`. */
async function setApprovalRange(page, from, to) {
  if (from !== undefined && from !== null) {
    await setJqmSlider(page, `${PAGE} input[name="historyBaseRange"]`, from);
  }
  if (to !== undefined && to !== null) {
    await setJqmSlider(page, `${PAGE} input[name="historyChangePicker"]`, to);
  }
}

/** The ids of every recorded change the view currently holds, in order. */
async function readRecordedChangeIds(page) {
  return page.evaluate(() => {
    const region = document.querySelector('#approval-changes');
    if (!region) return [];
    return Array.from(region.querySelectorAll('input[id^="history-changes-"]'))
      .sort((a, b) => parseInt(a.id.split('-').pop(), 10) - parseInt(b.id.split('-').pop(), 10))
      .map((input) => input.value)
      .filter(Boolean);
  });
}

/** The label on the approve button, e.g. "Approve changes up to 26". */
async function readApproveButtonLabel(page) {
  const button = page.locator(`${PAGE} .approve-change`).first();
  if (await button.count() === 0) return null;
  return normalize(await button.textContent());
}

/**
 * What `#approval-edit` is currently showing.
 *
 * `mode` is one of:
 *  - `button` — an approve control, with `label` and the change index it would
 *    approve up to (`upTo`);
 *  - `none`   — the literal "No unapproved changes", i.e. the newest approval
 *    already points at the newest recorded change;
 *  - `table`  — an existing approval is selected on the approvals slider, and
 *    its `createdAt / approved / change / approver / owner` row is rendered.
 */
async function readEditRegion(page) {
  return page.evaluate(() => {
    const region = document.querySelector('#approval-edit');
    if (!region) return { mode: 'missing', text: '' };
    const text = region.textContent.replace(/\s+/g, ' ').trim();

    const button = region.querySelector('.approve-change');
    if (button) {
      const label = button.textContent.replace(/\s+/g, ' ').trim();
      const m = label.match(/up to\s+(-?\d+)/);
      return { mode: 'button', text, label, upTo: m ? parseInt(m[1], 10) : null };
    }

    const table = region.querySelector('table');
    if (table) {
      // jQuery Mobile's responsive table injects a `<b class="ui-table-cell-label">`
      // carrying the column name into every `<td>`, so a bare `td.textContent`
      // reads "approveruser_sampast" rather than "user_sampast".
      const cellText = (td) => {
        const copy = td.cloneNode(true);
        copy.querySelectorAll('.ui-table-cell-label').forEach((el) => el.remove());
        return copy.textContent.replace(/\s+/g, ' ').trim();
      };
      const headers = Array.from(table.querySelectorAll('thead th'))
        .map((th) => th.textContent.replace(/\s+/g, ' ').trim());
      const cells = Array.from(table.querySelectorAll('tbody tr td')).map(cellText);
      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i]; });
      return { mode: 'table', text, headers, row };
    }

    if (/No unapproved changes/i.test(text)) return { mode: 'none', text };
    return { mode: 'unknown', text };
  });
}

/** True when the current user is offered an approve control at all. */
async function canApprove(page, characterId) {
  await openApproval(page, characterId);
  return (await page.locator(`${PAGE} .approve-change`).count()) > 0;
}

/** The approval ids currently rendered, read without navigating anywhere. */
async function readApprovalsFromView(page) {
  return page.evaluate(() => {
    const region = document.querySelector('#approval-approvals');
    if (!region) return [];
    return Array.from(region.querySelectorAll('input[id^="approval-changes-"]'))
      .sort((a, b) => parseInt(a.id.split('-').pop(), 10) - parseInt(b.id.split('-').pop(), 10))
      .map((input) => input.value)
      .filter(Boolean);
  });
}

/**
 * Approve every change recorded so far, from an already-open approval view.
 *
 * Returns the approval ids after the click. `approve_change` adds the new
 * approval to the collection and re-renders in place, so the landing signal is
 * the approvals region growing by one — no re-navigation needed, which matters
 * because this route is the slowest in the app.
 */
async function approveFromOpenView(page, { timeout = 30000 } = {}) {
  const button = page.locator(`${PAGE} .approve-change`).first();
  if (await button.count() === 0) {
    const edit = await readEditRegion(page);
    throw new Error(
      `no approve control is available on this character for this user (#approval-edit is showing ` +
      `"${edit.mode}": ${edit.text.slice(0, 120)})`
    );
  }

  const before = await readApprovalsFromView(page);
  await button.click();
  await waitForJqmLoader(page);

  await page.waitForFunction(
    (n) => {
      const region = document.querySelector('#approval-approvals');
      if (!region) return false;
      return region.querySelectorAll('input[id^="approval-changes-"]').length > n;
    },
    before.length,
    { timeout }
  );

  return readApprovalsFromView(page);
}

/**
 * Approve every change recorded so far.
 * Pushes the slider to its maximum, then commits.
 */
async function approveLatestChange(page, characterId) {
  await openApproval(page, characterId);

  const slider = await readSlider(page);
  if (slider && slider.right && slider.right.value !== slider.right.max) {
    await setApprovalRange(page, null, slider.right.max);
  }

  return approveFromOpenView(page);
}

/**
 * The approvals recorded against a character, as their object ids.
 *
 * The approvals region is not a table or a list: it is a second jQuery Mobile
 * slider (`#approval-slider`, name `approvalChangePicker`) whose `max` equals
 * the number of approvals, accompanied by one hidden
 * `#approval-changes-N` input per approval holding that approval's object id.
 * Scraping it for `tr` or `li` elements finds nothing and makes every approval
 * look like it silently failed.
 */
async function readApprovals(page, characterId) {
  await openApproval(page, characterId);
  return readApprovalsFromView(page);
}

/** The approvals slider's current position and maximum, read without navigating. */
async function readApprovalSliderFromView(page) {
  return page.evaluate(() => {
    const input = document.querySelector('#approval-approvals input[name="approvalChangePicker"]');
    if (!input) return null;
    return {
      value: parseInt(input.value, 10),
      max: parseInt(input.getAttribute('max') || '0', 10)
    };
  });
}

/** The approvals slider's current position and maximum. */
async function readApprovalSlider(page, characterId) {
  await openApproval(page, characterId);
  return readApprovalSliderFromView(page);
}

/** Select an existing approval by index on the approvals slider. */
async function setApprovalIndex(page, index) {
  await setJqmSlider(page, '#approval-approvals input[name="approvalChangePicker"]', index);
  // ApprovalsView re-points `picked`, and EditView / ChangesSelectedView both
  // re-render off a debounced (100ms) listener on it.
  await page.waitForTimeout(350);
}

async function countApprovals(page, characterId) {
  return (await readApprovals(page, characterId)).length;
}

/**
 * The change rows `#approval-viewing` is currently displaying, as objects keyed
 * by the template's own column headers (`id`, `createdAt`, `category`, `name`,
 * `type`, `old_value`, `value`, `old_free_value`, `free_value`, `old_cost`,
 * `cost`, `old_text`, `new_text`).
 */
async function readSelectedChanges(page) {
  return page.evaluate(() => {
    const region = document.querySelector('#approval-viewing');
    if (!region) return [];
    const table = region.querySelector('table');
    if (!table) return [];
    // See readEditRegion: jQuery Mobile injects the column name into each cell.
    const cellText = (td) => {
      const copy = td.cloneNode(true);
      copy.querySelectorAll('.ui-table-cell-label').forEach((el) => el.remove());
      return copy.textContent.replace(/\s+/g, ' ').trim();
    };
    const headers = Array.from(table.querySelectorAll('thead th'))
      .map((th) => th.textContent.replace(/\s+/g, ' ').trim());
    return Array.from(table.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map(cellText);
      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i]; });
      return row;
    });
  });
}

/** Rows listed in the pending-changes region. */
async function readPendingChanges(page, characterId) {
  await openApproval(page, characterId);
  return readSelectedChanges(page);
}

/**
 * Try to open the approval view without insisting that it works.
 *
 * `openApproval` retries and then throws, which is the right behaviour for a
 * user who is supposed to get there. The access-control tests need the
 * opposite: set the hash, give the route every chance to run, and report where
 * the application actually ended up. A denied user gets no page transition at
 * all — `characterapproval`'s `get_character` rejects and the whole chain lands
 * in `.fail(PromiseFailReport)` — so the hash changes while the previous page
 * stays active.
 */
async function attemptOpenApproval(page, characterId, { timeout = 15000 } = {}) {
  await page.evaluate((h) => { window.location.hash = h; }, `#character/${characterId}/approval`);
  const deadline = Date.now() + timeout;
  let active = null;
  while (Date.now() < deadline) {
    active = await activePageId(page);
    if (active === 'character-approval') break;
    await page.waitForTimeout(500);
  }
  await waitForJqmLoader(page);
  return {
    activePage: await activePageId(page),
    hash: await page.evaluate(() => window.location.hash),
    approveControls: await page.locator(`${PAGE} .approve-change`).count()
  };
}

/**
 * Structured read of a rendered printable sheet.
 *
 * `CharacterPrintView` renders through `character-print-parent.html` (the
 * `character-print-view.html` import in the same file is dead code), so the
 * sheet is a set of `cpp-*` regions rather than one template. Sections
 * (`Backgrounds`, `Disciplines`, `Merits`, `Skills`, and the three attribute
 * blocks) are all rendered as an `<h4>`/`<h2>` header followed by bare text
 * nodes separated by `<br/>` — `print/section.html` interpolates
 * `format_skill(...)` unescaped — so the only reliable way to associate an
 * entry with its heading is to walk the DOM in order.
 *
 * Formats differ per section, which is what assertions have to match:
 * skills/backgrounds/disciplines use style 1 (`"Athletics x2"`), merits and
 * flaws use style 4 (`"Moniker (1)"`), and attributes render as a bare number.
 */
async function readPrintableSheet(page, pageSelector = SHEET_PAGE) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;

    const clean = (s) => s.replace(/\s+/g, ' ').trim();

    const sections = {};
    let current = null;
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag === 'H4' || tag === 'H2' || tag === 'H1') {
            const label = clean(child.textContent);
            // "Clan: Brujah" style bars carry their value inline; section
            // headers do not.
            current = label.indexOf(':') === -1 ? label : null;
            if (current && !sections[current]) sections[current] = [];
            continue;
          }
          if (tag === 'BR' || tag === 'SCRIPT' || tag === 'STYLE') continue;
          walk(child);
        } else if (child.nodeType === 3) {
          const t = clean(child.textContent);
          if (t && current) sections[current].push(t);
        }
      }
    };
    walk(root);

    const bars = {};
    root.querySelectorAll('#cpp-firstbar h2, #cpp-secondbar h2').forEach((h) => {
      const t = clean(h.textContent);
      const i = t.indexOf(':');
      if (i > 0) bars[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });

    const attributes = {};
    ['Physical', 'Social', 'Mental'].forEach((name) => {
      const entries = sections[name];
      if (!entries || entries.length === 0) return;
      const n = parseInt(entries[0], 10);
      if (!isNaN(n)) attributes[name] = n;
    });

    const header = root.querySelector('#cpp-header h1');

    return {
      pageId: root.id,
      name: header ? clean(header.textContent) : null,
      bars,
      attributes,
      sections,
      text: clean(root.textContent)
    };
  }, pageSelector);
}

/**
 * Open `#character/:cid/print` or `#character/:cid/approved` and read the sheet.
 *
 * Both routes render into the *same* `#printable-sheet` page element through
 * the same memoized `characterPrintView`, so going straight from one to the
 * other leaves that page already active and `waitForActivePage` returns
 * instantly against the previous route's content. Parking on the character
 * sheet first makes the transition a genuine signal. `reload` additionally
 * clears the router's character cache, which never invalidates on its own.
 */
async function openPrintable(page, characterId, kind, { reload = false, timeout = 30000 } = {}) {
  if (kind !== 'print' && kind !== 'approved') {
    throw new Error(`openPrintable expects "print" or "approved", got "${kind}"`);
  }

  const active = await activePageId(page);

  // Reload up front rather than letting `navigateToHash` discover the problem.
  //
  // Leaving `#character-approval` strands the router outright, and leaving
  // `#printable-sheet` for the *other* printable route is worse than useless:
  // both routes render into that one page element, so it is already active and
  // `waitForActivePage` returns instantly against the previous route's content.
  // Letting the generic fallback cascade handle either case costs three full
  // timeouts before it reaches the reload it was always going to need.
  if (reload || active === 'character-approval' || active === 'printable-sheet') {
    await page.evaluate((h) => { window.location.hash = h; }, `#character?${characterId}`);
    await hardReload(page);
  }

  await navigateToHash(page, `character/${characterId}/${kind}`, SHEET_PAGE, timeout);
  await waitForJqmLoader(page);
  return readPrintableSheet(page, SHEET_PAGE);
}

/** Read the approved snapshot sheet (`#character/:cid/approved`). */
async function readApprovedSheet(page, characterId, options = {}) {
  return openPrintable(page, characterId, 'approved', options);
}

/** Read the current printable sheet (`#character/:cid/print`). */
async function readPrintSheet(page, characterId, options = {}) {
  return openPrintable(page, characterId, 'print', options);
}

/**
 * Where `#character/:cid/approved` actually lands.
 *
 * With no approvals at all `get_transformed_last_approved` resolves to `null`
 * and the route swaps to `#character-print-no-approval` ("No approved versions
 * of your character") instead of `#printable-sheet` — there is no creation
 * baseline snapshot to show.
 */
async function openApprovedAllowingNone(page, characterId, { timeout = 30000 } = {}) {
  const startedOn = await activePageId(page);
  if (startedOn === 'printable-sheet' || startedOn === 'character-approval' || startedOn === 'character-print-no-approval') {
    await page.evaluate((h) => { window.location.hash = h; }, `#character?${characterId}`);
    await hardReload(page);
  }
  await page.evaluate((h) => { window.location.hash = h; }, `#character/${characterId}/approved`);

  const deadline = Date.now() + timeout;
  let active = null;
  while (Date.now() < deadline) {
    active = await activePageId(page);
    if (active === 'printable-sheet' || active === 'character-print-no-approval') break;
    await page.waitForTimeout(400);
  }
  await waitForJqmLoader(page);
  active = await activePageId(page);
  return {
    activePage: active,
    text: normalize(await page.locator(active ? `#${active}` : 'body').textContent()),
    sheet: active === 'printable-sheet' ? await readPrintableSheet(page, SHEET_PAGE) : null
  };
}

module.exports = {
  PAGE,
  SHEET_PAGE,
  NO_APPROVAL_PAGE,
  openApproval,
  freshApproval,
  readSlider,
  setApprovalRange,
  readRecordedChangeIds,
  readApproveButtonLabel,
  readEditRegion,
  canApprove,
  approveFromOpenView,
  approveLatestChange,
  readApprovals,
  readApprovalsFromView,
  readApprovalSlider,
  readApprovalSliderFromView,
  setApprovalIndex,
  countApprovals,
  readSelectedChanges,
  readPendingChanges,
  attemptOpenApproval,
  readPrintableSheet,
  openPrintable,
  readApprovedSheet,
  readPrintSheet,
  openApprovedAllowingNone
};
