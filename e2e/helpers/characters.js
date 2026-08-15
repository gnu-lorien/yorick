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
  selectBackformOption,
  runInApp
} = require('./jqm-helpers');

/**
 * Wait until the hash no longer contains `fragment`.
 *
 * Every mutating step in the creation wizard and the trait editor is
 * fire-and-forget from the DOM's point of view: the view's click handler runs
 * an async Parse chain and only then assigns `window.location.hash`. Nothing
 * about the page changes in the meantime, so there is no element state to wait
 * on - the hash moving off the action URL *is* the completion signal, and it is
 * emitted after the save has resolved (see `CharacterCreateSimpleTraitNewView.
 * clicked`, `SimpleTextNewView.clicked`, `SimpleTraitChangeView.save_clicked`
 * and the `charactercreateunpick*` routes, all of which assign the hash from
 * inside a `.done()`/`.then()` on the persisting promise).
 *
 * Waiting on it replaces the fixed `waitForTimeout` sleeps this module used to
 * carry, which were both slower and unreliable under load.
 */
async function waitForHashToLeave(page, fragment, timeout = 30000) {
  await page.waitForFunction(
    (f) => window.location.hash.indexOf(f) === -1,
    fragment,
    { timeout }
  );
}

/**
 * Wait for the page a pick/unpick action redirects to once its own save has
 * resolved: `#character-create` for every creation-time action, `#character`
 * for the post-creation (`duringCreation: false`) simpletext actions.
 *
 * Confirmed live as a genuine race, not a hypothetical one: the redirect
 * target itself runs a *second* asynchronous route handler (`charactercreate`
 * fetches the character, calls `fetch_all_creation_elements()`, then calls
 * `$.mobile.changePage`), which briefly hides the jQuery Mobile loader between
 * its own `.show()`/work/`.hide()` - a window `waitForJqmLoader` alone can
 * observe as "done" before that second handler has actually finished. Chaining
 * two picks back to back (no assertion in between to absorb the gap) lands the
 * second pick's navigation while the *first* pick's destination page is still
 * mid-render, so it reads whatever the previously-active page last showed.
 * Reproduced by picking Breed then immediately Auspice on a fresh Werewolf:
 * the Auspice picker rendered the stale Breed options ("Homid, Lupus, Metis")
 * until this wait was added. `createCompletedCharacter`'s `texts` loop and
 * `spendAllCreationPools`'s pick loop both fire picks back to back with no
 * caller-side assertion between them, so both need this, not just tests that
 * happen to chain calls themselves.
 */
async function settleAfterRedirect(page, duringCreation) {
  await waitForActivePage(page, duringCreation ? 'character-create' : 'character');
}

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
 *
 * Returns the name actually chosen - read off the clicked option rather than
 * echoed back from the argument - so a caller that let the helper choose can
 * still assert the round trip against a real value.
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

  // The template puts the Description's name on the anchor's `name` attribute
  // and uses it verbatim as the stored value, so this is the value that is
  // about to be written, not merely its rendered label.
  const chosen = (await link.getAttribute('name')) || normalize(await link.textContent());

  await link.click();
  await waitForHashToLeave(page, '/pick');
  await waitForJqmLoader(page);
  await settleAfterRedirect(page, duringCreation);
  return chosen;
}

/** Clear a previously picked simpletext value. */
async function unpickSimpleText(page, characterId, category, target, { duringCreation = true } = {}) {
  const prefix = duringCreation ? 'charactercreate/simpletext' : 'simpletext';
  await navigateToHash(page, `${prefix}/${category}/${target}/${characterId}/unpick`);
  await waitForHashToLeave(page, '/unpick');
  await waitForJqmLoader(page);
  await settleAfterRedirect(page, duringCreation);
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
  await waitForHashToLeave(page, '/pick');
  await waitForJqmLoader(page);
  await settleAfterRedirect(page, true);
  return chosen;
}

