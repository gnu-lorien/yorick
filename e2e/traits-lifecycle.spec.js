/**
 * Task 9 - Trait Change Lifecycle In The UI, All Three Creature Types
 *
 * Covers testing_implementation_plan.md items 241-276: twelve scenarios,
 * parameterized over Vampire (241-252), Werewolf (253-264) and Changeling
 * (265-276). Mirrors `trait-test.js` and the "traits" block of
 * `default-test.js` (which drive the identical rename/specialize/collide/
 * remove chain at the model layer, always against a `backgrounds` trait) -
 * this suite drives the same chain through the real UI.
 *
 * One completed character per venue carries all twelve scenarios in sequence,
 * the same "lifecycle, not independent facts" structure the three creation
 * suites use. Each character is built with exactly one creation-time pick (in
 * the venue's own chain category, at the smallest slot) so scenario (h) has a
 * genuine creation-picked trait to test removal against, then completed and
 * topped up with fixture XP (see "XP headroom" below) before any UI
 * interaction under test begins.
 *
 * ---
 *
 * ## Findings confirmed live against this server before any test below was written
 *
 * **1. DEFECT - the character log view shows stale rows when re-opened with
 * unchanged parameters (affects every log-reading scenario below: a, b, c, d,
 * g, k).** `CharacterLogView.register(character, start, changeBy)`
 * (views/CharacterLogView.js) only calls `update_collection_query_and_fetch()`
 * - the thing that actually re-queries `VampireChange` - when `start`,
 * `changeBy`, or the character object reference differ from what it already
 * held; it has no way to know the underlying rows changed. The natural "read
 * the log, act, read the log again" pattern almost always calls
 * `character/:cid/log/:start/:changeBy` with the *same* three values both
 * times, which is exactly the case this view treats as "nothing to do".
 * Measured live: raising a trait's value produced a correct `VampireChange`
 * row immediately (confirmed by a direct `Parse.Query` run alongside the UI
 * read), while re-opening the same `character/:cid/log/0/20` kept showing the
 * stale pre-raise rows even 1.5 seconds later and after an explicit
 * re-navigation - only a different `changeBy`, or a full reload, forced a
 * fresh fetch. **Fixed in `e2e/helpers/logs.js`** - see that file's own
 * comment on `openLog` for the fix and why a faster-looking alternative
 * (routing through a throwaway `changeBy` first) was rejected: it measured
 * correct but produced a *worse* defect, destabilising jQuery Mobile's
 * transition queue enough that the next unrelated navigation stalled for
 * ~42 seconds. `openLog` now does a full reload before navigating to the log
 * route, which is slower per call but provably safe. This is a shared-helper
 * change; the other consumer (`xp-history.spec.js`) was re-run afterward and
 * still passes (see the report for this task).
 *
 * **2. The `SimpleTraitChangeView.save_clicked` free_value-drop defect
 * (already documented for the creation suites' merit tests) does NOT corrupt
 * anything for the categories this task uses.** `update_creation_rules_for_
 * changed_trait(category, modified_trait, freeValue)` - identical in
 * Vampire.js/Werewolf.js/ChangelingBetaSlice.js - opens with
 * `if (!_.contains(["merits"/"wta_merits"/"ctdbs_merits", "flaws"/...],
 * category)) { if (!freeValue) { return Parse.Promise.as(self); } }`. Every
 * trait this suite renames or revalues post-creation was purchased (not
 * creation-picked), so its `free_value` is already `0` - and `0` is falsy,
 * so this guard returns *before* ever touching the creation record, for
 * every category this task touches (`backgrounds`/`wta_backgrounds`/
 * `ctdbs_arts`) except merits, where the guard is unconditionally skipped.
 * Measured live and reported per scenario below rather than assumed - this
 * is exactly what the assignment's "measure, don't assume" note about
 * scenario (g) asked for.
 *
 * **3. Specialization-page saves never move XP by themselves; value changes
 * on a specialized trait charge or refund exactly the table delta - no
 * defect (scenario g).** `SimpleTraitSpecializationView.save_clicked` only
 * calls `simpletrait.set_specialization(v)` before saving, so `calculate_
 * trait_cost`/`calculate_trait_to_spend` see an unchanged `value`/
 * `free_value` and compute a zero delta - measured live, Available stayed
 * fixed at the pre-rename number. A *subsequent* value change through the
 * ordinary `#simpletrait/:category/:cid/:bid` page (the only place the value
 * slider lives) reads `trait.get("cost")` - the value stored by the
 * *previous* save - as `old_cost` and computes `new_cost - old_cost` as the
 * spend, exactly like the "upgrade charges only the increment" behaviour
 * Task 8a's test 187 already proved. Measured on a Vampire background
 * (`Retainers: Specialized Now`, 1->4): quoted cost 9, Spent moved by exactly
 * 9, the trait's own stored `cost` became 10 (the new absolute). Measured
 * again on a Changeling Art (`Primal: First`, cumulative table, 1->2): quoted
 * cost 12 (18-6), Spent moved by exactly 12. Both correct.
 *
 * **4. DEFECT - renaming a trait to collide with an existing name is
 * correctly *rejected*, but the rejection is never surfaced to the player
 * anywhere in the DOM (scenario f, all three venues).**
 * `SimpleTraitSpecializationView.save_clicked`'s `.fail()` branch does
 * `console.log(...)` and then `window.location.hash = self.redirectRemove(...)`
 * - and `redirectRemove` and `redirectSave` were registered as the *same*
 * `#simpletraits/<category>/<cid>/all` target (see `simpletraitspecialize` in
 * mobileRouter.js), so a rejected rename lands on the identical page a
 * successful one would, with no visible difference. The shared `PromiseFail
 * Report` helper (helpers/PromiseFailReport.js) that other failure paths use
 * is no better: its real, exported function only ever does `console.info`/
 * `console.log`; the one branch that *would* render a popup
 * (`#popup-global-error`) is a second, unexported `fakefunc` that is dead
 * code - never called, and would throw on an undefined `img` variable if it
 * ever were. Measured live: attempting the rename produced console text
 * `"Couldn't specialize trait because of {\"code\":1,\"message\":\"Name
 * matches an existing trait. Restoring original name\"}"` - visible only in
 * DevTools - while the rendered page showed nothing but the ordinary
 * category listing. The rejection itself is real and correct (confirmed via
 * assertion-side Parse read-back: the target trait's stored name never
 * changed), so these tests assert the *data* integrity as passing and
 * `test.fail()` only the "surfaced error" clause.
 *
 * **5. DEFECT - removing a creation-picked trait does not fail; it succeeds
 * silently and permanently orphans that pool slot (scenario h, all three
 * venues).** `Character.remove_trait(trait)` (models/Character.js) does
 * `trait.destroy()`, refunds `-cost` (zero for a creation pick, since it was
 * free), removes the trait from the character's array, and posts an
 * experience notation - nothing in that path touches the `creation` object's
 * `*_remaining` counters, unlike the dedicated `charactercreateunpicksimple
 * trait` route that runs *during* creation. Measured live on all three
 * venues (backgrounds/wta_backgrounds/ctdbs_arts): the Remove button is
 * present and works, the trait disappears, the refund is correct (zero, since
 * the trait was free) - and the `_1_remaining` counter reads the identical
 * number before and after. Since the character is no longer `is_being_
 * created()`, there is no route back to that picker, so the slot is lost for
 * the rest of the character's life. This directly contradicts the plan's
 * "fails with an informative error" - the real behaviour is the opposite
 * shape of bug (silent success with a hidden side effect, not a blocked
 * action), so these tests `test.fail()` the plan's literal expectation and
 * report the measured reality in the same breath.
 *
 * **6. Building a same-base-name collision fixture, entirely through the UI,
 * for a venue with no `requires_specialization` trait at all (Changeling).**
 * No `ctdbs_arts`/`ctdbs_backgrounds`/`ctdbs_merits` Description carries
 * `requirement: "requires_specialization"` anywhere in the seed data (unlike
 * Vampire's `Retainers` or Werewolf's `Kinfolk`, both backgrounds), so the
 * two-step "pick -> forced specialization form" flow those two venues use to
 * add a second same-base row (their base name stays perpetually offered by
 * the picker - `SimpleTraitNewView.templateHelpers` explicitly excludes
 * `requireSpecializations` names from its "already owned" filter) has no
 * Changeling equivalent. But the same *general* mechanism the picker uses -
 * exclude only names that exactly match a currently-owned trait - reopens a
 * path once a trait is renamed away from its bare form: after "Primal" is
 * renamed to "Primal: First", nothing owned is named exactly "Primal" any
 * more, so the ordinary new-trait picker offers "Primal" again, letting a
 * second, independent "Primal"-based row be added and specialized to
 * "Primal: Second". Confirmed live end to end, including the collision
 * attempt and its rejection, entirely through real UI actions - no
 * `page.evaluate` fixture workaround needed. This suite uses the venue's
 * native `requires_specialization` trait where one exists (Vampire, Werewolf)
 * and this rename-then-readd mechanism for Changeling, both producing the
 * identical shape of fixture (two independent rows sharing one base name).
 *
 * **7. `ctdbs_backgrounds` is deliberately not this suite's Changeling chain
 * category, even though the plan's category list names it first.**
 * `BNSCTDBS_ChangelingCosts.calculate_trait_cost` has a background-shaped
 * branch that checks the literal string `"backgrounds"` - Vampire's bare
 * category name, never renamed to this venue's actual `"ctdbs_backgrounds"` -
 * so it never matches, and the function's final statement is a bare
 * `return 0`. This is already documented by Task 8c (creation-changeling.
 * spec.js test 236); re-proving it here would add nothing. What it does
 * mean for *this* task is that `ctdbs_backgrounds` cannot demonstrate
 * scenario (g)'s "charges or refunds the correct XP difference", because the
 * charge is always zero regardless of what's correct. Changeling's a-g chain
 * therefore runs against `ctdbs_arts` instead (a real, measured, cumulative
 * cost table - see finding 3), and `ctdbs_backgrounds` is used instead for
 * the creation-pick/removal scenario (h, where cost is irrelevant) and the
 * picker-exclusivity scenario (l, ditto), so the category the plan names
 * still gets real coverage in this file, just not for the arithmetic-
 * sensitive scenarios.
 *
 * **8. XP headroom, and a second caching defect it uncovered.** `ctdbs_arts`
 * costs 6/level cumulative for a non-affinity Art (measured: value 1 = 6,
 * value 2 = 18), nearly double a Vampire background's 1/2/3 cumulative
 * table. Two Art purchases plus a raise each would overspend a bare 30-XP
 * starting budget before scenario (h) even begins. Every character in this
 * suite (all three venues, for uniformity) is topped up with a `+50`
 * fixture XP notation in `beforeAll`, driven through `add_experience_
 * notation` the same way `ensure_creation_rules_exist` grants the initial
 * 30 - fixture setup, not the interaction under test, so this stays inside
 * the `page.evaluate`-in-`beforeAll` allowance.
 *
 * Getting this working live surfaced a real caching defect worth recording
 * on its own: `Vampire.get_character(id, categories, character_cache)`
 * (models/Vampire.js, identically in Werewolf.js/ChangelingBetaSlice.js)
 * takes an optional third argument used purely as a cache slot
 * (`character_cache._character`). Called with only two arguments - which is
 * what every `runInApp`-based helper in `characters.js` does
 * (`readTraits`, `readCreation`, ...) - it creates a fresh, throwaway cache
 * each call and always fetches current server state, which is exactly right
 * for assertion-side read-back. But `mobileRouter.js`'s own `self.get_
 * character` wrapper passes `self` (the *router instance*) as that third
 * argument, so the router keeps *one* cached character object alive across
 * every hash-based navigation to that same id for the lifetime of the page,
 * and line 307's own invalidation check (`character_cache._character.id !=
 * id`) only fires on an actual id change - never on "the id is the same but
 * the data changed elsewhere." Confirmed live: the `+50` notation, added via
 * `runInApp` (which does its own independent fetch-and-save, bypassing the
 * router's cache entirely), was verified correct twice over - the promise's
 * own resolved value and a separate, direct `Parse.Query` both read
 * `experience_earned: 80` immediately afterward - while the very next
 * `readSheetXp` call, which navigates through the router's `#character?:id`
 * route, still rendered `30`. This is the same family of staleness as
 * finding 1's log view and the plan's own already-documented admin-view
 * memoization, just in a third location. The fix is a `hardReload()`
 * immediately after the top-up, once per venue in `beforeAll` (three calls
 * total for the whole suite) - heavier than the write itself, but it resets
 * the router instance completely, which is the only thing that actually
 * clears this cache slot.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const {
  navigateToHash,
  waitForActivePage,
  normalize,
  waitForJqmLoader,
  runInApp,
  hardReload
} = require('./helpers/jqm-helpers');
const {
  CREATURE_TYPES,
  createCharacter,
  openCreation,
  pickCreationTrait,
  completeCreation,
  readTraits,
  readSheetXp,
  readCreation,
  openNewTraitChange,
  openTraitChange,
  setTraitChangeSliders,
  readTraitChangeView,
  saveTraitChange,
  countCharactersByPrefix,
  destroyCharactersByPrefix
} = require('./helpers/characters');
const { openLog, readLogRows, findLogRows } = require('./helpers/logs');

/** Every character this file creates is named with this prefix, so teardown is a query. */
const FIXTURE_PREFIX = 'E2E T9 ';

