/**
 * The Werewolf venue.
 *
 * Ports helpers/BNSWTAV1_WerewolfCosts.js and the venue half of
 * models/Werewolf.js. The static tables live in data.ts, which is generated
 * from that same model, so nothing here restates them.
 *
 * The werewolf analogue of the vampire's in-clan discipline is gift affinity.
 * A character's affinities are its breed, auspice and tribe plus whatever
 * `extra_affinity_links` names; a gift's affinities are the `affinity_1..3`
 * columns of its Description row. Overlap in one place is enough, and it is
 * worth 2 experience per level -- 4 rather than 6.
 */

import { Parse } from '../init';
import type { Character } from '../models/Character';
import { Description } from '../models/Description';
import type { SimpleTrait } from '../models/SimpleTrait';
import { traitsIn } from '../character/traits';
import { addExperienceNotation } from '../character/experience';
import { sumOfPicks } from '../character/creation';
import { venueData } from './data';
import { MAX_TRAIT_LEVEL, type CostEngine, type Venue, type VenueRulesLoader } from './types';

import WerewolfCosts, {
  type CostCharacter,
  type CostTrait,
} from '@yorick/venues/rules/WerewolfCosts';

/**
 * Every `wta_gifts` Description row, which is where gift affinities are stored.
 */
let _giftDescriptions: Parse.Object[] = [];

/**
 * Fetch gift descriptions once and share them.
 *
 * The legacy `initialize` pages through the same query with `each` and keeps the
 * rows in a Backbone collection for the life of the page. This is that cache,
 * shared rather than per-character, and the in-flight promise is kept so two
 * characters loading at once make one round trip instead of two.
 *
 * Also feeds the shared cost engine instance so it has rules to price against.
 */
async function loadGiftDescriptions(): Promise<void> {
  const rows: Parse.Object[] = [];
  await new Parse.Query(Description).equalTo('category', 'wta_gifts').each((row) => {
    rows.push(row);
  });
  _giftDescriptions = rows;
  sharedCosts.descriptions = rows as unknown as WerewolfCosts['descriptions'];
}

/** Rule loading: load gift descriptions once. */
const _rulesLoader: VenueRulesLoader = (() => {
  let loaded = false;
  let promise: Promise<void> | null = null;
  return {
    load: async () => {
      if (loaded) return;
      if (!promise) {
        promise = loadGiftDescriptions().catch(() => {
          promise = null;
          loaded = false;
          throw new Error('Failed to load werewolf gift descriptions');
        });
      }
      return promise;
    },
    get loaded() {
      return loaded;
    },
  };
})();

/**
 * Adapter: bridge React's CostCharacter to the shared CostCharacter interface.
 */
function costCharacter(character: Character, rank: number): CostCharacter {
  return {
    get: (attr: string) => character.get(attr),
    rank: () => rank,
  };
}

/**
 * Adapter: bridge React's CostTrait to the shared CostTrait interface.
 */
function costTrait(trait: SimpleTrait): CostTrait {
  return {
    get: (attr: string) => trait.get(attr),
    get_base_name: () => trait.baseName(),
  };
}

/**
 * The shared cost engine, initialised with loaded gift descriptions.
 */
const sharedCosts = new WerewolfCosts();

/**
 * Calculate the cost of a trait for this character.
 */
function calculateTraitCost(character: Character, trait: SimpleTrait, rank: number): number | undefined {
  return sharedCosts.calculate_trait_cost(costCharacter(character, rank), costTrait(trait));
}

/** The cost engine for this venue. */
const costs: CostEngine = {
  calculateTraitCost: (character, trait) => calculateTraitCost(character, trait, rankOf(character)),
  costTable: (costPerEntry) => Array.from({ length: MAX_TRAIT_LEVEL }, (_, i) => (i + 1) * costPerEntry),
  costOnTable: (table, value) => {
    if (value !== undefined && value !== null && value > table.length) return undefined;
    const levels = value === undefined || value === null ? 1 : Math.max(0, value);
    return table.slice(0, levels).reduce((total, e) => total + e, 0);
  },
  traitCostOnTable: (table, trait) => {
    const value = trait.get('value') as number | undefined;
    const freeValue = (trait.get('free_value') as number | undefined) || 0;
    const totalCost =
      value !== undefined && value !== null && value > table.length
        ? undefined
        : table
            .slice(0, value === undefined || value === null ? 1 : Math.max(0, value))
            .reduce((t, e) => t + e, 0);
    const freeCost =
      freeValue !== undefined && freeValue !== null && freeValue > table.length
        ? undefined
        : table
            .slice(0, freeValue === undefined || freeValue === null ? 1 : Math.max(0, freeValue))
            .reduce((t, e) => t + e, 0);
    if (totalCost === undefined || freeCost === undefined) return undefined;
    return totalCost - freeCost;
  },
};

/** The categories that have a creation pool. */
const CREATION_POOL_CATEGORIES = [
  'wta_flaws',
  'wta_merits',
  'focus_mentals',
  'focus_physicals',
  'focus_socials',
  'attributes',
  'skills',
  'wta_gifts',
  'wta_backgrounds',
];

/** The categories `calculate_total_cost` walks. */
const TOTAL_COST_CATEGORIES = ['skills', 'wta_backgrounds', 'wta_gifts', 'attributes', 'wta_merits'];

