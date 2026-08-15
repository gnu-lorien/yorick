/**
 * Character creation and sheet helpers.
 *
 * `createCompletedCharacter` drives the real Marionette creation wizard rather
 * than writing Parse objects directly, because most of the suite depends on the
 * wizard's own accounting (creation pools, initial XP, the change log entries it
 * emits). A character fabricated behind the UI's back would not carry that
 * history and would quietly invalidate the tests that read it.
 */

const {
  navigateToHash,
  waitForActivePage,
  waitForJqmLoader,
  setJqmSlider,
  clearStuckLoader,
  parseIntOrNull,
  normalize,
  runInApp
} = require('./jqm-helpers');

/** Venue name -> RequireJS module and the `type` the app stores. */
const CREATURE_TYPES = {
  Vampire: { module: 'app/models/Vampire', type: 'Vampire' },
  Werewolf: { module: 'app/models/Werewolf', type: 'Werewolf' },
  Changeling: { module: 'app/models/ChangelingBetaSlice', type: 'ChangelingBetaSlice' }
};

/** The trait category each venue uses for the fifth creation step. */
const VENUE_POWER_CATEGORY = {
  Vampire: 'disciplines',
  Werewolf: 'wta_gifts',
  Changeling: 'ctdbs_arts'
};

/** The trait category each venue uses for backgrounds. */
const VENUE_BACKGROUND_CATEGORY = {
  Vampire: 'backgrounds',
  Werewolf: 'wta_backgrounds',
  Changeling: 'ctdbs_backgrounds'
};

/** The merit/flaw categories each venue uses. */
const VENUE_MERIT_CATEGORY = {
  Vampire: 'merits',
  Werewolf: 'wta_merits',
  Changeling: 'ctdbs_merits'
};

const VENUE_FLAW_CATEGORY = {
  Vampire: 'flaws',
  Werewolf: 'wta_flaws',
  Changeling: 'ctdbs_flaws'
};

function resolveVenue(venue) {
  const found = CREATURE_TYPES[venue];
  if (!found) {
    throw new Error(`Unknown venue "${venue}". Expected one of: ${Object.keys(CREATURE_TYPES).join(', ')}`);
  }
  return found;
}

let nameCounter = 0;
/** Unique, readable character name so roster and rename assertions never collide. */
function uniqueName(prefix) {
  nameCounter++;
  return `${prefix} ${Date.now().toString(36)}${nameCounter}`;
}

/**
 * Create an empty character of the given venue.
 * This is fixture setup, so it goes through the model directly; every
 * subsequent step in this module drives the UI.
 */
async function createCharacter(page, venue, name) {
  const { module } = resolveVenue(venue);
  const finalName = name || uniqueName(`E2E ${venue}`);
  const result = await runInApp(page, [module], `
    return mods[0].create(arg.name).then(function (c) {
      return { id: c.id, name: c.get('name'), type: c.get('type') };
    });
  `, { name: finalName });
  return result;
}

/** Navigate to the creation wizard for a character. */
async function openCreation(page, characterId) {
  await navigateToHash(page, `charactercreate/${characterId}`, '#character-create');
}

/**
 * Read the creation wizard's current state straight off the rendered page:
 * which text attributes are set, and how many picks remain in each pool.
 *
 * The pool counts come from the `.ui-li-count` badge each section renders, which
 * is the same number a human sees.
 */
async function readCreationState(page, characterId) {
  await openCreation(page, characterId);
  return page.evaluate(() => {
    const pg = document.querySelector('#character-create');
    if (!pg) return null;

    const pools = {};
    pg.querySelectorAll('li[data-role="list-divider"]').forEach((li) => {
      const badge = li.querySelector('.ui-li-count');
      if (!badge) return;
      const label = li.textContent.replace(badge.textContent, '').trim();
      pools[label] = parseInt(badge.textContent.trim(), 10);
    });

    const texts = {};
    pg.querySelectorAll('li[data-role="list-divider"]').forEach((li) => {
      const p = li.querySelector('p');
      if (p) texts[li.childNodes[0].textContent.trim()] = p.textContent.trim();
    });

    const pickLinks = Array.from(pg.querySelectorAll('a[href*="/pick/"]'))
      .map((a) => a.getAttribute('href'));
    const textPickLinks = Array.from(pg.querySelectorAll('a[href*="/simpletext/"]'))
      .map((a) => a.getAttribute('href'));

    const picked = Array.from(pg.querySelectorAll('li[data-icon="delete"]')).map((li) => {
      const first = li.querySelector('a');
      return first ? first.textContent.trim().replace(/\s+/g, ' ') : null;
    }).filter(Boolean);

    return { pools, texts, pickLinks, textPickLinks, picked };
  });
}