/**
 * Per-venue configuration driving all twelve scenarios identically. Category
 * names come straight from `characters.js`'s `VENUE_*_CATEGORY` maps except
 * where finding 7 above documents why Changeling's chain deliberately
 * diverges from `ctdbs_backgrounds`.
 */
const VENUES = [
  {
    name: 'Vampire',
    numberBase: 241,
    chainCategory: 'backgrounds',
    creationPickTrait: 'Resources',
    plainTrait: 'Haven',
    specializeBase: 'Retainers',
    requiresTwoStepAdd: true,
    meritCategory: 'merits',
    meritTrait: 'Bloodline: Coyote',
    meritValue: 2,
    exclusivityCategory: 'disciplines',
    exclusivityTraitName: 'Celerity'
  },
  {
    name: 'Werewolf',
    numberBase: 253,
    chainCategory: 'wta_backgrounds',
    creationPickTrait: 'Fame',
    plainTrait: 'Resources',
    specializeBase: 'Kinfolk',
    requiresTwoStepAdd: true,
    meritCategory: 'wta_merits',
    meritTrait: 'Ambidextrous',
    meritValue: 2,
    exclusivityCategory: 'wta_gifts',
    exclusivityTraitName: 'Airt Perception'
  },
  {
    name: 'Changeling',
    numberBase: 265,
    chainCategory: 'ctdbs_arts',
    creationPickTrait: 'Dread',
    plainTrait: 'Skullduggery',
    specializeBase: 'Primal',
    requiresTwoStepAdd: false,
    meritCategory: 'ctdbs_merits',
    meritTrait: 'Ambidextrous',
    meritValue: 2,
    exclusivityCategory: 'ctdbs_backgrounds',
    exclusivityTraitName: 'Resources'
  }
];

