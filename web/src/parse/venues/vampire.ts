/**
 * The Vampire venue: what a vampire costs, and how its creation pools are spent.
 *
 * Ports helpers/BNSMETV1_VampireCosts.js, collections/BNSMETV1_ClanRules.js and
 * the venue half of models/Vampire.js -- `generation`, `morality`,
 * `max_trait_value`, `calculate_total_cost`,
 * `update_creation_rules_for_changed_trait` and `ensure_creation_rules_exist`.
 *
 * The static tables (categories, text attributes, sum-creation categories) are
 * not repeated here; they are generated into `@yorick/venues/data` from the
 * same model file.
 *
 * Cost engine calculations use pure functions from @yorick/venues; the front-end
 * adapters bridge React's Character/SimpleTrait to the shared CostCharacter/
 * CostTrait structural interfaces.
 */

import { Parse } from '../init';
import { addExperienceNotation } from '../character/experience';
import { sumOfPicks } from '../character/creation';
import type { Character } from '../models/Character';
import { fauxTrait, type SimpleTrait } from '../models/SimpleTrait';
import { venueData } from './data';
import { MAX_TRAIT_LEVEL, type CostEngine, type Venue, type VenueRulesLoader } from './types';

import {
  createVampireCosts,
  type CostCharacter,
  type CostTrait,
} from '@yorick/venues/rules/VampireCosts';

/* ------------------------------------------------------------ clan rules -- */

/** The Parse class the clan rules live in. Lower-cased `b`, as on the server. */
const CLAN_RULE_CLASS = 'bnsmetv1_ClanRule';

/* ----------------------------------------------------------- the venue -- */

/** The categories `calculate_total_cost` walks (Vampire.js:239). */
const TOTAL_COST_CATEGORIES = [
  'skills',
  'backgrounds',
  'disciplines',
  'attributes',
  'merits',
  'rituals',
  'techniques',
  'elder_disciplines',
  'luminary_disciplines',
];

/** The categories that have creation pools at all. */
const CREATION_POOL_CATEGORIES = [
  'flaws',
  'merits',
  'focus_mentals',
  'focus_physicals',
  'focus_socials',
  'attributes',
  'skills',
  'disciplines',
  'backgrounds',
];

/** The creation record's class -- shared by all three venues, hence the name. */
const CREATION_CLASS = 'VampireCreation';

/**
 * Fetch the clan rules, once.
 *
 * Ports `initialize` on VampireCosts.js:37. The raw rows are an array of
 * Parse.Object instances, each holding `clan`, `discipline_1`, `discipline_2`
 * and `discipline_3` columns.
 */
let _clanRules: Parse.Object[] = [];

/**
 * The clan-rule table, as a plain array.
 *
 * The shared `createVampireCosts` accessor reads this array.
 */
function getClanRules(): Parse.Object[] {
  return _clanRules;
}

export async function loadVampireClanRules(): Promise<void> {
  _clanRules = await new Parse.Query(CLAN_RULE_CLASS).find();
}

/**
 * Build the Vampire venue object.
 *
 * The cost engine is the shared one, bound to the clan-rule accessor.
 * Creation rules are handled here because they require Parse.
 */

/**
 * Fetch the in-clan discipline table, once.
 *
 * The legacy `initialize` (VampireCosts.js:37) is a try/catch around a bare
 * `BNSMETV1_ClanRules` identifier that the module never declares. It reads as a
 * reference that must throw, and an earlier note in this file claimed it did.
 * It does not: `app/loadall.js` assigns `this.BNSMETV1_ClanRules = new
 * ClanRules` at module scope, which in that non-strict require callback is
 * `window`, so the bare identifier resolves to a global collection fetched once
 * at boot. Measured on the running app: it is an object holding 42 rules, and
 * the try branch is what runs.
 *
 * Both branches end at the same table, so this ports the fetch-and-hold shape
 * rather than reproducing a boot-time global. What is NOT reproduced is the
 * sharing: the legacy global is fetched once for the whole page, while this
 * fetches its own copy the first time a vampire needs pricing. Same rules, one
 * extra request per session.
 *
 * Repeated calls share the in-flight promise rather than re-querying -- every
 * screen that prices a trait calls this first. A failed load clears the memo so
 * the next caller retries instead of inheriting the failure forever.
 *
 * No `limit`: the legacy collection fetch is a plain `query.find()`, so it takes
 * the server's default page of 100. There are 42 rules on the running server, so
 * the two front ends see the same table today; above 100 both would silently
 * lose rules and over-charge in-clan disciplines.
 */
