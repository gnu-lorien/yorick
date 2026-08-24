/**
 * Task 7 - Troupes Populated With Real Characters
 *
 * Covers testing_implementation_plan.md items 129-154. Entirely replaces the
 * previous `troupes.spec.js`, which hardcoded a single fixed Parse object id
 * for a pre-existing "Sample Troupe" and asserted only that empty containers
 * were visible - with no characters in the troupe, its roster, summarize,
 * select-to-print and relationship-network tests all passed trivially against
 * empty state. Nothing here reaches for that id; every troupe and character is
 * created fresh by this file's own fixtures and torn down again in `afterAll`.
 *
 * The suite is `serial` and builds up **one** troupe with **three** characters
 * (one per venue) across tests 129-134, the same "lifecycle, not independent
 * facts" structure the creation and trait-lifecycle suites use. Every test from
 * 135 onward reads or mutates that shared fixture.
 *
 * ---
 *
 * ## `troupes.addStaff` - how the second step was completed
 *
 * Per the assignment brief, `addStaff` threw unless passed `{ allowIncomplete:
 * true }`: picking a user from `#troupe/:id/staff/add` (UsersView) only lands
 * on `#troupe/:id/staff/edit/:uid` (TroupeEditStaffView); a role still had to
 * be chosen from that page's Backform `<select name="role">` and the form
 * saved. That save calls `Parse.Cloud.run("change_troupe_staff", {troupe_id,
 * user_to_change_id, roles_to_add, roles_to_remove})` (cloud/main.js:811),
 * which requires the caller to hold - directly or by role inheritance - the
 * troupe's own `LST_<id>` role.
 *
 * **Completed in `e2e/helpers/troupes.js`** (`openStaffEditForUser` +
 * `addStaff`, `allowIncomplete` removed entirely): the role `<select>` is
 * driven through `selectBackformOption` (its options render with
 * `Backform.JSONFormatter`-quoted DOM values - literally `"AST"`, quote
 * characters included - so selecting by visible label is what avoids that
 * landmine), the form's Save button is clicked, and the result is verified by
 * re-reading `#troupe/:id`'s own `#troupe-staff` region (`readStaff`) until
 * the expected `"<ROLE>: <username> ..."` row appears - not by trusting the
 * hash, because `submit` moves it to `#troupe/:id` from inside an `.always()`,
 * win or lose.
 *
 * There is no separate "edit" entry point anywhere in the UI - the staff list
 * items are plain `<li>` text, not links (troupe-staff-list.html) - so
 * re-adding an *existing* staff member through the same `#troupe/:id/staff/add`
 * picker, with a different role selected on the form that opens
 * (`TroupeEditStaffView.register()` pre-selects whichever role the picked user
 * currently holds), is genuinely how a real user changes someone's role. That
 * is why one function serves both test 130 ("add") and test 131 ("edit") -
 * test 130 adds `sampast` as **Narrator** deliberately, not AST, precisely so
 * test 131 has a real role change to demonstrate (Narrator -> AST), which also
 * conveniently leaves `sampast` holding AST for every later test in this file
 * that depends on it (139, 153, 154).
 *
 * **Evidence a staff member genuinely gains AST access** (measured live,
 * reproduced in the suite below as tests 139/153/154): after `addStaff(...,
 * 'sampast', 'AST')`, a fresh Parse session logged in as `sampast` successfully
 * fetches all three fixture characters directly
 * (`new Parse.Query('Vampire').get(id)` resolves); after the owning character
 * leaves the troupe, the identical fetch rejects with `Parse.Error.
 * OBJECT_NOT_FOUND` (101); after it rejoins, the fetch succeeds again. This
 * traces a real chain: `Character.get_me_acl()` (models/Character.js) grants
 * `AST_<troupeId>` role read/write for every troupe id the character belongs
 * to, `join_troupe`/`leave_troupe` call `update_troupe_acls()` to rebuild and
 * save that ACL onto the character (and its traits/notations/long texts), and
 * `change_troupe_staff` is what actually put `sampast` into the `AST_<troupeId>`
 * role in the first place.
 *
 * Why `devuser` (not a direct member of any per-troupe role) can drive staff
 * management and later create a `CharacterRelationship` on a troupe it didn't
 * hand-seed a role for: `TroupeNewView`'s submit handler (the real "New
 * Troupe" form this suite's `createTroupe` fixture drives) creates the three
 * per-troupe roles with a hierarchy - `LST_<id>.getRoles().add(Administrator)`,
 * `AST_<id>.getRoles().add(LST_<id>)`, `Narrator_<id>.getRoles().add([LST_<id>,
 * AST_<id>])` - so `devuser`'s direct `Administrator` membership transitively
 * carries all three per-troupe roles, plus the global `LST`/`AST`/`Narrator`
 * roles the same way (confirmed in `database_seed/_Join roles _Role.json`).
 * This only holds for troupes created through the real UI; it does not apply
 * to the separate, differently-provisioned "Sample Troupe" the old suite
 * hardcoded by fixed id, which is one more reason not to reach for it.
 *
 * ---
 *
 * ## Findings confirmed live against this server before or while writing this suite
 *
 * **1. CORRECTION to an assumption formed while reading source alone - the
 * printable sheet is genuinely venue-aware (bears on tests 148, and the
 * now-superseded worry that it might not be).** `character-print-view.html`
 * (imported into `CharacterPrintView.js` as `character_print_view_html`) reads
 * as Vampire-only - hardcoded `Clan`/`Sect`/`backgrounds`/`disciplines`/
 * `merits`/`flaws` - and grepping it for "Werewolf", "wta_", "ctdbs_" returns
 * nothing. That import is dead code: `character_print_view_html` is never
 * referenced anywhere else in the file. The view's actual `template` is
 * `character_print_parent_html`, a region-based `Marionette.LayoutView` whose
 * `setup_regions()` branches on `character.get("type")` and populates a
 * genuinely different set of child views per venue - Werewolf gets a Tribe/
 * Breed/Auspice bar, Gnosis, Rage (or Fixed Blood for Ananasi), Harano, Wyrm
 * Taint, `wta_backgrounds`, `wta_gifts`, `wta_rites`; Changeling gets a Kith/
 * Court bar, Glamour, `ctdbs_backgrounds`, `ctdbs_arts`; Vampire gets Clan/
 * Sect, Blood, Morality, `backgrounds`, `disciplines`. Measured live: a
 * Werewolf's printed sheet reads "Breed: Homid" and lists real Gifts by name
 * and value. `Skills` (a shared category on all three venues) is rendered
 * identically regardless of venue, which is what test 148 leans on as its
 * primary, venue-agnostic proof, with each venue's own header field asserted
 * as a bonus.
 *
 * **2. `#sections` (and, unguarded, `ul > li` queries) collide across pages.**
 * jQuery Mobile keeps every visited page's markup in the DOM at once, and
 * `#troupe-summarize-characters-all`, `#troupe-select-to-print-characters-all`
 * and the admin equivalents each render their own `<div id="sections">` for
 * their filter form - a bare `page.locator('#sections')` throws a Playwright
 * strict-mode violation once more than one has been visited. Every filter and
 * list-read helper below scopes through the specific page id. Separately, the
 * Pretty and CSV-with-grouping list items (character-summarize-list-item.html)
 * nest their own `<ul><li>` of trait rows *inside* each character's outer
 * `<li>` - a naive `querySelectorAll('ul > li')` inside the list region
 * matches both levels (3 characters + their nested trait rows). Reading only
 * `list.querySelector('ul').children` - direct children - is what isolates one
 * row per character.
 *
 * **3. `CharactersSelectToPrintView` has no per-character selection
 * checkboxes at all (bears on test 146's plan wording).** Its `PrettyView`
 * reuses the plain `character-summarize-list-item.html` (no checkbox markup),
 * its click handler references a `click_url` the router never sets, and
 * "Print Shown" (`printselected`) navigates to `#troupe/:id/characters/print/
 * selected`, whose route handler resets the print collection from
 * `self.troupeSelectToPrintCharacters.get_filtered()` - the *same*
 * category/antecedence/resulttype/playable filter form Summarize uses, not an
 * individually-checked set. The two checkboxes that do exist on that page
 * belong to unrelated controls (the filter form's own "playable" toggle and
 * `PrintSettingsForm`'s "exclude extended text" toggle) - confirmed live and
 * asserted as absent specifically from the character-list region. "Selecting
 * two of three" (147) is therefore driven through that filter - antecedence
 * is set to `NPC` on the excluded character via a real post-creation pick,
 * narrowing the default `PC`-only filter from three characters to two - which
 * demonstrably narrows and excludes (149) even though no checkbox is involved.
 *
 * **4. The Summarize CSV/CSV-with-grouping formats render no header row.**
 * `character-summarize-list-item-csv(.html / -header-grouped.html)` emit only
 * a quoted data line per character; nothing in `CharactersSummarizeListView.js`
 * ever renders a column-label row. Measured live: switching to CSV format for
 * three characters produces exactly three `<li>` elements, each one data row,
 * confirmed by counting direct children rather than assuming a header exists.
 * Test 144 asserts the three real rows and documents the absence rather than
 * asserting a header that was never going to appear.
 *
 * **5. The category filter dropdown (Summarize and Select-to-Print) never
 * offers a Changeling-only category.** `category_options` is built from
 * `Vampire.all_simpletrait_categories()` and `Werewolf.all_simpletrait_
 * categories()` only - `ChangelingBetaSlice.all_simpletrait_categories()` is
 * never referenced in either view. There is consequently no way to isolate
 * "only the Changeling" through this control the way "Disciplines" isolates
 * the Vampire in test 145; a Vampire- or Werewolf-only category is what proves
 * the filter narrows by venue, and this gap is called out at the point test
 * 145 exercises it rather than silently worked around.
 *
 * **6. The relationship network is genuinely canvas-based (vis.js
 * `Network`), and Playwright's `click({modifiers: ['Control']})` does not
 * register as vis.js's multiselect modifier, though a plain click does.**
 * `TroupeCharacterRelationshipsNetworkView` renders into `#relationships-network`
 * via `new vis.Network(container, data, options)`; there is no per-node DOM
 * element to click by selector. `interaction.multiselect` checks `event.
 * changedPointers[0].ctrlKey` on the Hammer.js-normalized pointer event
 * (public/scripts/lib/vis.js:37649). Measured live, repeatedly: `page.mouse.
 * click(x, y, {modifiers: ['Control']})` on the second node *replaced* the
 * selection instead of extending it every time; wrapping the same click in
 * explicit `page.keyboard.down('Control')` / `page.mouse.click(x, y)` /
 * `page.keyboard.up('Control')` extended it correctly every time. This suite
 * uses the latter. Node screen coordinates are computed from the view's own
 * `network.getPositions()` (network space) run through `network.canvasToDOM()`
 * (DOM space, relative to the canvas element) plus the canvas's own
 * `getBoundingClientRect()` - polled until stable, and preceded by an explicit
 * `network.fit()`, because the physics layout does not auto-fit the viewport
 * and an unfit two-node graph measured live with one node computing to a
 * negative, off-canvas x-coordinate. `window.router` is a genuine global (the
 * app assigns `this.router = new Mobile()` from a non-strict top-level
 * `require()` callback), which is what makes the live vis.js `Network`
 * instance (the published `tcrnv.network`) and its underlying node/edge
 * `data` reachable at all for a real click-driven interaction plus an
 * assertion-side read of the rendered graph's own state - the "assert
 * whatever is genuinely observable" the assignment asks for when a graph is
 * canvas-based. `make_relationship()` ends by reloading the whole page (not a
 * hash change); the suite waits for the reload and re-navigates rather than
 * trying to observe the in-flight save.
 *
 * **7. ACL enforcement is real and does not merely redirect - confirmed with
 * an assertion-side Parse read-back, not just a UI observation.** As
 * `sampstranger`, `new Parse.Query('Vampire').get(<fixture id>)` rejects with
 * `code: 101` (`Parse.Error.OBJECT_NOT_FOUND`) for all three fixture
 * characters, and a roster count query for the troupe returns `0` although
 * three characters genuinely belong to it - Parse silently omits rows the
 * querying session cannot read rather than erroring, so the *page* for
 * `#troupe/:id/characters/all` still opens for a stranger, just empty. This
 * is why tests 140/141/153 assert the Parse-level read-back as their primary
 * evidence and the UI-level symptom (empty roster; `show_character_helper`'s
 * `.fail()` branch bouncing the hash back to the roster) only as a secondary,
 * corroborating check - a redirect alone would not prove the data is
 * genuinely inaccessible.
 *
 * **8. `waitForJqmLoader` is not a reliable signal that a freshly-created
 * troupe's three per-troupe Roles have finished saving** (matches the
 * already-documented Task 0 finding for this helper generally). Measured live
 * across several runs, `TroupeEditStaffView.register()` never actually failed
 * this way once `createTroupe`'s own `findTroupeIdByName` poll had already
 * settled - but since a failure here is silent (register()'s `.fail()` branch
 * only `console.log`s and leaves `#troupe-edit-staff-form` unrendered), `e2e/
 * helpers/troupes.js`'s new `openStaffEditForUser` retries the whole
 * add-staff-and-click navigation, not just a longer wait, rather than leaving
 * this as a latent flake.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, loginAsAST, loginAsStranger } = require('./helpers/auth');
const {
  navigateToHash,
  waitForActivePage,
  activePageId,
  normalize,
  waitForJqmLoader,
  waitForAppReady,
  selectBackformOption
} = require('./helpers/jqm-helpers');
const {
  createCompletedCharacter,
  readCharacterTexts,
  readTraits,
  readSheetXp,
  pickSimpleText,
  countCharactersByPrefix,
  destroyCharactersByPrefix
} = require('./helpers/characters');
const {
  uniqueTroupeName,
  createTroupe,
  listTroupes,
  addStaff,
  readStaff,
  readStaffRole,
  joinTroupe,
  leaveTroupe,
  readRoster,
  countTroupesByPrefix,
  destroyTroupesByPrefix
} = require('./helpers/troupes');

/** Every troupe and character this file creates is named with this prefix, so teardown is a query. */
const FIXTURE_PREFIX = 'E2E T7 ';