/**
 * List what the *creation* picker offers for one pool slot, without picking.
 *
 * This is how the in-clan discipline gate is observed: the wizard hands
 * `CharacterCreateSimpleTraitNewView` a `"in clan disciplines"` filter rule, but
 * that filter is a no-op while the character has no clan (`if (0 != icd.length)`
 * in its `render`), so a clanless Vampire is offered the entire discipline
 * catalogue.
 */
async function listCreationTraitOptions(page, characterId, category, freeValue) {
  await navigateToHash(
    page,
    `charactercreate/simpletraits/${category}/${characterId}/pick/${freeValue}`,
    '#character-create-simpletrait-new'
  );
  return page.locator('#character-create-simpletrait-new a.simpletrait')
    .evaluateAll((els) => els.map((e) => e.getAttribute('name')));
}

/**
 * How many pick affordances the wizard currently renders for one pool slot.
 *
 * Pool enforcement in this app is presentational: each section template emits
 * `_.range(creation.get(category + "_" + i + "_remaining"))` links, so an
 * exhausted slot simply stops rendering one. (The route behind the link is not
 * itself guarded - see the suite notes.) Counting the affordances is therefore
 * the honest measure of "can a player spend this slot again".
 */
async function countCreationPickLinks(page, characterId, category, freeValue) {
  await openCreation(page, characterId);
  return page.evaluate(({ cid, cat, value }) => {
    const wanted = `#charactercreate/simpletraits/${cat}/${cid}/pick/${value}`;
    return Array.from(document.querySelectorAll('#character-create a[href]'))
      .filter((a) => a.getAttribute('href') === wanted).length;
  }, { cid: characterId, cat: category, value: freeValue });
}

/**
 * Remove a creation pick by clicking the Delete link the wizard renders beside
 * it, which is the only unpick affordance a player has.
 *
 * Each picked row is `<li data-icon="delete">` with two anchors: an inert label
 * (`href="javascript: void(0)"`) carrying `Name xValue`, and the real
 * `.../unpick/:stid/:i` link. The trait id is read out of the rendered link
 * rather than tracked by the caller, so nothing here depends on a Parse id the
 * test had to remember.
 */
async function unpickCreationTrait(page, characterId, category, traitName) {
  await openCreation(page, characterId);

  const href = await page.evaluate(({ cat, name }) => {
    const pg = document.querySelector('#character-create');
    if (!pg) return null;
    const rows = Array.from(pg.querySelectorAll('li[data-icon="delete"]'));
    for (const li of rows) {
      const label = li.querySelector('a');
      if (!label) continue;
      const text = label.textContent.replace(/\s+/g, ' ').trim();
      if (text !== name && text.indexOf(name + ' x') !== 0) continue;
      const del = Array.from(li.querySelectorAll('a[href]'))
        .map((a) => a.getAttribute('href'))
        .find((h) => h && h.indexOf(`/simpletraits/${cat}/`) !== -1 && h.indexOf('/unpick/') !== -1);
      if (del) return del;
    }
    return null;
  }, { cat: category, name: traitName });

  if (!href) {
    const state = await readCreationState(page, characterId);
    throw new Error(
      `no creation Delete affordance for "${traitName}" in "${category}". ` +
      `Currently picked: ${state ? state.picked.join(', ') : 'unreadable'}`
    );
  }

  await page.locator(`#character-create a[href="${href}"]`).first().click();
  await waitForHashToLeave(page, '/unpick');
  await waitForJqmLoader(page);
  await settleAfterRedirect(page, true);
  return href;
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
  await openNewTraitChange(page, characterId, category, traitName);
  await setTraitChangeSliders(page, { value, freeValue });
  await saveTraitChange(page, characterId, category);
}

/**
 * Open the "buy a new trait" confirmation page and stop there.
 *
 * Splitting this out of `purchaseTrait` is what makes the cost of a purchase
 * observable *before* committing to it: `#simpletrait-change` renders
 * `character.calculate_trait_to_spend(trait)` live on every slider change, so a
 * test can read the price the player is shown at each value and then walk away
 * without spending anything.
 */
