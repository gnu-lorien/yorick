/**
 * Do a player's edits survive moving around the app?
 *
 * The plain version of the question: make a change, wander off to other
 * screens, come back -- is it still there, and is it the change you actually
 * made?
 *
 * The unit tests in `client/src/parse/singleInstance.spec.ts` answer the
 * mechanism half of that with no server: what two references to one row see
 * while edits are pending, and what a save response does to children already
 * loaded. They cannot answer this half. A screen only shows the right thing if
 * the route fetches, the save lands, and the object the next edit is handed
 * still has data on it -- and those only meet in a real browser against a real
 * server.
 *
 * ## What this file does NOT guard, measured rather than assumed
 *
 * It does not guard `client/src/parse/reattach.ts`. That was the intent of test
 * 2 -- two edits back to back, no reload between -- because that is the shape
 * that broke on the Backbone client and broke SILENTLY: a save response echoes
 * pointer columns as bare pointers, per-object state decodes those into empty
 * objects, and the character is left holding traits with no data, so the next
 * `update_trait` cannot find the trait it was handed.
 *
 * All four tests here were then run with `installSaveReattachment()` commented
 * out, and all four still passed. The reason is structural: every route in this
 * client fetches on entry, and `openTraitChange` navigates to the category
 * listing to find its row, so even "no reload" still crosses a route boundary
 * and refetches. The unfetched children never survive long enough to be read.
 *
 * The tests that DO guard the wrap are the two save-response cases in
 * `client/src/parse/singleInstance.spec.ts`; both fail without it. Kept
 * separate on purpose -- do not delete them believing this file covers them.
 *
 * That result also says something about the app: the refetch-on-entry design is
 * what makes this client resilient here, and the wrap is defence for the day
 * some screen saves and re-reads without a route change. If that ever happens,
 * this file is where a test for it belongs.
 *
 * ## Test 4 is the other direction
 *
 * "Edits persist" has a counterpart that matters just as much: an edit the
 * player did NOT commit must not persist. Abandoning a change page by
 * navigating away has to leave the trait alone. Under shared object state a
 * pending edit can ride along on somebody else's save, which is the mechanism
 * behind unasked-for writes, so this is pinned too.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { navigateToHash, hardReload, runInApp } = require('./helpers/jqm-helpers');
const {
  CREATURE_TYPES,
  createCharacter,
  openCreation,
  pickCreationTrait,
  completeCreation,
  readTraits,
  purchaseTrait,
  openTraitChange,
  setTraitChangeSliders,
  saveTraitChange,
  destroyCharactersByPrefix
} = require('./helpers/characters');

const FIXTURE_PREFIX = 'E2E EditPersist ';

const VENUE = 'Vampire';
const CATEGORY = 'backgrounds';
/** Picked at creation, so the fixture has a real creation-time trait on it. */
const CREATION_PICK = 'Resources';
/** Bought with XP after creation. `plainTrait` for this venue. */
const BOUGHT = 'Haven';

/*
 * Test 2's subject, and it must be a trait that buys in ONE step.
 *
 * `Retainers` was the first choice and is wrong: it is this venue's
 * `specializeBase`, so buying it diverts to `#simpletrait-new-specialization`
 * and never reaches the change page. `skills`/`Athletics` and
 * `disciplines`/`Celerity` are both bought plainly by existing suites
 * (`xp-history`, `character-sheet`), so they are known one-step rather than
 * assumed to be.
 */
const EDITED_TWICE = { category: 'skills', name: 'Athletics' };
/** Test 4's unrelated save. Also a proven one-step purchase. */
const UNRELATED = { category: 'disciplines', name: 'Celerity' };

/** Enough XP that no purchase below is refused for affordability. */
const XP_HEADROOM = 200;

/**
 * A tour of unrelated screens.
 *
 * Deliberately not a reload: the point is to leave the sheet, put other routes
 * through their own fetches and renders, and come back. Each entry is a route
 * this app actually has, with the page it settles on.
 */
const ELSEWHERE = [
  ['', '#player-options'],
  ['troupes', '#troupes-list'],
  ['characters?all', '#characters-all'],
  ['profile', '#user-settings-profile']
];

async function wanderAround(page) {
  for (const [hash, settled] of ELSEWHERE) {
    await navigateToHash(page, hash, settled);
  }
}

/** The value the listing for `category` currently shows for `traitName`. */
async function traitValue(page, characterId, category, traitName) {
  const traits = await readTraits(page, characterId, category, VENUE);
  const found = traits.find((t) => t.name === traitName);
  return found ? found.value : null;
}