const BASELINE_XP = { earned: 30, spent: 0, available: 30 };

const SUMMARIZE_PAGE = '#troupe-summarize-characters-all';
const SELECT_TO_PRINT_PAGE = '#troupe-select-to-print-characters-all';
const PRINT_PAGE = '#troupe-print-characters-all';
const NETWORK_PAGE = '#troupe-character-relationships-network';

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Suite-local helpers
// ---------------------------------------------------------------------------

/**
 * Top-level rows of a Marionette CollectionView list (Summarize or
 * Select-to-Print), scoped to one page and to *direct* children only - see
 * file-level finding 2 for why both of those matter.
 */
async function readListRows(page, pageId, listId) {
  return page.evaluate(({ pageId, listId }) => {
    const list = document.querySelector(`${pageId} ${listId}`);
    const ul = list ? list.querySelector('ul') : null;
    if (!ul) return [];
    return Array.from(ul.children).map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  }, { pageId, listId });
}

/** Drive the Summarize/Select-to-Print filter form's Backform controls, scoped to one page. */
async function setListFilter(page, pageId, { category, antecedence, resulttype, format } = {}) {
  const formSel = `${pageId} #sections form`;
  if (category !== undefined) await selectBackformOption(page, `${formSel} select[name="category"]`, category);
  if (antecedence !== undefined) await selectBackformOption(page, `${formSel} select[name="antecedence"]`, antecedence);
  if (resulttype !== undefined) await selectBackformOption(page, `${formSel} select[name="resulttype"]`, resulttype);
  if (format !== undefined) await selectBackformOption(page, `${formSel} select[name="format"]`, format);
  // filterOptions is a Backbone.Model; each control's `change` dispatch above
  // triggers `filterwith` synchronously, but the list region's own re-render
  // (and, for format switches, a different childView class entirely) needs a
  // beat to settle before the DOM is read back.
  await page.waitForTimeout(400);
}

