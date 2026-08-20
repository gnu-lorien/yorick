/**
 * Task 6 - Rename And Portraits, Verified Everywhere They Appear
 *
 * Covers testing_implementation_plan.md items 99-128. Replaces the previous
 * shallow assertions in `character-sheet.spec.js` (asserted only the literal
 * string "Successfully Updated" after a rename, never revisited any other
 * view) and `character-sheet.spec.js` / `troupes.spec.js` (asserted a
 * portrait `<input type="file">` was attached, never uploaded anything).
 *
 * ---
 *
 * ## Fixture shape
 *
 * Two completed Vampires owned by `sampmem` ("Alpha", the main rename/
 * portrait subject; "Beta", used only for the name-collision test), one
 * troupe created by `devuser`, with Alpha joined to it. `memberPage`
 * (sampmem) performs the rename and the character-portrait uploads - the
 * realistic "player manages their own character" path. `adminPage` (devuser)
 * performs the one action a player structurally cannot (approving a change on
 * their own character - `beforeSave("VampireApproval")` rejects with
 * "Players cannot approve their own character changes" whenever
 * `isOwner && !isAdmin`, cloud/main.js:630) and every admin/troupe-scoped
 * route (`#troupe/...`, `#administration/...`), which `TroupeView`'s
 * `readonly = !(is_st || is_ad)` gate and the admin routes themselves close
 * off to a plain member (see troupes.spec.js's own finding 7 for the
 * ACL-level proof of that gate).
 *
 * `Vampire.get_character` caches exactly one character per router instance
 * (`character_cache._character`, models/Vampire.js:287-336) and mutates that
 * cached object **in place** on save - a rename via `character.set("name",
 * ...); character.save()` updates the live object every other route sharing
 * that cache slot will read. Concretely this means `memberPage`'s own cache,
 * warm from creating and renaming Alpha, already reflects the new name for
 * every subsequent same-character route with no reload required. A single
 * `hardReload` is still taken before each actor's first post-rename /
 * post-upload read below - cheap insurance against the memoized-view
 * short-circuits this codebase has repeatedly documented elsewhere (
 * `CharacterLogView.register`, `CharacterHistoryView`'s `LayoutView.register`,
 * `administrationSummarizeCharacters`/`troupeSummarizeCharacters` both being
 * constructed exactly once and bound to the identical DOM element) - not
 * because the single-slot cache itself was found to be a problem here.
 *
 * ---
 *
 * ## Findings that shape which tests are `test.fail()`
 *
 * **1. `name` genuinely is tracked, so the rename is genuinely logged (item
 * 113 is a real pass, not a `test.fail()`).** Unlike XP and long-text fields
 * - which the assignment brief calls out as excluded - `beforeSave("Vampire")`
 * 's `tracked_texts` allowlist (cloud/main.js:153-168) includes `"name"`.
 * Renaming produces one `VampireChange` row: `category: "core"`,
 * `name: "name"`, `type: "core_update"`, `old_text`/`new_text` the two names.
 *
 * **2. There is no name-uniqueness check anywhere in the codebase - item 114
 * is a `test.fail()`.** `CharacterRenameView.js`'s submit handler is exactly
 * `character.set("name", ...); character.save()`, with no client-side
 * validation. `beforeSave("Vampire")` only ever tracks the change; it never
 * queries for an existing row with the same name. `database_seed/_SCHEMA.json`
 * carries no unique index for `Vampire.name` (Parse Server schema JSON would
 * show one under `_metadata.indexes` if it existed - there is no such key).
 * Grepping every model file for "validate" and the whole repo for
 * "duplicate"/"already exists"/"unique" (case-insensitive) returns nothing
 * relevant. Confirmed live below: renaming Beta to Alpha's exact current name
 * succeeds with the same "Successfully Updated" feedback a legitimate rename
 * gets.
 *
 * **3. The printable sheet never renders a portrait `<img>` at all - item 118
 * is a `test.fail()`.** `CHARACTER_PORTRAIT_SELECTORS.print` in
 * helpers/portraits.js is `'#printable-sheet img'`, inherited from the plan's
 * assumption that a portrait renders there. Exhaustively grepping
 * `CharacterPrintView.js`, `character-print-parent.html`, the dead
 * `character-print-view.html`, `VampirePrintHelper.js`, and every other file
 * under `public/scripts/app/` for `<img` turns up exactly nine files, none of
 * them print-related (character-list-item.html, character-summarize-list-item
 * .html, referendums-list.html, single-character-list-item.html, troupe-list-
 * entry.html, troupe-portrait-display.html, troupe.html, troupes-list.html,
 * plus two PayPal button templates). `HeaderView`'s own template is
 * `'<h1 class="ui-bar ui-bar-a"><%= format_simpletext("name") %></h1>'` -
 * text only. This is confirmed live below (element count 0), not merely
 * asserted from source.
 *
 * **4. The XP history view never displays the character's name anywhere -
 * item 106 is a `test.fail()`.** `experienceNotationsAllView` (public/
 * index.html:515-616) renders `<p>Earned: ...</p>` / `Spent` / `Available`,
 * the notations table, and five popups - no `character.get("name")`
 * anywhere in the template, and `CharacterExperienceView.js`'s `render()`
 * passes only `character`/`logs`/`format_entry` into that same template, no
 * separate header injection the way `CharacterView.js` injects
 * `CharacterListItem` into `#insertheader` for the main sheet. The one-off
 * global `<h1>Default Title</h1>` fixed header (index.html:65-71) is never
 * updated by any application code (grepped for "Default Title" and for any
 * `pagecontainerbeforeshow`/title-sync handler; there is none) and in any
 * case `#experience-notations-all`'s own `data-title="Experience Notations"`
 * is a static string, not a template. Confirmed live below.
 *
 * **5. The sheet/roster/troupe-roster/select-to-print portrait is the
 * `thumb_128` JPEG, not the 200x200 PNG original - item 117's "200x200"
 * reading is corrected to the measured 128x128, matching Task 0's own
 * end-to-end finding ("a red 200x200 upload ... renders as a 128x128 JPEG
 * thumbnail").** Every one of those four surfaces' templates
 * (character-list-item.html, character-summarize-list-item.html,
 * single-character-list-item.html) calls `e.get_thumbnail_sync(128)`, which
 * reads `portrait.attributes.thumb_128.url` (models/Character.js:707-710).
 * `cloud/main.js`'s `crop_and_thumb` only ever generates 32/64/128/256
 * square JPEG thumbnails from a center crop; it never touches `original`.
 * Test 115 verifies the true original (200x200) directly through the
 * portrait-page's own `<img>`, which does render `original.url()` unscaled
 * (public/index.html:981-992) - the one surface in the whole app that does.
 *
 * **6. `#administration/characters/all` and `#administration/character/:id`
 * are not separate views - they reuse the exact same `#characters-all` and
 * `#character` page elements the personal-roster/sheet routes use, just
 * populated by `get_administrator_characters()` (all owned characters) and
 * `show_character_helper` respectively (mobileRouter.js:705-731,
 * 1864-1876).** `#administration/characters/summarize` likewise reuses
 * `#troupe-summarize-characters-all`, the same page id the troupe-scoped
 * summarize route renders into, via a second, independently-memoized
 * `CharactersSummarizeListView` instance bound to the identical
 * `"#troupe-summarize-characters-all > div[role='main']"` element
 * (CharactersSummarizeListView.js:272) - whichever route was visited most
 * recently is what is on screen. Tests 111/112/122 navigate directly to each
 * admin route immediately before reading, so this is never ambiguous here.
 *
 * **7. `CharacterPortrait`/`TroupePortrait` carry no `owner` back-pointer**
 * (`database_seed/_SCHEMA.json`: only `original`/`thumb_32/64/128/256`
 * fields) - unlike `SimpleTrait`/`ExperienceNotation`/`VampireCreation`,
 * which `destroyCharactersByPrefix` sweeps by querying `owner` `containedIn`
 * the matched characters, there is no query that finds "every portrait
 * belonging to an E2E T6 character" after the fact. Their ids are captured
 * into `state` at upload time and destroyed explicitly in `afterAll`, the
 * same way `troupes.spec.js` captures `CharacterRelationship` ids up front
 * because that class has the same gap. Both classes grant `"delete":{"*":
 * true}` (public delete), so no elevated session is required.
 * `VampireApproval` *does* carry `owner`, and is swept the same way
 * `approvals.spec.js` already does.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember } = require('./helpers/auth');
const {
  navigateToHash,
  hardReload,
  normalize,
  fillBackformInput
} = require('./helpers/jqm-helpers');
const {
  createCompletedCharacter,
  countCharactersByPrefix,
  destroyCharactersByPrefix
} = require('./helpers/characters');
const {
  uniqueTroupeName,
  createTroupe,
  joinTroupe,
  countTroupesByPrefix,
  destroyTroupesByPrefix
} = require('./helpers/troupes');
const { openLog, readLogRows, expectLogRow } = require('./helpers/logs');
const {
  approveLatestChange,
  readApprovedSheet,
  readPrintSheet,
  readPrintableSheet
} = require('./helpers/approvals');
const {
  CHARACTER_PORTRAIT_SELECTORS,
  TROUPE_PORTRAIT_SELECTORS,
  uploadCharacterPortrait,
  uploadTroupePortrait,
  expectPortraitMatches
} = require('./helpers/portraits');
const { ensureFixtures, fetchRenderedImage, assertImageColor } = require('./helpers/images');
const { openXp } = require('./helpers/xp');

const FIXTURE_PREFIX = 'E2E T6 ';

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Suite-local helpers
// ---------------------------------------------------------------------------

/**
 * Drive the real rename form (`#character-rename`, `CharacterRenameView.js`)
 * and report what the page actually showed.
 *
 * `hardReload` first, always: `characterRenameView` is memoized once on the
 * router and its Backform "submit" field - `status`/`message`/`disabled` -
 * persists in memory across visits within one page session (`register()`
 * only touches the form's `name` value, never resets the submit field), so a
 * second visit within the same session can start already showing a stale
 * "Successfully Updated" from a *previous* rename. Typing a new value still
 * clears it correctly (the form's delegated "change" handler resets
 * status/message/disabled whenever status was "success" - backform.js), but
 * reloading removes the ambiguity entirely rather than relying on that
 * reasoning holding at every call site.
 */