/** Remaining picks in a named creation pool, e.g. "Attributes" or "Skills". */
async function remainingPicks(page, characterId, poolLabel) {
  const state = await readCreationState(page, characterId);
  if (!state) return null;
  return Object.prototype.hasOwnProperty.call(state.pools, poolLabel) ? state.pools[poolLabel] : null;
}

/**
 * List the options a simpletext picker offers.
 * Works for both the creation-time and post-creation routes.
 */
async function listSimpleTextOptions(page, characterId, category, target, { duringCreation = true } = {}) {
  const prefix = duringCreation ? 'charactercreate/simpletext' : 'simpletext';
  await navigateToHash(page, `${prefix}/${category}/${target}/${characterId}/pick`, '#simpletext-new');
  return page.evaluate(() => {
    const pg = document.querySelector('#simpletext-new');
    if (!pg) return [];
    return Array.from(pg.querySelectorAll('ul li a'))
      .map((a) => a.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  });
}

/**
 * Pick a value in a simpletext picker by its visible name.
 * Passing no name takes the first available option, which is what most fixture
 * setup wants.
 */
async function pickSimpleText(page, characterId, category, target, optionName, { duringCreation = true } = {}) {
  const prefix = duringCreation ? 'charactercreate/simpletext' : 'simpletext';
  await navigateToHash(page, `${prefix}/${category}/${target}/${characterId}/pick`, '#simpletext-new');

  const link = optionName
    ? page.locator('#simpletext-new ul li a').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(optionName)}\\s*$`) }).first()
    : page.locator('#simpletext-new ul li a').first();

  const count = await page.locator('#simpletext-new ul li a').count();
  if (count === 0) {
    throw new Error(`simpletext picker for "${category}" offered no options; the Description category is probably unseeded`);
  }
  if (await link.count() === 0) {
    const available = await listSimpleTextOptions(page, characterId, category, target, { duringCreation });
    throw new Error(`"${optionName}" not offered by "${category}". Available: ${available.slice(0, 12).join(', ')}`);
  }

  await link.click();
  await waitForJqmLoader(page);
  return optionName || null;
}

/** Clear a previously picked simpletext value. */
async function unpickSimpleText(page, characterId, category, target, { duringCreation = true } = {}) {
  const prefix = duringCreation ? 'charactercreate/simpletext' : 'simpletext';
  await navigateToHash(page, `${prefix}/${category}/${target}/${characterId}/unpick`);
  await waitForJqmLoader(page);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pick a creation trait into the pool slot of the given free value.
 * `traitName` selects a specific option; omitting it takes the first.
 */
async function pickCreationTrait(page, characterId, category, freeValue, traitName) {
  await navigateToHash(
    page,
    `charactercreate/simpletraits/${category}/${characterId}/pick/${freeValue}`,
    '#character-create-simpletrait-new'
  );

  const items = page.locator('#character-create-simpletrait-new a.simpletrait');
  const total = await items.count();
  if (total === 0) {
    throw new Error(`creation picker for "${category}" at value ${freeValue} offered no options`);
  }

  const target = traitName
    ? page.locator(`#character-create-simpletrait-new a.simpletrait[name="${traitName.replace(/"/g, '\\"')}"]`).first()
    : items.first();

  if (await target.count() === 0) {
    const names = await items.evaluateAll((els) => els.slice(0, 12).map((e) => e.getAttribute('name')));
    throw new Error(`"${traitName}" not offered by "${category}" at value ${freeValue}. Available: ${names.join(', ')}`);
  }

  const chosen = await target.getAttribute('name');
  await target.click();
  await waitForJqmLoader(page);
  return chosen;
}

/**
 * Purchase a trait *post-creation*, the counterpart to `pickCreationTrait`
 * above for a character that has already left the wizard (or, per the
 * confirmed-live finding that these routes gate on nothing but a valid
 * character id, one that has not yet reached it either).
 *
 * Drives the real two-step UI: `#simpletraits/:category/:cid/new` lists the
 * offered Descriptions (SimpleTraitNewView, reading `DescriptionFetcher` -
 * see helpers/descriptions.js and helpers/rules.js for why that is the
 * `Description` class, never a `bnsmetv1_*Rule`/`bnsctdbs_KithRule` class);
 * clicking one navigates to `#simpletrait/spacer/.../new`
 * (`#simpletrait-change`), a confirmation page with a `.value-slider` /
 * `.free-slider` and a `.save` button that actually persists the purchase and
 * charges XP. `value`/`freeValue` default to whatever the picked option's own
 * href already encodes (its Description's `value` field, or 1 if it has
 * none) - pass them to spend at a specific level instead.
 */
