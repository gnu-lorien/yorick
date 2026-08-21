/**
 * Description-catalogue helpers.
 *
 * Every picker in the app is backed by the `Description` class filtered on a
 * `category`. The simpletext pickers derive their category by appending "s" to
 * the character's text attribute (`wta_tribe` -> `wta_tribes`), which is why an
 * unseeded category shows up as a silently empty list rather than an error.
 *
 * Out of scope: `ctdbs_noble_houses`, `ctdbs_realms` and `wta_monikers` have no
 * source rows anywhere in the repository, so their pickers are legitimately
 * empty. They have been dropped from the suite by decision rather than blocked
 * on authoring game data, and so are absent from the coverage lists below.
 * `UNSEEDABLE_CATEGORIES` keeps them only as a guard, so a future test that
 * reaches for one fails with that explanation rather than a confusing
 * empty-list assertion.
 */

const {
  navigateToHash,
  hardReload,
  waitForActivePage,
  clearStuckLoader,
  selectBackformOption,
  fillBackformInput,
  runInApp
} = require('./jqm-helpers');

/** Text attributes per venue, mirroring TEXT_ATTRIBUTES in each model. */
const TEXT_ATTRIBUTES = {
  Vampire: ['clan', 'archetype', 'sect', 'faction', 'title', 'antecedence'],
  Werewolf: ['archetype', 'archetype_2', 'wta_breed', 'wta_auspice', 'wta_tribe', 'wta_camp', 'wta_faction', 'antecedence'],
  // `ctdbs_noble_house` is omitted: its `ctdbs_noble_houses` catalogue has no
  // source data in the repository and is out of scope.
  Changeling: ['archetype', 'ctdbs_kith', 'ctdbs_fealty_court', 'ctdbs_kith_group_type', 'antecedence']
};

/** Trait categories unique to each venue. */
const VENUE_ONLY_TRAIT_CATEGORIES = {
  Vampire: [
    'disciplines', 'techniques', 'elder_disciplines', 'luminary_disciplines', 'rituals',
    'sabbat_rituals', 'vampiric_texts', 'status_traits', 'paths', 'extra_in_clan_disciplines',
    'haven_specializations'
  ],
  Werewolf: [
    'wta_gifts', 'extra_affinity_links', 'wta_backgrounds', 'wta_territory_specializations',
    'wta_rites', 'wta_totem_bonus_traits', 'wta_gnosis_sources'
  ],
  Changeling: [
    'ctdbs_arts', 'ctdbs_arts_affinities_links', 'ctdbs_backgrounds',
    'ctdbs_holdings_specializations'
  ]
};

/** Categories every venue shares. */
const SHARED_TRAIT_CATEGORIES = [
  'attributes', 'focus_physicals', 'focus_mentals', 'focus_socials',
  'health_levels', 'willpower_sources', 'skills',
  'lore_specializations', 'academics_specializations', 'drive_specializations',
  'linguistics_specializations', 'contacts_specializations', 'allies_specializations',
  'influence_elite_specializations', 'influence_underworld_specializations'
];

/**
 * Categories with no source rows in the repository.
 * Neither `database_seed/Description.json` nor any CSV under `data/` defines
 * them, so nothing can seed them without inventing game content.
 */
const UNSEEDABLE_CATEGORIES = ['ctdbs_noble_houses', 'ctdbs_realms', 'wta_monikers'];

/** The Description category a text attribute's picker reads. */
function categoryForTextAttribute(attribute) {
  return attribute + 's';
}

/** Count the Description rows in a category, straight from Parse. */
async function countDescriptions(page, category) {
  return page.evaluate(async (cat) => {
    const q = new window.Parse.Query('Description');
    q.equalTo('category', cat);
    return q.count();
  }, category);
}

/** Distinct categories present in the database. */
async function listCategories(page) {
  return page.evaluate(async () => {
    const q = new window.Parse.Query('Description');
    q.select('category');
    q.limit(1000);
    const rows = await q.find();
    const seen = {};
    rows.forEach((r) => { seen[r.get('category')] = (seen[r.get('category')] || 0) + 1; });
    return seen;
  });
}