async function renameCharacter(page, characterId, newName) {
  await hardReload(page);
  await navigateToHash(page, `character/${characterId}/rename`, '#character-rename');

  const submit = page.locator('#character-rename button[name="submit"]');
  await expect(submit, 'submit starts disabled until the form is touched').toBeDisabled();

  await fillBackformInput(page, '#character-rename input[name="name"]', newName);
  await expect(submit, 'submit is enabled once the form registers a change').toBeEnabled();
  await submit.click();

  const status = page.locator('#character-rename span.status');
  await page.waitForFunction(() => {
    const el = document.querySelector('#character-rename span.status');
    return !!el && (el.classList.contains('text-success') || el.classList.contains('text-danger'));
  }, { timeout: 15000 });

  const isSuccess = await status.evaluate((el) => el.classList.contains('text-success'));
  const isError = await status.evaluate((el) => el.classList.contains('text-danger'));
  const text = normalize(await status.textContent());
  return { text, isSuccess, isError };
}

/** Rows of `#characters-all` (shared by the personal roster and the admin "all characters" list). */
async function readCharactersAllRows(page) {
  return page.evaluate(() => {
    // Inlined rather than calling the outer `normalize` helper - page.evaluate
    // callbacks run in the browser and cannot close over Node-side functions.
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('#characters-all');
    if (!root) return [];
    const list = root.querySelector('ul[data-role="listview"]');
    if (!list) return [];
    return Array.from(list.children).map((li) => {
      const a = li.querySelector('a');
      const h2 = li.querySelector('h2');
      return {
        id: a ? a.getAttribute('backendid') : null,
        name: h2 ? clean(h2.textContent) : null,
        text: clean(li.textContent)
      };
    });
  });
}