async function purchaseTrait(page, characterId, category, traitName, { value, freeValue } = {}) {
  await navigateToHash(page, `simpletraits/${category}/${characterId}/new`, '#simpletrait-new');

  const link = page.locator(`#simpletrait-new a.simpletrait[name="${traitName.replace(/"/g, '\\"')}"]`).first();
  if (await link.count() === 0) {
    const available = await page.locator('#simpletrait-new a.simpletrait').evaluateAll((els) => els.map((e) => e.getAttribute('name')));
    throw new Error(`"${traitName}" not offered by the "${category}" picker. Available: ${available.slice(0, 20).join(', ')}`);
  }
  await link.click();
  await waitForActivePage(page, 'simpletrait-change');

  if (value !== undefined) {
    await setJqmSlider(page, '#simpletrait-changing .value-slider', value);
  }
  if (freeValue !== undefined) {
    await setJqmSlider(page, '#simpletrait-changing .free-slider', freeValue);
  }

  await page.locator('#simpletrait-changing .save').click();
  await waitForJqmLoader(page);
  // save_clicked defers the actual persistence (`_.defer(...)`) and then
  // navigates the hash on success; give the deferred save a moment to land
  // before anything reads the character back.
  await page.waitForTimeout(500);
  // Defensive: several routes in this app only hide the loading overlay
  // inside a `.fail(...)` branch, never unconditionally on success (see
  // clearStuckLoader in jqm-helpers.js) - cheap to clear defensively here too.
  await clearStuckLoader(page);
}

/** Read the character sheet's XP counters. */
async function readSheetXp(page, characterId) {
  await navigateToHash(page, `character?${characterId}`, '#character');
  return page.evaluate(() => {
    const pg = document.querySelector('#character');
    if (!pg) return null;
    const text = pg.textContent.replace(/\s+/g, ' ');
    const grab = (label) => {
      const m = text.match(new RegExp(label + ':\\s*(-?\\d+)'));
      return m ? parseInt(m[1], 10) : null;
    };
    return {
      earned: grab('Earned XP'),
      spent: grab('Spent XP'),
      available: grab('Available XP')
    };
  });
}

/**
 * True once the character has left the creation wizard.
 *
 * Completion is stored on the character's `creation` object, not on the
 * character itself (`Character.is_being_created` reads
 * `creation.get("completed")`), so checking `character.completed` silently
 * reports false forever.
 */
async function isCompleted(page, characterId, venue) {
  const { module } = resolveVenue(venue);
  return runInApp(page, [module], `
    return mods[0].get_character(arg.id, []).then(function (c) {
      return c.fetch_all_creation_elements().then(function () {
        return !c.is_being_created();
      });
    });
  `, { id: characterId });
}

/**
 * Drive Complete Character Creation and land on the live sheet.
 *
 * The completion route is fire-and-forget about its own save: it runs
 * `complete_character_creation()` inside a `.done()` callback, whose return
 * value is discarded, then immediately sets `window.location.hash`. The hash
 * therefore changes before the creation record has been written, and the sheet
 * route can run against a character that is still mid-save. So rather than wait
 * for a page transition, wait for the persisted completion flag and then
 * navigate to the sheet deliberately.
 */
async function completeCreation(page, characterId, venue = 'Vampire', { timeout = 30000 } = {}) {
  await navigateToHash(page, `charactercreate/complete/${characterId}`);
  await waitForJqmLoader(page);

  const deadline = Date.now() + timeout;
  let done = false;
  while (Date.now() < deadline) {
    done = await isCompleted(page, characterId, venue);
    if (done) break;
    await page.waitForTimeout(500);
  }

  if (!done) {
    const state = await readCreationState(page, characterId);
    const unspent = state ? Object.entries(state.pools).filter(([, n]) => n > 0) : [];
    throw new Error(
      'Complete Creation did not mark the creation record completed' +
      (unspent.length ? `; unspent pools: ${unspent.map(([k, v]) => `${k}=${v}`).join(', ')}` : '')
    );
  }

  await navigateToHash(page, `character?${characterId}`, '#character');
}