/**
 * Fail loudly and informatively when a category a test depends on is empty.
 * Distinguishes "known to have no source data" from "seeding is broken".
 */
async function assertCategorySeeded(page, category) {
  const count = await countDescriptions(page, category);
  if (count > 0) return count;

  if (UNSEEDABLE_CATEGORIES.indexOf(category) !== -1) {
    throw new Error(
      `Description category "${category}" is deliberately out of scope: the repository contains no ` +
      `source data for it (absent from database_seed/Description.json and every data/*.csv), and it ` +
      `was dropped from the suite rather than blocked on authoring game content. ` +
      `No test should depend on it.`
    );
  }
  throw new Error(
    `Description category "${category}" is empty. It should have been backfilled from ` +
    `data/all_dev_descriptions.csv by seed_extra.js - check the seed ran.`
  );
}

/**
 * Read the active picker's options once the list has stopped changing.
 *
 * `#simpletrait-new` is one page element shared by every category, so
 * `waitForActivePage` can be satisfied the instant the page is active - which
 * is before Marionette has finished re-rendering the region for *this*
 * category. Reading straight after the navigation therefore catches it either
 * mid-render (empty) or still showing the previous category.
 *
 * So poll until two consecutive reads agree, the same settle-then-read shape
 * `lifecycle.js#readLogPage` uses for the log table. A stable non-empty list is
 * returned as soon as it settles; a stable *empty* one has to sit out
 * `emptyGrace` first, because empty is also what a mid-render read returns. On
 * timeout this returns whatever it last saw rather than throwing, so a picker
 * that really is empty fails the caller's own assertion with the real number
 * instead of an opaque timeout.
 */