/* --------------------------------------------------------------- affinity -- */

/**
 * The affinities a character has: breed, auspice, tribe, plus extra links.
 *
 * Ports `get_affinities` on models/Werewolf.js. `wta_camp` and `wta_faction`
 * are text attributes too and are deliberately not affinities.
 */
export function affinitiesOf(character: Character): string[] {
  const named = ['wta_tribe', 'wta_auspice', 'wta_breed']
    .map((key) => character.get(key) as string | undefined)
    .filter((value): value is string => value !== undefined);

  const extra = traitsIn(character, 'extra_affinity_links')
    .map((trait) => trait.get('name') as string | undefined)
    .filter((value): value is string => value !== undefined);

  return [...named, ...extra];
}

/**
 * Whether this gift is on one of the character's affinity lists.
 *
 * A gift with no Description row is not an affinity -- the legacy code returns
 * false rather than throwing, so an unknown gift is charged the out-of-affinity
 * price instead of blocking the edit.
 *
 * Matched on `baseName`, so "Heightened Senses: Wolf" finds the row for
 * "Heightened Senses" -- the same reason the vampire engine compares both
 * forms.
 */
export function giftIsAffinity(character: Character, trait: SimpleTrait): boolean {
  const baseName = trait.baseName();
  const description = _giftDescriptions.find((row) => row.get('name') === baseName);
  if (!description) return false;

  const traitAffinities = [1, 2, 3]
    .map((i) => description.get(`affinity_${i}`) as string | undefined)
    .filter((value): value is string => Boolean(value));

  const characterAffinities = affinitiesOf(character);
  return traitAffinities.some((affinity) => characterAffinities.includes(affinity));
}

/**
 * A werewolf's Rank, which is stored as a background rather than as a field.
 *
 * Ports `_raw_rank` / `rank`. The loop keeps the LAST match rather than the
 * first, and that is preserved: nothing stops a sheet holding two traits whose
 * base name is "Rank" -- "Rank" and "Rank: Something" -- and which one wins
 * decides whether skills cost 1 or 2 per level.
 */
export function rankOf(character: Character): number {
  let rank: number | undefined;
  for (const background of traitsIn(character, 'wta_backgrounds')) {
    if (background.baseName() === 'Rank') rank = background.value;
  }
  return rank ?? 0;
}

/* --------------------------------------------------------------- the venue -- */

export const werewolfVenue: Venue = {
  name: 'Werewolf',
  data: venueData.Werewolf,
  costs,
  loadRules: _rulesLoader.load,
  maxTraitValue: (trait) => (trait.get('category') === 'skills' ? 10 : MAX_TRAIT_LEVEL),
  totalCostCategories: TOTAL_COST_CATEGORIES,
  sumCreationCategories: venueData.Werewolf.sumCreationCategories,

  async ensureCreationRulesExist(character: Character): Promise<void> {
    if (character.has('creation')) {
      try {
        await Parse.Object.fetchAllIfNeeded([character.get('creation') as Parse.Object]);
      } catch (error) {
        console.log('ensure_creation_rules_exist', error);
      }
      return;
    }

    const creation = new (Parse.Object.extend('VampireCreation'))();
    creation.set({
      owner: character,
      completed: false,
      concept: false,
      archetype: false,
      clan: false,
      attributes: false,
      focuses: false,
      skills_4_remaining: 1,
      skills_3_remaining: 2,
      skills_2_remaining: 3,
      skills_1_remaining: 4,
      wta_backgrounds_3_remaining: 1,
      wta_backgrounds_2_remaining: 1,
      wta_backgrounds_1_remaining: 1,
      wta_gifts_1_remaining: 3,
      attributes_7_remaining: 1,
      attributes_5_remaining: 1,
      attributes_3_remaining: 1,
      focus_mentals_1_remaining: 1,
      focus_socials_1_remaining: 1,
      focus_physicals_1_remaining: 1,
      wta_merits_0_remaining: 7,
      wta_flaws_0_remaining: 7,
      phase_1_finished: false,
      initial_xp: 30,
      phase_2_finished: false,
    });
    const saved = await creation.save();
    character.set('creation', saved);

    await addExperienceNotation(character, {
      reason: 'Character Creation XP',
      alteration_earned: 30,
      earned: 30,
    });
  },

  async updateCreationRulesForChangedTrait(
    character: Character,
    category: string,
    trait: SimpleTrait,
    freeValue: number,
  ): Promise<void> {
    const isSumCategory = venueData.Werewolf.sumCreationCategories.includes(category);

    if (!isSumCategory && !freeValue) return;
    if (!CREATION_POOL_CATEGORIES.includes(category)) return;

    const pointer = character.get('creation') as Parse.Object | undefined;
    if (!pointer) return;
    const [creation] = await Parse.Object.fetchAllIfNeeded([pointer]);
    if (!creation) return;
    if (creation.get('completed')) return;

    const remainingName = `${category}_${freeValue}_remaining`;
    const picksName = `${category}_${freeValue}_picks`;
    creation.addUnique(picksName, trait);

    if (isSumCategory) {
      const picks = (creation.get(picksName) as SimpleTrait[] | undefined) ?? [];
      const sum = await sumOfPicks(picks, trait);
      creation.set(remainingName, 7 - sum);
    } else {
      creation.increment(remainingName, -1);
    }
  },
};