/** Fixture XP top-up granted to every character - see finding 8 above. */
const XP_HEADROOM = 50;

test.describe.configure({ mode: 'serial' });

// -----------------------------------------------------------------------
// Suite-local helpers
// -----------------------------------------------------------------------

/**
 * Poll a hash to its expected value rather than trusting a single blocking
 * wait. Confirmed necessary live: a plain `page.waitForFunction` on an exact
 * hash match intermittently reported a 15s timeout on the specialize routes
 * even though the hash reliably settled within one second when polled
 * instead - this app's page-transition timing is not reliable enough for a
 * single non-retrying wait on these particular routes (see finding 1's
 * sibling note in `logs.js` about the same family of issue).
 */
async function waitForHash(page, expectedHash, { timeout = 20000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.location.hash);
    if (last === expectedHash) return;
    await page.waitForTimeout(interval);
  }
  throw new Error(`expected hash "${expectedHash}" within ${timeout}ms; last seen "${last}"`);
}

/** Buy a trait at value 1 through the ordinary post-creation picker. */
async function addPlainTrait(page, cid, category, name) {
  await openNewTraitChange(page, cid, category, name);
  await setTraitChangeSliders(page, { value: 1 });
  await saveTraitChange(page, cid, category);
}

/**
 * Add the bare (unspecialized) form of the venue's specializing base trait.
 *
 * Vampire's `Retainers` and Werewolf's `Kinfolk` carry `requirement:
 * "requires_specialization"`, so `SimpleTraitNewView.clicked` always diverts
 * a fresh pick to the two-step specialize-new flow
 * (`SimpleTraitNewSpecializationView`); leaving the specialization field
 * blank on that form calls `set_specialization("")`, which - per
 * `SimpleTraitMixin.set_specialization` - resets the name to the bare base,
 * then redirects (without persisting) to the ordinary "new" change page with
 * that bare name pre-filled, which *does* persist on Save. Changeling's
 * `Primal` carries no such requirement, so it goes straight through the
 * ordinary one-step picker instead (finding 6 above).
 */
