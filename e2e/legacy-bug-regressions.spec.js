/**
 * Regression tests for the defects catalogued in
 * `docs/legacy-bugs-found-during-react-port.md`, with their resolutions in
 * `docs/legacy-bugs-fixed.md`.
 *
 * Entries numbered plainly (#0, #6, #14) come from those documents. Entries
 * prefixed R (R1, R2) were found while writing these tests and are described
 * in `legacy-bugs-fixed.md` under their own headings. Note that `R1`-`R51`
 * elsewhere in `docs/` means the unrelated access-control remediation.
 *
 * Nothing here asks which client it is talking to. Several of these tests once
 * did -- reaching for `window.router.characterMainPage`, `router._character`,
 * `router.lastadminchecktime` -- and each one pinned a defect to the mechanism
 * that happened to carry it, so no port could be held to it however correct it
 * was. They now assert what a person can observe, and run against every client.
 *
 * The ones here are the ones that need a rendered page and a real server: a
 * whole section of the start page that was silently empty, a history entry that
 * trapped a user behind a refusal, a failure with no message, and the character
 * sheet's identity block. The rest - collection ordering, the clan-rule page
 * size, template guards, markup shape - are decided without a browser in
 * `test/legacy-bug-regressions.test.js` and run in a second.
 *
 * Each test names the numbered entry it covers and says what the failure looked
 * like, because most of these fail *silently*: an empty list, a missing line, a
 * spinner that stops. An assertion that only checks the happy state would pass
 * against the bug, so every one below pins the thing that was actually absent.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsAST, loginAsMember, logout } = require('./helpers/auth');
const {
  waitForAppReady,
  waitForJqmLoader,
  waitForActivePage,
  navigateToHash,
  hardReload,
  clearStuckLoader,
  selectBackformOption,
  activePageId,
  normalize,
  runInApp
} = require('./helpers/jqm-helpers');

// Imported rather than written out, so the fixture and the test that depends on
// its shape cannot drift apart. `seed_db.js` writes this character straight
// into Mongo, which is why it has no change rows.
const { PRIVATE_FIXTURE_CHARACTER_ID } = require('../seed_db');

const ERROR_REGION = '#global-error-region';

/**
 * How far from the remembered offset a restored page may land.
 *
 * The restore itself is exact. Instrumenting `window.scrollTo` on the Vue
 * client shows it land on precisely the remembered offset, every run, pass or
 * fail. What moves afterwards is the BROWSER, not the app: when the last of the
 * page's content arrives after the restore and lands ABOVE the reader, CSS
 * scroll anchoring adds that content's height to `window.scrollY` so the thing
 * being read stays where it is.
 *
 * Measured on the Vue client, six runs with `overflow-anchor` as the only
 * variable:
 *
 *   restore fired at height 2572 (36px short), anchoring on    scrollY 436
 *   restore fired at height 2608 (settled),    anchoring on    scrollY 400
 *   restore fired at height 2572 (36px short), anchoring off   scrollY 400
 *
 * The drift is exactly the height of whatever arrived late, and it is the
 * browser keeping the reader's place rather than the app losing it -- so it is
 * accommodated here rather than suppressed in the client, which would cost a
 * real behaviour to satisfy a test.
 *
 * No wait avoids it. The displacement happens inside the app's own restore,
 * before this assertion gets a turn, and it is stable once it has happened:
 * sampling `scrollY` for three seconds afterwards reads 436 the whole way.
 *
 * This is a tolerance on the RETURN TRIP only. The assertions that a page
 * opened at the TOP stay exact, because at `scrollY` 0 there is nothing above
 * the viewport for anchoring to compensate for, and so do the ones checking
 * that the test's own `scrollTo` took effect on a page that has already settled.
 */
const RESTORE_TOLERANCE = 36;

/** Set the hash directly and wait for the app to settle, without asserting where it lands. */
async function gotoHashUnchecked(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await waitForJqmLoader(page);
}

/**
 * The Parse class each of these admin routes edits.
 *
 * The route name is not the class name, and the mapping lives in the client
 * (`mobileRouter.js`'s six handlers, `web/src/parse/models/Description.ts`'s
 * table). It is repeated here because the assertion below needs to know what
 * the screen *ought* to be showing, and asking the client would mean trusting
 * the thing under test.
 */
const ADMIN_CATEGORY_CLASSES = {
  'administration/descriptions': 'Description',
  'administration/bnsmetv1_clan_rules': 'bnsmetv1_ClanRule',
  'administration/bnsctdbs_kith_rules': 'bnsctdbs_KithRule',
  'administration/bnsmetv1_ritual_rules': 'bnsmetv1_RitualRule'
};

/**
 * The categories a class actually has, according to the server.
 *
 * Read through the SDK rather than off the screen, because it is the answer the
 * screen is being judged against. Rows with no `category` are skipped, which is
 * #19: an object key is a string, so accumulating them wrote the key
 * "undefined" and the dropdown offered an option reading exactly that.
 */
async function categoriesOnServer(page, className) {
  const found = await runInApp(page, ['parse'], `
    var Parse = mods[0];
    var q = new Parse.Query(arg.className);
    q.select("category");
    var seen = {};
    return q.each(function (row) {
      var c = row.get("category");
      if (c) seen[c] = 1;
    }).then(function () { return Object.keys(seen); });
  `, { className });
  return found.slice().sort();
}

/**
 * Visit one of the admin screens that share the category select, and report on
 * what it is showing once it has finished showing it.
 *
 * The readiness wait is the whole difficulty. It cannot be "a select exists
 * with 'All' in it", because R3 shows that on the legacy client the select
 * sitting in that region can be the PREVIOUS screen's - R2's test was written
 * that way and silently stopped detecting its own bug, passing against fully
 * reverted sources. It also cannot ask which Marionette view owns the node,
 * which is what replaced it: that is a mechanism only one of the three clients
 * has, and this file runs against all of them.
 *
 * So it waits for the select to hold exactly the categories the SERVER says
 * this route's class has. That is satisfiable only by the right content, from a
 * source outside the client, so a screen showing another class's categories --
 * or its own, but stale -- times out here rather than being read and asserted
 * on. R2's other property, that the select is jQM-enhanced, stays independent
 * of it.
 */
async function visitAdminCategoryScreen(page, route) {
  const className = ADMIN_CATEGORY_CLASSES[route];
  if (!className) throw new Error(`no Parse class recorded for the route ${route}`);
  const expected = await categoriesOnServer(page, className);

  await navigateToHash(page, route, '#administration-descriptions');
  try {
    await page.waitForFunction((want) => {
      const dom = document.querySelector('#descriptions-sections select');
      if (!dom) return false;
      const shown = Array.from(dom.options).map((o) => o.text);
      // "All" is appended unconditionally by every client, so it is the signal
      // that the list was rebuilt rather than left holding a placeholder.
      if (!shown.includes('All')) return false;
      const categories = shown.filter((o) => o !== 'All').slice().sort();
      return categories.length === want.length &&
        categories.every((c, i) => c === want[i]);
    }, expected, { timeout: 30000 });
  } catch (err) {
    const shown = await page.evaluate(() => {
      const dom = document.querySelector('#descriptions-sections select');
      return dom ? Array.from(dom.options).map((o) => o.text) : null;
    }).catch(() => null);
    throw new Error(
      `${route} never showed ${className}'s own categories. Expected ` +
      `[${expected.join(', ')}] plus "All"; the select holds ` +
      (shown ? `[${shown.join(', ')}]` : 'no select at all') + '.'
    );
  }
  // These admin routes hide their spinner only on the failure path, so the
  // overlay would otherwise swallow the next navigation.
  await clearStuckLoader(page);

  return page.evaluate(() => {
    const dom = document.querySelector('#descriptions-sections select');
    return {
      options: Array.from(dom.options).map((o) => o.text),
      // jQuery Mobile wraps an enhanced `<select>` in `.ui-select`. Every
      // client either produces that wrapper or does not; none of them needs to
      // be asked which one it is.
      enhanced: !!dom.closest('.ui-select')
    };
  });
}

/**
 * Open a character sheet, scroll down it, and leave through a text picker.
 * Returns the offset that was scrolled to.
 *
 * Shared by the #17 restore tests. The waits are the whole difficulty: the sheet
 * grows as Marionette fills its regions, so scrolling too early silently lands
 * at 0, and the sheet's own restore fires on `pagechange` and would drag the
 * page back under us if it landed after our scroll.
 */
async function scrollSheetAndLeave(page, characterId) {
  await navigateToHash(page, 'character?' + characterId, '#character');
  await expect(page.locator('#character #insertheader')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(
    () => document.documentElement.scrollHeight - window.innerHeight > 200,
    { timeout: 30000 });
  // Let the sheet's own restore fire and consume its offset before we scroll.
  await page.waitForTimeout(1500);

  const offset = await page.evaluate(() => {
    const room = document.documentElement.scrollHeight - window.innerHeight;
    const target = Math.min(400, Math.floor(room / 2));
    window.scrollTo(0, target);
    return target;
  });
  expect(offset, 'the sheet must be scrollable for this to mean anything')
    .toBeGreaterThan(50);
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, offset,
    { timeout: 15000 });

  await gotoHashUnchecked(page, '#simpletext/archetype/archetype/' + characterId + '/pick');
  await waitForActivePage(page, 'simpletext-new');
  return offset;
}