/*
 * Serial, because these four build on one another: test 1 buys the trait tests
 * 3 and 4 read. Without it a retry of a later test runs against a freshly
 * created fixture that never had the purchase, and reports a confusing `null`
 * instead of the real failure.
 */
test.describe.serial('Edits persist while navigating around', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  const state = {};

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginAsAdmin(page);

    await destroyCharactersByPrefix(page, FIXTURE_PREFIX);

    const name = `${FIXTURE_PREFIX}${Date.now().toString(36)}`;
    const character = await createCharacter(page, VENUE, name);
    state.id = character.id;

    await openCreation(page, character.id);
    await pickCreationTrait(page, character.id, CATEGORY, 1, CREATION_PICK);
    await completeCreation(page, character.id, VENUE);

    // Through the model's own notation path, exactly as the initial 30 is
    // granted, so it stays a real notation later purchases propagate against.
    // `runInApp` is the dual-client seam -- both front ends publish the venue
    // modules through it -- so this fixture is written once for both.
    await runInApp(page, [CREATURE_TYPES[VENUE].module], `
      return mods[0].get_character(arg.id, "all").then(function (c) {
        return c.add_experience_notation({
          reason: "E2E fixture headroom",
          alteration_earned: arg.amount
        });
      });
    `, { id: character.id, amount: XP_HEADROOM });

    // The grant above went around whatever character the client already had
    // cached for this id; only a full reload invalidates that.
    await hardReload(page);
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  test('a purchase is still there after visiting four other screens', async () => {
    await purchaseTrait(page, state.id, CATEGORY, BOUGHT, { value: 2 });

    expect(await traitValue(page, state.id, CATEGORY, BOUGHT),
      'the purchase must be visible immediately').toBe(2);

    await wanderAround(page);

    expect(await traitValue(page, state.id, CATEGORY, BOUGHT),
      'the purchase must survive navigating away and back').toBe(2);
    expect(await traitValue(page, state.id, CATEGORY, CREATION_PICK),
      'the creation-time pick must not have been disturbed').toBe(1);
  });

  test('a second edit immediately after the first, with no reload between', async () => {
    /*
     * The one that matters. No `hardReload` anywhere in this test on purpose:
     * a reload refetches everything and would hide exactly the defect this is
     * here to catch.
     */
    await purchaseTrait(page, state.id, EDITED_TWICE.category, EDITED_TWICE.name, { value: 1 });
    expect(await traitValue(page, state.id, EDITED_TWICE.category, EDITED_TWICE.name)).toBe(1);

    // Straight into a second edit of the trait just saved. If the save
    // response left the character holding dataless traits, this is where it
    // shows: the row renders without a name, or the save silently no-ops.
    await openTraitChange(page, state.id, EDITED_TWICE.category, EDITED_TWICE.name);
    await setTraitChangeSliders(page, { value: 3 });
    await saveTraitChange(page, state.id, EDITED_TWICE.category);

    expect(await traitValue(page, state.id, EDITED_TWICE.category, EDITED_TWICE.name),
      'the second edit must take effect without an intervening reload').toBe(3);

    // And the first purchase is still intact after all of it.
    expect(await traitValue(page, state.id, CATEGORY, BOUGHT)).toBe(2);
  });

  test('everything is really on the server, not just on the screen', async () => {
    // The one place a reload is the point: this asks the server, not the
    // client's copy.
    await hardReload(page);

    expect(await traitValue(page, state.id, CATEGORY, BOUGHT)).toBe(2);
    expect(await traitValue(page, state.id, EDITED_TWICE.category, EDITED_TWICE.name)).toBe(3);
    expect(await traitValue(page, state.id, CATEGORY, CREATION_PICK)).toBe(1);
  });

  test('an edit abandoned by navigating away does not persist', async () => {
    const before = await traitValue(page, state.id, CATEGORY, BOUGHT);
    expect(before).toBe(2);

    // Open the change page, move the slider, and leave without saving.
    await openTraitChange(page, state.id, CATEGORY, BOUGHT);
    await setTraitChangeSliders(page, { value: 5 });
    await wanderAround(page);

    expect(await traitValue(page, state.id, CATEGORY, BOUGHT),
      'an uncommitted slider change must not reach the trait').toBe(before);

    // And it must not be sitting on the object waiting to ride along on the
    // next unrelated save either.
    await purchaseTrait(page, state.id, UNRELATED.category, UNRELATED.name, { value: 1 });

    expect(await traitValue(page, state.id, CATEGORY, BOUGHT),
      'an unrelated save must not carry the abandoned edit').toBe(before);
  });
});