/** The names currently rendered as top-level roster entries. */
async function readRosterNames(page, troupeId) {
  const roster = await readRoster(page, troupeId);
  return roster.map((r) => r.name);
}

/**
 * Navigate to a character sheet and poll until it genuinely shows the
 * expected character, rather than trusting the first non-empty read.
 *
 * `Vampire.get_character`/`Werewolf.get_character`/`ChangelingBetaSlice.
 * get_character` (models/*.js) share one cache slot on the router instance
 * (`character_cache._character`, passed through as `self` from mobileRouter.
 * js's own `_get_character`). Switching from character A's sheet to
 * character B's, on the identical `#character` page element, has real
 * asynchronous work to do (a type-detection query, `character_cache.
 * _character.save()` on the outgoing character, a fresh fetch, `ensure_
 * creation_rules_exist()`, `initialize_vampire_costs()`, `initialize_troupe_
 * membership()`) - and `#character` already holds A's non-empty content the
 * entire time B is loading. `waitForActivePage`'s generic "page is active and
 * non-empty" check is satisfied immediately by A's leftover content, so a
 * bare `navigateToHash` + immediate read is a real, measured race: it read
 * the *previous* character's data live while writing this suite (test 138,
 * Werewolf's page showing the Vampire's content). Polling for the expected
 * name is the same "poll for the value you expect" discipline the Task 0
 * report and several other suites' helpers already use for this class of bug.
 */
async function openCharacterSheetAndWait(page, hash, characterName, { timeout = 20000 } = {}) {
  await navigateToHash(page, hash, '#character');
  const deadline = Date.now() + timeout;
  let text = '';
  while (Date.now() < deadline) {
    text = normalize(await page.locator('#character').textContent());
    if (text.indexOf(characterName) !== -1) return text;
    await page.waitForTimeout(300);
  }
  throw new Error(
    `#character never showed "${characterName}" within ${timeout}ms after navigating to "${hash}"; ` +
    `last content: ${text.slice(0, 200)}`
  );
}

/**
 * Assertion-side read-back: does the *currently logged-in* session's own Parse
 * connection see this character at all? Mirrors `troupe-test.js`'s Karma
 * assertion (`expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND)`) rather
 * than inferring access from a UI redirect - see file-level finding 7.
 */
async function tryFetchCharacterAsCurrentUser(page, characterId) {
  return page.evaluate(async (cid) => {
    try {
      const obj = await new window.Parse.Query('Vampire').get(cid);
      return { ok: true, id: obj.id, name: obj.get('name') };
    } catch (e) {
      return { ok: false, code: e && e.code, message: e && e.message };
    }
  }, characterId);
}

/** How many of the troupe's characters the current session's own query can actually see. */
async function queryTroupeCharacterCountAsCurrentUser(page, troupeId) {
  return page.evaluate(async (tid) => {
    const Parse = window.Parse;
    const troupe = await new Parse.Query('Troupe').get(tid);
    const q = new Parse.Query('Vampire');
    q.equalTo('troupes', troupe);
    return q.count();
  }, troupeId);
}

/** Header text of every printed sheet currently rendered on the troupe print page. */
async function readPrintedSheetNames(page) {
  return page.evaluate((pageId) => {
    const root = document.querySelector(pageId);
    if (!root) return [];
    return Array.from(root.querySelectorAll('h1.ui-bar.ui-bar-a')).map((h) => h.textContent.replace(/\s+/g, ' ').trim());
  }, PRINT_PAGE);
}

/**
 * The flattened text of exactly one character's printed sheet, isolated from
 * its siblings via a DOM Range spanning from that character's own `<h1>` up
 * to (but not including) the next one - robust to whatever container nesting
 * Marionette's CollectionView produces, since it never needs to know that
 * structure.
 */