/**
 * The categories whose creation pool is a *point budget* rather than a count of
 * slots, as declared by the model itself (merits and flaws, named per venue).
 *
 * This distinction matters: for a slot pool the wizard renders one pick link per
 * remaining slot and each pick consumes exactly one. For a sum pool it renders
 * one link per remaining *point*, while each pick consumes that trait's own
 * value ("Ambidextrous x2" costs 2 of the 7). Treating the links as slots
 * overspends the budget and drives the pool negative, which corrupts the
 * character's spent XP.
 */
/** Read the remaining point budget for a sum pool straight off the creation object. */
async function readSumPoolRemaining(page, venue, characterId, category) {
  const { module } = resolveVenue(venue);
  return runInApp(page, [module], `
    return mods[0].get_character(arg.id, []).then(function (c) {
      return c.fetch_all_creation_elements().then(function () {
        return c.get('creation').get(arg.category + '_0_remaining');
      });
    });
  `, { id: characterId, category });
}

/**
 * Spend the creation pools the wizard still shows as outstanding.
 *
 * Rather than hardcode a pick order per venue, this reads the remaining
 * `pick/<value>` links off the page and follows them one at a time, re-reading
 * after each pick because the pools re-render. That keeps it correct for all
 * three venues and resilient to pool sizes changing.
 *
 * Sum pools (merits/flaws) are skipped by default. They are optional in play,
 * they cannot generally be spent to exactly zero, and overspending them is the
 * one way this loop can corrupt a character. Tests that exercise merits and
 * flaws drive them explicitly instead.
 */