test.describe('Legacy bugs found during the React port', () => {

  // -------------------------------------------------------------------------
  // #0 A character with an empty timeline could not open Show Approval at all
  // -------------------------------------------------------------------------
  //
  // `register` sets `picked.right` to `recorded_changes.models.length - 1`, so
  // a character with no non-experience change rows gives -1, `at(-1)` is
  // `undefined`, and `update_override_character_and_transform` threw
  // `TypeError: Cannot read properties of undefined (reading 'id')`. The route
  // caught it with a bare `.fail(PromiseFailReport)` and its `loading("hide")`
  // sat inside the `.then()`, so the user was left on the SPLASH SCREEN with
  // the hash changed, `ui-loading` stuck on <html>, and nothing said.
  //
  // Measured before the fix, against this same fixture:
  //
  //   activePage       "splashscreen"      (not "character-approval")
  //   htmlHasUiLoading true                (a full-page click-swallowing overlay)
  //   console          info: Error in promise {}
  //
  // The document reporting this said it was "every character that has just
  // been created". It is not, and the difference matters for anyone hunting
  // it: `Vampire.create` seeds Humanity, three health levels and Willpower, so
  // a freshly created character has FIVE rows and opens fine - measured, and
  // the control test below pins it. What has an empty timeline is a character
  // whose change rows do not exist at all, which is this seeded fixture and,
  // in production, anything imported or migrated without its history.

  test('#0 Show Approval opens for a character with no recorded changes', async ({ page }) => {
    await loginAsAdmin(page);

    // If the fixture ever gains change rows this test stops reproducing the
    // bug, and it must say so rather than pass on a character that was never
    // going to trigger it.
    const timeline = await runInApp(page, ['app/models/Vampire'], `
      return mods[0].get_character(arg.id, "all").then(function (c) {
        return c.get_recorded_changes().then(function () {
          return c.recorded_changes.models.length;
        });
      });
    `, { id: PRIVATE_FIXTURE_CHARACTER_ID });
    expect(timeline,
      'the fixture must have an EMPTY approval timeline or this proves nothing')
      .toBe(0);

    await navigateToHash(page, 'character/' + PRIVATE_FIXTURE_CHARACTER_ID + '/approval',
      '#character-approval');

    await expect(page.locator('#character-approval')).toBeVisible();
    await expect(page.locator(ERROR_REGION)).toHaveCount(0);

    // The spinner must come down. A stuck `ui-loading` is a full-page overlay
    // that swallows the next click anywhere on the page.
    expect(await page.evaluate(() =>
      document.documentElement.classList.contains('ui-loading'))).toBe(false);

    // And the sheet renders the character as at creation, which is the right
    // answer when there is nothing to replay.
    await expect(page.locator('#approval-sheet')).toContainText('Private Owner Test Character');
    // With no rows drawn - the counterpart to the control test's count.
    await expect(page.locator('#approval-changes input[id^="history-changes-"]'))
      .toHaveCount(0);
  });

  test('#0 a character WITH recorded changes still opens its approval page', async ({ page }) => {
    // The control. Without it, a guard that broke the normal path - or simply
    // returned early for everyone - would pass the test above.
    await loginAsAdmin(page);

    const character = await runInApp(page, ['app/models/Vampire'], `
      return mods[0].create_test_character("r0_control").then(function (v) {
        return mods[0].get_character(v.id, "all");
      }).then(function (c) {
        return c.get_recorded_changes().then(function () {
          return { id: c.id, name: c.get("name"), rows: c.recorded_changes.models.length };
        });
      });
    `);
    // Vampire.create seeds Humanity, three health levels and Willpower.
    expect(character.rows).toBeGreaterThan(0);

    await navigateToHash(page, 'character/' + character.id + '/approval', '#character-approval');

    await expect(page.locator('#character-approval')).toBeVisible();
    await expect(page.locator(ERROR_REGION)).toHaveCount(0);
    expect(await page.evaluate(() =>
      document.documentElement.classList.contains('ui-loading'))).toBe(false);
    await expect(page.locator('#approval-sheet')).toContainText(character.name);
    // The timeline the empty case has none of. `character-approval-changes.html`
    // emits one hidden input per row beside the range slider, so this counts
    // the rows the view actually drew rather than assuming any trait name.
    await expect(page.locator('#approval-changes input[id^="history-changes-"]'))
      .toHaveCount(character.rows);
  });

  test('#0 a failure on the approval route drops the spinner and says so', async ({ page }) => {
    // The other half of the fix, which the two tests above cannot reach: with
    // the empty-timeline guard in place they both succeed, and `loading("hide")`
    // sitting inside the `.then()` was only ever wrong on the FAILURE path.
    //
    // A character id that does not exist reaches the same tail. Before the
    // change: `ui-loading` stuck on <html> - a full-page overlay that swallows
    // the next click anywhere - and nothing said but `Error in promise {}`.
    await loginAsAdmin(page);
    await navigateToHash(page, 'characters?all', '#characters-all');

    await gotoHashUnchecked(page, '#character/nosuchcharacter/approval');

    await expect(page.locator(ERROR_REGION)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(ERROR_REGION)).toContainText(/Couldn't open the approval page/i);
    expect(await page.evaluate(() =>
      document.documentElement.classList.contains('ui-loading'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // #14 The approval screen left diff markers on every sheet drawn afterwards
  // -------------------------------------------------------------------------
  //
  // Numbers here match the document's. The one exception is `#R1`, the profile
  // page's Roles section, which was found while writing these tests and is not
  // in the document at all - it briefly held the number 14 and was relabelled
  // when the document claimed that number for this entry.
  //
  // `update_override_character_and_transform` wrote `transform_description`
  // onto `self.model`, and the router memoises that character across routes
  // (`_character`). `helpers/VampirePrintHelper.js` switches on
  // `this.model.transform_description` to decide whether to draw a value
  // plainly or as "old struck through in red, new in green", so the next sheet
  // drawn from the cached character inherited this screen's diff.
  //
  // Asserted through what the next sheet DRAWS.
  //
  // This used to reach into `router.characterApprovalView`, `router._character`
  // and the history view's `format_attribute_value`, which is the right shape
  // for finding the bug and the wrong shape to keep -- all three exist only
  // because the legacy client is Backbone, so no other client could be held to
  // the test however correct it was.
  //
  // The visible defect is a sheet drawing a diff it has no business drawing.
  // `formatSkill` (`helpers/VampirePrintHelper.js`, `web/src/print/format.ts`,
  // `client/src/domain/print.ts`)
  // applies one only when it is handed a `transform_description`, so an
  // ORDINARY printable sheet must contain no diff markup at all. Measured
  // before the fix: a trait whose value had simply been raised to 4 printed as
  // "<i class='fa fa-minus'>2 ... <i class='fa fa-plus'>4".
  //
  // The approval screen is checked FIRST, and required to show its own diff.
  // Without that, "no diff markers on the printable sheet" would pass just as
  // well on a client that had lost the ability to draw diffs anywhere.

  test('#14 the approval screen leaves no diff on the sheets drawn after it', async ({ page }) => {
    await loginAsAdmin(page);

    const character = await runInApp(page, ['app/models/Vampire'], `
      return mods[0].create_test_character("r15_leak").then(function (v) {
        return v.update_trait("Physical", 2, "attributes", 0, true).then(function () {
          return v.update_trait("Physical", 4, "attributes", 0, true);
        }).then(function () { return { id: v.id, name: v.get("name") }; });
      });
    `);

    // The positive control: the approval screen SHOULD diff, and does.
    await navigateToHash(page, 'character/' + character.id + '/approval', '#character-approval');
    await expect(page.locator('#approval-sheet')).toBeVisible();

    const approvalMarkup = await page.locator('#approval-sheet').innerHTML();
    expect(/fa-(minus|plus)/.test(approvalMarkup),
      'the approval screen must still draw its own diff, or the check below is vacuous')
      .toBe(true);

    // Now an ordinary sheet, which must not have inherited it.
    await navigateToHash(page, 'character/' + character.id + '/print', '#printable-sheet');
    await expect(page.locator('#printable-sheet')).toBeVisible();
    await expect(page.locator('#printable-sheet')).toContainText('Physical');

    const printMarkup = await page.locator('#printable-sheet').innerHTML();
    expect(/fa-(minus|plus)/.test(printMarkup),
      'an ordinary sheet must draw values plainly, not with the approval screen diff')
      .toBe(false);
  });

  // -------------------------------------------------------------------------
  // #15 The experience ledger was fetched 100 rows at a time, and the balances
  //     recomputed against the truncated list
  // -------------------------------------------------------------------------
  //
  // `Character.fetch_experience_notations` ran a plain `find()` with no limit,
  // so it took the server's default page of 100. That collection is the one
  // `_propagate_experience_notation_change` walks to rebuild every row's
  // running `earned`/`spent`, and it then writes the newest row's totals onto
  // the character and saves them. Truncated, the oldest rows are absent from
  // the walk entirely: the seed falls off the end, becomes a zeroed default,
  // and the character's totals are rebuilt as though its earlier history never
  // happened.
  //
  // Measured before the fix, on the fixture this test builds:
  //
  //   rows on server                111        true total earned  140
  //   loaded by the app             100        recomputed total   100
  //
  // Forty XP gone, saved, and nothing said. Worse than #12's clan rules, which
  // only mispriced a purchase - this rewrites the ledger itself.

  test('#15 a ledger longer than one server page is loaded and totalled whole', async ({ page }) => {
    test.setTimeout(180000);
    await loginAsAdmin(page);

    // 110 extra notations worth 1 XP each, written through saveAll rather than
    // `add_experience_notation` - the latter re-propagates and saves the whole
    // ledger on every call, which is O(n^2) and would take minutes here.
    // All are newer than the 30 XP creation entry, so the creation entry is
    // what falls off the end of a 100-row page.
    const built = await runInApp(page,
      ['app/models/Vampire', 'app/models/ExperienceNotation', 'parse'], `
      var Vampire = mods[0], ExperienceNotation = mods[1], Parse = mods[2];
      return Vampire.create_test_character("r15_ledger").then(function (v) {
        var acl = v.get_me_acl();
        var rows = [];
        for (var i = 0; i < 110; i++) {
          var en = new ExperienceNotation({
            entered: new Date(arg.baseTime + (i + 1) * 60000),
            reason: "ledger fixture " + i,
            earned: 0, spent: 0,
            alteration_earned: 1, alteration_spent: 0,
            owner: v
          });
          en.setACL(acl);
          rows.push(en);
        }
        return Parse.Object.saveAll(rows).then(function () { return { id: v.id }; });
      });
    `, { baseTime: Date.now() });

    // Ground truth, read back from the server with an explicit high limit.
    const truth = await runInApp(page,
      ['app/models/Vampire', 'app/models/ExperienceNotation', 'parse'], `
      var Vampire = mods[0], ExperienceNotation = mods[1], Parse = mods[2];
      return Vampire.get_character(arg.id, "all").then(function (c) {
        var q = new Parse.Query(ExperienceNotation);
        q.equalTo("owner", c).limit(1000);
        return q.find().then(function (rows) {
          var sum = 0;
          rows.forEach(function (r) { sum += (r.get("alteration_earned") || 0); });
          return { rows: rows.length, totalEarned: sum };
        });
      });
    `, { id: built.id });

    // The fixture has to actually cross the page boundary or this proves
    // nothing at all.
    expect(truth.rows, 'the fixture must exceed one server page of 100')
      .toBeGreaterThan(100);

    const app = await runInApp(page, ['app/models/Vampire'], `
      return mods[0].get_character(arg.id, "all").then(function (c) {
        return c.get_experience_notations().then(function (ens) {
          var loaded = ens.models.length;
          // The full recompute, exactly as a notation edit triggers it.
          c._propagate_experience_notation_change(ens, loaded - 1);
          return { loaded: loaded, earned: c.get("experience_earned") };
        });
      });
    `, { id: built.id });

    expect(app.loaded, 'the whole ledger must be loaded, not the first page')
      .toBe(truth.rows);
    expect(app.earned, 'the running total must be rebuilt from the whole ledger')
      .toBe(truth.totalEarned);
  });

  // -------------------------------------------------------------------------
  // #16 Character lists lost their rounded ends after the first visit
  // -------------------------------------------------------------------------
  //
  // `CharactersListView.render` wrote fresh `<li>`s into the `<ul>` and
  // re-enhanced nothing. jQuery Mobile enhances a page once, on `pagecreate`,
  // which happens after the first batch of rows is already in place - so the
  // first visit looks right. On any later render jQM does not touch the page
  // again and the new rows never receive `ui-first-child` / `ui-last-child`,
  // the classes that round the top and bottom of an inset list.
  //
  // Measured before the fix, with `#characters?all` and
  // `#administration/characters/all` both rendering into `#characters-all`:
  //
  //   first visit    li.ui-li-has-thumb.ui-first-child … .ui-last-child
  //   after the second render   li.ui-li-has-thumb   (bare, both ends)

  test('#16 character rows keep their rounded ends across repeat visits', async ({ page }) => {
    await loginAsAdmin(page);

    await runInApp(page, ['app/models/Vampire'], `
      return mods[0].create_test_character("r16_a").then(function () {
        return mods[0].create_test_character("r16_b");
      });
    `);

    const readRows = () => page.evaluate(() => {
      const lis = Array.from(
        document.querySelectorAll('#characters-all ul[data-role="listview"] > li'));
      return {
        count: lis.length,
        firstHasClass: lis.length ? lis[0].classList.contains('ui-first-child') : null,
        lastHasClass: lis.length
          ? lis[lis.length - 1].classList.contains('ui-last-child') : null
      };
    });

    // First visit: this always worked - jQM enhances the page around the rows.
    await navigateToHash(page, 'characters?all', '#characters-all');
    await expect(page.locator('#characters-all ul[data-role="listview"] > li').first())
      .toBeVisible({ timeout: 30000 });
    const first = await readRows();
    expect(first.count).toBeGreaterThan(0);
    expect(first.firstHasClass, 'the first visit was never the broken one').toBe(true);
    expect(first.lastHasClass).toBe(true);

    // The admin roster renders into the SAME page element - a second render
    // into an already-enhanced page, which is where it used to go wrong.
    await navigateToHash(page, 'administration/characters/all', '#characters-all');
    await expect(page.locator('#characters-all ul[data-role="listview"] > li').first())
      .toBeVisible({ timeout: 30000 });
    const second = await readRows();
    expect(second.count).toBeGreaterThan(0);
    expect(second.firstHasClass, 'rows lost ui-first-child on a repeat render').toBe(true);
    expect(second.lastHasClass, 'rows lost ui-last-child on a repeat render').toBe(true);

    // And back again, which is the path a player actually takes.
    await navigateToHash(page, 'characters?all', '#characters-all');
    await expect(page.locator('#characters-all ul[data-role="listview"] > li').first())
      .toBeVisible({ timeout: 30000 });
    const third = await readRows();
    expect(third.count).toBeGreaterThan(0);
    expect(third.firstHasClass).toBe(true);
    expect(third.lastHasClass).toBe(true);
  });

  // -------------------------------------------------------------------------
  // #17 The character sheet's scroll-restore has never worked
  // -------------------------------------------------------------------------
  //
  // `CharacterView.scroll_back_after_page_change` reads `backToTop` off the
  // VIEW, and `show_character_helper` calls it on `self.characterMainPage`.
  // But the routes that leave the sheet recorded the offset on
  // `self.character` - and the router has no `character` property. It resolves
  // to the ROUTE HANDLER `character: function (id)`, so the offset was stored
  // on a function and never read again.
  //
  // Measured before the fix, leaving the sheet from an offset of 400:
  //
  //   typeof router.character                "function"
  //   router.character === the route handler  true
  //   router.character.backToTop             400      <- landed here
  //   router.characterMainPage.backToTop     0        <- what is read back
  //   scroll position on return              0
  //
  // The document describes the target as "the character model"; it is not,
  // and the distinction is why nothing ever threw. It also reports
  // `_.parseInt(undefined)` giving NaN - true only on the very first pass,
  // because the helper sets `self.backToTop = 0` after each use. Either way
  // the sheet always went back to the top.

  /*
   * These three used to assert WHERE the offset was stored --
   * `router.characterMainPage.backToTop` versus the `character` route handler.
   * That was the right shape for finding the bug, and the wrong shape to keep:
   * both objects exist only because the legacy client is Backbone, so the tests
   * could never run against a client built any other way, and a port could not
   * be held to them however correct it was.
   *
   * What a reader actually cares about is that the page comes back where they
   * left it. That is observable, and it is the same sentence on either client.
   *
   * The scroll sites are the sheet and the wizard, which every client has
   * (`views/CharacterView.js`, `views/CharacterCreateView.js` and
   * `CharacterCreateViewNew.js`; `screens/CharacterSheet.tsx` and
   * `screens/CharacterCreate.tsx`, both through `shell/scrollMemory.ts`;
   * `CharacterPage.vue` and `CharacterCreatePage.vue`). The Vue client restores
   * a third place, the trait category listing, which neither of the others
   * does -- so that one is not asserted here, where it would fail the baseline
   * rather than the port.
   */

  test('#17 the sheet returns to where the reader left it', async ({ page }) => {
    // The restore used to fire on `pagechange`, which jQuery Mobile emits
    // before the sheet has finished growing. Measured then: `silentScroll(400)`
    // against an 81px page went nowhere, and nothing ran again once the sheet
    // had its height, so it landed on 0. Occasionally the render won the race,
    // which made it inconsistent rather than merely absent.
    await loginAsAdmin(page);

    const character = await runInApp(page, ['app/models/Vampire'], `
      return mods[0].create_test_character("r17_restore").then(function (v) {
        return { id: v.id };
      });
    `);

    const OFFSET = await scrollSheetAndLeave(page, character.id);

    await gotoHashUnchecked(page, '#character?' + character.id);
    await waitForActivePage(page, 'character');

    await page.waitForFunction(
      ([y, tol]) => Math.abs(window.scrollY - y) <= tol, [OFFSET, RESTORE_TOLERANCE],
      { timeout: 30000 });
  });

  /*
   * Two further properties were written here and then removed, because they
   * hold on the ported clients and not on the legacy one, and this file is run
   * against all three:
   *
   *   - A different character's sheet opening at the top. The ported routers
   *     scroll to 0 on every navigation (`App.tsx`, on the fragment; the Vue
   *     router likewise); the legacy client does not, so opening a second sheet
   *     while the first is scrolled leaves the window where it was. Measured:
   *     `window.scrollY` was still at the first sheet's offset.
   *   - The WIZARD restoring its own offset. `charactercreatepicksimpletext`
   *     records it (`mobileRouter.js:721`), but the legacy restore is still
   *     subject to the fire-before-the-page-grows race that was fixed for the
   *     sheet alone. Measured: the return trip never reached the recorded
   *     offset in 30s. The ports restore it (`scrollMemory.ts`), which is the
   *     defect being reported here rather than a difference to reproduce.
   *
   * Both look like legacy defects rather than port ones. Neither is asserted
   * here, where it would fail the BASELINE and so be forgiven on every run
   * afterwards. They belong in their own entries if they are worth fixing.
   */

  test('#17 the wizard unpick route works from cold', async ({ page }) => {
    /*
     * `charactercreate/simpletext/.../unpick` was the only one of the wizard's
     * four exits that recorded its offset the way the SHEET's two did, and the
     * only one that never ensured the wizard view existed -- so pointing it at
     * the wizard threw for anyone arriving before the wizard had been opened.
     *
     * The hard reload is what makes "before" real, and is not decoration: it is
     * the difference between exercising the bug and walking past it.
     */
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await loginAsAdmin(page);
    const character = await runInApp(page, ['app/models/Vampire'], `
      return mods[0].create_test_character("r17_wizard").then(function (v) {
        return { id: v.id };
      });
    `);

    // Cold: nothing has built the wizard yet, on either client.
    await hardReload(page);
    pageErrors.length = 0;

    await gotoHashUnchecked(page,
      '#charactercreate/simpletext/archetype/archetype/' + character.id + '/unpick');
    await waitForActivePage(page, 'character-create');

    expect(pageErrors, 'the unpick route must not throw when the wizard is cold').toEqual([]);
    await expect(page.locator(ERROR_REGION)).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // #20 Opening a second character's sheet kept the first one's scroll
  // -------------------------------------------------------------------------
  //
  // Scroll a sheet, leave through a text picker, return (it restores, as #17
  // intends), then open a DIFFERENT character. The window stayed where it was,
  // so the reader landed in the middle of a character they had never scrolled.
  //
  // The report left this undiagnosed and guessed that no `pagechange` fires
  // because both sheets are the same jQuery Mobile page. Half right: it IS the
  // same page, `#character`, so neither the browser nor jQuery Mobile resets
  // the scroll - but `pagechange` does fire. Measured:
  //
  //   scrollY after opening character B    400   (A's offset)
  //   pagechange events since navigating   ["character"]
  //   characterMainPage.backToTop          0     (consumed, not stale)
  //
  // So the restore handler ran, found nothing to restore, and returned having
  // done nothing. It now scrolls to the top in that case. The wizard had the
  // identical defect for the same reason - measured, not assumed - and got the
  // same treatment in its own copy.

  test('#20 opening a second character opens at the top', async ({ page }) => {
    await loginAsAdmin(page);

    const chars = await runInApp(page, ['app/models/Vampire'], `
      var V = mods[0];
      return V.create_test_character("r20_a").then(function (a) {
        return V.create_test_character("r20_b").then(function (b) {
          return {
            a: a.id, b: b.id,
            aName: a.get("name"), bName: b.get("name")
          };
        });
      });
    `);

    // The full #17 path first, so the sheet really is scrolled and really did
    // restore - otherwise "opens at the top" would be trivially true.
    const OFFSET = await scrollSheetAndLeave(page, chars.a);
    await gotoHashUnchecked(page, '#character?' + chars.a);
    await waitForActivePage(page, 'character');
    await page.waitForFunction(
      ([y, tol]) => Math.abs(window.scrollY - y) <= tol, [OFFSET, RESTORE_TOLERANCE],
      { timeout: 30000 });

    // Now a different character, which used to inherit that offset.
    await gotoHashUnchecked(page, '#character?' + chars.b);
    await waitForActivePage(page, 'character');
    await page.waitForFunction(() => window.scrollY <= 5, null, { timeout: 30000 });

    // Which character the sheet is showing, from the header rather than from
    // the router's memoised view: "opened at the top" would be trivially true
    // of a sheet that never navigated, and every client puts the name here.
    await expect(page.locator('#character #insertheader'),
      'the sheet should be showing the second character')
      .toContainText(chars.bName, { timeout: 30000 });
  });

  test('#20 opening a second character\'s wizard opens at the top', async ({ page }) => {
    // Same defect, same cause, measured separately rather than assumed from
    // the sheet: every wizard is the same page, `#character-create`.
    await loginAsAdmin(page);

    const chars = await runInApp(page, ['app/models/Vampire'], `
      var V = mods[0];
      return V.create_test_character("r20w_a").then(function (a) {
        return V.create_test_character("r20w_b").then(function (b) {
          return { a: a.id, b: b.id };
        });
      });
    `);

    await navigateToHash(page, 'charactercreate/' + chars.a, '#character-create');
    await page.waitForFunction(
      () => document.documentElement.scrollHeight - window.innerHeight > 200,
      null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    const OFFSET = await page.evaluate(() => {
      const room = document.documentElement.scrollHeight - window.innerHeight;
      const target = Math.min(400, Math.floor(room / 2));
      window.scrollTo(0, target);
      return target;
    });
    expect(OFFSET).toBeGreaterThan(50);
    await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, OFFSET,
      { timeout: 15000 });

    await gotoHashUnchecked(page, '#charactercreate/' + chars.b);
    await waitForActivePage(page, 'character-create');
    await page.waitForFunction(() => window.scrollY <= 5, null, { timeout: 30000 });
  });

  // -------------------------------------------------------------------------
  // #18 Seven more lists lost their rounded ends, the same way #16's roster did
  // -------------------------------------------------------------------------
  //
  // #16 fixed `CharactersListView`. Seven other lists write `<li>`s into a
  // `data-role="listview"` that jQuery Mobile has already enhanced, and never
  // re-enhance, so the rows never receive `ui-first-child` / `ui-last-child` -
  // the classes that round the top and bottom of an inset list.
  //
  // Five of them are patronage lists, and all five are the SAME view
  // (`PatronagesView`, a Marionette.CollectionView) bound straight to an
  // enhanced `<ul>`. Fixed once there rather than at five call sites.
  //
  // The other two are the filterable rosters. The report says they "call
  // `enhanceWithin()`" and that `enhanceWithin` skips an already-enhanced
  // element. The second half is right and the first is not: every enhancement
  // call in both files is commented out. Same effect, same fix - only
  // `listview("refresh")` re-walks the rows.

  test('#18 patronage lists keep their rounded ends', async ({ page }) => {
    await loginAsAdmin(page);

    // The lists need rows, and a fresh per-worker database has none.
    const created = await runInApp(page, ['parse'], `
      var Parse = mods[0];
      var Patronage = Parse.Object.extend("Patronage");
      var rows = [];
      for (var i = 0; i < 3; i++) {
        var p = new Patronage({
          owner: Parse.User.current(),
          amount: 10 + i,
          expiresOn: new Date(arg.base + (i + 1) * 86400000),
          paidOn: new Date(arg.base - (i + 1) * 86400000)
        });
        var acl = new Parse.ACL();
        acl.setPublicReadAccess(true);
        acl.setWriteAccess(Parse.User.current(), true);
        p.setACL(acl);
        rows.push(p);
      }
      return Parse.Object.saveAll(rows).then(function () { return rows.length; });
    `, { base: Date.now() });
    expect(created).toBe(3);

    const checkList = async (selector, label) => {
      await page.waitForFunction((sel) => {
        const ul = document.querySelector(sel);
        return !!ul && ul.querySelectorAll('li').length > 0;
      }, selector, { timeout: 30000 });
      const state = await page.evaluate((sel) => {
        const ul = document.querySelector(sel);
        const lis = Array.from(ul.children).filter((n) => n.tagName === 'LI');
        return {
          rows: lis.length,
          first: lis[0].classList.contains('ui-first-child'),
          last: lis[lis.length - 1].classList.contains('ui-last-child')
        };
      }, selector);
      expect(state.rows, `${label}: needs rows to mean anything`).toBeGreaterThan(0);
      expect(state.first, `${label}: first row lost ui-first-child`).toBe(true);
      expect(state.last, `${label}: last row lost ui-last-child`).toBe(true);
    };

    // `#usp-patronage-list` lives in a template and is created per render, so
    // whether it looked right was a race between the patronage fetch and the
    // page enhancement - which is why #profile compared clean only sometimes.
    await navigateToHash(page, 'profile', '#user-settings-profile');
    await checkList('#usp-patronage-list', 'profile patronage list');

    // This one is declared in index.html, so it is enhanced once at
    // `pagecreate` and every row arriving afterwards was bare.
    await navigateToHash(page, 'administration/patronages', '#administration-patronages-view');
    await clearStuckLoader(page);
    await checkList('#administration-patronages-view-list', 'admin patronages list');
  });

  test('#18 the filterable roster keeps its rounded ends across a filter change', async ({ page }) => {
    await loginAsAdmin(page);

    // The summarize roster reached through #administration needs no troupe
    // fixture, unlike the troupe one, and drives the same view.
    //
    // The characters need an `attributes` trait. The roster's default filter
    // is `category: "attributes"` with `resulttype: "onlycat"`, which shows
    // only characters that have something in that category - and
    // `create_test_character` seeds Humanity, health levels and Willpower but
    // no attributes. Without this the roster renders zero rows and the test
    // waits for rows that are never coming.
    await runInApp(page, ['app/models/Vampire'], `
      var Vampire = mods[0];
      return Vampire.create_test_character("r18_a").then(function (a) {
        return a.update_trait("Physical", 1, "attributes", 0, true);
      }).then(function () {
        return Vampire.create_test_character("r18_b");
      }).then(function (b) {
        return b.update_trait("Physical", 2, "attributes", 0, true);
      });
    `);

    const readRows = () => page.evaluate(() => {
      const ul = document.querySelector('#troupe-summarize-characters-list ul');
      if (!ul) return { missing: true };
      const lis = Array.from(ul.children).filter((n) => n.tagName === 'LI');
      return {
        rows: lis.length,
        first: lis.length ? lis[0].classList.contains('ui-first-child') : null,
        last: lis.length ? lis[lis.length - 1].classList.contains('ui-last-child') : null
      };
    });

    await navigateToHash(page, 'administration/characters/summarize',
      '#troupe-summarize-characters-all');
    await clearStuckLoader(page);
    await page.waitForFunction(() => {
      const ul = document.querySelector('#troupe-summarize-characters-list ul');
      return !!ul && ul.querySelectorAll('li').length > 0;
    }, null, { timeout: 30000 });

    const first = await readRows();
    expect(first.rows).toBeGreaterThan(0);
    expect(first.first, 'first render lost ui-first-child').toBe(true);
    expect(first.last, 'first render lost ui-last-child').toBe(true);

    // Changing a filter runs `filterwith`, which calls `collection.reset(...)`
    // and replaces every row. That is where these two used to lose the classes
    // - they looked right until the reader touched a filter.
    //
    // The antecedence filter rather than the category one on purpose: category
    // is what decides which characters qualify at all (`resulttype: onlycat`),
    // so changing it would empty the list and leave nothing to check. Widening
    // antecedence from "PC" to "All" keeps the same rows and still forces the
    // reset.
    await expect(page.locator('#sections select[name="antecedence"]')).toBeAttached();
    await selectBackformOption(page, '#sections select[name="antecedence"]', 'All');
    await page.waitForTimeout(2000);

    const after = await readRows();
    expect(after.rows, 'the filter should leave rows to check').toBeGreaterThan(0);
    expect(after.first, 'after a filter change the first row lost ui-first-child').toBe(true);
    expect(after.last, 'after a filter change the last row lost ui-last-child').toBe(true);
  });

  // -------------------------------------------------------------------------
  // #21 The wizard's scroll-restore fired before the wizard had grown
  // -------------------------------------------------------------------------
  //
  // The half of #17 that was fixed for the sheet and not the wizard. Worse: the
  // comment left in `CharacterView.js` when the sheet was fixed asserted that
  // "the wizard has its own copy ... where the immediate scroll works". That
  // was repeated from the report and never measured, and it is wrong - the
  // wizard raced the render in exactly the same way. The comment is corrected
  // and the wizard now carries the same bounded wait, as its own copy.
  //
  // The wizard also never cleared `backToTop`, so an offset survived its own
  // use and could be re-applied on a later visit the reader never scrolled.
  // Measured after the fix: 4 of 4 return trips landed on the recorded offset,
  // and the offset read back 0 each time.

  test('#21 the wizard returns to where the reader left it, and consumes the offset', async ({ page }) => {
    await loginAsAdmin(page);

    const character = await runInApp(page, ['app/models/Vampire'], `
      return mods[0].create_test_character("r21_wizard").then(function (v) {
        return { id: v.id };
      });
    `);

    await navigateToHash(page, 'charactercreate/' + character.id, '#character-create');
    await page.waitForFunction(
      () => document.documentElement.scrollHeight - window.innerHeight > 200,
      { timeout: 30000 });
    // Let the wizard's own restore fire and consume its offset before we
    // scroll, or it drags the page back under us.
    await page.waitForTimeout(1500);

    const OFFSET = await page.evaluate(() => {
      const room = document.documentElement.scrollHeight - window.innerHeight;
      const target = Math.min(400, Math.floor(room / 2));
      window.scrollTo(0, target);
      return target;
    });
    expect(OFFSET, 'the wizard must be scrollable for this to mean anything')
      .toBeGreaterThan(50);
    await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, OFFSET,
      { timeout: 15000 });

    await gotoHashUnchecked(page,
      '#charactercreate/simpletext/archetype/archetype/' + character.id + '/pick');
    await waitForActivePage(page, 'simpletext-new');

    // That the offset was recorded is not asserted directly -- where a client
    // keeps it is its own business, and the legacy answer
    // (`router.characterCreateView.backToTop`) is a property only one of the
    // three has. The return trip below is the same claim, observably: it can
    // only land back at OFFSET if something recorded it.
    await gotoHashUnchecked(page, '#charactercreate/' + character.id);
    await waitForActivePage(page, 'character-create');
    await page.waitForFunction(
      ([y, tol]) => Math.abs(window.scrollY - y) <= tol, [OFFSET, RESTORE_TOLERANCE],
      { timeout: 30000 });

    // Main also asserted the offset is CONSUMED -- `backToTop` reading back as
    // 0 -- and that half is deliberately not reproduced here, because it has no
    // client-independent meaning.
    //
    // Measured: both ports record the scroll position on every departure
    // (`shell/scrollMemory.ts` records in its unmount cleanup), so leaving this
    // wizard a second time records the offset it was just restored to and
    // coming back restores it again. That is "remember where I was" applied
    // consistently, not a failure to consume; the legacy client forgets after
    // one use instead. Asserting either shape would be asserting a mechanism.
    //
    // Nothing is lost by leaving it out. What the consumption was FOR -- a
    // visit the reader never scrolled opening at the top -- is what the sibling
    // test "#20 opening a second character's wizard opens at the top" checks,
    // observably, on all three clients.
  });

  // -------------------------------------------------------------------------
  // R3 A rule editor showed the Descriptions screen's category list
  // -------------------------------------------------------------------------
  //
  // Not in the document; found while re-verifying R2, and the reason R2's own
  // test was unreliable.
  //
  // `EditRules` and `DescriptionsView` are separate memoised instances that
  // share BOTH an `el` and the region selector `#descriptions-sections`. Their
  // `el` matches nothing - it says `div[data-role='main']`, the markup says
  // `<div role="main">` - so Marionette resolves the region globally and both
  // views' regions point at the same DOM node. `setup()` runs once per view,
  // so whichever showed its child views last owns the node and the other never
  // gets it back.
  //
  // Measured before the fix, visiting clan rules -> Descriptions -> kith rules:
  //
  //   DOM select                 68 options, "academics_specializations" ...
  //   editRules.formInDocument   false
  //   editRules' own form        2 options, correct, and detached
  //
  // So one visit to Descriptions left every rule editor showing Descriptions'
  // categories for the rest of the session, and filtering by one of them
  // queried the rule class for a category it does not have.

  test('R3 a rule editor shows its own categories after the Descriptions screen', async ({ page }) => {
    await loginAsAdmin(page);

    // Each of these four calls fails inside the helper if the screen never
    // shows its own class's categories, which is the defect itself. The
    // assertions here are the shape of what it showed, so a failure says
    // which screen and what it held instead.
    await visitAdminCategoryScreen(page, 'administration/bnsmetv1_clan_rules');

    const descriptions = await visitAdminCategoryScreen(
      page, 'administration/descriptions');
    // Descriptions has a category per Description row; the rule classes have
    // at most a couple. This is what the rule editor used to show afterwards.
    expect(descriptions.options.length).toBeGreaterThan(10);
    expect(descriptions.options).toContain('academics_specializations');

    // The regression: back to a rule editor, which used to render into a
    // detached form while the screen kept showing the list above.
    const rulesAgain = await visitAdminCategoryScreen(
      page, 'administration/bnsctdbs_kith_rules');
    expect(rulesAgain.options,
      'the rule editor is showing the Descriptions category list')
      .not.toContain('academics_specializations');
    expect(rulesAgain.options.length,
      'the rule editor should show its own short category list')
      .toBeLessThan(descriptions.options.length);

    // And symmetrically - fixing only the rule editors would have moved the
    // defect rather than removed it.
    const descriptionsAgain = await visitAdminCategoryScreen(
      page, 'administration/descriptions');
    expect(descriptionsAgain.options).toContain('academics_specializations');
  });

  // -------------------------------------------------------------------------
  // #19 The rule editor offered a category literally labelled "undefined"
  // -------------------------------------------------------------------------
  //
  // Both copies of `update_categories` built the dropdown by walking every row
  // and using its category as an object key. An object key is a string, so a
  // row with no `category` column wrote the key `"undefined"` and the dropdown
  // offered an option reading exactly that. `bnsmetv1_ClanRule` is the case in
  // the seed: its 42 rows carry `clan` and no `category`.
  //
  // Selecting it built `equalTo("category", undefined)`, which parse-server
  // reads as "category does not exist" - every row of the class. So it was a
  // worse-named duplicate of "All", with nothing on screen to say so.
  //
  // I saw this in my own probe output while fixing R2 (`["undefined", "All"]`)
  // and did not chase it; it came back from the Vue port as #19.

  test('#19 no rule editor offers a category called "undefined"', async ({ page }) => {
    await loginAsAdmin(page);

    const screens = [
      ['administration/bnsmetv1_clan_rules', 'clan rules'],
      ['administration/bnsctdbs_kith_rules', 'kith rules'],
      ['administration/bnsmetv1_ritual_rules', 'ritual rules'],
      ['administration/descriptions', 'descriptions']
    ];

    for (const [route, label] of screens) {
      // Through the helper, so this cannot read the previous screen's select
      // and report on the wrong class -- see R2, which was written that way.
      const { options } = await visitAdminCategoryScreen(page, route);

      // "All" is pushed unconditionally, so its presence proves the dropdown
      // was rebuilt rather than left holding its placeholder.
      expect(options, `${label}: the category list should have been rebuilt`)
        .toContain('All');
      expect(options, `${label}: offered a category literally called "undefined"`)
        .not.toContain('undefined');
      // And nothing empty crept in as a blank-looking option either.
      expect(options.filter((o) => !o || !o.trim()),
        `${label}: offered a blank category`).toEqual([]);
    }
  });

  // -------------------------------------------------------------------------
  // R2 The admin category select was styled or not depending on visit order
  // -------------------------------------------------------------------------
  //
  // Not in the document. Reported from the React port as "EditRules never
  // calls enhanceWithin(), so the rule editor's category select is unstyled
  // while the identical control on the Descriptions screen is styled". That is
  // not what happens, and the difference matters - see docs/legacy-bugs-fixed.md.
  //
  // `EditRules` does call `enhanceWithin()`, twice. Those calls have never done
  // anything: both views declare `el: "#administration-descriptions >
  // div[data-role='main']"` and the markup is `<div role="main">`, so `$el` is
  // an empty set. What actually breaks the styling is `update_categories()`
  // ending with `form.render()`, which replaces the `<select>` and re-enhances
  // nothing - and jQuery Mobile enhances a page exactly once, on `pagecreate`.
  //
  // Measured before the fix, and the point is that it is not per-screen:
  //
  //   rule editor first             enhanced
  //   Descriptions after it         NOT enhanced
  //   Descriptions first (reload)   NOT enhanced
  //   rule editor after it          NOT enhanced
  //
  // So `DescriptionsView` - the screen the report treats as correct - carries
  // the identical omission and is fixed the same way. This test walks both
  // orders, because a test that only visited one screen would have passed
  // against the bug half the time.

  test('R2 the admin category select is styled whatever the visit order', async ({ page }) => {
    await loginAsAdmin(page);

    // The helper already refuses to return until the screen shows its own
    // class's categories -- which is R3, and is what stops this test from
    // reading the previous screen's leftover select and passing against its own
    // bug. All that is left to assert here is the styling.
    const check = async (route, label) => {
      const state = await visitAdminCategoryScreen(page, route);
      expect(state.enhanced,
        `${label}: the category select is not jQM-enhanced`).toBe(true);
      return state;
    };

    // Order A: a rule editor first, then Descriptions. The second visit is
    // the one that used to come back raw.
    await check('administration/bnsmetv1_clan_rules', 'rule editor first');
    const descriptionsSecond = await check(
      'administration/descriptions', 'Descriptions second');
    // Descriptions has a category per Description row; the rule classes have
    // at most a couple. Distinct shapes prove both screens really rendered.
    expect(descriptionsSecond.options.length).toBeGreaterThan(10);

    // Order B: fresh app, Descriptions first, then two different rule editors.
    await hardReload(page);
    await check('administration/descriptions', 'Descriptions first');
    await check('administration/bnsctdbs_kith_rules', 'kith rules second');
    await check('administration/bnsmetv1_ritual_rules', 'ritual rules third');
  });

  // -------------------------------------------------------------------------
  // #1 The start page's troupe shortcuts have been empty since Parse 8
  // -------------------------------------------------------------------------
  //
  // `PlayerOptionsView.update_troupes` derived the troupe id from
  // `role.attributes.attributes.name`. Under Parse 1.5 a Parse.Object added to
  // a Backbone collection was wrapped and that doubled path resolved; under
  // parse@8 the compat layer stores the object as itself, so `.attributes` on
  // the attribute bag is `undefined` and reading `.name` threw. The throw
  // happened inside a promise callback and was swallowed, `reset` never ran,
  // and "Troupe View All Characters" rendered its heading above an empty list
  // for every storyteller and every admin.
  //
  // `sampast` holds `AST_WOad4CBTsG` and is a storyteller, which is the exact
  // shape the feature exists for.

  test('#1 a storyteller sees their troupe under Troupe View All Characters', async ({ page }) => {
    await loginAsAST(page);
    await navigateToHash(page, '', '#player-options');

    const quickAccess = page.locator('#troupe-characters-quick-access');
    await expect(quickAccess).toContainText('Troupe View All Characters');

    // The heading alone always rendered. The rows are what was missing.
    const rows = quickAccess.locator('a.troupe-listing');
    await expect(rows.first()).toBeVisible({ timeout: 30000 });
    await expect(rows.first()).toHaveAttribute('href', /#troupe\/[A-Za-z0-9]+\/characters\/all/);
    await expect(quickAccess).toContainText('Sample Troupe');
  });

  test('#1 a plain player sees no troupe shortcuts and no error', async ({ page }) => {
    // `setup` returns early for a user who is neither admin nor storyteller,
    // so the region stays empty. That is the correct empty, not the bug's.
    await loginAsMember(page);
    await navigateToHash(page, '', '#player-options');

    const quickAccess = page.locator('#troupe-characters-quick-access');
    await expect(quickAccess.locator('a.troupe-listing')).toHaveCount(0);
    await expect(page.locator(ERROR_REGION)).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // #3 A dead "Link Account to Facebook" button still painted on the profile
  // -------------------------------------------------------------------------
  //
  // Its handler called `Parse.FacebookUtils.link`, and `app/loadall.js`
  // deliberately no longer calls `Parse.FacebookUtils.init()` - under parse@8
  // that throws during bootstrap and takes the router down with it, so every
  // route 404s. The control rendered and could not work.

  test('#3 the profile page offers no Facebook linking control', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToHash(page, 'profile', '#user-settings-profile');

    const profile = page.locator('#user-settings-profile');
    await expect(profile).toBeVisible();
    // The sections that should still be there, so an empty page cannot pass.
    await expect(profile).toContainText('Profile');
    await expect(profile).toContainText('Patronage');

    await expect(profile.locator('#facebook-link')).toHaveCount(0);
    await expect(profile.locator('#facebook-unlink')).toHaveCount(0);
    await expect(profile.locator('#facebook-account-linking')).toHaveCount(0);
    expect(normalize(await profile.innerText())).not.toMatch(/Facebook/i);
  });

  // -------------------------------------------------------------------------
  // #R1 The profile page's Roles section was silently empty
  // -------------------------------------------------------------------------
  //
  // Not one of the thirteen in the document - found while writing these tests,
  // and it is the same defect class as #1. `RoleView`'s template read
  // `<%= attributes.name %>`, but Marionette hands a template `model.toJSON()`
  // and a parse@8 Parse.Role's `toJSON()` is the flat attribute bag with no
  // `attributes` key. lodash compiles the body inside `with (obj)`, so the
  // render died with `ReferenceError: attributes is not defined`.
  //
  // Measured as devuser, who holds Administrator: `#user-roles-available`
  // rendered `<div></div>` and the role name was simply absent. Nothing
  // surfaced - the throw happened inside the `q.each` callback, the Parse
  // chain rejected, and `PromiseFailReport` logged `Error in promise {}`,
  // because a ReferenceError has no enumerable own properties for
  // JSON.stringify to show.
  //
  // Also measured, so the template is known to be the cause and not a
  // scapegoat: a Marionette CollectionView DOES render a child added after
  // construction, which is how these roles arrive. With `<%= name %>` the same
  // late add produced `<div>The one: Administrator</div>`.

  test('#R1 the profile page lists the roles the user actually holds', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToHash(page, 'profile', '#user-settings-profile');

    const roles = page.locator('#user-roles-available');
    await expect(roles).toBeAttached();
    // devuser is in the Administrator role (seed_db.js's cold-start block).
    await expect(roles).toContainText('Administrator', { timeout: 30000 });
    expect(await roles.locator('> div > div').count()).toBeGreaterThan(0);
  });

  test('#R1 a storyteller sees their troupe role too', async ({ page }) => {
    // sampast holds AST_WOad4CBTsG and nothing else, so this also proves the
    // section shows the CURRENT user's roles rather than a fixed string.
    await loginAsAST(page);
    await navigateToHash(page, 'profile', '#user-settings-profile');

    const roles = page.locator('#user-roles-available');
    await expect(roles).toContainText('AST_', { timeout: 30000 });
    await expect(roles).not.toContainText('Administrator');
  });

  // -------------------------------------------------------------------------
  // #4 The character sheet's identity block showed the wrong character's id
  // -------------------------------------------------------------------------
  //
  // `CharacterView.render` memoised its sub-view, and `new CharacterListItem
  // (this.model)` passes the MODEL where Backbone.View expects an options bag -
  // so the wrapper element took its `id` and `class` from whichever character
  // was opened FIRST and kept them. Open a vampire, then a werewolf, and the
  // werewolf's details sat inside `<div id="<the vampire's objectId>"
  // class="Vampire">`.

  test('#4 the sheet header carries the id and class of the character being shown', async ({ page }) => {
    await loginAsAdmin(page);

    const vampire = await runInApp(page, ['app/models/Vampire'], `
      return mods[0].create_test_character("r4_vampire").then(function (v) {
        return { id: v.id, name: v.get("name") };
      });
    `);
    const werewolf = await runInApp(page, ['app/models/Werewolf'], `
      return mods[0].create_test_character("r4_werewolf").then(function (w) {
        return { id: w.id, name: w.get("name") };
      });
    `);

    // The vampire FIRST, so the memoised wrapper would be stamped with its id.
    await navigateToHash(page, 'character?' + vampire.id, '#character');
    await expect(page.locator('#character #insertheader')).toContainText(vampire.name);

    const afterVampire = await page.evaluate(() => {
      const el = document.querySelector('#character #insertheader').firstElementChild;
      return el ? { id: el.id, className: el.className } : null;
    });
    expect(afterVampire.id).toBe(vampire.id);

    // Then the werewolf, which is where it used to go wrong.
    await navigateToHash(page, 'character?' + werewolf.id, '#character');
    await expect(page.locator('#character #insertheader')).toContainText(werewolf.name);

    const afterWerewolf = await page.evaluate(() => {
      const header = document.querySelector('#character #insertheader');
      return {
        children: header.children.length,
        id: header.firstElementChild ? header.firstElementChild.id : null,
        className: header.firstElementChild ? header.firstElementChild.className : null
      };
    });

    expect(afterWerewolf.id).toBe(werewolf.id);
    expect(afterWerewolf.id).not.toBe(vampire.id);
    // Only the id can tell them apart. All three venues deliberately register
    // the Parse className "Vampire" (they share one table - see VenueClass.js),
    // so the wrapper's class reads "Vampire" for a werewolf too and always did.
    // Measured: it is "Vampire" on both sheets, before and after this fix.
    expect(afterWerewolf.className).toContain('Vampire');
    // Building a fresh sub-view each render must not stack headers up.
    expect(afterWerewolf.children).toBe(1);
  });

  // -------------------------------------------------------------------------
  // #5 Refusing a non-admin from an admin route created a redirect loop
  // -------------------------------------------------------------------------
  //
  // `admin_route_failed` did `window.location.hash = ""`, which PUSHES. A
  // non-admin who opened `#administration` was bounced to the start page with
  // `#administration` still behind them; pressing Back returned them there and
  // bounced them again, forever.

  test('#5 a refused non-admin can press Back and get past the admin route', async ({ page }) => {
    await loginAsMember(page);

    // A known page to go back TO, so "did Back work" has a definite answer.
    await navigateToHash(page, 'profile', '#user-settings-profile');
    expect(await page.evaluate(() => window.location.hash)).toBe('#profile');

    await gotoHashUnchecked(page, '#administration');

    // The refusal itself: a banner, and not the administration page.
    await expect(page.locator(ERROR_REGION)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(ERROR_REGION)).toContainText(/Administrator access is required/i);
    await page.waitForFunction(() => window.location.hash !== '#administration', { timeout: 30000 });
    expect(await activePageId(page)).not.toBe('administration');

    await page.goBack();
    await waitForJqmLoader(page);

    // The whole bug: this used to be '#administration' again.
    await page.waitForFunction(() => window.location.hash === '#profile', { timeout: 30000 });
    await waitForActivePage(page, 'user-settings-profile');
  });

  // -------------------------------------------------------------------------
  // #6 Admin status was read from a cache refreshed at most every five minutes
  // -------------------------------------------------------------------------
  //
  // `enforce_admin` read `Parse.User.current().get("admininterface")`, which is
  // only reconciled against the Administrator / SiteAdministrator roles inside
  // `enforce_logged_in`, and only when `lastadminchecktime` is over 300000ms
  // old. Someone just promoted was refused for up to five minutes.
  //
  // Poisoning the cached flag while leaving the throttle "fresh" reproduces
  // exactly that state without having to mutate a role: the client believes the
  // user is not an admin, the server says they are, and the throttle would
  // suppress the recount that settles it.
  //
  // The throttle is left fresh by NOT touching it. Logging in and opening the
  // administration page has just run the check on either client, so the window
  // is already open and the recount is already suppressed -- which is precisely
  // the position a just-promoted user is in. The original set
  // `router.lastadminchecktime` by hand, which pinned the test to one client's
  // internals for a state the fixture arrives in anyway.
  //
  // `Parse.User.current()` is common to both clients and is where both keep the
  // flag (`stores/auth.ts`, `routers/mobileRouter.js`), so the poison itself
  // needs no client-specific hook.

  test('#6 a stale "not an admin" cache does not keep a real admin out', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToHash(page, 'administration', '#administration');

    const cached = await page.evaluate(() => {
      window.Parse.User.current().set('admininterface', false);
      return window.Parse.User.current().get('admininterface');
    });
    expect(cached, 'the client must actually believe the user is not an admin').toBe(false);

    await gotoHashUnchecked(page, '#profile');
    await waitForActivePage(page, 'user-settings-profile');

    await navigateToHash(page, 'administration', '#administration');
    await expect(page.locator('#administration')).toBeVisible();
    await expect(page.locator(ERROR_REGION)).toHaveCount(0);

    // And the recount wrote the true answer back over the poisoned cache,
    // rather than letting the admin in while still believing otherwise.
    expect(await page.evaluate(() => window.Parse.User.current().get('admininterface'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // #7 A troupe that failed to load said nothing
  // -------------------------------------------------------------------------
  //
  // The `troupe` handler's chain was `.then(...).then(...).always(hide)` with
  // no `.fail` anywhere. A troupe that could not be fetched dropped the spinner
  // and left the user where they were, with nothing said and the URL changed.

  test('#7 an unopenable troupe reports itself instead of stopping silently', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToHash(page, 'troupes', '#troupes-list');

    await gotoHashUnchecked(page, '#troupe/nosuchtroupe');

    await expect(page.locator(ERROR_REGION)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(ERROR_REGION)).toContainText(/Couldn't open that troupe/i);

    // And the loader still came down - `.fail` sits before `.always`, so the
    // reporter runs without costing the spinner its `hide`.
    const loading = await page.evaluate(() =>
      document.documentElement.classList.contains('ui-loading'));
    expect(loading).toBe(false);
  });

  test('#7 a troupe that CAN be opened still opens, with no banner', async ({ page }) => {
    // Without this the test above would pass against a handler that reported
    // every troupe as broken.
    await loginAsAdmin(page);
    await navigateToHash(page, 'troupes', '#troupes-list');

    const troupeId = await page.evaluate(() => {
      const link = document.querySelector('#troupes-list a.troupe-listing');
      return link ? link.getAttribute('backendid') : null;
    });
    expect(troupeId, 'the seeded Sample Troupe should be in the directory').toBeTruthy();

    await navigateToHash(page, 'troupe/' + troupeId, '#troupe');
    await expect(page.locator('#troupe')).toBeVisible();
    await expect(page.locator(ERROR_REGION)).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // #9 update_creation_rules_for_changed_trait threw on a null creation record
  // -------------------------------------------------------------------------
  //
  // The guard tested `creation &&` - acknowledging the record could be missing
  // - and then used it unguarded three lines later. Worse, with NO creation
  // pointer at all the throw came earlier still: parse@8's `fetchAllIfNeeded`
  // reads `.className` off every member of the list it is given, so
  // `[undefined]` raises a TypeError synchronously, before the guard is
  // reached at all.
  //
  // Not reachable through the UI today - every caller runs
  // `ensure_creation_rules_exist` first - so it is exercised directly, which
  // is the only honest way to prove a trap for the next caller is gone.

  const VENUES = [
    { name: 'Vampire', module: 'app/models/Vampire', category: 'merits' },
    { name: 'Werewolf', module: 'app/models/Werewolf', category: 'wta_merits' },
    { name: 'Changeling', module: 'app/models/ChangelingBetaSlice', category: 'ctdbs_merits' }
  ];

  for (const venue of VENUES) {
    test(`#9 ${venue.name} survives a changed trait with no creation record`, async ({ page }) => {
      await loginAsAdmin(page);

      const outcome = await runInApp(page, [venue.module, 'app/models/SimpleTrait'], `
        var Model = mods[0];
        var SimpleTrait = mods[1];
        var character = new Model();          // never entered the wizard
        var trait = new SimpleTrait({ name: "Nothing", value: 1, category: arg.category });
        if (character.has("creation")) {
          return "fixture is wrong: a bare model already has a creation record";
        }
        var chain;
        try {
          chain = character.update_creation_rules_for_changed_trait(arg.category, trait, 1);
        } catch (e) {
          return "threw synchronously: " + e.message;
        }
        return chain.then(function () { return "resolved"; },
                          function (e) { return "rejected: " + (e && e.message); });
      `, { category: venue.category });

      expect(outcome).toBe('resolved');
    });
  }

  // -------------------------------------------------------------------------
  // #10 The troupe staff list printed an email column that was always blank
  // -------------------------------------------------------------------------
  //
  // `get_troupe_staff` builds each staffer through `identity_of`, and
  // `cloud/main.js` sets `IDENTITY_INCLUDES_EMAIL = false` deliberately;
  // parse-server also withholds another user's address from every non-master
  // read. Every row rendered as `LST: devuser  ` with a double space.

  test('#10 the troupe staff list has no blank email gap', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToHash(page, 'troupes', '#troupes-list');
    const troupeId = await page.evaluate(() => {
      const link = document.querySelector('#troupes-list a.troupe-listing');
      return link ? link.getAttribute('backendid') : null;
    });
    expect(troupeId).toBeTruthy();

    await navigateToHash(page, 'troupe/' + troupeId, '#troupe');

    const staff = page.locator('#troupe-staff li');
    await expect(staff.first()).toBeVisible({ timeout: 30000 });

    // `textContent`, not `innerText`, and no trimming.
    //
    // The whole visible symptom is one extra space where the email would have
    // gone. `innerText` collapses whitespace runs, so reading it makes a row
    // carrying the bug indistinguishable from one that does not - measured:
    // this test passed against the unfixed template until it read textContent.
    // The seeded staff carry no realname either, so the gap is trailing, which
    // is why nothing here trims.
    const lines = await staff.evaluateAll((els) => els.map((el) => el.textContent));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `"${line}" still carries the empty email column`)
        .not.toMatch(/ {2}/);
      expect(line).toMatch(/^\w+: \S/);
    }
  });

  // -------------------------------------------------------------------------
  // #11 The administration menu was a plain bullet list, not a listview
  // -------------------------------------------------------------------------
  //
  // No `data-role="listview"`, so jQuery Mobile left it alone and the admin
  // front door rendered as bullet-point links - while `#player-options`, one
  // click away, is a proper inset listview of full-width buttons.

  test('#11 the administration menu is enhanced as an inset listview', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToHash(page, 'administration', '#administration');

    const list = page.locator('#administration div[role="main"] > ul');
    await expect(list).toHaveAttribute('data-role', 'listview');
    // jQuery Mobile only adds these once it has actually enhanced the element,
    // which is the difference a user sees.
    await expect(list).toHaveClass(/ui-listview/);
    await expect(list).toHaveClass(/ui-listview-inset/);

    // Matching what #player-options one click away already looked like.
    await expect(page.locator('#administration a[href="#administration/characters/summarize"]'))
      .toHaveText(/Summarize Characters/);
  });

  // -------------------------------------------------------------------------
  // #13 A player's own roster never shows the owner line
  // -------------------------------------------------------------------------
  //
  // Left as-is on purpose: showing a player their own name on every row of
  // their own roster is noise. What must not happen is someone "fixing" it
  // with `include("owner")` - that made parse-server DELETE the pointer for a
  // private owner, and `get_me_acl` reads a missing owner as "no owner" and
  // grants the CURRENT user read and write, so opening someone else's sheet
  // rewrote its ACL to the viewer.
  //
  // This pins the observable half so the change cannot be made by accident.
  //
  // It asserts the QUERY, not the pointer's client-side state, and that
  // distinction is load-bearing. The original read `owner.get("username")` back
  // and required it to be null, on the reasoning that only an `include` could
  // have filled it in. That inference holds only under the unique-instance
  // state controller, where each object carries its own state: the Backbone
  // client runs it through `parse-compat/index.js` and the React port through
  // `Parse.Object.disableSingleInstance()` in `web/src/parse/init.ts`, while
  // the Vue client deliberately does not (`client/src/parse/index.ts`, which
  // explains why). Under a shared controller the pointer and
  // `Parse.User.current()` are one bag of state, and the current user is fully
  // loaded by definition -- so on a PLAYER'S OWN roster, where every owner is
  // the current user, the pointer answers with the username no matter what the
  // server sent. The old assertion therefore failed on a client that was doing
  // nothing wrong.
  //
  // Reading the request removes the inference. `include=owner` is the thing
  // that was dangerous; look for it directly.

  /**
   * Every Parse query the page issues against the character table.
   *
   * All three venues share the `Vampire` class, so that one path covers the
   * lot. The SDK posts queries with the real verb in `_method`, which puts the
   * `include` list in the POST body rather than the URL -- but read both, so a
   * transport change cannot silently make this stop looking.
   */
  function captureCharacterQueries(page) {
    const seen = [];
    page.on('request', (request) => {
      if (!/\/parse\/1\/classes\/Vampire/.test(request.url())) return;
      let body = {};
      try {
        body = request.postDataJSON() || {};
      } catch {
        // Not a JSON body; the URL is still worth recording.
      }
      const fromUrl = new URL(request.url()).searchParams.get('include') || '';
      const fromBody = body.include || '';
      seen.push({
        url: request.url(),
        include: [fromUrl, Array.isArray(fromBody) ? fromBody.join(',') : fromBody]
          .filter(Boolean).join(',')
      });
    });
    return seen;
  }

  test('#13 a player\'s own roster never asks the server to include the owner', async ({ page }) => {
    await loginAsMember(page);

    await runInApp(page, ['app/models/Vampire'], `
      return mods[0].create_test_character("r13_roster").then(function (v) {
        return v.id;
      });
    `);

    const queries = captureCharacterQueries(page);

    await navigateToHash(page, 'characters?all', '#characters-all');
    await expect(page.locator('#characters-all li').first()).toBeVisible({ timeout: 30000 });

    // Without this the test passes when it sees NOTHING -- a renamed endpoint
    // or a changed transport would read as "no query included the owner".
    expect(queries.length,
      'the roster must have queried the character table for this to mean anything')
      .toBeGreaterThan(0);

    const offending = queries.filter((q) => /(^|,)\s*owner\s*(,|$)/.test(q.include));
    expect(offending.map((q) => q.include),
      'the roster query must not include("owner"): it makes parse-server DELETE the ' +
      'pointer for a private owner, and get_me_acl reads a missing owner as "no owner" ' +
      'and grants the viewer read and write')
      .toEqual([]);

    // The pointer must still be there. A missing owner renders as DELETED, and
    // is the state the include defect actually produced.
    const owners = await runInApp(page, ['app/models/Vampire', 'parse'], `
      var Vampire = mods[0], Parse = mods[1];
      var q = new Parse.Query(Vampire);
      q.equalTo("owner", Parse.User.current());
      return q.find().then(function (rows) {
        return rows.map(function (r) { return { hasOwner: r.has("owner") }; });
      });
    `);

    expect(owners.length).toBeGreaterThan(0);
    for (const row of owners) {
      expect(row.hasOwner, 'the pointer must survive - a missing owner reads as DELETED').toBe(true);
    }

    // And the rows carry no owner line, which is the visible half.
    const roster = await page.locator('#characters-all').innerText();
    expect(roster).not.toContain('sampmem');
  });
});