async function readPrintedCharacterText(page, characterName) {
  return page.evaluate(({ pageId, name }) => {
    const container = document.querySelector(pageId);
    if (!container) return null;
    const h1s = Array.from(container.querySelectorAll('h1.ui-bar.ui-bar-a'));
    const idx = h1s.findIndex((el) => el.textContent.replace(/\s+/g, ' ').trim() === name);
    if (idx === -1) return null;

    const range = document.createRange();
    range.setStartBefore(h1s[idx]);
    if (h1s[idx + 1]) {
      range.setEndBefore(h1s[idx + 1]);
    } else {
      range.setEndAfter(container.lastChild);
    }
    const frag = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(frag);
    return div.textContent.replace(/\s+/g, ' ').trim();
  }, { pageId: PRINT_PAGE, name: characterName });
}

/** The live vis.js network's own node/edge data - see file-level finding 6. */
async function readNetworkGraph(page) {
  return page.evaluate(() => {
    // vis.js draws into a canvas, so there is no DOM to read the graph from --
    // both front ends publish the view instead. The legacy one is the router's
    // memoised `tcrnv`; React's is the same three fields on its test bridge.
    const v = (window.__yorick && window.__yorick.tcrnv) || (window.router && window.router.tcrnv);
    if (!v || !v.data) return null;
    return {
      nodes: v.data.nodes.map((n) => ({ id: n.id, label: n.label })),
      edges: v.data.edges.map((e) => ({ from: e.from, to: e.to }))
    };
  });
}

/** Poll `network.getPositions()` until two consecutive reads agree (physics has settled). */
async function getStableNetworkPositions(page, { attempts = 25, interval = 300 } = {}) {
  let prev = null;
  for (let i = 0; i < attempts; i++) {
    const pos = await page.evaluate(() => {
      const v = (window.__yorick && window.__yorick.tcrnv) || window.router.tcrnv;
      return v.network.getPositions();
    });
    if (prev) {
      const ids = Object.keys(pos);
      const stable = ids.length > 0 && ids.every((k) => Math.abs(pos[k].x - prev[k].x) < 1 && Math.abs(pos[k].y - prev[k].y) < 1);
      if (stable) return pos;
    }
    prev = pos;
    await page.waitForTimeout(interval);
  }
  return prev;
}