const _rulesLoader: VenueRulesLoader = (() => {
  let loaded = false;
  let promise: Promise<void> | null = null;
  return {
    load: async () => {
      if (loaded) return;
      if (!promise) {
        promise = loadVampireClanRules().catch(() => {
          promise = null;
          loaded = false;
          throw new Error('Failed to load vampire clan rules');
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
function costCharacter(character: Character): CostCharacter {
  const raw = rawGeneration(character);
  return {
    get: (attr: string) => character.get(attr),
    generation: () => (raw === undefined || raw === null ? 1 : raw),
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
 * The shared cost engine, bound to the clan-rule accessor.
 */
const sharedCosts = createVampireCosts(getClanRules);

/**
 * Calculate the cost of a trait for this character.
 *
 * Ports `calculate_total_cost` on Vampire.js:220. The shared engine is
 * parameterised by the clan-rule accessor; this wrapper adapts React's
 * types to the shared CostCharacter/CostTrait interfaces.
 */
function calculateTraitCost(character: Character, trait: SimpleTrait): number | undefined {
  return sharedCosts.calculate_trait_cost(costCharacter(character), costTrait(trait));
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

/**
 * What this character's generation is.
 *
 * Matched on `baseName`, so "Generation: 8th" counts. The last matching
 * background wins, as in the legacy `_.each` loop.
 */
export function rawGeneration(character: Character): number | undefined {
  let generation: number | undefined;
  for (const background of (character.get('backgrounds') as SimpleTrait[] | undefined) ?? []) {
    if (background.baseName() === 'Generation') {
      generation = background.get('value') as number | undefined;
    }
  }
  return generation;
}

/**
 * The generation to price against: 1 when the character has no Generation.
 *
 * `|| 1` in the original, so a stored value of 0 also reads as 1. Kept, because
 * generation 1 is the cheap end of every table it feeds and rounding a 0 up to 5
 * would raise prices no one has ever been charged.
 */
export function generation(character: Character): number {
  return rawGeneration(character) || 1;
}

export function hasGeneration(character: Character): boolean {
  return rawGeneration(character) !== undefined;
}

/**
 * What this character's morality is called: "Humanity", or a Path's name.
 *
 * Ports `morality_merit`. The merit is named "Path of <Something Something>"
 * and the label is everything from the third word on -- `_.words` splits on
 * word boundaries, so punctuation in the path's name is dropped.
 */
export function moralityMerit(character: Character): string {
  let morality = 'Humanity';
  for (const merit of (character.get('merits') as SimpleTrait[] | undefined) ?? []) {
    if (merit.name.startsWith('Path of')) {
      morality = (merit.name.match(/[A-Za-z0-9]+/g) ?? []).slice(2).join(' ');
    }
  }
  return morality;
}

/**
 * The character's morality trait.
 *
 * Ports `morality`. Both fallbacks are display-only rows that must never be
 * saved, so they are `fauxTrait`s: an empty one when the character has no
 * `paths` attribute at all, and a Humanity of 1 when the attribute exists but
 * is empty. The two cases are deliberately different -- the first has no name
 * to show, the second is the default every vampire starts with.
 */
export function morality(character: Character): SimpleTrait {
  if (!character.has('paths')) return fauxTrait({});
  const path = ((character.get('paths') as SimpleTrait[] | undefined) ?? [])[0];
  if (!path) return fauxTrait({ name: 'Humanity', value: 1 });
  return path;
}

/**
 * The disciplines this character's clan grants, plus any granted individually.
 *
 * Ports `get_in_clan_disciplines`. A clan with no rule row contributes nothing,
 * and Caitiff's row is present but has all three discipline fields absent --
 * both call sites in the legacy views strip the resulting `undefined`s with
 * `_.without(..., undefined)`, so the strip is done here once instead.
 */
export function inClanDisciplines(character: Character): string[] {
  const clan = character.get('clan') as string | undefined;
  const rule = _clanRules.find((candidate) => candidate.get('clan') === clan);
  const granted = rule
    ? [rule.get('discipline_1'), rule.get('discipline_2'), rule.get('discipline_3')]
    : [];
  const extra = ((character.get('extra_in_clan_disciplines') as SimpleTrait[] | undefined) ?? []).map(
    (trait) => trait.name,
  );
  return [...granted, ...extra].filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  );
}

/**
 * Is this discipline in clan?
 *
 * Matched against BOTH the trait's name and its base name, because a rule
 * granting "Lore" must match "Lore: Kindred" -- and, the other way round, the
 * Tremere rule grants the full "Thaumaturgy: Path of Blood", which matches only
 * the name. Dropping either comparison silently doubles the price of a whole
 * clan's disciplines.
 */
export function disciplineIsInClan(character: Character, trait: SimpleTrait): boolean {
  const inClan = inClanDisciplines(character);
  return inClan.some((name) => name === trait.baseName() || name === trait.name);
}

/**
 * The value of Generation, or undefined if there is none.
 */
export const getGeneration = rawGeneration;

/**
 * Build the Vampire venue object.
 *
 * The factory handles the cost engine (shared rules from @yorick/venues), rule
 * loading, and maxTraitValue. This file adds the venue-specific glue: clan
 * discipline lookups, generation/morality readers, and creation rule updates
 * that require Parse.
 */
export const vampireVenue: Venue = {
  name: 'Vampire',
  data: venueData.Vampire,
  costs,
  loadRules: _rulesLoader.load,
  maxTraitValue: (trait) => (trait.get('category') === 'skills' ? 10 : MAX_TRAIT_LEVEL),
  totalCostCategories: TOTAL_COST_CATEGORIES,
  sumCreationCategories: venueData.Vampire.sumCreationCategories,

  async ensureCreationRulesExist(character: Character): Promise<void> {
    if (character.has('creation')) {
      try {
        await Parse.Object.fetchAllIfNeeded([character.get('creation') as Parse.Object]);
      } catch (error) {
        console.log('ensureCreationRulesExist', error);
      }
      return;
    }

    const creation = new Parse.Object(CREATION_CLASS, {
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
      backgrounds_3_remaining: 1,
      backgrounds_2_remaining: 1,
      backgrounds_1_remaining: 1,
      disciplines_2_remaining: 1,
      disciplines_1_remaining: 2,
      attributes_7_remaining: 1,
      attributes_5_remaining: 1,
      attributes_3_remaining: 1,
      focus_mentals_1_remaining: 1,
      focus_socials_1_remaining: 1,
      focus_physicals_1_remaining: 1,
      merits_0_remaining: 7,
      flaws_0_remaining: 7,
      phase_1_finished: false,
      initial_xp: 30,
      phase_2_finished: false,
    });

    await creation.save();
    character.set('creation', creation);
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
    if (!venueData.Vampire.sumCreationCategories.includes(category) && !freeValue) return;
    if (!CREATION_POOL_CATEGORIES.includes(category)) return;

    const creation = character.get('creation') as Parse.Object | undefined;
    if (!creation) return;
    await Parse.Object.fetchAllIfNeeded([creation]);
    if (creation.get('completed')) return;

    const picksName = `${category}_${freeValue}_picks`;
    const remainingName = `${category}_${freeValue}_remaining`;
    creation.addUnique(picksName, trait);

    if (venueData.Vampire.sumCreationCategories.includes(category)) {
      const picks = (creation.get(picksName) as SimpleTrait[] | undefined) ?? [];
      const sum = await sumOfPicks(picks, trait);
      creation.set(remainingName, 7 - sum);
    } else {
      creation.increment(remainingName, -1);
    }
  },
};
