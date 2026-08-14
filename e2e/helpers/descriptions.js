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

const { navigateToHash } = require('./jqm-helpers');

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

/** Options offered by a trait category's "new" picker. */
async function listTraitPickerOptions(page, characterId, category) {
  await navigateToHash(page, `simpletraits/${category}/${characterId}/new`);
  return page.evaluate(() => {
    const pg = document.querySelector('.ui-page-active');
    if (!pg) return [];
    return Array.from(pg.querySelectorAll('a.simpletrait, ul li a'))
      .map((a) => (a.getAttribute('name') || a.textContent).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  });
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
  listSheetCategories
};
