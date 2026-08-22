import { Parse } from '../init';
import type { Character } from '../models/Character';
import { SimpleTrait } from '../models/SimpleTrait';
import { addExperienceNotation } from '../character/experience';
import { venueData } from './data';
import { MAX_TRAIT_LEVEL, type CostEngine, type Venue } from './types';

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
 * which is why the engine has to be loaded before it can price an Art -- the
 * legacy `initialize_costs`/`BNSCTDBS_ChangelingCostsFetcher` pair does exactly
 * this, fetching the rules once and sharing them across every character.
 */

/** The Parse class holding one row per Kith: `name`, `art_1`, `art_2`, `art_3`. */
export const KITH_RULE_CLASS = 'bnsctdbs_KithRule';

/**
 * Categories that genuinely cost nothing.
 *
 * The list exists so that an *unlisted* category is a missing rule rather than
 * a free one. See the note on CostEngine.calculateTraitCost: collapsing the two
 * is how `ctdbs_backgrounds` was silently free for as long as it was.
 */
const FREE_CATEGORIES = [
  'focus_physicals',
  'focus_mentals',
  'focus_socials',
  'health_levels',
  'willpower_sources',
  'lore_specializations',
  'academics_specializations',
  'drive_specializations',
  'linguistics_specializations',
  'ctdbs_arts_affinities_links',
  'ctdbs_holdings_specializations',
  'contacts_specializations',
  'allies_specializations',
  'influence_elite_specializations',
  'influence_underworld_specializations',
];

/**
 * The categories that have a creation pool at all.
 *
 * From the second guard in `update_creation_rules_for_changed_trait`. A change
 * to anything outside this list touches no counter, whatever its free value.
 */
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

const SUM_CREATION_CATEGORIES = venueData.ChangelingBetaSlice.sumCreationCategories;

/* ------------------------------------------------------------ kith rules -- */

let kithRules: Parse.Object[] = [];
let rulesPromise: Promise<void> | undefined;

/**
 * Fetch the Kith rules once and share them.
 *
 * Ports `BNSCTDBS_ChangelingCostsFetcher`, whose whole job is to make sure the
 * single `ChangelingBetaSliceCosts` instance and its one `KithRules.fetch()`
 * are shared rather than repeated per character. The in-flight promise is
 * cached, not just the result, so two characters opening at once do not each
 * issue the query.
 */
export function loadKithRules(): Promise<void> {
  if (!rulesPromise) {
    rulesPromise = new Parse.Query(KITH_RULE_CLASS)
      .find()
      .then((rules) => {
        kithRules = rules;
      })
      .catch((error: unknown) => {
        // Do not leave a rejected promise cached: every later call would adopt
        // the old failure and never retry the fetch.
        rulesPromise = undefined;
        throw error;
      });
  }
  return rulesPromise;
}

/** The rules as loaded. Empty until `loadRules` has resolved. */
export function loadedKithRules(): Parse.Object[] {
  return kithRules;
}

/**
 * The Arts a Kith grants affinity in.
 *
 * Ports `BNSCTDBS_KithRules.get_arts_affinities_for_kith`. A Kith with no rule
 * row grants nothing; a rule with fewer than three Arts leaves the rest
 * undefined, which `_.without(..., undefined)` drops.
 */
export function artsAffinitiesForKith(kith: string | undefined): string[] {
  const rule = kithRules.find((candidate) => candidate.get('name') === kith);
  if (!rule) return [];
  return (['art_1', 'art_2', 'art_3'] as const)
    .map((field) => rule.get(field) as string | undefined)
    .filter((art): art is string => art !== undefined);
}

/**
 * Every Art this character has affinity in.
 *
 * Ports `ChangelingBetaSliceCosts.get_arts_affinities`: the Kith's own list,
 * plus the names of any traits in `ctdbs_arts_affinities_links` -- a free
 * category whose only purpose is to add affinities a Kith did not grant.
 *
 * The link traits are read through `_.map(..., "attributes.name")` in the
 * legacy code, so an unfetched pointer contributes `undefined`. Dropping those
 * here is not a behaviour change: `undefined` can never equal a trait's name or
 * base name, so it could only ever fail to match.
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
 * must also match a trait named "Sovereign: Dictum" -- see the specialization
 * convention on SimpleTrait.
 *
 * The legacy guard `if ([] == icds) { return false; }` is dead: a fresh array
 * literal is never `==` to another array. An empty list needs no guard, since
 * `.some` over it is already false.
 */
export function artIsAffinity(character: Character, trait: SimpleTrait): boolean {
  const affinities = artsAffinities(character);
  return affinities.some((art) => art === trait.baseName() || art === trait.name);
}

/* -------------------------------------------------------- derived values -- */

