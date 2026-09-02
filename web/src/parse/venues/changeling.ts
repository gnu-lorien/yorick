/**
 * The ChangelingBetaSlice venue.
 *
 * Ports models/ChangelingBetaSlice.js, helpers/BNSCTDBS_ChangelingCosts.js,
 * helpers/BNSCTDBS_ChangelingCostsFetcher.js, collections/BNSCTDBS_KithRules.js
 * and models/BNSCTDBS_KithRule.js.
 *
 * The changeling analogue of the vampire's in-clan discipline is *art
 * affinity*: a Kith names up to three Arts, and those cost 4 per level instead
 * of 6. The mapping lives in the `bnsctdbs_KithRule` table rather than in code,
 * which is why the engine has to be loaded before it can price an Art.
 *
 * Cost engine calculations use pure functions from @yorick/venues; the front-end
 * adapters bridge React's Character/SimpleTrait to the shared CostCharacter/
 * CostTrait structural interfaces.
 */

import { Parse } from '../init';
import type { Character } from '../models/Character';
import { SimpleTrait } from '../models/SimpleTrait';
import { addExperienceNotation } from '../character/experience';
import { sumOfPicks, unpickFromCreation } from '../character/creation';
import { baseUnpickText, baseUpdateText, updateTrait } from '../character/traits';
import { venueData } from './data';
import { MAX_TRAIT_LEVEL, type CostEngine, type Venue, type VenueRulesLoader } from './types';

import {
  calculate_trait_cost as _calculateTraitCost,
  type CostCharacter,
  type CostTrait,
  type KithRules,
} from '@yorick/venues/rules/ChangelingCosts';

/** The Parse class holding one row per Kith: `name`, `art_1`, `art_2`, `art_3`. */
export const KITH_RULE_CLASS = 'bnsctdbs_KithRule';

/** The creation record's class -- shared by all three venues. */
const CREATION_CLASS_NAME = 'VampireCreation';

/**
 * Fetch the Kith rules once and share them.
 *
 * Ports `BNSCTDBS_ChangelingCostsFetcher`, whose whole job is to make sure the
 * single `ChangelingBetaSliceCosts` instance and its one `KithRules.fetch()`
 * are shared rather than repeated per character.
 */
let _kithRules: KithRules = [];

export async function loadChangelingKithRules(): Promise<void> {
  _kithRules = (await new Parse.Query(KITH_RULE_CLASS).find()) as unknown as KithRules;
}

