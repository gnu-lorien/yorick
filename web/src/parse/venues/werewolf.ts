import { Parse } from '../init';
import type { Character } from '../models/Character';
import { Description } from '../models/Description';
import type { SimpleTrait } from '../models/SimpleTrait';
import { traitsIn } from '../character/traits';
import { addExperienceNotation } from '../character/experience';
import { sumOfPicks } from '../character/creation';
import { venueData } from './data';
import { MAX_TRAIT_LEVEL, type CostEngine, type Venue } from './types';

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

/**
 * Categories that genuinely cost nothing: focus tracks, expended pools,
 * skill/background specializations, and the link categories that only record
 * affinities.
 *
 * Listing them explicitly is what lets an *unlisted* category be treated as a
 * missing rule rather than as free -- the zero-versus-undefined distinction
 * CostEngine.calculateTraitCost documents. BNSWTAV1_WerewolfCosts.js is the
 * file the vampire engine's own comment points at for the explanation.
 */
const FREE_CATEGORIES = [
  'focus_physicals',
  'focus_mentals',
  'focus_socials',
  'health_levels',
  'willpower_sources',
  'wta_gnosis_sources',
  'lore_specializations',
  'academics_specializations',
  'drive_specializations',
  'linguistics_specializations',
  'extra_affinity_links',
  'wta_territory_specializations',
  'contacts_specializations',
  'allies_specializations',
  'influence_elite_specializations',
  'influence_underworld_specializations',
  'wta_monikers',
  'wta_totem_bonus_traits',
];

/**
 * The categories that have a creation pool.
 *
 * From the second guard in `update_creation_rules_for_changed_trait`, which the
 * legacy source marks `FIXME Move to the creation model`. It is narrower than
 * "every category with a free value": a Rite or a Moniker can carry one and
 * still has no pool to spend it from, and writing
 * `wta_rites_1_remaining` would invent a counter the wizard never seeded.
 */
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

/** The categories `calculate_total_cost` walks. Deliberately not all of them. */
const TOTAL_COST_CATEGORIES = ['skills', 'wta_backgrounds', 'wta_gifts', 'attributes', 'wta_merits'];

/* ------------------------------------------------------------------ rules -- */

/**
 * Every `wta_gifts` Description row, which is where gift affinities are stored.
 *
 * The legacy `initialize` pages through the same query with `each` and keeps the
 * rows in a Backbone collection for the life of the page. This is that cache,
 * shared rather than per-character, and the in-flight promise is kept so two
 * characters loading at once make one round trip instead of two.
 */
let giftDescriptions: Description[] = [];
let loading: Promise<void> | undefined;

async function loadGiftDescriptions(): Promise<void> {
  const rows: Description[] = [];
  await new Parse.Query(Description).equalTo('category', 'wta_gifts').each((row) => {
    rows.push(row);
  });
  giftDescriptions = rows;
}

function loadRules(): Promise<void> {
  if (!loading) {
    loading = loadGiftDescriptions().catch((error: unknown) => {
      // A failed load must not leave a rejected promise cached as "loaded":
      // every later character would then fail with the first one's error.
      loading = undefined;
      throw error;
    });
  }
  return loading;
}

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
  const description = giftDescriptions.find((row) => row.get('name') === baseName);
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

/* ------------------------------------------------------------------ costs -- */

const costs: CostEngine = {
  costTable(costPerEntry: number): number[] {
    return Array.from({ length: MAX_TRAIT_LEVEL }, (_unused, i) => (i + 1) * costPerEntry);
  },

  costOnTable(table: number[], value: number): number | undefined {
    if (value > table.length) {
      // Never under-charge in silence. `_.take` would return the whole table
      // and read as a correct total; an unusable number is refused out loud by
      // updateTrait. See MAX_TRAIT_LEVEL for how the plateau went unnoticed.
      return undefined;
    }
    // `_.take` with a negative count yields nothing, where slice would count
    // back from the end and total the wrong rows.
    return table.slice(0, Math.max(0, value)).reduce((total, entry) => total + entry, 0);
  },

  traitCostOnTable(table: number[], trait: SimpleTrait): number | undefined {
    const total = costs.costOnTable(table, trait.value);
    const free = costs.costOnTable(table, trait.freeValue);
    if (total === undefined || free === undefined) return undefined;
    return total - free;
  },

  calculateTraitCost(character: Character, trait: SimpleTrait): number | undefined {
    const category = trait.category;
    const modValue = trait.value - trait.freeValue;
    const experienceCostType = trait.get('experience_cost_type') as string | undefined;
    const experienceCostModifier = parseInt(String(trait.get('experience_cost_modifier')), 10);

    // A per-trait rule beats the category's, and is checked before it.
    if (experienceCostType === 'flat') {
      return modValue * experienceCostModifier;
    } else if (experienceCostType === 'linear') {
      return costs.traitCostOnTable(costs.costTable(experienceCostModifier), trait);
    }

    if (category === 'attributes') {
      return modValue * 3;
    }

    if (category === 'wta_gifts') {
      return giftIsAffinity(character, trait) ? modValue * 4 : modValue * 6;
    }

    if (category === 'wta_merits') {
      return modValue;
    }

    if (category === 'wta_flaws') {
      // Negative on purpose: a flaw refunds experience rather than costing it.
      return modValue * -1;
    }

    if (category === 'wta_backgrounds') {
      return costs.traitCostOnTable(costs.costTable(2), trait);
    }

    // Rites are the Werewolf analogue of the Vampire's Rituals, which this
    // codebase prices at 2 experience per level (BNSMETV1_VampireCosts,
    // "rituals"), and the model already files them under the same print section
    // as Backgrounds. Before this branch existed the cost resolved to
    // `undefined` and update_trait's `_.isFinite` guard zeroed it, so every Rite
    // was silently free.
    if (category === 'wta_rites') {
      return modValue * 2;
    }

    if (category === 'skills') {
      // Rank 3 and above doubles the price of every skill level, including the
      // ones already bought: the whole table changes, not the next step.
      const table = costs.costTable(rankOf(character) >= 3 ? 2 : 1);
      return costs.traitCostOnTable(table, trait);
    }

    if (FREE_CATEGORIES.includes(category)) {
      return 0;
    }

    // Deliberately `undefined`, not 0: there is no rule for this category, which
    // is a different thing from a rule that says "free". updateTrait turns this
    // into a visible refusal rather than a silent giveaway.
    return undefined;
  },
};