async function spendAllCreationPools(page, characterId, options = {}) {
  const { maxPicks = 120, includeSumPools = false, venue = 'Vampire' } = options;
  const chosen = [];

  const sumCategories = new Set(
    await runInApp(page, [resolveVenue(venue).module], `
      return mods[0].get_character(arg.id, []).then(function (c) {
        return c.get_sum_creation_categories();
      });
    `, { id: characterId })
  );

  // Categories we have decided we cannot spend further, so the loop terminates
  // even while the wizard keeps rendering links for the leftover points.
  const blocked = new Set();
  if (!includeSumPools) {
    sumCategories.forEach((c) => blocked.add(c));
  }

  for (let i = 0; i < maxPicks; i++) {
    await openCreation(page, characterId);

    const next = await page.evaluate((blockedList) => {
      const pg = document.querySelector('#character-create');
      if (!pg) return null;
      const links = Array.from(pg.querySelectorAll('a[href*="/simpletraits/"][href*="/pick/"]'));
      for (const a of links) {
        const href = a.getAttribute('href');
        const m = href.match(/simpletraits\/([^/]+)\//);
        if (m && blockedList.indexOf(m[1]) !== -1) continue;
        return href;
      }
      return null;
    }, Array.from(blocked));

    if (!next) break;

    // href form: #charactercreate/simpletraits/<category>/<cid>/pick/<value>
    const m = next.match(/simpletraits\/([^/]+)\/([^/]+)\/pick\/(\d+)/);
    if (!m) throw new Error(`unrecognised creation pick link: ${next}`);
    const [, category, cid, value] = m;

    if (sumCategories.has(category)) {
      const budget = await readSumPoolRemaining(page, venue, characterId, category);
      const picked = await pickSumPoolTrait(page, cid, category, value, chosen, budget);
      if (picked === null) {
        // Nothing left that fits inside the remaining budget.
        blocked.add(category);
        continue;
      }
      chosen.push(`${category}:${picked}`);
    } else {
      const picked = await pickCreationTraitAvoiding(page, cid, category, value, chosen);
      chosen.push(`${category}:${picked}`);
    }
  }

  const state = await readCreationState(page, characterId);
  const remaining = state ? Object.entries(state.pools).filter(([, n]) => n > 0) : [];
  const overspent = state ? Object.entries(state.pools).filter(([, n]) => n < 0) : [];
  if (overspent.length > 0) {
    throw new Error(`creation overspent a pool: ${overspent.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  return { picks: chosen, remainingPools: remaining };
}

/**
 * Pick a sum-pool trait that fits inside `budget`.
 * Returns the chosen name, or null when nothing affordable is left.
 */
async function pickSumPoolTrait(page, characterId, category, freeValue, alreadyChosen, budget) {
  await navigateToHash(
    page,
    `charactercreate/simpletraits/${category}/${characterId}/pick/${freeValue}`,
    '#character-create-simpletrait-new'
  );

  // Options render as "Name xN"; N is what the pick costs against the budget.
  const options = await page.locator('#character-create-simpletrait-new a.simpletrait')
    .evaluateAll((els) => els.map((e) => {
      const name = e.getAttribute('name');
      const m = e.textContent.replace(/\s+/g, ' ').trim().match(/x(\d+)\s*$/);
      return { name, cost: m ? parseInt(m[1], 10) : 1 };
    }));

  if (options.length === 0) return null;

  const taken = new Set(
    alreadyChosen.filter((c) => c.startsWith(category + ':')).map((c) => c.slice(category.length + 1))
  );

  // Largest affordable pick first, so the budget lands on zero where possible.
  const affordable = options
    .filter((o) => !taken.has(o.name) && o.cost <= budget)
    .sort((a, b) => b.cost - a.cost);

  if (affordable.length === 0) return null;

  const pick = affordable[0];
  await page.locator(`#character-create-simpletrait-new a.simpletrait[name="${pick.name.replace(/"/g, '\\"')}"]`).first().click();
  await waitForJqmLoader(page);
  return pick.name;
}

/**
 * Pick a trait, skipping names already taken in this category.
 * The wizard rejects picking the same trait twice into one category, so a naive
 * "always take the first option" loop stalls on multi-slot pools.
 */
async function pickCreationTraitAvoiding(page, characterId, category, freeValue, alreadyChosen) {
  await navigateToHash(
    page,
    `charactercreate/simpletraits/${category}/${characterId}/pick/${freeValue}`,
    '#character-create-simpletrait-new'
  );

  const names = await page.locator('#character-create-simpletrait-new a.simpletrait')
    .evaluateAll((els) => els.map((e) => e.getAttribute('name')));

  if (names.length === 0) {
    throw new Error(`creation picker for "${category}" at value ${freeValue} offered no options`);
  }

  const taken = new Set(alreadyChosen.filter((c) => c.startsWith(category + ':')).map((c) => c.slice(category.length + 1)));
  const pick = names.find((n) => !taken.has(n)) || names[0];

  await page.locator(`#character-create-simpletrait-new a.simpletrait[name="${pick.replace(/"/g, '\\"')}"]`).first().click();
  await waitForJqmLoader(page);
  return pick;
}

/**
 * Create a character and drive the wizard all the way to a live sheet.
 *
 * `texts` maps a text target to the option to choose, e.g. `{ clan: 'Brujah' }`.
 * Anything not named is left for the caller to set; anything named but unseeded
 * throws with the category that has no Descriptions.
 */
async function createCompletedCharacter(page, venue, options = {}) {
  const { name, texts = {}, spendPools = true } = options;
  const character = await createCharacter(page, venue, name);

  for (const [target, value] of Object.entries(texts)) {
    const category = target + 's';
    await pickSimpleText(page, character.id, category, target, value, { duringCreation: true });
  }

  let poolResult = { picks: [], remainingPools: [] };
  if (spendPools) {
    poolResult = await spendAllCreationPools(page, character.id, {
      venue,
      includeSumPools: options.includeSumPools === true
    });
  }

  await completeCreation(page, character.id, venue);

  const xp = await readSheetXp(page, character.id);
  return Object.assign({}, character, { venue, xp, creationPicks: poolResult.picks });
}

/** Delete a character through the UI. */
async function deleteCharacter(page, characterId) {
  await navigateToHash(page, `character/${characterId}/delete`, '#character-delete');
  await page.locator('#character-delete .delete-character').click();
  await waitForJqmLoader(page);
}

module.exports = {
  CREATURE_TYPES,
  VENUE_POWER_CATEGORY,
  VENUE_BACKGROUND_CATEGORY,
  VENUE_MERIT_CATEGORY,
  VENUE_FLAW_CATEGORY,
  uniqueName,
  createCharacter,
  openCreation,
  readCreationState,
  remainingPicks,
  listSimpleTextOptions,
  pickSimpleText,
  unpickSimpleText,
  pickCreationTrait,
  purchaseTrait,
  pickCreationTraitAvoiding,
  spendAllCreationPools,
  pickSumPoolTrait,
  readSumPoolRemaining,
  completeCreation,
  isCompleted,
  readSheetXp,
  createCompletedCharacter,
  deleteCharacter
};