/**
 * Top-level rows of a Marionette CollectionView list (Summarize or
 * Select-to-Print), scoped to one page - mirrors `troupes.spec.js`'s
 * `readListRows` (not exported from there, so duplicated locally rather than
 * reaching into another spec file).
 */
async function readListItemTexts(page, pageId, listId) {
  return page.evaluate(({ pageId, listId }) => {
    const list = document.querySelector(`${pageId} ${listId}`);
    const ul = list ? list.querySelector('ul') : null;
    if (!ul) return [];
    return Array.from(ul.children).map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  }, { pageId, listId });
}

/** A character's portrait `<img>` within a specific list page, scoped by id so a multi-row list can't match a sibling's image. */
function scopedRosterPortraitSelector(pageId, characterId) {
  return `${pageId} a[backendid="${characterId}"] img.character-link-portrait`;
}

/** A troupe's directory-listing portrait `<img>`, scoped by id for the same reason. */
function scopedTroupeDirectoryPortraitSelector(troupeId) {
  return `#troupes-list a.troupe-listing[backendid="${troupeId}"] img.troupe-link-portrait`;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Task 6 - Rename And Portraits, Verified Everywhere They Appear', () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let adminContext, memberContext;
  /** @type {import('@playwright/test').Page} */
  let adminPage, memberPage;
  const state = {};
  let fixtures;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300000);

    adminContext = await browser.newContext();
    memberContext = await browser.newContext();
    adminPage = await adminContext.newPage();
    memberPage = await memberContext.newPage();
    await loginAsAdmin(adminPage);
    await loginAsMember(memberPage);

    fixtures = await ensureFixtures();

    // Self-heal first: sweep anything a crashed earlier run left behind, keyed
    // by the name prefix, so the baseline measured immediately afterwards is
    // trustworthy on a repeat run.
    const sweptChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX);
    const sweptTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX);
    console.log('[e2e assets] self-heal swept characters:', JSON.stringify(sweptChars));
    console.log('[e2e assets] self-heal swept troupes:', JSON.stringify(sweptTroupes));

    state.baseline = {
      allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()),
      allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()),
      allUsers: await adminPage.evaluate(() => new window.Parse.Query(window.Parse.User).count()),
      fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX),
      fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX)
    };
    console.log('[e2e assets] baseline counts:', JSON.stringify(state.baseline));

    // Troupe first (devuser), so the character exists only briefly before joining it.
    state.troupe = await createTroupe(adminPage, uniqueTroupeName(FIXTURE_PREFIX));

    // Two completed Vampires owned by sampmem. Alpha is the rename/portrait
    // subject; Beta exists only to be renamed *into a collision* with Alpha
    // (item 114) - a real second character with a real name, not a hardcoded
    // string.
    state.primary = await createCompletedCharacter(memberPage, 'Vampire', {
      name: `${FIXTURE_PREFIX}Alpha ${Date.now().toString(36)}`,
      texts: { clan: undefined }
    });
    state.primary.oldName = state.primary.name;

    state.secondary = await createCompletedCharacter(memberPage, 'Vampire', {
      name: `${FIXTURE_PREFIX}Beta ${Date.now().toString(36)}`,
      texts: { clan: undefined }
    });

    await joinTroupe(memberPage, state.primary.id, state.troupe.id);

    console.log('[e2e assets] fixture:', JSON.stringify({
      troupe: state.troupe.id,
      primary: state.primary.id,
      primaryName: state.primary.name,
      secondary: state.secondary.id,
      secondaryName: state.secondary.name
    }));
  });

  test.afterAll(async () => {
    if (!adminPage) return;

    await loginAsAdmin(adminPage).catch(() => {});

    // VampireApproval rows (test 103) - has an `owner` pointer, unlike the
    // portrait classes below, so it can be swept the same way
    // approvals.spec.js already does: query by owner, then destroy.
    const approvalSweep = await adminPage.evaluate(async (prefix) => {
      const Parse = window.Parse;
      const q = new Parse.Query('Vampire');
      q.startsWith('name', prefix);
      q.limit(1000);
      const characters = await q.find();
      if (characters.length === 0) return { approvals: 0, errors: [] };
      const aq = new Parse.Query('VampireApproval');
      aq.containedIn('owner', characters);
      aq.limit(1000);
      const rows = await aq.find();
      const result = { approvals: rows.length, errors: [] };
      try {
        if (rows.length) await Parse.Object.destroyAll(rows);
      } catch (e) {
        result.errors.push(e && e.message ? e.message : String(e));
      }
      return result;
    }, FIXTURE_PREFIX).catch((e) => ({ approvals: -1, errors: [String(e)] }));
    console.log('[e2e assets] destroyed VampireApproval rows:', JSON.stringify(approvalSweep));

    // CharacterPortrait / TroupePortrait - no owner back-pointer exists (see
    // file-level finding 7), so these are destroyed by the exact ids this
    // suite captured at upload time.
    const characterPortraitIds = [state.primary && state.primary.portraitId].filter(Boolean);
    const troupePortraitIds = [state.troupe && state.troupe.portraitId].filter(Boolean);
    const portraitSweep = await adminPage.evaluate(async ({ characterPortraitIds, troupePortraitIds }) => {
      const Parse = window.Parse;
      let destroyed = 0;
      const errors = [];
      const CharacterPortrait = Parse.Object.extend('CharacterPortrait');
      const TroupePortrait = Parse.Object.extend('TroupePortrait');
      for (const id of characterPortraitIds) {
        try {
          await CharacterPortrait.createWithoutData(id).destroy();
          destroyed++;
        } catch (e) {
          errors.push('CharacterPortrait/' + id + ': ' + (e && e.message ? e.message : String(e)));
        }
      }
      for (const id of troupePortraitIds) {
        try {
          await TroupePortrait.createWithoutData(id).destroy();
          destroyed++;
        } catch (e) {
          errors.push('TroupePortrait/' + id + ': ' + (e && e.message ? e.message : String(e)));
        }
      }
      return { destroyed, errors };
    }, { characterPortraitIds, troupePortraitIds }).catch((e) => ({ destroyed: -1, errors: [String(e)] }));
    console.log('[e2e assets] destroyed portrait objects:', JSON.stringify(portraitSweep));

    const destroyedChars = await destroyCharactersByPrefix(adminPage, FIXTURE_PREFIX)
      .catch((e) => ({ characters: 0, children: 0, errors: [String(e)] }));
    const destroyedTroupes = await destroyTroupesByPrefix(adminPage, FIXTURE_PREFIX)
      .catch((e) => ({ troupes: 0, roles: 0, errors: [String(e)] }));
    console.log('[e2e assets] destroyed in teardown (characters):', JSON.stringify(destroyedChars));
    console.log('[e2e assets] destroyed in teardown (troupes):', JSON.stringify(destroyedTroupes));

    const final = {
      allTroupes: await adminPage.evaluate(() => new window.Parse.Query('Troupe').count()).catch(() => -1),
      allCharacters: await adminPage.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
      allUsers: await adminPage.evaluate(() => new window.Parse.Query(window.Parse.User).count()).catch(() => -1),
      fixtureTroupes: await countTroupesByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1),
      fixtureCharacters: await countCharactersByPrefix(adminPage, FIXTURE_PREFIX).catch(() => -1)
    };
    console.log(
      '[e2e assets] final counts (should equal baseline ' + JSON.stringify(state.baseline) + '):',
      JSON.stringify(final)
    );

    await adminContext.close().catch(() => {});
    await memberContext.close().catch(() => {});
  });

  // -------------------------------------------------------------------------
  // 99 - the rename itself
  // -------------------------------------------------------------------------

  test('99 Rename form submits a new unique name and shows success feedback', async () => {
    // Deliberately not a suffix of the old name ("Alpha ...") - later tests
    // assert the *absence* of the old name as text, which a substring
    // relationship would defeat.
    const newName = `${FIXTURE_PREFIX}Zephyr ${Date.now().toString(36)}`;

    const result = await renameCharacter(memberPage, state.primary.id, newName);
    expect(result.text).toBe('Successfully Updated');
    expect(result.isSuccess).toBe(true);
    expect(result.isError).toBe(false);

    // Assertion-side read-back, not just the form's own success message.
    const serverName = await memberPage.evaluate(
      (id) => new window.Parse.Query('Vampire').get(id).then((c) => c.get('name')),
      state.primary.id
    );
    expect(serverName).toBe(newName);

    state.primary.name = newName;
  });

  // -------------------------------------------------------------------------
  // 100-107 - propagation to every character-scoped view sampmem can reach
  // -------------------------------------------------------------------------

  test('100 Renamed name appears in the sheet header at #character?:id', async () => {
    // See the file-level comment on renameCharacter: memberPage's own cache is
    // already warm and correct from performing the rename itself, but a fresh
    // reload removes any doubt for this whole 100-107 block, which is the
    // first read after the mutation.
    await hardReload(memberPage);
    await navigateToHash(memberPage, `character?${state.primary.id}`, '#character');
    const text = normalize(await memberPage.locator('#character').textContent());
    expect(text).toContain(state.primary.name);
    expect(text).not.toContain(state.primary.oldName);
  });

  test('101 Renamed name appears in the roster at #characters?all', async () => {
    await navigateToHash(memberPage, 'characters?all', '#characters-all');
    const rows = await readCharactersAllRows(memberPage);
    const row = rows.find((r) => r.id === state.primary.id);
    expect(row, `a roster row for ${state.primary.id}`).toBeTruthy();
    expect(row.name).toBe(state.primary.name);
    expect(rows.some((r) => r.name === state.primary.oldName)).toBe(false);
  });

  test('102 Renamed name appears in the printable sheet at #character/:cid/print', async () => {
    const sheet = await readPrintSheet(memberPage, state.primary.id);
    expect(sheet.name).toBe(state.primary.name);
  });

  test('103 Renamed name appears in the approved view at #character/:cid/approved', async () => {
    // sampmem cannot approve their own character's changes (cloud/main.js:630)
    // - devuser establishes the approval that folds the rename in.
    await hardReload(adminPage);
    const approvals = await approveLatestChange(adminPage, state.primary.id);
    expect(approvals.length).toBeGreaterThan(0);
    state.approvalCount = approvals.length;

    const approved = await readApprovedSheet(adminPage, state.primary.id);
    expect(approved.name).toBe(state.primary.name);
    expect(approved.name).not.toBe(state.primary.oldName);
  });

  test('104 Renamed name appears in the log view header at #character/:cid/log/0/10', async () => {
    // openLog hardReloads internally (CharacterLogView.register short-circuits
    // otherwise - see helpers/logs.js).
    await openLog(memberPage, state.primary.id, 0, 10);
    const h1 = normalize(await memberPage.locator('#character-log h1').textContent());
    expect(h1).toBe(state.primary.name);
  });

  test('105 Renamed name appears in the costs view at #character/:cid/costs', async () => {
    await navigateToHash(memberPage, `character/${state.primary.id}/costs`, '#character-costs');
    const h1 = normalize(await memberPage.locator('#character-costs h1').textContent());
    expect(h1).toBe(state.primary.name);
  });

  test.fail('106 Renamed name appears in the XP history view header', async () => {
    // DEFECT (see file-level finding 4): experienceNotationsAllView never
    // renders character.get("name") anywhere - only Earned/Spent/Available
    // totals and the notation table. Confirmed live: the full text of
    // #experience-notations-all contains neither the new name nor the old one.
    await openXp(memberPage, state.primary.id);
    const text = normalize(await memberPage.locator('#experience-notations-all').textContent());
    expect(text, 'the XP history page shows the character name somewhere').toContain(state.primary.name);
  });

  test('107 Renamed name appears in the history timeline view at #character/:cid/history/0', async () => {
    await navigateToHash(memberPage, `character/${state.primary.id}/history/0`, '#character-history');
    await memberPage.waitForTimeout(500);
    const sheet = await readPrintableSheet(memberPage, '#character-history #history-sheet');
    expect(sheet, 'the embedded print sheet rendered inside #history-sheet').toBeTruthy();
    expect(sheet.name).toBe(state.primary.name);
  });

  // -------------------------------------------------------------------------
  // 108-112 - propagation to troupe- and admin-scoped views (devuser only)
  // -------------------------------------------------------------------------

  test('108 Renamed name appears in the troupe roster at #troupe/:id/characters/all', async () => {
    await navigateToHash(adminPage, `troupe/${state.troupe.id}/characters/all`, '#troupe-characters-all');
    const text = normalize(await adminPage.locator('#troupe-characters-all').textContent());
    expect(text).toContain(state.primary.name);
    expect(text).not.toContain(state.primary.oldName);
  });

  test('109 Renamed name appears in the troupe summarize view', async () => {
    await navigateToHash(adminPage, `troupe/${state.troupe.id}/characters/summarize/all`, '#troupe-summarize-characters-all');
    await adminPage.waitForTimeout(500);
    const rows = await readListItemTexts(adminPage, '#troupe-summarize-characters-all', '#troupe-summarize-characters-list');
    expect(rows.some((r) => r.indexOf(state.primary.name) === 0), `a row starting with ${state.primary.name}`).toBe(true);
  });

  test('110 Renamed name appears in the troupe select-to-print list', async () => {
    await navigateToHash(adminPage, `troupe/${state.troupe.id}/characters/selecttoprint/all`, '#troupe-select-to-print-characters-all');
    await adminPage.waitForTimeout(500);
    const rows = await readListItemTexts(adminPage, '#troupe-select-to-print-characters-all', '#troupe-select-to-print-characters-list');
    expect(rows.some((r) => r.indexOf(state.primary.name) === 0), `a row starting with ${state.primary.name}`).toBe(true);
  });

  test('111 Renamed name appears in the admin characters list at #administration/characters/all', async () => {
    // Shares the #characters-all page element with the personal roster (see
    // file-level finding 6) - navigating here re-populates it from
    // get_administrator_characters(), a superset of every owner's roster.
    await navigateToHash(adminPage, 'administration/characters/all', '#characters-all');
    const rows = await readCharactersAllRows(adminPage);
    const row = rows.find((r) => r.id === state.primary.id);
    expect(row, `an admin-list row for ${state.primary.id}`).toBeTruthy();
    expect(row.name).toBe(state.primary.name);
  });

  test('112 Renamed name appears in the admin characters summarize view', async () => {
    // Shares #troupe-summarize-characters-all with the troupe-scoped summarize
    // (finding 6) - a fresh navigation re-populates it admin-wide.
    await navigateToHash(adminPage, 'administration/characters/summarize', '#troupe-summarize-characters-all');
    await adminPage.waitForTimeout(500);
    const rows = await readListItemTexts(adminPage, '#troupe-summarize-characters-all', '#troupe-summarize-characters-list');
    expect(rows.some((r) => r.indexOf(state.primary.name) === 0), `a row starting with ${state.primary.name}`).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 113-114 - the log entry, and the collision defect
  // -------------------------------------------------------------------------

  test('113 The rename is recorded in the character log as a name-change entry with old and new name', async () => {
    // See file-level finding 1: "name" is in beforeSave("Vampire")'s
    // tracked_texts, unlike XP/long-text fields, so this is a genuine pass.
    await openLog(memberPage, state.primary.id, 0, 10);
    const rows = await readLogRows(memberPage);
    const row = expectLogRow(rows, {
      category: 'core',
      name: 'name',
      old_text: state.primary.oldName,
      new_text: state.primary.name
    }, 'rename log row');
    expect(row.type).toBe('core_update');
  });

  test('114 Renaming to collide with an existing character name succeeds - names are deliberately not unique', async () => {
    // INVERTED, per remediation R41 and the owner's ruling behind it: character
    // names are explicitly *not* required to be unique, and uniqueness must not
    // be enforced. Nothing enforces it today (CharacterRenameView.js does a
    // bare set+save, and beforeSave("Vampire") only logs the change), so the
    // application is already correct and the test was what was wrong.
    //
    // Turned around rather than deleted, the same treatment patronage
    // world-readability got: anyone who later "fixes" this by adding a
    // uniqueness check now fails loudly instead of silently removing intended
    // behaviour. Characters are identified by id throughout this suite and its
    // helpers, never by name, which is what makes duplicate names safe.
    const collidingName = state.primary.name;

    const result = await renameCharacter(memberPage, state.secondary.id, collidingName);
    expect(result.isError, 'a duplicate name is accepted, not refused').toBe(false);

    const names = await memberPage.evaluate(
      (ids) => Promise.all(ids.map((id) =>
        new window.Parse.Query('Vampire').get(id).then((c) => ({ id: c.id, name: c.get('name') }))
      )),
      [state.primary.id, state.secondary.id]
    );
    expect(names.map((c) => c.name), 'both characters now carry the same name')
      .toEqual([collidingName, collidingName]);
    expect(names[0].id).not.toBe(names[1].id);

    // Leave the fixture as it was found, so later tests that read Beta by name
    // are not surprised.
    const restored = await renameCharacter(memberPage, state.secondary.id, state.secondary.name);
    expect(restored.isError).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 115-117 - upload, and byte-level verification at the sheet
  // -------------------------------------------------------------------------

  test('115 Portrait upload: submit portrait-red-200x200.png at #character/:cid/portrait; success is confirmed', async () => {
    await uploadCharacterPortrait(memberPage, state.primary.id, fixtures.characterRed.path);

    const portraitId = await memberPage.evaluate(
      (id) => new window.Parse.Query('Vampire').get(id).then((c) => {
        const p = c.get('portrait');
        return p ? p.id : null;
      }),
      state.primary.id
    );
    expect(portraitId, 'a CharacterPortrait object is now attached to the character').toBeTruthy();
    state.primary.portraitId = portraitId;

    // The portrait page's own preview renders the true, unscaled original
    // (public/index.html:984) - the one surface that isn't a derived
    // thumbnail, so this is the most direct proof the upload took.
    const original = await fetchRenderedImage(memberPage, '#character-portrait img');
    assertImageColor(original, fixtures.characterRed.color, { label: 'own-page original preview' });
    expect(original.width).toBe(fixtures.characterRed.width);
    expect(original.height).toBe(fixtures.characterRed.height);
  });

  test('116 The sheet header img src fetches with HTTP 200 and an image content-type', async () => {
    await hardReload(memberPage);
    await navigateToHash(memberPage, `character?${state.primary.id}`, '#character');
    const fetched = await fetchRenderedImage(memberPage, CHARACTER_PORTRAIT_SELECTORS.sheet);
    expect(fetched.status).toBe(200);
    expect(fetched.contentType).toMatch(/^image\//);
  });

  test('117 The fetched sheet-header image decodes to its rendered thumbnail size with a red dominant color, matching the fixture', async () => {
    // See file-level finding 5: the sheet renders get_thumbnail_sync(128) -
    // the 128x128 JPEG thumbnail cloud/main.js generates - not the 200x200
    // original the plan's wording names. Task 0 measured the identical thing
    // end to end ("renders as a 128x128 JPEG thumbnail decoding to
    // rgb(220, 40, 40)").
    const fetched = await fetchRenderedImage(memberPage, CHARACTER_PORTRAIT_SELECTORS.sheet);
    expect(fetched.width).toBe(128);
    expect(fetched.height).toBe(128);
    assertImageColor(fetched, fixtures.characterRed.color, { label: 'sheet header portrait' });
  });

  // -------------------------------------------------------------------------
  // 118-122 - byte-level verification at every other surface
  // -------------------------------------------------------------------------

  test.fail('118 The uploaded portrait renders and byte-matches in the printable sheet #character/:cid/print', async () => {
    // DEFECT (see file-level finding 3): CharacterPrintView never renders a
    // portrait <img> anywhere in its region tree - confirmed by an exhaustive
    // source grep and, here, by a live element count.
    await navigateToHash(memberPage, `character/${state.primary.id}/print`, '#printable-sheet');
    const count = await memberPage.locator(CHARACTER_PORTRAIT_SELECTORS.print).count();
    expect(count, 'a portrait <img> exists on the printable sheet').toBeGreaterThan(0);

    await expectPortraitMatches(memberPage, CHARACTER_PORTRAIT_SELECTORS.print, fixtures.characterRed.color, 'printable sheet portrait');
  });

  test('119 The uploaded portrait renders and byte-matches in the character list item on #characters?all', async () => {
    await navigateToHash(memberPage, 'characters?all', '#characters-all');
    // Scoped by id: Beta is also listed here, unadorned, and a bare
    // "#characters-all img.character-link-portrait" selector would match
    // whichever row happens to come first in the DOM.
    const selector = scopedRosterPortraitSelector('#characters-all', state.primary.id);
    const fetched = await expectPortraitMatches(memberPage, selector, fixtures.characterRed.color, 'personal roster portrait');
    expect(fetched.width).toBe(128);
    expect(fetched.height).toBe(128);
  });

  test('120 The uploaded portrait renders and byte-matches in the troupe roster list item', async () => {
    // Only Alpha is joined to this troupe, so the generic selector is
    // unambiguous here (unlike the personal roster above).
    await navigateToHash(adminPage, `troupe/${state.troupe.id}/characters/all`, '#troupe-characters-all');
    await expectPortraitMatches(adminPage, CHARACTER_PORTRAIT_SELECTORS.troupeRoster, fixtures.characterRed.color, 'troupe roster portrait');
  });

  test('121 The uploaded portrait renders and byte-matches in the troupe select-to-print list item', async () => {
    await navigateToHash(adminPage, `troupe/${state.troupe.id}/characters/selecttoprint/all`, '#troupe-select-to-print-characters-all');
    await adminPage.waitForTimeout(500);
    await expectPortraitMatches(adminPage, CHARACTER_PORTRAIT_SELECTORS.selectToPrint, fixtures.characterRed.color, 'select-to-print portrait');
  });

  test('122 The uploaded portrait renders and byte-matches in the admin character view', async () => {
    // #administration/character/:id renders through show_character_helper
    // into the identical #character page the plain sheet route uses (finding
    // 6), reached via a route only devuser/an admin can open. Unlike 120/121
    // (fresh collection queries every visit), show_character_helper goes
    // through the single-slot `get_character` cache - and adminPage's slot for
    // Alpha was last populated back in test 103's approval flow, *before*
    // memberPage (a wholly separate browser context/session, with its own
    // independent router and cache) uploaded the portrait in test 115.
    // Cross-page cache staleness, not an application defect - reload to force
    // a genuinely fresh fetch.
    await hardReload(adminPage);
    await navigateToHash(adminPage, `administration/character/${state.primary.id}`, '#character');
    await expectPortraitMatches(adminPage, CHARACTER_PORTRAIT_SELECTORS.sheet, fixtures.characterRed.color, 'admin character view portrait');
  });

  // -------------------------------------------------------------------------
  // 123 - replace and re-verify every surface above
  // -------------------------------------------------------------------------

  test('123 Replacing the portrait with portrait-blue-320x240.png changes every surface above to the blue fixture', async () => {
    await uploadCharacterPortrait(memberPage, state.primary.id, fixtures.characterBlue.path);
    await hardReload(memberPage);
    await hardReload(adminPage);

    await navigateToHash(memberPage, `character?${state.primary.id}`, '#character');
    await expectPortraitMatches(memberPage, CHARACTER_PORTRAIT_SELECTORS.sheet, fixtures.characterBlue.color, 'sheet (blue)');

    await navigateToHash(memberPage, 'characters?all', '#characters-all');
    await expectPortraitMatches(
      memberPage,
      scopedRosterPortraitSelector('#characters-all', state.primary.id),
      fixtures.characterBlue.color,
      'personal roster (blue)'
    );

    await navigateToHash(adminPage, `troupe/${state.troupe.id}/characters/all`, '#troupe-characters-all');
    await expectPortraitMatches(adminPage, CHARACTER_PORTRAIT_SELECTORS.troupeRoster, fixtures.characterBlue.color, 'troupe roster (blue)');

    await navigateToHash(adminPage, `troupe/${state.troupe.id}/characters/selecttoprint/all`, '#troupe-select-to-print-characters-all');
    await adminPage.waitForTimeout(500);
    await expectPortraitMatches(adminPage, CHARACTER_PORTRAIT_SELECTORS.selectToPrint, fixtures.characterBlue.color, 'select-to-print (blue)');

    await navigateToHash(adminPage, `administration/character/${state.primary.id}`, '#character');
    await expectPortraitMatches(adminPage, CHARACTER_PORTRAIT_SELECTORS.sheet, fixtures.characterBlue.color, 'admin view (blue)');
  });

  // -------------------------------------------------------------------------
  // 124 - negative upload
  // -------------------------------------------------------------------------

  test('124 Uploading a non-image file is rejected with a surfaced error and leaves the existing portrait intact', async () => {
    await expect(
      uploadCharacterPortrait(memberPage, state.primary.id, fixtures.notAnImage.path)
    ).rejects.toThrow(/rejected/);

    // The file input has no `accept` filter (public/index.html:989), so the
    // browser happily attaches the .txt file, and the beforeSave failure aborts
    // the whole save - the previously-saved thumb_* values are never touched.
    //
    // Note what actually rejects it, because it is not what it looks like: under
    // jimp 0.2.28 `Image.read` does NOT reject on a non-image. It resolves with
    // undefined - its throwError discards string errors - and crop_and_thumb's
    // explicit guard is what turns that into a real error. So the server log for
    // THIS test carries a "Could not find MIME for Buffer <...portraittxt.txt>"
    // line on every single run. That line is expected here, and is not a symptom
    // of anything.
    await hardReload(memberPage);
    await navigateToHash(memberPage, `character?${state.primary.id}`, '#character');
    await expectPortraitMatches(memberPage, CHARACTER_PORTRAIT_SELECTORS.sheet, fixtures.characterBlue.color, 'sheet still blue after rejected upload');

    const portraitId = await memberPage.evaluate(
      (id) => new window.Parse.Query('Vampire').get(id).then((c) => {
        const p = c.get('portrait');
        return p ? p.id : null;
      }),
      state.primary.id
    );
    expect(portraitId, 'still the same CharacterPortrait row, not a new or cleared one').toBe(state.primary.portraitId);
  });

  // -------------------------------------------------------------------------
  // 125-128 - troupe portrait
  // -------------------------------------------------------------------------

  test('125 Troupe portrait upload at #troupe/:id/portrait submits troupe-green-400x300.png successfully', async () => {
    await uploadTroupePortrait(adminPage, state.troupe.id, fixtures.troupeGreen.path);

    const portraitId = await adminPage.evaluate(
      (id) => new window.Parse.Query('Troupe').get(id).then((t) => {
        const p = t.get('portrait');
        return p ? p.id : null;
      }),
      state.troupe.id
    );
    expect(portraitId, 'a TroupePortrait object is now attached to the troupe').toBeTruthy();
    state.troupe.portraitId = portraitId;
  });

  test('126 The troupe portrait renders in troupe detail #troupe/:id and byte-matches the green fixture', async () => {
    // TROUPE_PORTRAIT_SELECTORS.detail renders the true original (see
    // portraits.js's documented asymmetry), so this is the exact fixture size.
    await navigateToHash(adminPage, `troupe/${state.troupe.id}`, '#troupe');
    const fetched = await expectPortraitMatches(adminPage, TROUPE_PORTRAIT_SELECTORS.detail, fixtures.troupeGreen.color, 'troupe detail (original)');
    expect(fetched.width).toBe(fixtures.troupeGreen.width);
    expect(fetched.height).toBe(fixtures.troupeGreen.height);
  });

  test('127 The troupe portrait renders in the troupe directory #troupes list item and byte-matches', async () => {
    await navigateToHash(adminPage, 'troupes', '#troupes-list');
    const selector = scopedTroupeDirectoryPortraitSelector(state.troupe.id);
    const fetched = await expectPortraitMatches(adminPage, selector, fixtures.troupeGreen.color, 'troupe directory (thumbnail)');
    expect(fetched.width).toBe(128);
    expect(fetched.height).toBe(128);
  });

  test('128 Replacing the troupe portrait updates both surfaces to the new fixture', async () => {
    // Reuses the character-blue fixture as "a distinctly different colour" -
    // nothing requires troupe portraits use troupe-prefixed files, and this
    // keeps the fixture set to the three that Task 0 built.
    await uploadTroupePortrait(adminPage, state.troupe.id, fixtures.characterBlue.path);
    await hardReload(adminPage);

    await navigateToHash(adminPage, `troupe/${state.troupe.id}`, '#troupe');
    await expectPortraitMatches(adminPage, TROUPE_PORTRAIT_SELECTORS.detail, fixtures.characterBlue.color, 'troupe detail (blue)');

    await navigateToHash(adminPage, 'troupes', '#troupes-list');
    const selector = scopedTroupeDirectoryPortraitSelector(state.troupe.id);
    await expectPortraitMatches(adminPage, selector, fixtures.characterBlue.color, 'troupe directory (blue)');
  });
});