/** Absolute page coordinates for every node currently in the network, ready for `page.mouse.click`. */
async function computeNodeScreenCoordinates(page) {
  await page.evaluate(() => {
    const v = (window.__yorick && window.__yorick.tcrnv) || window.router.tcrnv;
    v.network.fit();
  });
  await page.waitForTimeout(500);

  const canvasBox = await page.locator(`${NETWORK_PAGE} canvas`).boundingBox();
  const positions = await getStableNetworkPositions(page);
  const domCoords = await page.evaluate((positions) => {
    const out = {};
    const v = (window.__yorick && window.__yorick.tcrnv) || window.router.tcrnv;
    for (const id of Object.keys(positions)) out[id] = v.network.canvasToDOM(positions[id]);
    return out;
  }, positions);

  const coords = {};
  for (const id of Object.keys(domCoords)) {
    coords[id] = { x: canvasBox.x + domCoords[id].x, y: canvasBox.y + domCoords[id].y };
  }
  return coords;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Task 7 - Troupes Populated With Real Characters', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  const state = {};

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginAsAdmin(page);

    // Self-heal first: sweep anything a crashed earlier run left behind, keyed
    // by the name prefix, so the baseline measured immediately afterwards is
    // trustworthy on a repeat run.
    const sweptChars = await destroyCharactersByPrefix(page, FIXTURE_PREFIX);
    const sweptTroupes = await destroyTroupesByPrefix(page, FIXTURE_PREFIX);

    state.baseline = {
      allTroupes: await page.evaluate(() => new window.Parse.Query('Troupe').count()),
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()),
      fixtureTroupes: await countTroupesByPrefix(page, FIXTURE_PREFIX),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX)
    };
    console.log('[e2e troupes] self-heal swept characters:', JSON.stringify(sweptChars));
    console.log('[e2e troupes] self-heal swept troupes:', JSON.stringify(sweptTroupes));
    console.log('[e2e troupes] baseline counts:', JSON.stringify(state.baseline));
  });

  test.afterAll(async () => {
    if (!page) return;

    // The suite ends logged in as whichever actor the last test needed;
    // sweeping troupes/characters needs Administrator.
    await loginAsAdmin(page).catch(() => {});

    // CharacterRelationship rows (test 151) store `from`/`to` as plain string
    // character ids, not Parse pointers, so they are never swept by
    // `destroyCharactersByPrefix` (which only follows `owner` pointers) and
    // would otherwise be orphaned litter forever.
    const destroyedRelationships = await page.evaluate(async (ids) => {
      const Parse = window.Parse;
      if (!ids || ids.length === 0) return 0;
      const q1 = new Parse.Query('CharacterRelationship');
      q1.containedIn('from', ids);
      const q2 = new Parse.Query('CharacterRelationship');
      q2.containedIn('to', ids);
      const rows = await Parse.Query.or(q1, q2).find();
      if (rows.length) await Parse.Object.destroyAll(rows);
      return rows.length;
    }, [state.vampire, state.werewolf, state.changeling].filter(Boolean).map((c) => c.id)).catch((e) => {
      console.log('[e2e troupes] CharacterRelationship sweep failed:', e.message);
      return -1;
    });
    console.log('[e2e troupes] destroyed CharacterRelationship rows:', destroyedRelationships);

    const destroyedChars = await destroyCharactersByPrefix(page, FIXTURE_PREFIX)
      .catch((e) => ({ characters: 0, children: 0, errors: [String(e)] }));
    const destroyedTroupes = await destroyTroupesByPrefix(page, FIXTURE_PREFIX)
      .catch((e) => ({ troupes: 0, roles: 0, errors: [String(e)] }));
    console.log('[e2e troupes] destroyed in teardown (characters):', JSON.stringify(destroyedChars));
    console.log('[e2e troupes] destroyed in teardown (troupes):', JSON.stringify(destroyedTroupes));

    const final = {
      allTroupes: await page.evaluate(() => new window.Parse.Query('Troupe').count()).catch(() => -1),
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
      fixtureTroupes: await countTroupesByPrefix(page, FIXTURE_PREFIX).catch(() => -1),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX).catch(() => -1)
    };
    console.log(
      '[e2e troupes] final counts (should equal baseline ' + JSON.stringify(state.baseline) + '):',
      JSON.stringify(final)
    );

    await page.close();
  });

  // -------------------------------------------------------------------------
  // 129-131 - the troupe and its staff
  // -------------------------------------------------------------------------

  test('129 Create a new troupe via #troupe/new; it appears in #troupes', async () => {
    const name = uniqueTroupeName(FIXTURE_PREFIX);
    const troupe = await createTroupe(page, name);
    expect(troupe.id).toMatch(/^\w+$/);

    const listed = await listTroupes(page);
    const found = listed.find((t) => t.id === troupe.id);
    expect(found, `troupe ${troupe.id} listed in #troupes`).toBeTruthy();
    expect(found.name).toBe(name);

    state.troupeId = troupe.id;
    state.troupeName = name;
  });

  test('130 Add sampast as Assistant Storyteller via #troupe/:id/staff/add; they appear in the staff list', async () => {
    const before = await readStaff(page, state.troupeId);
    expect(before.some((r) => r.indexOf('sampast') !== -1), 'sampast not yet on staff').toBe(false);

    // Added as Narrator, not AST, deliberately: test 131 then demonstrates a
    // genuine role *change* (Narrator -> AST) rather than a second add, and
    // that change is what leaves sampast holding AST for every later test in
    // this file that needs it (139, 153, 154).
    const result = await addStaff(page, state.troupeId, 'sampast', 'Narrator');
    expect(result.role).toBe('Narrator');

    const after = await readStaff(page, state.troupeId);
    const row = after.find((r) => r.indexOf('sampast') !== -1);
    expect(row, 'sampast now appears on staff').toBeTruthy();
    expect(row.indexOf('Narrator:')).toBe(0);
  });

  test('131 Edit the staff role via #troupe/:id/staff/edit/:uid; the new role renders in the staff list', async () => {
    expect(await readStaffRole(page, state.troupeId, 'sampast')).toBe('Narrator');

    const result = await addStaff(page, state.troupeId, 'sampast', 'AST');
    expect(result.role).toBe('AST');

    const staff = await readStaff(page, state.troupeId);
    const sampastRows = staff.filter((r) => r.indexOf('sampast') !== -1);
    // The role changed in place - exactly one row for sampast, not a second
    // one alongside the old "Narrator" entry.
    expect(sampastRows).toHaveLength(1);
    expect(sampastRows[0].indexOf('AST:')).toBe(0);
    expect(await readStaffRole(page, state.troupeId, 'sampast')).toBe('AST');
  });

  // -------------------------------------------------------------------------
  // 132-134 - one completed character per venue, joined to the troupe
  // -------------------------------------------------------------------------

  test('132 Create and fully complete a Vampire owned by sampmem and join it to the troupe', async () => {
    await loginAsMember(page);

    const vampire = await createCompletedCharacter(page, 'Vampire', {
      name: `${FIXTURE_PREFIX}Vampire ${Date.now().toString(36)}`,
      texts: { clan: undefined }
    });
    expect(vampire.xp, 'lands on the documented 30/0/30 baseline').toEqual(BASELINE_XP);

    const ownerUsername = await page.evaluate((id) => {
      return new window.Parse.Query('Vampire').include('owner').get(id).then((c) => {
        const owner = c.get('owner');
        return owner ? owner.get('username') : null;
      });
    }, vampire.id);
    expect(ownerUsername, 'owned by sampmem, per assertion-side read-back').toBe('sampmem');

    const texts = await readCharacterTexts(page, vampire.id, 'Vampire');
    expect(texts.clan, 'a real Clan was picked during creation').toBeTruthy();
    const skills = await readTraits(page, vampire.id, 'skills', 'Vampire');
    expect(skills.length).toBeGreaterThan(0);

    await joinTroupe(page, vampire.id, state.troupeId);
    const roster = await readRoster(page, state.troupeId);
    expect(roster.map((r) => r.id)).toContain(vampire.id);

    state.vampire = Object.assign({}, vampire, { texts, skills });
  });

  test('133 Create and fully complete a Werewolf and join it to the troupe', async () => {
    // Still logged in as sampmem from test 132.
    const werewolf = await createCompletedCharacter(page, 'Werewolf', {
      name: `${FIXTURE_PREFIX}Werewolf ${Date.now().toString(36)}`,
      texts: { wta_breed: undefined }
    });
    expect(werewolf.xp).toEqual(BASELINE_XP);

    const texts = await readCharacterTexts(page, werewolf.id, 'Werewolf');
    expect(texts.wta_breed, 'a real Breed was picked during creation').toBeTruthy();
    const skills = await readTraits(page, werewolf.id, 'skills', 'Werewolf');
    expect(skills.length).toBeGreaterThan(0);

    await joinTroupe(page, werewolf.id, state.troupeId);
    const roster = await readRoster(page, state.troupeId);
    expect(roster.map((r) => r.id)).toContain(werewolf.id);

    state.werewolf = Object.assign({}, werewolf, { texts, skills });
  });

  test('134 Create and fully complete a Changeling and join it to the troupe', async () => {
    const changeling = await createCompletedCharacter(page, 'Changeling', {
      name: `${FIXTURE_PREFIX}Changeling ${Date.now().toString(36)}`,
      texts: { ctdbs_kith: undefined }
    });
    expect(changeling.xp).toEqual(BASELINE_XP);

    const texts = await readCharacterTexts(page, changeling.id, 'Changeling');
    expect(texts.ctdbs_kith, 'a real Kith was picked during creation').toBeTruthy();
    const skills = await readTraits(page, changeling.id, 'skills', 'Changeling');
    expect(skills.length).toBeGreaterThan(0);

    await joinTroupe(page, changeling.id, state.troupeId);
    const roster = await readRoster(page, state.troupeId);
    expect(roster.map((r) => r.id)).toContain(changeling.id);

    state.changeling = Object.assign({}, changeling, { texts, skills });

    // All three fixtures exist now - assert the troupe's roster is exactly them.
    expect(roster).toHaveLength(3);
    expect([...roster.map((r) => r.id)].sort()).toEqual(
      [state.vampire.id, state.werewolf.id, state.changeling.id].sort()
    );
  });

  // -------------------------------------------------------------------------
  // 135-138 - the roster
  // -------------------------------------------------------------------------

  test('135 #troupe/:id/characters/all lists all three characters by name', async () => {
    await loginAsAdmin(page);

    const names = await readRosterNames(page, state.troupeId);
    for (const c of [state.vampire, state.werewolf, state.changeling]) {
      expect(names.some((n) => n.indexOf(c.name) === 0), `${c.name} listed on the roster`).toBe(true);
    }
    expect(names).toHaveLength(3);
  });

  test('136 The roster shows the correct creature type for each of the three characters', async () => {
    // character-list-item.html branches on `e.get("type")`: only a Werewolf
    // renders its wta_breed/wta_tribe/wta_auspice paragraph, only a Changeling
    // renders ctdbs_kith/ctdbs_fealty_court, and only neither (a Vampire, which
    // carries no `type` attribute at all) renders sect/archetype/clan. Reading
    // each fixture's own real picked value back and requiring it to appear in
    // *that* character's own roster row - and *not* leak into the others -
    // proves the branch taken, not merely that a row rendered.
    await navigateToHash(page, `troupe/${state.troupeId}/characters/all`, '#troupe-characters-all');
    const itemText = async (id) => page.evaluate((cid) => {
      const root = document.querySelector('#troupe-characters-all');
      const a = root ? root.querySelector(`a[backendid="${cid}"]`) : null;
      return a ? a.textContent.replace(/\s+/g, ' ').trim() : null;
    }, id);

    const vampText = await itemText(state.vampire.id);
    const wereText = await itemText(state.werewolf.id);
    const chanText = await itemText(state.changeling.id);

    expect(vampText).toContain(state.vampire.texts.clan);
    expect(wereText).toContain(state.werewolf.texts.wta_breed);
    expect(chanText).toContain(state.changeling.texts.ctdbs_kith);

    // Cross-check: the Vampire's own clan text does not leak into the other two.
    expect(wereText).not.toContain(state.vampire.texts.clan);
    expect(chanText).not.toContain(state.vampire.texts.clan);
  });

  test('137 The roster filter narrows the list to a single character by name', async () => {
    await navigateToHash(page, `troupe/${state.troupeId}/characters/all`, '#troupe-characters-all');

    const filterInput = page.locator('#troupe-characters-all #troupes-characters-filter');
    await filterInput.fill(state.vampire.name);
    await filterInput.dispatchEvent('keyup');
    await page.waitForTimeout(400);

    const visibleItems = page.locator('#troupe-characters-all li:visible');
    await expect(visibleItems).toHaveCount(1);
    const visibleText = normalize(await visibleItems.first().textContent());
    expect(visibleText).toContain(state.vampire.name);
    expect(visibleText).not.toContain(state.werewolf.name);
    expect(visibleText).not.toContain(state.changeling.name);

    // Clear the filter so later tests see the full roster again.
    await filterInput.fill('');
    await filterInput.dispatchEvent('keyup');
    await page.waitForTimeout(400);
  });

  test('138 #troupe/:id/character/:cid renders each individual character within troupe context', async () => {
    for (const c of [state.vampire, state.werewolf, state.changeling]) {
      const sheetText = await openCharacterSheetAndWait(page, `troupe/${state.troupeId}/character/${c.id}`, c.name);
      expect(sheetText, `${c.name}'s sheet renders through the troupe route`).toContain(c.name);

      const xp = await readSheetXp(page, c.id);
      expect(xp, `${c.name} still at the creation baseline`).toEqual(BASELINE_XP);
    }
  });

  // -------------------------------------------------------------------------
  // 139-141 - access control
  // -------------------------------------------------------------------------

  test("139 sampast as AST can open all three characters' sheets", async () => {
    await loginAsAST(page);

    for (const c of [state.vampire, state.werewolf, state.changeling]) {
      const sheetText = await openCharacterSheetAndWait(page, `troupe/${state.troupeId}/character/${c.id}`, c.name);
      expect(sheetText, `AST can read ${c.name}'s real sheet content`).toContain(c.name);

      const fetch = await tryFetchCharacterAsCurrentUser(page, c.id);
      expect(fetch.ok, `AST's own session can fetch ${c.name}`).toBe(true);
      expect(fetch.name).toBe(c.name);
    }
  });

  test('140 A stranger user not in the troupe cannot open the troupe roster', async () => {
    await loginAsStranger(page);

    // The "View Characters" affordance itself is gated: TroupeView renders it
    // only `if (!readonly)`, where `readonly = !(is_st || is_ad)` - absent
    // entirely for a plain stranger.
    await navigateToHash(page, `troupe/${state.troupeId}`, '#troupe');
    await expect(page.locator('#troupe .troupe-view-characters')).toHaveCount(0);

    // Direct hash navigation still opens the roster *page* - jQuery Mobile has
    // no route-level permission gate here - but Parse silently omits every
    // row the session cannot read, so the data is genuinely absent, not
    // merely hidden by a UI affordance. Both halves are asserted.
    const domRoster = await readRoster(page, state.troupeId);
    expect(domRoster, 'DOM roster is empty for a stranger despite 3 real members').toEqual([]);

    const strangerCount = await queryTroupeCharacterCountAsCurrentUser(page, state.troupeId);
    expect(strangerCount, "the stranger's own Parse session counts 0 troupe characters").toBe(0);
  });

  test('141 A stranger user cannot open any of the three characters', async () => {
    // Still logged in as sampstranger.
    for (const c of [state.vampire, state.werewolf, state.changeling]) {
      const fetch = await tryFetchCharacterAsCurrentUser(page, c.id);
      expect(fetch.ok, `${c.name} is inaccessible to a stranger's own Parse session`).toBe(false);
      expect(fetch.code, 'Parse.Error.OBJECT_NOT_FOUND').toBe(101);

      // UI-level corroboration: show_character_helper's .fail() branch bounces
      // the hash back to the roster rather than ever rendering the sheet.
      await navigateToHash(page, `troupe/${state.troupeId}/character/${c.id}`);
      await page.waitForTimeout(1000);
      const activeId = await activePageId(page);
      expect(activeId, `attempting to open ${c.name} lands back on the roster, not the sheet`).toBe('troupe-characters-all');
    }
  });

  // -------------------------------------------------------------------------
  // 142-145 - summarize
  // -------------------------------------------------------------------------

  test('142 #troupe/:id/characters/summarize/all renders one row per character with populated trait columns', async () => {
    await loginAsAdmin(page);
    await navigateToHash(page, `troupe/${state.troupeId}/characters/summarize/all`, SUMMARIZE_PAGE);
    await page.waitForTimeout(500);

    const rows = await readListRows(page, SUMMARIZE_PAGE, '#troupe-summarize-characters-list');
    expect(rows).toHaveLength(3);

    // Default filter is category=attributes, resulttype=onlycat, antecedence=PC,
    // playable=true - every fixture qualifies (each is owned, has attributes,
    // and none carries an NPC antecedence). Each row is matched to its
    // character and required to show that character's *actual* picked
    // attribute name/value pairs, not merely a non-empty row.
    for (const c of [state.vampire, state.werewolf, state.changeling]) {
      const row = rows.find((r) => r.indexOf(c.name) === 0);
      expect(row, `a summarize row for ${c.name}`).toBeTruthy();
      expect(row).toContain('Attributes');

      const attrs = await readTraits(page, c.id, 'attributes', c.venue);
      expect(attrs.length).toBeGreaterThan(0);
      for (const attr of attrs) {
        expect(row, `${c.name}'s row shows ${attr.name} x${attr.value}`).toContain(`${attr.name} x${attr.value}`);
      }
    }
  });

  test('143 The summarize view shows each character\'s actual attribute and skill values, not blanks', async () => {
    await setListFilter(page, SUMMARIZE_PAGE, { category: 'Skills' });
    const rows = await readListRows(page, SUMMARIZE_PAGE, '#troupe-summarize-characters-list');
    expect(rows).toHaveLength(3);

    for (const c of [state.vampire, state.werewolf, state.changeling]) {
      const row = rows.find((r) => r.indexOf(c.name) === 0);
      expect(row, `a Skills row for ${c.name}`).toBeTruthy();
      expect(row).toContain('Skills');
      // Real values captured at fixture creation (test 132-134), not re-derived.
      for (const skill of c.skills) {
        expect(row, `${c.name}'s row shows ${skill.name} x${skill.value}`).toContain(`${skill.name} x${skill.value}`);
      }
    }
  });

  test('144 Switching the summarize view to CSV renders three data rows (no header row exists)', async () => {
    // See file-level finding 4: neither CSV template ever emits a header/
    // column-label row. Documented here as measured reality rather than
    // asserting a header that the application never renders.
    await setListFilter(page, SUMMARIZE_PAGE, { format: 'CSV' });
    const rows = await readListRows(page, SUMMARIZE_PAGE, '#troupe-summarize-characters-list');
    expect(rows).toHaveLength(3);

    for (const c of [state.vampire, state.werewolf, state.changeling]) {
      const row = rows.find((r) => r.indexOf(`"${c.name}"`) === 0);
      expect(row, `a quoted CSV row starting with "${c.name}"`).toBeTruthy();
    }
    // None of the three rows is a label/header row - each begins with an
    // actual character's quoted name.
    expect(rows.every((r) => /^"[^"]+"/.test(r))).toBe(true);
  });

  test('145 Filtering the summarize view by creature type shows only the matching characters', async () => {
    // See file-level finding 5: there is no literal "creature type" selector
    // and Changeling never appears in this dropdown at all. "Disciplines" is
    // Vampire-exclusive (confirmed absent from both Werewolf's and
    // Changeling's own trait sets), so filtering to it isolates the Vampire -
    // a real, working narrowing of the venue-mixed roster, using the control
    // that actually exists.
    await setListFilter(page, SUMMARIZE_PAGE, { category: 'Disciplines', format: 'Pretty' });
    const rows = await readListRows(page, SUMMARIZE_PAGE, '#troupe-summarize-characters-list');

    expect(rows).toHaveLength(1);
    expect(rows[0].indexOf(state.vampire.name)).toBe(0);
    expect(rows.join(' ')).not.toContain(state.werewolf.name);
    expect(rows.join(' ')).not.toContain(state.changeling.name);

    // Restore defaults for the tests that follow.
    await setListFilter(page, SUMMARIZE_PAGE, { category: 'Attributes' });
  });

  // -------------------------------------------------------------------------
  // 146-149 - select to print
  // -------------------------------------------------------------------------

  test('146 #troupe/:id/characters/selecttoprint/all lists all three characters', async () => {
    await navigateToHash(page, `troupe/${state.troupeId}/characters/selecttoprint/all`, SELECT_TO_PRINT_PAGE);
    await page.waitForTimeout(500);

    const rows = await readListRows(page, SELECT_TO_PRINT_PAGE, '#troupe-select-to-print-characters-list');
    expect(rows).toHaveLength(3);
    for (const c of [state.vampire, state.werewolf, state.changeling]) {
      expect(rows.some((r) => r.indexOf(c.name) === 0), `${c.name} listed`).toBe(true);
    }

    // See file-level finding 3: no per-character selection checkboxes exist
    // anywhere in the character-list region specifically (the two checkboxes
    // elsewhere on this page belong to the filter form and PrintSettingsForm).
    const checkboxesInList = await page.locator(
      `${SELECT_TO_PRINT_PAGE} #troupe-select-to-print-characters-list input[type="checkbox"]`
    ).count();
    expect(checkboxesInList, 'no individual selection checkboxes exist in the list region').toBe(0);
  });

  test('147 Selecting two of the three and printing renders exactly two sheets', async () => {
    // Narrow via the real filter mechanism (finding 3): give the excluded
    // character an NPC antecedence through a genuine post-creation UI pick,
    // which the page's own default antecedence=PC filter then excludes.
    const picked = await pickSimpleText(page, state.changeling.id, 'antecedences', 'antecedence', 'NPC', { duringCreation: false });
    expect(picked).toBe('NPC');
    state.changeling.texts.antecedence = 'NPC';

    await navigateToHash(page, `troupe/${state.troupeId}/characters/selecttoprint/all`, SELECT_TO_PRINT_PAGE);
    await page.waitForTimeout(500);

    const rows = await readListRows(page, SELECT_TO_PRINT_PAGE, '#troupe-select-to-print-characters-list');
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.indexOf(state.vampire.name) === 0)).toBe(true);
    expect(rows.some((r) => r.indexOf(state.werewolf.name) === 0)).toBe(true);
    expect(rows.some((r) => r.indexOf(state.changeling.name) === 0)).toBe(false);

    await page.locator(`${SELECT_TO_PRINT_PAGE} #print-shown`).click();
    await waitForActivePage(page, 'troupe-print-characters-all');

    const sheets = await readPrintedSheetNames(page);
    expect(sheets).toHaveLength(2);
    expect([...sheets].sort()).toEqual([state.vampire.name, state.werewolf.name].sort());
  });

  test("148 The printed sheets contain each selected character's actual trait values", async () => {
    // Still on the print page rendered by test 147.
    const vampSlice = await readPrintedCharacterText(page, state.vampire.name);
    const wereSlice = await readPrintedCharacterText(page, state.werewolf.name);
    expect(vampSlice, "the Vampire's own printed slice was isolated").toBeTruthy();
    expect(wereSlice, "the Werewolf's own printed slice was isolated").toBeTruthy();

    // Skills is shared/venue-agnostic (finding 1) - the primary, uniform proof.
    for (const skill of state.vampire.skills) {
      expect(vampSlice).toContain(`${skill.name} x${skill.value}`);
    }
    for (const skill of state.werewolf.skills) {
      expect(wereSlice).toContain(`${skill.name} x${skill.value}`);
    }

    // Venue-specific header fields, real values.
    expect(vampSlice).toContain(`Clan: ${state.vampire.texts.clan}`);
    expect(wereSlice).toContain(`Breed: ${state.werewolf.texts.wta_breed}`);
  });

  test('149 The unselected character does not appear in the print output', async () => {
    const fullText = normalize(await page.locator(PRINT_PAGE).textContent());
    expect(fullText).not.toContain(state.changeling.name);
    if (state.changeling.texts.ctdbs_kith) {
      expect(fullText).not.toContain(`Kith: ${state.changeling.texts.ctdbs_kith}`);
    }
  });

  // -------------------------------------------------------------------------
  // 150-151 - relationship network
  // -------------------------------------------------------------------------

  test('150 #troupe/:id/characters/relationships/network renders one node per troupe character', async () => {
    await navigateToHash(page, `troupe/${state.troupeId}/characters/relationships/network`, NETWORK_PAGE);
    await page.waitForTimeout(1000);

    const graph = await readNetworkGraph(page);
    expect(graph, 'the vis.js Network view publishes its graph').toBeTruthy();
    expect(graph.nodes).toHaveLength(3);

    const labels = graph.nodes.map((n) => n.id + '|' + n.label).sort();
    const expected = [state.vampire, state.werewolf, state.changeling]
      .map((c) => c.id + '|' + c.name).sort();
    expect(labels).toEqual(expected);
  });

  test('151 Adding a relationship between two characters renders an edge in the network graph', async () => {
    const before = await readNetworkGraph(page);
    const edgesBefore = before.edges.length;

    const coords = await computeNodeScreenCoordinates(page);

    // A plain click selects the first node; vis.js's multiselect requires the
    // modifier held for the *second* click - see file-level finding 6 for why
    // this uses manual keyboard down/up rather than click()'s `modifiers`
    // option, which measured unreliable for this canvas control specifically.
    await page.mouse.click(coords[state.vampire.id].x, coords[state.vampire.id].y);
    await page.waitForTimeout(300);
    await page.keyboard.down('Control');
    await page.mouse.click(coords[state.werewolf.id].x, coords[state.werewolf.id].y);
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);

    const selected = await page.evaluate(() => {
      const v = (window.__yorick && window.__yorick.tcrnv) || window.router.tcrnv;
      return v.selected_nodes.slice();
    });
    expect([...selected].sort()).toEqual([state.vampire.id, state.werewolf.id].sort());

    const createButton = page.locator(`${NETWORK_PAGE} .make-relationship`);
    await expect(createButton).toBeEnabled();
    await createButton.click();

    // make_relationship() saves the CharacterRelationship then reloads the
    // whole page (not a hash change) - wait for the reload, then re-navigate
    // to a fresh view of the same route.
    await page.waitForTimeout(800);
    await waitForAppReady(page);
    await navigateToHash(page, `troupe/${state.troupeId}/characters/relationships/network`, NETWORK_PAGE);
    await page.waitForTimeout(1000);

    const after = await readNetworkGraph(page);
    expect(after.edges).toHaveLength(edgesBefore + 1);
    const newEdge = after.edges.find((e) =>
      (e.from === state.vampire.id && e.to === state.werewolf.id) ||
      (e.from === state.werewolf.id && e.to === state.vampire.id));
    expect(newEdge, 'the new edge connects the two selected characters').toBeTruthy();

    // Assertion-side corroboration directly against the row the click created.
    const relCount = await page.evaluate(async ({ from, to }) => {
      const q = new window.Parse.Query('CharacterRelationship');
      q.equalTo('from', from);
      q.equalTo('to', to);
      return q.count();
    }, { from: newEdge.from, to: newEdge.to });
    expect(relCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 152-154 - leave and rejoin
  // -------------------------------------------------------------------------

  test('152 A character leaving via #character/:cid/troupes/leave disappears from the roster', async () => {
    await loginAsMember(page); // sampmem owns the Werewolf

    const before = await readRoster(page, state.troupeId);
    expect(before.map((r) => r.id)).toContain(state.werewolf.id);

    await leaveTroupe(page, state.werewolf.id, state.troupeId);

    const after = await readRoster(page, state.troupeId);
    expect(after.map((r) => r.id)).not.toContain(state.werewolf.id);
    expect(after).toHaveLength(2);
    expect([...after.map((r) => r.id)].sort()).toEqual([state.vampire.id, state.changeling.id].sort());
  });

  test('153 After leaving, sampast loses access to that character', async () => {
    await loginAsAST(page);

    const fetch = await tryFetchCharacterAsCurrentUser(page, state.werewolf.id);
    expect(fetch.ok, "AST's session can no longer fetch the departed Werewolf").toBe(false);
    expect(fetch.code).toBe(101);

    // The two characters that never left remain accessible - the ACL change
    // is scoped to the one character that left, not a blanket revocation.
    const stillOk = await tryFetchCharacterAsCurrentUser(page, state.vampire.id);
    expect(stillOk.ok, 'AST access to the other characters is unaffected').toBe(true);

    // UI-level corroboration: show_character_helper's .fail() branch bounces
    // the hash back to the roster (the back_url `troupe_character` sets)
    // rather than ever rendering the sheet. This is secondary to the
    // assertion-side proof above - per the file-level comment on
    // `tryFetchCharacterAsCurrentUser`, a redirect alone would not prove the
    // data is genuinely inaccessible - but it is real, measured application
    // behaviour, just slower to land in a DOM-heavy session (many pages deep
    // by this point in the suite) than a fixed short wait accounts for, so
    // it is polled rather than trusted after one timeout.
    await navigateToHash(page, `troupe/${state.troupeId}/character/${state.werewolf.id}`);
    const deadline = Date.now() + 15000;
    let activeId = await activePageId(page);
    while (Date.now() < deadline && activeId !== 'troupe-characters-all') {
      await page.waitForTimeout(500);
      activeId = await activePageId(page);
    }
    expect(activeId, 'bounced back to the roster rather than rendering the departed character').toBe('troupe-characters-all');
  });

  test('154 Re-joining the troupe restores AST access and the roster entry', async () => {
    await loginAsMember(page);
    await joinTroupe(page, state.werewolf.id, state.troupeId);

    const roster = await readRoster(page, state.troupeId);
    expect(roster.map((r) => r.id)).toContain(state.werewolf.id);
    expect(roster).toHaveLength(3);

    await loginAsAST(page);
    const fetch = await tryFetchCharacterAsCurrentUser(page, state.werewolf.id);
    expect(fetch.ok, "AST's session can fetch the rejoined Werewolf again").toBe(true);
    expect(fetch.name).toBe(state.werewolf.name);

    const sheetText = await openCharacterSheetAndWait(page, `troupe/${state.troupeId}/character/${state.werewolf.id}`, state.werewolf.name);
    expect(sheetText).toContain(state.werewolf.name);
  });
});