async function openNewTraitChange(page, characterId, category, traitName) {
  await navigateToHash(page, `simpletraits/${category}/${characterId}/new`, '#simpletrait-new');

  // Werewolf's "wta_gifts" (and only that category) renders an extra
  // `GiftsForm` filter above the list (`SimpleTraitNewView.js`), whose
  // "Show by Affinity" control defaults to "Mine" -
  // `gift_filter_options` is constructed with `{"affinities": "mine", ...}`
  // and `templateHelpers` re-filters the list down to
  // `get_affinity_items()` whenever that is set. A non-affinity Gift is
  // therefore not even rendered, let alone findable by name, until this is
  // switched to "Any". Every other category (Vampire's disciplines
  // included) never renders `#category-filter-rules`, so this is a no-op
  // there - confirmed harmless by re-running the Vampire suite after adding
  // it here.
  const affinityFilter = page.locator('#category-filter-rules select[name="affinities"]');
  if (await affinityFilter.count() > 0) {
    await selectBackformOption(page, '#category-filter-rules select[name="affinities"]', 'Any');
  }

  const link = page.locator(`#simpletrait-new a.simpletrait[name="${traitName.replace(/"/g, '\\"')}"]`).first();
  if (await link.count() === 0) {
    const available = await page.locator('#simpletrait-new a.simpletrait').evaluateAll((els) => els.map((e) => e.getAttribute('name')));
    throw new Error(`"${traitName}" not offered by the "${category}" picker. Available: ${available.slice(0, 20).join(', ')}`);
  }
  await link.click();
  await waitForActivePage(page, 'simpletrait-change');
}

/**
 * Open the change page for a trait the character already owns, via the real
 * category listing (`#simpletraits/:category/:cid/all`) rather than by
 * assembling the `#simpletrait/...` URL from an id the test was holding.
 */
async function openTraitChange(page, characterId, category, traitName) {
  await navigateToHash(page, `simpletraits/${category}/${characterId}/all`, '#simpletraitcategory-all');

  const rows = await page.locator(`#simpletraitcategory-all a[href^="#simpletrait/${category}/${characterId}/"]`)
    .evaluateAll((els) => els.map((e) => ({ href: e.getAttribute('href'), text: e.textContent.replace(/\s+/g, ' ').trim() })));

  const row = rows.find((r) => r.text === traitName || r.text.indexOf(traitName + ' x') === 0);
  if (!row) {
    throw new Error(
      `"${traitName}" is not listed in the "${category}" category for this character. ` +
      `Listed: ${rows.map((r) => r.text).join(', ') || '(none)'}`
    );
  }

  await page.locator(`#simpletraitcategory-all a[href="${row.href}"]`).first().click();
  await waitForActivePage(page, 'simpletrait-change');
  return row.text;
}

/** Move the change page's value / free-value sliders (either may be omitted). */
async function setTraitChangeSliders(page, { value, freeValue } = {}) {
  if (value !== undefined) {
    await setJqmSlider(page, '#simpletrait-changing .value-slider', value);
  }
  if (freeValue !== undefined) {
    await setJqmSlider(page, '#simpletrait-changing .free-slider', freeValue);
  }
}

/**
 * The numbers the change page is currently showing the player.
 *
 * `Cost` is `calculate_trait_to_spend` - the *delta* that saving would charge,
 * not the trait's absolute cost - which is exactly the quantity the
 * "an upgrade charges only the increment" requirement is about.
 */
async function readTraitChangeView(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#simpletrait-viewing');
    if (!el) return null;
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    const grab = (label) => {
      const m = text.match(new RegExp(label + ':\\s*(-?\\d+)'));
      return m ? parseInt(m[1], 10) : null;
    };
    return {
      text,
      cost: grab('Cost'),
      available: grab('Available XP'),
      final: grab('Final')
    };
  });
}

/**
 * Sweep the value slider 1..max and record the cost the page displays at each
 * step. Nothing is saved.
 */