async function readSettledPickerOptions(page, { timeout = 15000, interval = 200, emptyGrace = 3000 } = {}) {
  const read = () => page.evaluate(() => {
    const pg = document.querySelector('.ui-page-active');
    if (!pg) return [];
    return Array.from(pg.querySelectorAll('a.simpletrait, ul li a'))
      .map((a) => (a.getAttribute('name') || a.textContent).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  });

  const deadline = Date.now() + timeout;
  const emptyDeadline = Date.now() + emptyGrace;
  let previous = await read();
  while (Date.now() < deadline) {
    await page.waitForTimeout(interval);
    const current = await read();
    if (current.join(String.fromCharCode(31)) === previous.join(String.fromCharCode(31))) {
      if (current.length > 0) return current;
      if (Date.now() >= emptyDeadline) return current;
    }
    previous = current;
  }
  return previous;
}

/**
 * Options offered by a trait category's "new" picker.
 *
 * HELPER FIX: this previously called `navigateToHash` without a target
 * selector, so it never actually waited for `#simpletrait-new` to become the
 * active, populated page before reading it - a race that could return the
 * *previous* page's links (or none) depending on how fast SimpleTraitNewView's
 * own Description fetch happened to resolve. Passing the target selector
 * narrowed that but did not close it, because the shared page element makes
 * "active and non-empty" true too early; see `readSettledPickerOptions`.
 */
async function listTraitPickerOptions(page, characterId, category) {
  await navigateToHash(page, `simpletraits/${category}/${characterId}/new`, '#simpletrait-new');
  return readSettledPickerOptions(page);
}

/**
 * The exact visible text of one option in a trait category's "new" picker.
 *
 * Deliberately reads `textContent` rather than the `name` attribute (which is
 * what `listTraitPickerOptions` above matches on): the template
 * (`simpletrait-new-list.html`) renders `"<name> x<value>"` when the backing
 * Description has a `value`, and only the rendered text carries that suffix -
 * the attribute is always the bare name. That suffix is exactly what proves a
 * Description edit reached the picker (test 35), so this is kept separate
 * rather than changing what the existing helper matches on.
 */
async function traitPickerOptionText(page, characterId, category, name) {
  await navigateToHash(page, `simpletraits/${category}/${characterId}/new`, '#simpletrait-new');
  // Settle for the same reason as `listTraitPickerOptions`: without this, a
  // mid-render read reports "no such option" rather than the option's text.
  await readSettledPickerOptions(page);
  const link = page.locator(`#simpletrait-new a.simpletrait[name="${name.replace(/"/g, '\\"')}"]`).first();
  if (await link.count() === 0) return null;
  const text = await link.textContent();
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** Trait categories the character sheet actually offers for a character. */
async function listSheetCategories(page, characterId) {
  await navigateToHash(page, `character?${characterId}`, '#character');
  return page.evaluate(() => {
    const pg = document.querySelector('#character');
    if (!pg) return [];
    const found = new Set();
    pg.querySelectorAll('a[href*="#simpletraits/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/#simpletraits\/([^/]+)\//);
      if (m) found.add(m[1]);
    });
    return Array.from(found).sort();
  });
}

/**
 * The admin bulk-CSV editor (EditRules.js and DescriptionsView.js) is one
 * mechanism shared by six admin routes: `#administration/descriptions` and
 * the five `#administration/bnsmetv1_*_rules` / `#administration/bnsctdbs_
 * kith_rules` routes. All six render into the *same* page id
 * (`#administration-descriptions`) and the same two region container ids
 * (`#descriptions-sections`, `#administration-descriptions-list`) - there is
 * no separate "add row" form; the textarea in `#administration-descriptions-
 * list` *is* both the rendered table (a CSV export of whichever category is
 * selected above it) and the add/edit form (typing a new or changed row into
 * it and clicking "Update Changes to Server" is the entire interface).
 *
 * Two things make driving this safely non-obvious, confirmed against a live
 * server:
 *
 * 1. **Stale cross-route state.** Each of the six routes memoizes its own
 *    top-level view on the router instance (`self.administrationEditRules`
 *    for all five rule routes - reused and merely reconfigured via
 *    `update_rule_name()` - and `self.administrationDescriptionsView`
 *    separately for Descriptions), but every one of those views targets the
 *    *same* shared DOM regions. Navigating between, say, the Descriptions
 *    admin and a rule editor within one page session can leave a previous
 *    route's DataForm still bound to `#administration-descriptions-list`
 *    alongside the new one; which one an automated click actually reaches is
 *    then a DOM-order accident. Confirmed live: a submit intended for
 *    `bnsmetv1_TechniqueRule` landed on a stale `DescriptionsView` handler
 *    instead and silently created a `Description` row. A full reload before
 *    every visit (see `openAdminBulkEditor`) avoids this entirely, because
 *    it forces a genuinely fresh router and a single fresh view.
 * 2. **A separate, identical defect** ("stuck loading overlay" - see
 *    `clearStuckLoader` in jqm-helpers.js) affects all six routes exactly the
 *    way it affects the Patronage admin routes Task 1 found: `$.mobile.
 *    loading("show")` is called up front and only ever hidden inside a
 *    `.fail(...)` branch, never unconditionally on success.
 */
const ADMIN_LIST_SELECTOR = '#administration-descriptions-list';
const ADMIN_TEXTAREA_SELECTOR = `${ADMIN_LIST_SELECTOR} textarea[name="descriptiondata"]`;
const ADMIN_SUBMIT_SELECTOR = `${ADMIN_LIST_SELECTOR} button[type="submit"]`;
const ADMIN_CATEGORY_SELECT_SELECTOR = '#descriptions-sections select[name="category"]';
const DESCRIPTIONS_ADMIN_HASH = 'administration/descriptions';

/** Quote a single CSV field the way a real admin typing into the textarea would. */
function csvQuote(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Build a minimal CSV blob: a header row followed by exactly one data row.
 *
 * Deliberately never includes any row beyond the one being added or edited.
 * `filterwith` (the app's own category-select handler) round-trips *every*
 * currently-matching row through the same submit handler, and for a rule
 * class with no reliable identity key (see rules.js) resubmitting that whole
 * blob corrupts unrelated rows. Building a single-row CSV by hand instead -
 * still typed into the same real textarea, still submitted through the same
 * real button - avoids that regardless of which class is being edited. Must
 * not end in a trailing newline: Papa Parse (header: true) treats a trailing
 * blank line as a malformed extra row ("Too few fields") and the submit
 * handler discards the whole submission before saving anything. Confirmed
 * live.
 */
function buildSingleRowCsv(fields) {
  const keys = Object.keys(fields);
  const header = keys.join(',');
  const row = keys.map((k) => csvQuote(fields[k])).join(',');
  return `${header}\n${row}`;
}

/**
 * Navigate to one of the six shared-page admin bulk-editor routes.
 *
 * Always reloads first - see the file-level comment above for why a plain
 * hash change is not safe here - then clears the stuck-loader defect
 * defensively so the very next interaction is not swallowed by a leftover
 * full-page overlay.
 */
async function openAdminBulkEditor(page, hash) {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  const current = await page.evaluate(() => window.location.hash.replace(/^#/, ''));
  if (current !== clean) {
    await page.evaluate((h) => { window.location.hash = '#' + h; }, clean);
  }
  await hardReload(page);
  await waitForActivePage(page, 'administration-descriptions');
  await clearStuckLoader(page);
}

/** Navigate to the Descriptions admin specifically. */
async function openDescriptionsAdmin(page) {
  await openAdminBulkEditor(page, DESCRIPTIONS_ADMIN_HASH);
}

/**
 * Parse the bulk editor's current textarea content into rows, using the
 * app's own already-loaded Papa Parse (same module, same options the submit
 * handler itself uses), so "what the table shows" is read exactly the way
 * the app produces it rather than via a hand-rolled CSV parser that might
 * disagree with it on an edge case.
 */
async function readBulkEditorRows(page) {
  return runInApp(page, ['papaparse'], `
    var ta = document.querySelector(arg.selector);
    if (!ta) return { fields: [], rows: [], errors: [] };
    var parsed = mods[0].parse(ta.value, { header: true });
    return { fields: parsed.meta.fields || [], rows: parsed.data || [], errors: parsed.errors || [] };
  `, { selector: ADMIN_TEXTAREA_SELECTOR });
}

/**
 * Select a category from the bulk editor's own category dropdown and wait
 * for the resulting server round-trip (`filterwith` in EditRules.js /
 * DescriptionsView.js) to repopulate the textarea. Selecting "All" is what
 * makes ClanRule/ElderDisciplineRule/TechniqueRule/RitualRule data visible at
 * all - see rules.js for why their own single non-"All" bucket is unusable.
 */
async function selectBulkEditorCategory(page, label) {
  const before = await page.locator(ADMIN_TEXTAREA_SELECTOR).inputValue();
  await selectBackformOption(page, ADMIN_CATEGORY_SELECT_SELECTOR, label);
  await page.waitForFunction(({ sel, before }) => {
    const el = document.querySelector(sel);
    return !!el && el.value !== before && el.value.length > 0;
  }, { sel: ADMIN_TEXTAREA_SELECTOR, before }, { timeout: 15000 }).catch(() => {});
  // The above resolves as soon as the value changes at all; give the fetch a
  // moment to fully settle before anything reads the textarea.
  await page.waitForTimeout(300);
}

/** Fill the bulk editor's textarea with an exact CSV string (a Backform control; see fillBackformInput). */
async function setBulkEditorCsv(page, csvText) {
  await fillBackformInput(page, ADMIN_TEXTAREA_SELECTOR, csvText);
}

/** Click "Update Changes to Server". The handler gives no visible success/failure signal either way - see rules.js. */
async function submitBulkEditorForm(page) {
  await page.locator(ADMIN_SUBMIT_SELECTOR).click();
  // There is no loader, status text, or navigation to wait on (confirmed by
  // reading DataForm's submit handler: every individual save failure is
  // swallowed by its own .fail(console.log) and the outer chain always logs
  // "Saved all of that" regardless). A fixed settle is the only option; callers
  // verify the real outcome via Parse afterward.
  await page.waitForTimeout(1200);
}

/**
 * Type a single minimal row into the bulk editor and submit it - the whole
 * "add or edit one record" interaction, real UI end to end. `hash` is the
 * admin route to submit through; `fields` becomes exactly one CSV data row.
 */
async function submitBulkEditorRow(page, hash, fields) {
  await openAdminBulkEditor(page, hash);
  await setBulkEditorCsv(page, buildSingleRowCsv(fields));
  await submitBulkEditorForm(page);
}

/** Read one Description straight from Parse by its natural key. Assertion-side read-back. */
async function getDescriptionByName(page, category, name) {
  return page.evaluate(async ({ category, name }) => {
    const q = new window.Parse.Query('Description').equalTo('category', category).equalTo('name', name);
    const r = await q.first();
    return r ? Object.assign({ id: r.id }, r.attributes) : null;
  }, { category, name });
}

/**
 * Add a Description through the real admin UI (`#administration/descriptions`).
 * Returns the created row, read back from Parse to capture its real id -
 * this is the one class among the six covered by this file where the bulk
 * editor's create path actually works (see rules.js for the defect that
 * blocks it for all five rule classes).
 */
async function createDescriptionViaAdmin(page, fields) {
  await submitBulkEditorRow(page, DESCRIPTIONS_ADMIN_HASH, fields);
  const created = await getDescriptionByName(page, fields.category, fields.name);
  if (!created) {
    throw new Error(`createDescriptionViaAdmin: no Description found for category=${fields.category} name=${fields.name} after submitting`);
  }
  return created;
}

/**
 * Edit an existing Description through the real admin UI. The lookup keys on
 * (category, name), so `fields` must include the record's *current*
 * category/name; any other field present in `fields` overwrites that field on
 * the existing row, and fields omitted from `fields` are left untouched.
 */
async function updateDescriptionViaAdmin(page, fields) {
  await submitBulkEditorRow(page, DESCRIPTIONS_ADMIN_HASH, fields);
  return getDescriptionByName(page, fields.category, fields.name);
}

/** Fixture teardown: remove Description rows this suite created, by real id. Mirrors Task 1's afterAll Parse cleanup. */
async function destroyDescriptions(page, ids) {
  // Report failures rather than swallowing them.
  //
  // This previously wrapped each destroy in `catch (e) { /* already gone */ }`,
  // which makes a genuine permission or network failure indistinguishable from
  // a row that was already deleted — so a leak is completely invisible. It was:
  // Task 11 tracked its ids correctly and called this faithfully, and a clan
  // Description still survived every run, silently pushing the seeded count
  // from 42 to 43. Only an out-of-band count caught it.
  //
  // Failures are returned rather than thrown, because this runs in `afterAll`
  // and turning a passing suite red at teardown would obscure the results it
  // just produced. Callers should surface a non-empty `failed` list.
  const result = await page.evaluate(async (ids) => {
    const failed = [];
    let destroyed = 0;
    for (const id of ids) {
      try {
        const obj = new window.Parse.Object('Description');
        obj.id = id;
        await obj.destroy();
        destroyed++;
      } catch (e) {
        failed.push({ id, message: e && e.message ? e.message : String(e) });
      }
    }
    return { destroyed, failed };
  }, ids);

  if (result.failed.length > 0) {
    console.warn(
      `[e2e] destroyDescriptions could not delete ${result.failed.length} of ${ids.length} row(s): ` +
      result.failed.map((f) => `${f.id} (${f.message})`).join('; ')
    );
  }
  return result;
}

module.exports = {
  TEXT_ATTRIBUTES,
  VENUE_ONLY_TRAIT_CATEGORIES,
  SHARED_TRAIT_CATEGORIES,
  UNSEEDABLE_CATEGORIES,
  categoryForTextAttribute,
  countDescriptions,
  listCategories,
  assertCategorySeeded,
  listTraitPickerOptions,
  traitPickerOptionText,
  listSheetCategories,

  // Shared admin bulk-CSV-editor toolkit (also used by helpers/rules.js).
  ADMIN_LIST_SELECTOR,
  ADMIN_TEXTAREA_SELECTOR,
  ADMIN_SUBMIT_SELECTOR,
  ADMIN_CATEGORY_SELECT_SELECTOR,
  DESCRIPTIONS_ADMIN_HASH,
  csvQuote,
  buildSingleRowCsv,
  openAdminBulkEditor,
  readBulkEditorRows,
  selectBulkEditorCategory,
  setBulkEditorCsv,
  submitBulkEditorForm,
  submitBulkEditorRow,

  // Description-admin convenience wrappers.
  openDescriptionsAdmin,
  getDescriptionByName,
  createDescriptionViaAdmin,
  updateDescriptionViaAdmin,
  destroyDescriptions
};