async function addSpecializingBase(page, cid, venue) {
  if (venue.requiresTwoStepAdd) {
    await navigateToHash(page, `simpletraits/${venue.chainCategory}/${cid}/new`, '#simpletrait-new');
    const link = page.locator(`#simpletrait-new a.simpletrait[name="${venue.specializeBase}"]`).first();
    await expect(link, `"${venue.specializeBase}" offered by the ${venue.chainCategory} picker`).toHaveCount(1);
    await link.click();

    // Poll the hash rather than trusting a single blocking wait on a named
    // page (the same robustness `waitForHash` exists for elsewhere in this
    // file) - and tolerate either destination the click can legitimately
    // reach: the two-step specialize-new form (the expected path, since
    // this trait is in `requireSpecializations`), or - if the app's own
    // render/fetch race lands the click on a stale copy of the link -
    // straight through to the ordinary "new" change page with the bare
    // name already pre-filled, which is functionally the same starting
    // point one step later.
    const specializeNewHashFragment = `simpletrait/specialize/${venue.chainCategory}/${cid}/`;
    const spacerHashFragment = `simpletrait/spacer/${venue.chainCategory}/${cid}/`;
    const deadline = Date.now() + 20000;
    let hash = null;
    while (Date.now() < deadline) {
      hash = await page.evaluate(() => window.location.hash);
      if (hash.indexOf(specializeNewHashFragment) !== -1 || hash.indexOf(spacerHashFragment) !== -1) break;
      await page.waitForTimeout(200);
    }
    await waitForJqmLoader(page);

    if (hash.indexOf(specializeNewHashFragment) !== -1) {
      await waitForActivePage(page, 'simpletrait-new-specialization');
      await page.fill('#simpletrait-new-specialization input[name="specialization"]', '');
      await page.locator('#simpletrait-new-specialization .save').click();
      await waitForJqmLoader(page);
    }

    await waitForActivePage(page, 'simpletrait-change');
    await page.locator('.ui-page-active .save').first().click();
    await waitForHash(page, `#simpletraits/${venue.chainCategory}/${cid}/all`);
    await waitForJqmLoader(page);
  } else {
    await addPlainTrait(page, cid, venue.chainCategory, venue.specializeBase);
  }

  const traits = await readTraits(page, cid, venue.chainCategory, venue.name);
  const trait = traits.find((t) => t.name === venue.specializeBase);
  if (!trait) {
    throw new Error(`expected a bare "${venue.specializeBase}" trait after addSpecializingBase; owned: ${traits.map((t) => t.name).join(', ')}`);
  }
  return trait;
}

/**
 * Rename an existing trait's specialization via the dedicated
 * `#simpletrait/specialize/:category/:cid/:bid` route (SimpleTraitSpecializationView).
 * Both success and rejection land on the same category-listing hash (finding
 * 4 above), so the caller distinguishes them by reading the trait back.
 */
async function specializeRename(page, cid, category, traitId, suffix) {
  await navigateToHash(page, `simpletrait/specialize/${category}/${cid}/${traitId}`, '#simpletrait-specialization');
  await page.fill('#simpletrait-specialization input[name="specialization"]', suffix);
  await page.locator('#simpletrait-specialization .save').click();
  await waitForHash(page, `#simpletraits/${category}/${cid}/all`);
  await waitForJqmLoader(page);
}

/** The freshest (log is newest-first) row matching every key in `spec`. */
function freshestLogRow(rows, spec) {
  const matches = findLogRows(rows, spec);
  if (matches.length === 0) {
    throw new Error(`no log row matched ${JSON.stringify(spec)}. First rows: ${JSON.stringify(rows.slice(0, 5))}`);
  }
  return matches[0];
}

// -----------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------