/**
 * The Seeming rating, read off the Backgrounds category.
 *
 * Seeming is not a field on the character: it is a Background trait, and it
 * gates the Skill cost table. `_raw_seeming` keeps the LAST match rather than
 * the first -- `_.each` has no early exit -- and that is reproduced here,
 * because a character carrying two "Seeming" rows would otherwise be priced
 * differently by the two front ends.
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

/* ------------------------------------------------------------ cost engine -- */

/** The changeling engine, plus the affinity lookups the Kith screens need. */
export interface ChangelingCostEngine extends CostEngine {
  artsAffinities(character: Character): string[];
  artsAffinitiesForKith(kith: string | undefined): string[];
  artIsAffinity(character: Character, trait: SimpleTrait): boolean;
}

const costs: ChangelingCostEngine = {
  artsAffinities,
  artsAffinitiesForKith,
  artIsAffinity,

  /**
   * A cumulative cost table, one entry per trait level.
   *
   * MAX_TRAIT_LEVEL entries, never nine. The legacy table was `_.range(1, 10)`
   * while `max_trait_value` lets a trait reach 20, and because taking more
   * entries than a table holds silently returns the whole table, levels 10-20
   * were charged exactly what level 9 cost -- a plateau that read as a
   * deliberate cap rather than as an off-by-eleven.
   */
  costTable(costPerEntry: number): number[] {
    return Array.from({ length: MAX_TRAIT_LEVEL }, (_unused, i) => (i + 1) * costPerEntry);
  },

  costOnTable(table: number[], value: number): number | undefined {
    if (value > table.length) {
      // Never under-charge in silence. Taking past the end would return the
      // whole table and read as a correct total; an unusable number is refused
      // out loud by Character.updateTrait instead.
      return undefined;
    }
    return table.slice(0, value).reduce((total, entry) => total + entry, 0);
  },

  /**
   * A trait's cost net of its free value.
   *
   * The legacy version subtracts without checking, so an out-of-table value
   * yields NaN; `updateTrait`'s `Number.isFinite` guard catches that and
   * refuses. Returning `undefined` reaches the same refusal by the route the
   * CostEngine type describes, rather than by smuggling a NaN through a
   * `number`.
   */
  traitCostOnTable(table: number[], trait: SimpleTrait): number | undefined {
    const totalCost = this.costOnTable(table, trait.value);
    const freeCost = this.costOnTable(table, trait.freeValue);
    if (totalCost === undefined || freeCost === undefined) return undefined;
    return totalCost - freeCost;
  },

  calculateTraitCost(character: Character, trait: SimpleTrait): number | undefined {
    const category = trait.category;
    const modValue = trait.value - trait.freeValue;

    if (category === 'attributes') {
      return modValue * 3;
    }

    if (category === 'ctdbs_arts') {
      // The affinity discount: 4 per level instead of 6. Until `loadRules` has
      // resolved every Art prices as non-affinity, which is why the legacy
      // `get_character` calls `initialize_costs` before anything reads a cost.
      const table = this.costTable(artIsAffinity(character, trait) ? 4 : 6);
      return this.traitCostOnTable(table, trait);
    }

    /* Merits can have a "free" value if they're given by some other merit */
    if (category === 'ctdbs_merits') {
      return modValue;
    }

    if (category === 'ctdbs_flaws') {
      return modValue * -1;
    }

    // "backgrounds" is the Vampire/Werewolf spelling and is not in this venue's
    // category list at all; `ctdbs_backgrounds` is the one Changelings actually
    // use, and it had no branch, so every Background purchase resolved to the
    // `return 0` fallthrough at the bottom and cost nothing. Both spellings are
    // priced on the same 2-per-level table the other two venues use.
    if (category === 'backgrounds' || category === 'ctdbs_backgrounds') {
      return this.traitCostOnTable(this.costTable(2), trait);
    }

    if (category === 'skills') {
      // A Seeming of 3 or more doubles the price of every Skill.
      const table = this.costTable(seeming(character) < 3 ? 1 : 2);
      return this.traitCostOnTable(table, trait);
    }

    if (category === 'ctdbs_realms') {
      // Deliberately not this trait's own value, and not net of its free value:
      // a Realm is priced on HOW MANY Realms the character holds. The count is
      // taken before the new trait joins the array (updateTrait costs first and
      // adds after), so the first Realm is free and the Nth costs the 8-table
      // total for N-1. Faithful to `character.realms().length`; every Realm row
      // on the sheet therefore carries the same cost, and that cost changes as
      // Realms are added.
      return this.costOnTable(this.costTable(8), realms(character).length);
    }

    if (FREE_CATEGORIES.includes(category)) {
      return 0;
    }

    // Was `return 0`, which made every category anyone forgot to price silently
    // free -- exactly how `ctdbs_backgrounds` went unnoticed. Deliberately
    // undefined now; `Character.updateTrait` turns it into a visible refusal.
    return undefined;
  },
};