/** Rule loading: load Kith rules once. */
const _rulesLoader: VenueRulesLoader = (() => {
  let loaded = false;
  let promise: Promise<void> | null = null;
  return {
    load: async () => {
      if (loaded) return;
      if (!promise) {
        promise = loadChangelingKithRules().catch(() => {
          promise = null;
          loaded = false;
          throw new Error('Failed to load changeling kith rules');
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
function costCharacter(character: Character, seeming: number): CostCharacter {
  return {
    get: (attr: string) => character.get(attr),
    seeming: () => seeming,
    realms: () => realms(character),
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
 * Calculate the cost of a trait for this character.
 *
 * Calls the shared function with the loaded kith rules.
 */
function calculateTraitCost(character: Character, trait: SimpleTrait): number | undefined {
  return _calculateTraitCost(
    _kithRules,
    costCharacter(character, rawSeeming(character) || 0),
    costTrait(trait),
  );
}

/** The cost engine for this venue. */
const costs: CostEngine = {
  calculateTraitCost,
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

/** The categories that have a creation pool at all. */
const CREATION_POOL_CATEGORIES = [
  'ctdbs_flaws',
  'ctdbs_merits',
  'focus_mentals',
  'focus_physicals',
  'focus_socials',
  'attributes',
  'skills',
  'ctdbs_arts',
  'ctdbs_backgrounds',
];

/** The categories `calculate_total_cost` walks. */
const TOTAL_COST_CATEGORIES = ['skills', 'ctdbs_backgrounds', 'ctdbs_arts', 'attributes', 'ctdbs_merits'];

/* -------------------------------------------------------- derived values -- */

/**
 * The Seeming rating, read off the Backgrounds category.
 *
 * Seeming is not a field on the character: it is a Background trait, and it
 * gates the Skill cost table. `_raw_seeming` keeps the LAST match rather than
 * the first.
 */
export function rawSeeming(character: Character): number | undefined {
  const backgrounds = (character.get('ctdbs_backgrounds') as SimpleTrait[] | undefined) ?? [];
  let seeming: number | undefined;
  for (const background of backgrounds) {
    if (background.baseName() === 'Seeming') seeming = background.get('value') as number;
  }
  return seeming;
}

/** The Seeming rating, or 0 when there is none. */
export function seeming(character: Character): number {
  return rawSeeming(character) || 0;
}

/** True when a Seeming Background exists at all, whatever its value. */
export function hasSeeming(character: Character): boolean {
  return rawSeeming(character) !== undefined;
}

/** The character's Realm traits. */
export function realms(character: Character): SimpleTrait[] {
  return (character.get('ctdbs_realms') as SimpleTrait[] | undefined) ?? [];
}

/* --------------------------------------------------------------- kith -- */

/** The Arts a Kith grants affinity in. */
export function artsAffinitiesForKith(kith: string | undefined): string[] {
  const rule = _kithRules.find((candidate) => candidate.get('name') === kith);
  if (!rule) return [];
  return (['art_1', 'art_2', 'art_3'] as const)
    .map((field) => rule.get(field) as string | undefined)
    .filter((art): art is string => art !== undefined);
}

/**
 * Every Art this character has affinity in.
 *
 * Ports `ChangelingBetaSliceCosts.get_arts_affinities`: the Kith's own list,
 * plus the names of any traits in `ctdbs_arts_affinities_links`.
 */
export function artsAffinities(character: Character): string[] {
  const links = (character.get('ctdbs_arts_affinities_links') as SimpleTrait[] | undefined) ?? [];
  const linked = links
    .map((link) => link?.get('name') as string | undefined)
    .filter((name): name is string => name !== undefined);
  return [...artsAffinitiesForKith(character.get('ctdbs_kith') as string | undefined), ...linked];
}

/**
 * Is this Art one the character has affinity in?
 *
 * Both forms of the name are compared, because an affinity granted as "Sovereign"
 * must also match a trait named "Sovereign: Dictum".
 */
export function artIsAffinity(character: Character, trait: SimpleTrait): boolean {
  const affinities = artsAffinities(character);
  return affinities.some((art) => art === trait.baseName() || art === trait.name);
}

/** The Arts the character holds that answer to one of these names. */
function ownedArtsNamed(character: Character, names: string[]): SimpleTrait[] {
  const owned = (character.get('ctdbs_arts') as SimpleTrait[] | undefined) ?? [];
  return owned.filter((art) => names.includes(art.name) || names.includes(art.baseName()));
}

/**
 * Refuse a Kith the Art pool cannot pay for.
 *
 * R22: the grant used to decrement regardless, so a three-Art Kith with the pool
 * already spent drove `ctdbs_arts_1_remaining` to -2. Refusing is the honest
 * answer; clamping would silently drop a grant the character is entitled to.
 */
async function checkKithArtPool(character: Character, kith: string): Promise<void> {
  const pointer = character.get('creation') as Parse.Object | undefined;
  if (!pointer) return;
  const [creation] = await Parse.Object.fetchAllIfNeeded([pointer]);
  if (!creation || creation.get('completed')) return;

  const releasing = ownedArtsNamed(character, artsAffinities(character)).length;
  const granting = artsAffinitiesForKith(kith).length;
  const available = ((creation.get('ctdbs_arts_1_remaining') as number | undefined) ?? 0) + releasing;
  if (granting > available) {
    throw new Error(
      `${kith} grants ${granting} Arts, but only ${available} Art pick` +
        `${available === 1 ? '' : 's'} remain. Unpick an Art before choosing this Kith.`,
    );
  }
}

/** Destroy the named Arts and hand their creation picks back. */
async function unpickPreviousArts(
  character: Character,
  venue: Venue,
  names: string[],
): Promise<void> {
  if (!names.length) return;
  for (const art of ownedArtsNamed(character, names)) {
    if (art.id) await unpickFromCreation(character, venue, 'ctdbs_arts', art.id, 1);
  }
}

/**
 * Apply a Kith: reconcile the Arts, then store the text.
 *
 * R23: the retained set stops an Art that is an affinity of *both* the outgoing
 * and the incoming Kith being destroyed and re-granted (two log rows for one Art
 * within the same minute).
 */
async function applyKith(character: Character, venue: Venue, value: unknown): Promise<void> {
  const kith = String(value);
  const owned = (character.get('ctdbs_arts') as SimpleTrait[] | undefined) ?? [];
  await Parse.Object.fetchAllIfNeeded(owned.filter((art) => art?.id !== undefined));

  await checkKithArtPool(character, kith);

  const outgoing = artsAffinities(character);
  const incoming = artsAffinitiesForKith(kith);
  const retained = outgoing
    .filter((name) => incoming.includes(name))
    .filter((name) =>
      ownedArtsNamed(character, [name]).some(
        (art) => ((art.get('free_value') as number | undefined) ?? 0) > 0,
      ),
    );

  await unpickPreviousArts(
    character,
    venue,
    outgoing.filter((name) => !retained.includes(name)),
  );
  await character.save();
  await baseUpdateText(character, 'ctdbs_kith', kith);

  for (const art of incoming.filter((name) => !retained.includes(name))) {
    await updateTrait(character, venue, {
      nameOrTrait: art,
      value: 1,
      category: 'ctdbs_arts',
      freeValue: 1,
    });
  }

  const creation = character.get('creation') as Parse.Object | undefined;
  if (creation) await creation.save();
}

/**
 * Clear the Kith, and take its Arts back with it.
 *
 * This used to be a bare passthrough, so it cleared the text and left the
 * granted Arts and the spent pool slots behind.
 */
async function releaseKith(character: Character, venue: Venue): Promise<void> {
  const owned = (character.get('ctdbs_arts') as SimpleTrait[] | undefined) ?? [];
  await Parse.Object.fetchAllIfNeeded(owned.filter((art) => art?.id !== undefined));
  await unpickPreviousArts(character, venue, artsAffinities(character));
  await baseUnpickText(character, 'ctdbs_kith');
  const creation = character.get('creation') as Parse.Object | undefined;
  if (creation) await creation.save();
}

/* ----------------------------------------------------------- the venue -- */

export const changelingVenue: Venue = {
  name: 'ChangelingBetaSlice',
  data: venueData.ChangelingBetaSlice,
  costs,
  loadRules: _rulesLoader.load,
  maxTraitValue: (trait) => (trait.get('category') === 'skills' ? 10 : MAX_TRAIT_LEVEL),
  totalCostCategories: TOTAL_COST_CATEGORIES,
  sumCreationCategories: venueData.ChangelingBetaSlice.sumCreationCategories,

  async ensureCreationRulesExist(character: Character): Promise<void> {
    if (character.has('creation')) {
      await Parse.Object.fetchAllIfNeeded([character.get('creation') as Parse.Object]);
      return;
    }

    const VampireCreation = Parse.Object.extend(CREATION_CLASS_NAME);
    const creation = new VampireCreation();
    creation.set({
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
      ctdbs_backgrounds_3_remaining: 1,
      ctdbs_backgrounds_2_remaining: 1,
      ctdbs_backgrounds_1_remaining: 1,
      attributes_7_remaining: 1,
      attributes_5_remaining: 1,
      attributes_3_remaining: 1,
      ctdbs_arts_1_remaining: 3,
      focus_mentals_1_remaining: 1,
      focus_socials_1_remaining: 1,
      focus_physicals_1_remaining: 1,
      ctdbs_merits_0_remaining: 7,
      ctdbs_flaws_0_remaining: 7,
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
    if (!venueData.ChangelingBetaSlice.sumCreationCategories.includes(category) && !freeValue) return;
    if (!CREATION_POOL_CATEGORIES.includes(category)) return;
    if (!character.has('creation')) return;

    const [creation] = await Parse.Object.fetchAllIfNeeded([
      character.get('creation') as Parse.Object,
    ]);
    if (!creation) return;
    if (creation.get('completed')) return;

    const listName = `${category}_${freeValue}_picks`;
    const stepName = `${category}_${freeValue}_remaining`;
    creation.addUnique(listName, trait);

    if (venueData.ChangelingBetaSlice.sumCreationCategories.includes(category)) {
      const picks = (creation.get(listName) as SimpleTrait[] | undefined) ?? [];
      const sum = await sumOfPicks(picks, trait);
      creation.set(stepName, 7 - sum);
    } else {
      creation.increment(stepName, -1);
    }
  },

  async applyText(character, target, value) {
    if (target !== 'ctdbs_kith') return false;
    await applyKith(character, changelingVenue, value);
    return true;
  },

  async releaseText(character, target) {
    if (target !== 'ctdbs_kith') return false;
    await releaseKith(character, changelingVenue);
    return true;
  },
};