async function readTraitCostProgression(page, maxValue) {
  const progression = [];
  for (let v = 1; v <= maxValue; v++) {
    await setJqmSlider(page, '#simpletrait-changing .value-slider', v);
    const view = await readTraitChangeView(page);
    progression.push(view ? view.cost : null);
  }
  return progression;
}

/**
 * Commit the change page.
 *
 * `save_clicked` defers the persistence (`_.defer`) and, only once
 * `update_trait` has resolved - after the character save *and* the experience
 * notation it triggers - assigns `window.location.hash` to the category
 * listing. Waiting for that assignment is a real completion signal for the
 * whole write, which a fixed sleep never was.
 */
async function saveTraitChange(page, characterId, category, { timeout = 30000 } = {}) {
  const settled = `#simpletraits/${category}/${characterId}/all`;
  await page.locator('#simpletrait-changing .save').click();
  await page.waitForFunction((h) => window.location.hash === h, settled, { timeout });
  await waitForJqmLoader(page);
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
 * Read the sheet's own text-attribute block (`Clan`, `Title`, ...).
 *
 * The sheet renders these only `if (!character.is_being_created())`, so an
 * empty result on an incomplete character is the template behaving correctly,
 * not a read failure. Note the labels differ from the wizard's: the sheet
 * capitalises the attribute name (`Antecedence`), the wizard uses the model's
 * pretty name (`Primary, Secondary, or NPC`).
 */
async function readSheetTextAttributes(page, characterId) {
  await navigateToHash(page, `character?${characterId}`, '#character');
  return page.evaluate(() => {
    const pg = document.querySelector('#character');
    if (!pg) return null;
    const out = {};
    pg.querySelectorAll('li[data-role="list-divider"]').forEach((li) => {
      const p = li.querySelector('p');
      if (p && li.childNodes[0]) out[li.childNodes[0].textContent.trim()] = p.textContent.trim();
    });
    return out;
  });
}

/** Assertion-side read-back of one trait category: name, value, free value, stored cost. */
async function readTraits(page, characterId, category, venue = 'Vampire') {
  const { module } = resolveVenue(venue);
  return runInApp(page, [module], `
    return mods[0].get_character(arg.id, [arg.category]).then(function (c) {
      return _.map(c.get(arg.category) || [], function (t) {
        return {
          id: t.id,
          name: t.get("name"),
          value: t.get("value"),
          free_value: t.get("free_value") || 0,
          cost: t.get("cost") || 0
        };
      });
    });
  `, { id: characterId, category });
}

/** Assertion-side read-back of the character's stored text attributes. */
async function readCharacterTexts(page, characterId, venue = 'Vampire') {
  const { module } = resolveVenue(venue);
  return runInApp(page, [module], `
    return mods[0].get_character(arg.id, []).then(function (c) {
      var out = {};
      _.each(c.all_text_attributes(), function (t) {
        out[t] = _.isUndefined(c.get(t)) ? null : c.get(t);
      });
      return out;
    });
  `, { id: characterId });
}

/**
 * Assertion-side read-back of every field on the creation record.
 *
 * Returned verbatim except that pick arrays collapse to their length and
 * pointers to their id, so a test can assert on `*_remaining` counters and on
 * *which keys exist* - the latter matters because one confirmed defect writes
 * its counter under a `<category>_undefined_remaining` key.
 */
async function readCreation(page, characterId, venue = 'Vampire') {
  const { module } = resolveVenue(venue);
  return runInApp(page, [module], `
    return mods[0].get_character(arg.id, []).then(function (c) {
      return c.fetch_all_creation_elements().then(function () {
        var cr = c.get("creation");
        var out = {};
        _.each(_.keys(cr.attributes), function (k) {
          var v = cr.get(k);
          if (_.isArray(v)) { out[k] = v.length; }
          else if (_.isDate(v)) { out[k] = v.toISOString(); }
          else if (_.isObject(v) && v.id) { out[k] = v.id; }
          else { out[k] = v; }
        });
        return out;
      });
    });
  `, { id: characterId });
}

/** Assertion-side read-back of the in-clan discipline list the cost engine uses. */
async function readInClanDisciplines(page, characterId) {
  return runInApp(page, ['app/models/Vampire'], `
    return mods[0].get_character(arg.id, "all").then(function (c) {
      return {
        clan: c.get("clan") || null,
        inClan: _.without(c.get_in_clan_disciplines(), undefined),
        generation: c.generation(),
        hasGeneration: c.has_generation()
      };
    });
  `, { id: characterId });
}

/**
 * Assertion-side read-back of the Gift affinity list `BNSWTAV1_WerewolfCosts.
 * gift_is_affinity` intersects against a Gift Description's `affinity_1..3`.
 *
 * `Werewolf.get_affinities()` (models/Werewolf.js) is `[wta_tribe, wta_
 * auspice, wta_breed].concat(extra_affinity_links names)`, filtered of
 * `undefined` - the Werewolf analogue of `get_in_clan_disciplines()` above.
 */
async function readAffinities(page, characterId) {
  return runInApp(page, ['app/models/Werewolf'], `
    return mods[0].get_character(arg.id, "all").then(function (c) {
      return {
        breed: c.get("wta_breed") || null,
        auspice: c.get("wta_auspice") || null,
        tribe: c.get("wta_tribe") || null,
        affinities: _.without(c.get_affinities(), undefined)
      };
    });
  `, { id: characterId });
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
 *
 * Does not call `settleAfterRedirect` - see the doc comment on
 * `pickCreationTraitAvoiding` just below, which this shares its caller
 * (`spendAllCreationPools`) and its reasoning with.
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
  await waitForHashToLeave(page, '/pick');
  await waitForJqmLoader(page);
  // Deliberately not `settleAfterRedirect` here - see `pickCreationTraitAvoiding`.
  return pick.name;
}

/**
 * Pick a trait, skipping names already taken in this category.
 * The wizard rejects picking the same trait twice into one category, so a naive
 * "always take the first option" loop stalls on multi-slot pools.
 *
 * Deliberately does *not* call `settleAfterRedirect` the way `pickCreationTrait`
 * does. This is the picker `spendAllCreationPools`'s greedy loop drives, which
 * has no way to know a given trait name carries `requires_specialization` (the
 * same landmine both creation suites' own test-picked names document avoiding)
 * - and unlike a normal pick, that redirects to `#simpletrait-specialization`,
 * never to `#character-create`. Waiting for one specific destination page
 * would hang for every such pick. It does not need to: the caller's loop
 * re-navigates via `openCreation` (a real, targeted wait) at the top of every
 * iteration regardless of which page a previous pick left active, so the
 * plain "hash left /pick, loader cleared" wait already used below is
 * sufficient here - confirmed live by the regression this exemption fixes
 * (`admin-rules.spec.js`'s unguarded `createCompletedCharacter('Vampire')`
 * call, which happens to pick a specialization-requiring skill).
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
  await waitForHashToLeave(page, '/pick');
  await waitForJqmLoader(page);
  // Deliberately not `settleAfterRedirect` here - see the doc comment above.
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

/**
 * Drive the UI's "Delete Character" action.
 *
 * Note what that action actually does: `CharacterDeleteView.delete` calls
 * `Character.archive()`, which only unsets `owner` and saves - the Parse row
 * survives. That is a faithful automation of the real button, but it makes this
 * useless for fixture teardown; destroy the rows directly instead (all three
 * venues live in the Parse class `"Vampire"`).
 */
async function deleteCharacter(page, characterId) {
  await navigateToHash(page, `character/${characterId}/delete`, '#character-delete');
  await page.locator('#character-delete .delete-character').click();
  await waitForJqmLoader(page);
}

/**
 * Count the characters whose name starts with `prefix`.
 *
 * All three creature types are rows of the Parse class `"Vampire"` -
 * models/Werewolf.js and models/ChangelingBetaSlice.js both declare
 * `Parse.Object.extend("Vampire", ...)`, and `type` is only an attribute - so
 * one query covers every venue.
 */
async function countCharactersByPrefix(page, prefix) {
  return page.evaluate((p) => {
    const q = new window.Parse.Query('Vampire');
    q.startsWith('name', p);
    return q.count();
  }, prefix);
}

/**
 * Destroy every character whose name starts with `prefix`, together with the
 * rows that hang off it.
 *
 * Keyed by query rather than by ids held in memory so a crashed run still
 * cleans up on the next one. The child classes all carry an `owner` pointer at
 * the character (SimpleTrait, ExperienceNotation, VampireCreation,
 * VampireChange), so they can be swept in the same pass instead of being
 * orphaned.
 */
async function destroyCharactersByPrefix(page, prefix) {
  return page.evaluate(async (p) => {
    const Parse = window.Parse;

    /**
     * `destroyAll` reports an opaque aggregate error if any object in the batch
     * fails, which says nothing about which one or why, so fall back to
     * per-object destroys and keep the real messages.
     */
    const destroyRows = async (label, rows, result) => {
      if (!rows.length) return;
      try {
        await Parse.Object.destroyAll(rows);
        result.children += rows.length;
        return;
      } catch (e) {
        // fall through to the per-object pass
      }
      for (const row of rows) {
        try {
          await row.destroy();
          result.children += 1;
        } catch (e) {
          const message = e && e.message ? e.message : String(e);
          result.errors.push(`${label}/${row.id}: ${message}`);
        }
      }
    };

    const q = new Parse.Query('Vampire');
    q.startsWith('name', p);
    q.limit(1000);
    const characters = await q.find();
    const result = { characters: characters.length, children: 0, errors: [] };
    if (characters.length === 0) return result;

    // `VampireChange` is deliberately not swept. It is the audit log, and its
    // class-level permissions in database_seed/_SCHEMA.json grant `delete` only
    // to `role:SiteAdministrator` - not to `Administrator`, which is the highest
    // role the seeded accounts hold - so every client-side delete comes back
    // "Permission denied for action delete on class VampireChange". Attempting
    // it just produces one error per row. Its rows are also *generated* by
    // teardown: `beforeDelete("SimpleTrait")` (cloud/main.js) writes a fresh
    // "remove" entry for each trait destroyed, so they could not be swept ahead
    // of the traits either. Counted in `historyRowsLeft` so the residue is
    // visible rather than silent.
    const sweep = async (className) => {
      const cq = new Parse.Query(className);
      cq.containedIn('owner', characters);
      cq.limit(1000);
      await destroyRows(className, await cq.find(), result);
    };

    for (const className of ['SimpleTrait', 'ExperienceNotation', 'VampireCreation']) {
      try {
        await sweep(className);
      } catch (e) {
        result.errors.push(className + ' query: ' + (e && e.message ? e.message : String(e)));
      }
    }

    try {
      const hq = new Parse.Query('VampireChange');
      hq.containedIn('owner', characters);
      result.historyRowsLeft = await hq.count();
    } catch (e) {
      result.errors.push('VampireChange count: ' + (e && e.message ? e.message : String(e)));
    }

    try {
      await Parse.Object.destroyAll(characters);
    } catch (e) {
      result.errors.push('Vampire: ' + (e && e.message ? e.message : String(e)));
    }
    return result;
  }, prefix);
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
  listCreationTraitOptions,
  countCreationPickLinks,
  unpickCreationTrait,
  purchaseTrait,
  openNewTraitChange,
  openTraitChange,
  setTraitChangeSliders,
  readTraitChangeView,
  readTraitCostProgression,
  saveTraitChange,
  pickCreationTraitAvoiding,
  spendAllCreationPools,
  pickSumPoolTrait,
  readSumPoolRemaining,
  completeCreation,
  isCompleted,
  readSheetXp,
  readSheetTextAttributes,
  readTraits,
  readCharacterTexts,
  readCreation,
  readInClanDisciplines,
  readAffinities,
  createCompletedCharacter,
  deleteCharacter,
  countCharactersByPrefix,
  destroyCharactersByPrefix
};