/* ------------------------------------------------------------- creation -- */

/**
 * The pool counters a new changeling starts with.
 *
 * From `ensure_creation_rules_exist`. Read alongside the `<category>_<free>_`
 * shape documented in character/creation.ts: three Arts at free value 1, one
 * Skill at 4 and so on. Merits and Flaws sit at free value 0 with 7 points
 * each, because they are spent as a sum of values rather than as a count of
 * picks -- see SUM_CREATION_CATEGORIES.
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
};

/** The Parse class the creation record lives in, shared by all three venues. */
export const CREATION_CLASS_NAME = 'VampireCreation';

async function ensureCreationRulesExist(character: Character): Promise<void> {
  if (character.has('creation')) {
    // Already seeded. The fetch is what the legacy version does here, and it
    // matters: callers go straight on to read the counters off the record.
    await Parse.Object.fetchAllIfNeeded([character.get('creation') as Parse.Object]);
    return;
  }

  const VampireCreation = Parse.Object.extend(CREATION_CLASS_NAME);
  const creation = new VampireCreation();
  creation.set({ ...CREATION_DEFAULTS, owner: character });
  const saved = await creation.save();
  character.set('creation', saved);

  // The 30 creation points, granted as a ledger entry -- so this must not run
  // twice, which is what the `has("creation")` return above guarantees. The
  // character is saved as part of this: `addExperienceNotation` recomputes the
  // running balances and saves the character with them, which is what persists
  // the `creation` pointer just set.
  await addExperienceNotation(character, {
    reason: 'Character Creation XP',
    alteration_earned: 30,
    earned: 30,
  });
}

async function updateCreationRulesForChangedTrait(
  character: Character,
  category: string,
  trait: SimpleTrait,
  freeValue: number,
): Promise<void> {
  // Outside the sum categories a change with no free value came out of no pool,
  // so there is nothing to spend. Merits and Flaws are the exception because
  // their pool is indexed at free value 0.
  if (!SUM_CREATION_CATEGORIES.includes(category) && !freeValue) return;

  /* FIXME Move to the creation model */
  if (!CREATION_POOL_CATEGORIES.includes(category)) return;
  if (!character.has('creation')) return;

  const [creation] = await Parse.Object.fetchAllIfNeeded([
    character.get('creation') as Parse.Object,
  ]);
  if (!creation) return;

  if (creation.get('completed')) {
    // These counters are creation-time bookkeeping and nothing reads them once
    // the wizard is finished, so writing to them afterwards only produced
    // meaningless negatives -- a post-creation Kith change drove
    // `ctdbs_arts_1_remaining` to -3, which then read as an overspend that had
    // never happened.
    return;
  }

  const listName = `${category}_${freeValue}_picks`;
  const stepName = `${category}_${freeValue}_remaining`;
  creation.addUnique(listName, trait);

  if (SUM_CREATION_CATEGORIES.includes(category)) {
    // A sum pool: the counter is 7 minus the total of the values in it, not a
    // count of picks, so a 3-point Merit costs three of the seven.
    const picks = (creation.get(listName) as SimpleTrait[] | undefined) ?? [];
    const sum = picks.reduce((total, pick) => total + (pick?.value ?? 0), 0);
    creation.set(stepName, 7 - sum);
  } else {
    creation.increment(stepName, -1);
  }

  // Not saved here. `updateTrait` saves the character and the trait together
  // with `saveAll` immediately after calling this, and the creation record is
  // reached as a dirty child of the character on that same save -- which is
  // also why the trait has to be named explicitly in that call. See the
  // saveAll comment in character/traits.ts.
}

/* ----------------------------------------------------------------- venue -- */

export interface ChangelingVenue extends Venue {
  costs: ChangelingCostEngine;
}

export const changelingVenue: ChangelingVenue = {
  name: 'ChangelingBetaSlice',
  data: venueData.ChangelingBetaSlice,
  costs,
  loadRules: loadKithRules,

  maxTraitValue(trait: SimpleTrait): number {
    return trait.category === 'skills' ? 10 : 20;
  },

  /**
   * What `calculate_total_cost` walks. Deliberately a subset: Flaws, Realms and
   * every specialization category are absent, so the costs screen's total is
   * the total of these five and not of the sheet.
   */
  totalCostCategories: ['skills', 'ctdbs_backgrounds', 'ctdbs_arts', 'attributes', 'ctdbs_merits'],

  ensureCreationRulesExist,
  updateCreationRulesForChangedTrait,
  sumCreationCategories: SUM_CREATION_CATEGORIES,
};