test.describe('Task 9 - Trait Change Lifecycle In The UI', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  const state = {};

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginAsAdmin(page);

    const swept = await destroyCharactersByPrefix(page, FIXTURE_PREFIX);
    state.baseline = {
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX)
    };
    console.log('[e2e traits-lifecycle] self-heal swept:', JSON.stringify(swept));
    console.log('[e2e traits-lifecycle] baseline Vampire row counts:', JSON.stringify(state.baseline));

    // One character per venue: create, pick exactly one creation-time trait
    // in the chain category (rating 1, the smallest slot every chain category
    // has), complete, then top up XP headroom (finding 8).
    for (const venue of VENUES) {
      const name = `${FIXTURE_PREFIX}${venue.name} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      const character = await createCharacter(page, venue.name, name);
      await openCreation(page, character.id);
      await pickCreationTrait(page, character.id, venue.chainCategory, 1, venue.creationPickTrait);
      await completeCreation(page, character.id, venue.name);

      // Fixture XP top-up (finding 8). Driven through the model's own
      // `add_experience_notation`, exactly like `ensure_creation_rules_
      // exist` grants the initial 30, so it stays a real notation the later
      // per-scenario purchases correctly propagate against.
      const { module } = CREATURE_TYPES[venue.name];
      await runInApp(page, [module], `
        return mods[0].get_character(arg.id, "all").then(function (c) {
          return c.add_experience_notation({
            reason: "E2E fixture headroom",
            alteration_earned: arg.amount
          });
        });
      `, { id: character.id, amount: XP_HEADROOM });

      // The write above bypasses mobileRouter.js's own cached character
      // object (see finding 8's second half) - completeCreation's own
      // navigation already populated that cache for this id, and nothing
      // short of a full reload invalidates it. Without this, readSheetXp
      // below - and every scenario test that follows, all of which navigate
      // through that same router - would keep reading the pre-top-up state.
      await hardReload(page);

      const xp = await readSheetXp(page, character.id);
      expect(xp, `${venue.name} fixture starting XP`).toEqual({
        earned: 30 + XP_HEADROOM,
        spent: 0,
        available: 30 + XP_HEADROOM
      });

      const creationPick = (await readTraits(page, character.id, venue.chainCategory, venue.name))
        .find((t) => t.name === venue.creationPickTrait);
      expect(creationPick, `${venue.name} creation-picked "${venue.creationPickTrait}"`).toMatchObject({
        value: 1, free_value: 1, cost: 0
      });

      state[venue.name] = { id: character.id, name, xpBaseline: xp };
      console.log(`[e2e traits-lifecycle] ${venue.name} fixture ready:`, character.id, JSON.stringify(xp));
    }
  });

  test.afterAll(async () => {
    if (!page) return;

    const destroyed = await destroyCharactersByPrefix(page, FIXTURE_PREFIX)
      .catch((e) => ({ characters: 0, children: 0, errors: [String(e)] }));
    console.log('[e2e traits-lifecycle] destroyed in teardown:', JSON.stringify(destroyed));

    const final = {
      allCharacters: await page.evaluate(() => new window.Parse.Query('Vampire').count()).catch(() => -1),
      fixtureCharacters: await countCharactersByPrefix(page, FIXTURE_PREFIX).catch(() => -1)
    };
    console.log(
      '[e2e traits-lifecycle] final Vampire row counts (should equal baseline ' +
      JSON.stringify(state.baseline) + '):', JSON.stringify(final)
    );

    await page.close();
  });

  for (const venue of VENUES) {
    const N = (offset) => venue.numberBase + offset;

    test.describe(`${venue.name} (${venue.numberBase}-${venue.numberBase + 11})`, () => {
      let cid;
      test.beforeAll(async () => {
        cid = state[venue.name].id;
        // A full reload between venues, not just a hash change. Measured
        // live: `SimpleTraitNewView`'s shared, router-memoized instance
        // occasionally rendered the *previous* venue's Description catalogue
        // (Vampire's `disciplines`) against the *new* venue's category route
        // (Werewolf's `wta_backgrounds`) the first time a fresh test run
        // crossed from one venue's last test into the next venue's first -
        // reproducible when the full Vampire block ran immediately before,
        // not reproducible starting cold on Werewolf alone. Whatever the
        // precise race, a reload guarantees every venue's block starts from
        // a genuinely fresh router and view state, the same "heavy but
        // reliable" tool used for the XP headroom cache defect above.
        await hardReload(page);

        // Warm-up: the very first navigation to a `simpletrait/...` route
        // after a reload has to `require(["SimpleTraitChangeView"])` fresh
        // (mobileRouter.js's `withSimpleTraitChangeView`), since the reload
        // wiped out the router's own memoized instance along with
        // everything else. Measured live: that first navigation alone can
        // outrun `openNewTraitChange`'s normal 20s wait for `#simpletrait-
        // change` to become active, even though the hash already shows the
        // correct destination. Absorbing that one-time cost here, tolerant
        // of it timing out outright, means the real numbered tests below
        // never have to carry it.
        try {
          await openNewTraitChange(page, cid, venue.chainCategory, venue.plainTrait);
        } catch (e) {
          console.log(`[e2e traits-lifecycle] ${venue.name} warm-up navigation did not settle in time (expected occasionally, continuing): ${e.message}`);
        }
        await navigateToHash(page, `character?${cid}`, '#character');
      });

      // ---------------------------------------------------------------
      // (a)-(c) - plain trait: add, re-add at the same value, raise
      // ---------------------------------------------------------------

      test(`${N(0)} Adding a trait through #simpletraits/:category/:cid/new records it in the log`, async () => {
        await addPlainTrait(page, cid, venue.chainCategory, venue.plainTrait);

        const traits = await readTraits(page, cid, venue.chainCategory, venue.name);
        const trait = traits.find((t) => t.name === venue.plainTrait);
        expect(trait, `${venue.plainTrait} after purchase`).toMatchObject({ value: 1, free_value: 0 });
        expect(trait.cost, `${venue.plainTrait} cost at value 1`).toBeGreaterThan(0);
        state[venue.name].plainCostAt1 = trait.cost;
        state[venue.name].plainTraitId = trait.id;

        await openLog(page, cid, 0, 50);
        const rows = await readLogRows(page);
        const row = freshestLogRow(rows, { category: venue.chainCategory, name: venue.plainTrait, type: 'define' });
        expect(row).toMatchObject({ value: 1, cost: trait.cost, old_value: null, old_cost: null });
      });

      test(`${N(1)} Re-adding the same trait at the same value produces no duplicate log entry`, async () => {
        // The "new" picker excludes already-owned exact names (confirmed
        // live: re-navigating to #simpletraits/:category/:cid/new no longer
        // offers "Haven"/"Resources"/"Skullduggery" once owned), so the only
        // real UI action that re-asserts "the same trait at the same value"
        // is opening its *existing* change page and saving without altering
        // the slider - which is exactly what a player re-confirming a value
        // would do. `cloud/main.js`'s `beforeSave("SimpleTrait")` computes
        // `isMeaningfulChange` and skips writing a `VampireChange` row
        // entirely when old and new value/cost/name/free_value all match, so
        // this is the real, load-bearing assertion, not a formality.
        await navigateToHash(page, `simpletraits/${venue.chainCategory}/${cid}/new`, '#simpletrait-new');
        await expect(
          page.locator(`#simpletrait-new a.simpletrait[name="${venue.plainTrait}"]`),
          `"${venue.plainTrait}" should no longer be offered once already owned`
        ).toHaveCount(0);

        await openLog(page, cid, 0, 50);
        const before = await readLogRows(page);

        await openTraitChange(page, cid, venue.chainCategory, venue.plainTrait);
        await setTraitChangeSliders(page, { value: 1 });
        await saveTraitChange(page, cid, venue.chainCategory);

        await openLog(page, cid, 0, 50);
        const after = await readLogRows(page);

        expect(after.length, 'log row count unchanged after re-saving the same value').toBe(before.length);
        expect(after[0], 'the freshest row is still the original define, not a new one').toMatchObject({
          category: venue.chainCategory, name: venue.plainTrait, type: 'define', value: 1
        });

        const traits = await readTraits(page, cid, venue.chainCategory, venue.name);
        const trait = traits.find((t) => t.name === venue.plainTrait);
        expect(trait).toMatchObject({ value: 1, cost: state[venue.name].plainCostAt1 });
      });

      test(`${N(2)} Raising the trait's value records a log row with the correct old and new values`, async () => {
        const xpBefore = await readSheetXp(page, cid);
        await openTraitChange(page, cid, venue.chainCategory, venue.plainTrait);
        const quote = await readTraitChangeView(page);
        await setTraitChangeSliders(page, { value: 2 });
        const raisedQuote = await readTraitChangeView(page);
        await saveTraitChange(page, cid, venue.chainCategory);
        const xpAfter = await readSheetXp(page, cid);

        const traits = await readTraits(page, cid, venue.chainCategory, venue.name);
        const trait = traits.find((t) => t.name === venue.plainTrait);
        expect(trait.value).toBe(2);
        state[venue.name].plainCostAt2 = trait.cost;

        expect(raisedQuote.cost, 'the quoted delta matches what was actually charged').toBe(trait.cost - state[venue.name].plainCostAt1);
        expect(xpAfter.spent - xpBefore.spent, 'Spent XP moved by exactly the delta').toBe(raisedQuote.cost);
        expect(xpAfter.available - xpBefore.available).toBe(-raisedQuote.cost);

        await openLog(page, cid, 0, 50);
        const rows = await readLogRows(page);
        const row = freshestLogRow(rows, { category: venue.chainCategory, name: venue.plainTrait, type: 'update' });
        expect(row).toMatchObject({
          old_value: 1, value: 2,
          old_cost: state[venue.name].plainCostAt1, cost: trait.cost
        });
      });

      // ---------------------------------------------------------------
      // (d)-(g) - the specialization chain
      // ---------------------------------------------------------------

      test(`${N(3)} Renaming a trait to a specialization via #simpletrait/specialize/... succeeds`, async () => {
        const bare = await addSpecializingBase(page, cid, venue);
        expect(bare).toMatchObject({ name: venue.specializeBase, value: 1, free_value: 0 });
        state[venue.name].specializedId = bare.id;
        state[venue.name].specializedCostAt1 = bare.cost;

        // The pool counter this rename must not move (finding 2) - read
        // *before* acting, not hardcoded, because the fixture's own
        // creation-time pick (scenario h's trait) already spent this same
        // rating-1 slot down to 0 before this test ever runs.
        const poolBefore = (await readCreation(page, cid, venue.name))[`${venue.chainCategory}_1_remaining`];

        const xpBefore = await readSheetXp(page, cid);
        await specializeRename(page, cid, venue.chainCategory, bare.id, 'Specialized Now');
        const xpAfter = await readSheetXp(page, cid);
        expect(xpAfter, 'renaming alone moves no XP').toEqual(xpBefore);

        const traits = await readTraits(page, cid, venue.chainCategory, venue.name);
        const renamed = traits.find((t) => t.id === bare.id);
        expect(renamed).toMatchObject({
          name: `${venue.specializeBase}: Specialized Now`,
          value: 1,
          cost: state[venue.name].specializedCostAt1
        });
        expect(traits.some((t) => t.name === venue.specializeBase), 'the bare name no longer exists as its own row').toBe(false);

        // Renaming a purchased (free_value 0) trait through this route does
        // not touch the creation pool - see finding 2. Confirmed rather than
        // assumed: read the counter back and require it unchanged from
        // whatever it already was.
        const creation = await readCreation(page, cid, venue.name);
        expect(creation[`${venue.chainCategory}_1_remaining`], `${venue.chainCategory}_1_remaining unaffected by a rename`).toBe(poolBefore);

        await openLog(page, cid, 0, 50);
        const rows = await readLogRows(page);
        const row = freshestLogRow(rows, { category: venue.chainCategory, name: `${venue.specializeBase}: Specialized Now`, type: 'update' });
        expect(row).toMatchObject({
          old_value: 1, value: 1,
          old_cost: state[venue.name].specializedCostAt1, cost: state[venue.name].specializedCostAt1,
          old_text: venue.specializeBase
        });
      });

      test(`${N(4)} The renamed specialization displays grouped under its base name on the sheet`, async () => {
        await navigateToHash(page, `simpletraits/${venue.chainCategory}/${cid}/all`, '#simpletraitcategory-all');
        const rows = await page.locator('#simpletraitcategory-all li a').allTextContents();
        const cleaned = rows.map(normalize);

        const full = `${venue.specializeBase}: Specialized Now x1`;
        expect(cleaned, `the category listing shows the full specialized name "${full}"`).toContain(full);
        expect(
          cleaned.some((t) => t === `${venue.specializeBase} x1`),
          'no separate bare-name row should exist alongside the specialized one'
        ).toBe(false);
        expect(
          cleaned.every((t) => t !== venue.specializeBase),
          'the row is identified by its full name, prefixed with the base name, not a bare label'
        ).toBe(true);
      });

      test.fail(`${N(5)} Renaming a trait to collide with an existing trait name is rejected with a surfaced error`, async () => {
        // DEFECT (finding 4). The plan's claim is a conjunction - rejected
        // AND surfaced. The first half is real and asserted here as passing
        // evidence (visible in the trace even though the test as a whole is
        // pinned red by `test.fail()`); the second half is the defect, and
        // it is the assertion this test actually fails on.

        // Build a second, independent trait sharing the same base name -
        // finding 6 explains the mechanism (native requires_specialization
        // two-step for Vampire/Werewolf; rename-then-readd for Changeling,
        // which has no requires_specialization trait in any ctdbs_* category).
        let second;
        if (venue.requiresTwoStepAdd) {
          second = await addSpecializingBase(page, cid, venue);
        } else {
          await addPlainTrait(page, cid, venue.chainCategory, venue.specializeBase);
          const traits = await readTraits(page, cid, venue.chainCategory, venue.name);
          second = traits.find((t) => t.name === venue.specializeBase);
        }
        expect(second, 'a second independent bare trait was added').toMatchObject({ name: venue.specializeBase, value: 1 });
        expect(second.id).not.toBe(state[venue.name].specializedId);

        await specializeRename(page, cid, venue.chainCategory, second.id, 'Second One');
        const afterSecondRename = (await readTraits(page, cid, venue.chainCategory, venue.name)).find((t) => t.id === second.id);
        expect(afterSecondRename.name).toBe(`${venue.specializeBase}: Second One`);

        // The actual collision attempt: rename the second trait onto the
        // first trait's current specialization.
        const consoleTexts = [];
        page.on('console', (msg) => consoleTexts.push(msg.text()));

        await navigateToHash(page, `simpletrait/specialize/${venue.chainCategory}/${cid}/${second.id}`, '#simpletrait-specialization');
        await page.fill('#simpletrait-specialization input[name="specialization"]', 'Specialized Now');
        await page.locator('#simpletrait-specialization .save').click();
        await waitForHash(page, `#simpletraits/${venue.chainCategory}/${cid}/all`);
        await waitForJqmLoader(page);

        // Passing evidence: the rename is genuinely rejected and the
        // trait's stored name is untouched (finding 4's "data" half).
        const traitsAfter = await readTraits(page, cid, venue.chainCategory, venue.name);
        const targetAfter = traitsAfter.find((t) => t.id === second.id);
        expect(targetAfter.name, 'the collided-into name must be rejected, not persisted').toBe(`${venue.specializeBase}: Second One`);
        const both = traitsAfter.filter((t) => t.name.indexOf(venue.specializeBase) === 0);
        expect(both.map((t) => t.name).sort()).toEqual(
          [`${venue.specializeBase}: Specialized Now`, `${venue.specializeBase}: Second One`].sort()
        );
        const rejectionLogged = consoleTexts.some((t) => /Couldn't specialize trait/.test(t));
        expect(rejectionLogged, 'the rejection is at least logged to the console (DevTools-only)').toBe(true);

        // The actual defect - this is the assertion that fails. Measured
        // live: no popup, no inline error text, nothing distinguishes this
        // page from a successful save; the only trace of the rejection is
        // the console.log above, which a real player never sees.
        const popupCount = await page.locator('[data-role="popup"], .ui-popup-active, #popup-global-error').count();
        const visibleText = normalize(await page.locator('.ui-page-active').textContent());
        const surfaced = popupCount > 0 || /match|collide|already exists|cannot|error/i.test(visibleText);
        expect(surfaced, 'DEFECT: no popup, inline message, or error text renders anywhere for a rejected rename').toBe(true);
      });

      test(`${N(6)} Changing the value of a specialized trait charges or refunds the correct XP difference`, async () => {
        const traits = await readTraits(page, cid, venue.chainCategory, venue.name);
        const specialized = traits.find((t) => t.id === state[venue.name].specializedId);
        expect(specialized.name).toBe(`${venue.specializeBase}: Specialized Now`);
        expect(specialized.value).toBe(1);

        const xpBefore = await readSheetXp(page, cid);
        await openTraitChange(page, cid, venue.chainCategory, specialized.name);
        const atCurrent = await readTraitChangeView(page);
        expect(atCurrent.cost, 'quoted cost at the unchanged value is zero').toBe(0);
        await setTraitChangeSliders(page, { value: 2 });
        const raised = await readTraitChangeView(page);
        await saveTraitChange(page, cid, venue.chainCategory);
        const xpAfter = await readSheetXp(page, cid);

        const after = (await readTraits(page, cid, venue.chainCategory, venue.name)).find((t) => t.id === specialized.id);
        expect(after.value).toBe(2);
        const expectedDelta = after.cost - state[venue.name].specializedCostAt1;
        console.log(
          `[${venue.name} ${N(6)}-measured] specialized trait value 1->2: ` +
          `cost ${state[venue.name].specializedCostAt1} -> ${after.cost} (delta ${expectedDelta}), ` +
          `quoted ${raised.cost}, XP spent moved by ${xpAfter.spent - xpBefore.spent}`
        );
        expect(raised.cost, 'the quote matches the actual delta charged').toBe(expectedDelta);
        expect(xpAfter.spent - xpBefore.spent, 'Spent XP moved by exactly the quoted delta').toBe(expectedDelta);
        expect(xpAfter.available - xpBefore.available).toBe(-expectedDelta);
        state[venue.name].specializedCostAt2 = after.cost;

        await openLog(page, cid, 0, 50);
        const rows = await readLogRows(page);
        const row = freshestLogRow(rows, { category: venue.chainCategory, name: `${venue.specializeBase}: Specialized Now`, type: 'update' });
        expect(row).toMatchObject({
          old_value: 1, value: 2,
          old_cost: state[venue.name].specializedCostAt1, cost: after.cost
        });
      });

      // ---------------------------------------------------------------
      // (h) - removal of a creation-picked trait
      // ---------------------------------------------------------------

      test.fail(`${N(7)} Removing a creation-picked trait fails with an informative error`, async () => {
        // DEFECT (finding 5). Measured live: the Remove button is present
        // and works on a creation-picked trait exactly as it does on a
        // purchased one - there is no guard anywhere in `remove_trait` or
        // its call sites keyed on `free_value`. The plan's literal claim is
        // asserted below and goes red on contact with the real behaviour;
        // the actually-measured consequence (silent success, orphaned pool
        // slot) is documented in the comment and in the report for this
        // task rather than encoded as a passing assertion, since a passing
        // assertion here would look like the defect was expected/desired.
        const before = await readTraits(page, cid, venue.chainCategory, venue.name);
        const picked = before.find((t) => t.name === venue.creationPickTrait);
        expect(picked, `${venue.creationPickTrait} still present before the removal attempt`).toBeTruthy();

        const poolBefore = (await readCreation(page, cid, venue.name))[`${venue.chainCategory}_1_remaining`];

        await openTraitChange(page, cid, venue.chainCategory, venue.creationPickTrait);
        await expect(page.locator('#simpletrait-changing .remove')).toHaveCount(1);
        await page.locator('#simpletrait-changing .remove').click();
        await waitForHash(page, `#simpletraits/${venue.chainCategory}/${cid}/all`);
        await waitForJqmLoader(page);

        const after = await readTraits(page, cid, venue.chainCategory, venue.name);
        const stillThere = after.some((t) => t.name === venue.creationPickTrait);
        const poolAfter = (await readCreation(page, cid, venue.name))[`${venue.chainCategory}_1_remaining`];
        console.log(
          `[${venue.name} 248-measured] creation-picked removal: stillPresent=${stillThere}, ` +
          `pool ${poolBefore} -> ${poolAfter} (never restored)`
        );

        // The plan's literal claim - fails, because the removal actually succeeds.
        expect(stillThere, 'the creation-picked trait should still exist because removal should have failed').toBe(true);
      });

      // ---------------------------------------------------------------
      // (i)-(k) - a purchased trait: remove, refund, disappear, log
      // ---------------------------------------------------------------

      test(`${N(8)} Removing a purchased trait succeeds and refunds the correct XP`, async () => {
        await openNewTraitChange(page, cid, venue.meritCategory, venue.meritTrait);
        await setTraitChangeSliders(page, { value: venue.meritValue });
        await saveTraitChange(page, cid, venue.meritCategory);

        const bought = (await readTraits(page, cid, venue.meritCategory, venue.name)).find((t) => t.name === venue.meritTrait);
        expect(bought, `${venue.meritTrait} after purchase`).toMatchObject({ value: venue.meritValue, cost: venue.meritValue });
        state[venue.name].meritId = bought.id;

        const xpBefore = await readSheetXp(page, cid);
        await openTraitChange(page, cid, venue.meritCategory, venue.meritTrait);
        await page.locator('#simpletrait-changing .remove').click();
        await waitForHash(page, `#simpletraits/${venue.meritCategory}/${cid}/all`);
        await waitForJqmLoader(page);
        const xpAfter = await readSheetXp(page, cid);

        expect(xpAfter.spent - xpBefore.spent, 'Spent decreases by exactly the merit value (a refund)').toBe(-venue.meritValue);
        expect(xpAfter.available - xpBefore.available).toBe(venue.meritValue);
        state[venue.name].meritRemovedAtSpent = xpAfter.spent;
      });

      test(`${N(9)} The removed trait disappears from both the category view and the main sheet`, async () => {
        const traits = await readTraits(page, cid, venue.meritCategory, venue.name);
        expect(traits.some((t) => t.name === venue.meritTrait), 'no longer present on the character itself, which backs the sheet').toBe(false);

        await navigateToHash(page, `simpletraits/${venue.meritCategory}/${cid}/all`, '#simpletraitcategory-all');
        const rows = (await page.locator('#simpletraitcategory-all li a').allTextContents()).map(normalize);
        expect(rows.some((t) => t.indexOf(venue.meritTrait) === 0), 'no longer listed in the category view').toBe(false);

        await navigateToHash(page, `character?${cid}`, '#character');
        const link = page.locator(`#character a[href="#simpletraits/${venue.meritCategory}/${cid}/all"]`);
        await expect(link, 'the category link itself still renders from the sheet (other categories may still hold traits)').toHaveCount(1);
      });

      test(`${N(10)} The removal is recorded in the log with the correct old value and cost`, async () => {
        await openLog(page, cid, 0, 50);
        const rows = await readLogRows(page);
        const row = freshestLogRow(rows, { category: venue.meritCategory, name: venue.meritTrait, type: 'remove' });
        expect(row).toMatchObject({ old_value: venue.meritValue, old_cost: venue.meritValue });
      });

      // ---------------------------------------------------------------
      // (l) - the "new" picker is scoped to its own category
      // ---------------------------------------------------------------

      test(`${N(11)} The category "new" picker lists only Descriptions valid for that category`, async () => {
        await navigateToHash(page, `simpletraits/${venue.exclusivityCategory}/${cid}/new`, '#simpletrait-new');
        const names = await page.locator('#simpletrait-new a.simpletrait').evaluateAll((els) => els.map((e) => e.getAttribute('name')));
        expect(names.length, `${venue.exclusivityCategory} picker is non-empty`).toBeGreaterThan(0);
        expect(names, `a known ${venue.exclusivityCategory} trait is offered`).toContain(venue.exclusivityTraitName);

        const foreignNames = [
          venue.plainTrait, venue.specializeBase, venue.creationPickTrait, venue.meritTrait
        ];
        const leaked = names.filter((n) => foreignNames.includes(n));
        expect(leaked, `no trait from another category (${foreignNames.join(', ')}) should appear here`).toEqual([]);
      });
    });
  }
});