/* --------------------------------------------------------------- creation -- */

/**
 * The pool counters the wizard starts a werewolf with.
 *
 * Straight from `ensure_creation_rules_exist`. The field names are
 * `<category>_<freeValue>_remaining`, so this table also states which free
 * values each category offers -- one skill at 4, two at 3, three at 2, four at
 * 1; three gifts at 1; one background each at 3, 2 and 1.
 */
const CREATION_DEFAULTS: Record<string, number | boolean> = {
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
};

/**
 * The sum pools' budget: 7 points of merits, 7 of flaws.
 *
 * The same number seeds `wta_merits_0_remaining` above and recomputes it below,
 * and creation.ts's `releaseCreationPickForTrait` has its own copy. They must
 * agree, which is why it is named here rather than written as a bare 7 twice.
 */
const SUM_POOL_BUDGET = 7;

/**
 * `clan: false` on a werewolf's creation record is not a mistake to fix.
 *
 * All three venues seed the same VampireCreation class, and the werewolf wizard
 * writes its breed, auspice and tribe flags through `updateText` under their own
 * names. The `clan` flag is simply never read for a werewolf. Dropping it would
 * change the row's shape for no gain and break nothing visible either way, so it
 * is kept exactly as the legacy model writes it.
 */
async function ensureCreationRulesExist(character: Character): Promise<void> {
  if (character.has('creation')) {
    try {
      await Parse.Object.fetchAllIfNeeded([character.get('creation') as Parse.Object]);
    } catch (error) {
      // Logged and swallowed, as the legacy `.then(success, failure)` does: a
      // creation record that cannot be fetched must not stop the sheet loading.
      console.log('ensure_creation_rules_exist', error);
    }
    return;
  }

  const creation = new (Parse.Object.extend('VampireCreation'))();
  creation.set({ owner: character, ...CREATION_DEFAULTS });
  const saved = await creation.save();
  character.set('creation', saved);

  // A ledger entry, so it must not be granted twice -- which is what the
  // `has("creation")` return above is really guarding. All three venues grant
  // the same 30 with the same reason.
  await addExperienceNotation(character, {
    reason: 'Character Creation XP',
    alteration_earned: 30,
    earned: 30,
  });
}

/**
 * Spend a creation pool slot on a trait that has just changed.
 *
 * The creation record is left DIRTY rather than saved: `updateTrait` saves the
 * character, and the character's `creation` pointer carries this record's
 * changes with it. Saving here as well would write the row twice.
 */
async function updateCreationRulesForChangedTrait(
  character: Character,
  category: string,
  trait: SimpleTrait,
  freeValue: number,
): Promise<void> {
  const isSumCategory = venueData.Werewolf.sumCreationCategories.includes(category);

  // Outside merits and flaws, a change with no free value came out of no pool.
  // Merits and flaws use pool 0 -- they have no levels -- so a falsy free value
  // is the normal case there and must not short-circuit.
  if (!isSumCategory && !freeValue) return;

  if (!CREATION_POOL_CATEGORIES.includes(category)) return;

  const pointer = character.get('creation') as Parse.Object | undefined;
  if (!pointer) return;
  const [creation] = await Parse.Object.fetchAllIfNeeded([pointer]);
  if (!creation) return;

  if (creation.get('completed')) {
    // These counters are creation-time bookkeeping and nothing reads them once
    // the wizard is finished, so writing to them afterwards only produced
    // meaningless negatives -- a post-creation Kith change drove
    // ctdbs_arts_1_remaining to -3, which then read as an overspend that had
    // never happened.
    return;
  }

  const remainingName = `${category}_${freeValue}_remaining`;
  const picksName = `${category}_${freeValue}_picks`;
  creation.addUnique(picksName, trait);

  if (isSumCategory) {
    // A sum pool: a 3-point merit costs three of the seven, so the counter is
    // recomputed from the values still in the list rather than decremented --
    // the trait's value may have changed since it was picked.
    const picks = (creation.get(picksName) as SimpleTrait[] | undefined) ?? [];
    const sum = await sumOfPicks(picks, trait);
    creation.set(remainingName, SUM_POOL_BUDGET - sum);
  } else {
    creation.increment(remainingName, -1);
  }
}

/* ------------------------------------------------------------------ venue -- */

export const werewolfVenue: Venue = {
  name: 'Werewolf',
  data: venueData.Werewolf,
  costs,
  loadRules,

  maxTraitValue(trait: SimpleTrait): number {
    return trait.category === 'skills' ? 10 : 20;
  },

  totalCostCategories: TOTAL_COST_CATEGORIES,
  sumCreationCategories: venueData.Werewolf.sumCreationCategories,
  ensureCreationRulesExist,
  updateCreationRulesForChangedTrait,
};
