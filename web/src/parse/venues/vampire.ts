import { Parse } from '../init';
import { addExperienceNotation } from '../character/experience';
import { sumOfPicks } from '../character/creation';
import type { Character } from '../models/Character';
import { fauxTrait, type SimpleTrait } from '../models/SimpleTrait';
import { venueData } from './data';
import { MAX_TRAIT_LEVEL, type CostEngine, type Venue } from './types';

/**
 * The Vampire venue: what a vampire costs, and how its creation pools are spent.
 *
 * Ports helpers/BNSMETV1_VampireCosts.js, collections/BNSMETV1_ClanRules.js and
 * the venue half of models/Vampire.js -- `generation`, `morality`,
 * `max_trait_value`, `calculate_total_cost`,
 * `update_creation_rules_for_changed_trait` and `ensure_creation_rules_exist`.
 *
 * The static tables (categories, text attributes, sum-creation categories) are
 * not repeated here; they are generated into data.ts from the same model file.
 */

/**
 * Categories that genuinely cost nothing.
 *
 * The list exists so that an *unlisted* category can be treated as a missing
 * rule rather than as free. Verbatim from VampireCosts.js:15.
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
  'extra_in_clan_disciplines',
  'haven_specializations',
  'contacts_specializations',
  'allies_specializations',
  'sabbat_rituals',
  'vampiric_texts',
  'influence_elite_specializations',
  'influence_underworld_specializations',
  'status_traits',
] as const;

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

/**
 * The categories that have creation pools at all.
 *
 * From the second guard in `update_creation_rules_for_changed_trait`
 * (Vampire.js:72), which carries a `FIXME Move to the creation model`. Anything
 * outside this list changes no counter, even when it arrives with a freeValue.
 */
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

/** Merits and flaws: the pools spent as a sum of values rather than a count. */
const SUM_CREATION_CATEGORIES = venueData.Vampire.sumCreationCategories;

/** The Parse class the clan rules live in. Lower-cased `b`, as on the server. */
const CLAN_RULE_CLASS = 'bnsmetv1_ClanRule';

/** The creation record's class -- shared by all three venues, hence the name. */
const CREATION_CLASS = 'VampireCreation';

/* ------------------------------------------------------------ clan rules -- */

let clanRules: Parse.Object[] = [];
let clanRulesLoad: Promise<void> | undefined;

/**
 * Fetch the in-clan discipline table, once.
 *
 * The legacy `initialize` (VampireCosts.js:37) is a try/catch around a bare
 * `BNSMETV1_ClanRules` identifier that the module never declares -- its own
 * import of that collection is bound to `FallbackClanRules`. It reads as a
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
function loadRules(): Promise<void> {
  if (!clanRulesLoad) {
    clanRulesLoad = new Parse.Query(CLAN_RULE_CLASS)
      .find()
      .then((rules) => {
        clanRules = rules;
      })
      .catch((error: unknown) => {
        clanRulesLoad = undefined;
        throw error;
      });
  }
  return clanRulesLoad;
}

/**
 * The disciplines this character's clan grants, plus any granted individually.
 *
 * Ports `get_in_clan_disciplines`. A clan with no rule row contributes nothing,
 * and Caitiff's row is present but has all three discipline fields absent --
 * both call sites in the legacy views strip the resulting `undefined`s with
 * `_.without(..., undefined)`, so the strip is done here once instead.
 * `discipline_is_in_clan` compared against those undefined entries and never
 * matched one, so nothing changes for it either.
 */
export function inClanDisciplines(character: Character): string[] {
  const clan = character.get('clan') as string | undefined;
  const rule = clanRules.find((candidate) => candidate.get('clan') === clan);
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

/* ------------------------------------------------------ vampire specifics -- */

/**
 * The value of the Generation background, or undefined if there is none.
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

/* ----------------------------------------------------------- cost engine -- */

const costs: CostEngine = {
  /**
   * A cumulative cost table, one entry per trait level.
   *
   * This used to be nine entries long while `max_trait_value` lets a trait reach
   * 20. Because taking more entries than a table holds silently returns the
   * whole table, `costOnTable` charged levels 10-20 exactly what level 9 cost,
   * and the plateau looked like a deliberate cap rather than an off-by-eleven.
   * The length is MAX_TRAIT_LEVEL for that reason and must stay tied to it.
   */
  costTable(costPerEntry: number): number[] {
    return Array.from({ length: MAX_TRAIT_LEVEL }, (_, i) => (i + 1) * costPerEntry);
  },

  costOnTable(table: number[], value: number): number | undefined {
    if (value > table.length) {
      // Never under-charge in silence. `_.take` would return the whole table and
      // read as a correct total; an unusable number is refused out loud by
      // `updateTrait`, which rejects an undefined cost.
      return undefined;
    }
    // Clamped at zero because `slice` and `_.take` disagree about negatives:
    // `_.take(ct, -1)` is empty, `ct.slice(0, -1)` is the whole table but one.
    return table.slice(0, Math.max(0, value)).reduce((total, entry) => total + entry, 0);
  },

  traitCostOnTable(table: number[], trait: SimpleTrait): number | undefined {
    const totalCost = costs.costOnTable(table, trait.value);
    const freeCost = costs.costOnTable(table, trait.freeValue);
    // The legacy subtraction of an undefined produced NaN, which `update_trait`
    // refused on the same test that refuses an undefined cost. Returning
    // undefined says the same thing in the type.
    if (totalCost === undefined || freeCost === undefined) return undefined;
    return totalCost - freeCost;
  },

  /**
   * What a trait costs, or undefined when no rule covers its category.
   *
   * Branch order is the legacy order and matters twice: in-clan disciplines are
   * priced before the out-of-clan discipline branch is reached (which is why
   * that branch can assume "must be OOC to have gotten this far"), and the
   * FREE_CATEGORIES check sits *after* every named category rather than before.
   *
   * The 0-versus-undefined distinction at the end is load-bearing. A category
   * that is meant to be free returns 0; a category with no rule returns
   * undefined and `updateTrait` refuses the change instead of granting it for
   * nothing. Collapsing the two is how `wta_rites` and `ctdbs_backgrounds` were
   * silently free.
   */
  calculateTraitCost(character: Character, trait: SimpleTrait): number | undefined {
    const category = trait.category;
    const name = trait.name;
    const modValue = trait.value - trait.freeValue;

    if (category === 'attributes') return modValue * 3;

    if (category === 'disciplines' && disciplineIsInClan(character, trait)) {
      return costs.traitCostOnTable(costs.costTable(3), trait);
    }

    // "humanity" is not one of ALL_SIMPLETRAIT_CATEGORIES -- the category on a
    // sheet is "paths" -- but the legacy engine prices both names identically
    // and this keeps it, rather than deciding here that nothing writes the
    // other one.
    if (category === 'humanity' || category === 'paths') return modValue * 10;

    // A merit can carry a free value when another merit grants it, which is why
    // this is `modValue` and not `value`.
    if (category === 'merits') return modValue;

    // A flaw refunds experience, so its cost is negative.
    if (category === 'flaws') return modValue * -1;

    if (category === 'rituals') return modValue * 2;

    const gen = generation(character);

    if (category === 'backgrounds') {
      // Generation buys itself: the first dot costs 1, every later dot 2.
      const table =
        name === 'Generation'
          ? generationCostTable()
          : costs.costTable(gen === 1 ? 1 : 2);
      return costs.traitCostOnTable(table, trait);
    }

    if (category === 'skills') {
      return costs.traitCostOnTable(costs.costTable(gen === 1 ? 1 : 2), trait);
    }

    if (category === 'disciplines') {
      // Must be out of clan to have got this far; the in-clan branch is above.
      return costs.traitCostOnTable(costs.costTable(gen < 5 ? 4 : 5), trait);
    }

    if (category === 'techniques') {
      // The 9999 default is not dead code: a generation of 4 or more matches
      // neither branch, so a technique is priced out of reach rather than
      // refused. That is the legacy behaviour and it is visible on the sheet.
      let techniqueCost = 9999;
      if (gen < 3) techniqueCost = 12;
      else if (gen === 3) techniqueCost = 20;
      return modValue * techniqueCost;
    }

    if (category === 'elder_disciplines') {
      // Same shape: the 99999 defaults stand for "not available at this
      // generation", and are left as an unaffordable price rather than an error.
      let inClanCost = 99999;
      let outOfClanCost = 99999;
      if (gen >= 3) inClanCost = 18;
      if (gen >= 5) outOfClanCost = 30;
      else if (gen >= 3) outOfClanCost = 24;
      return modValue * (disciplineIsInClan(character, trait) ? inClanCost : outOfClanCost);
    }

    if (category === 'luminary_disciplines') {
      // Only in-clan and only at generation 5 or above; everything else stays at
      // the unaffordable default.
      let luminaryCost = 99999;
      if (gen >= 5 && disciplineIsInClan(character, trait)) luminaryCost = 24;
      return modValue * luminaryCost;
    }

    if ((FREE_CATEGORIES as readonly string[]).includes(category)) return 0;

    return undefined;
  },
};

/** The Generation background's table: 1 for the first dot, 2 for each after. */
function generationCostTable(): number[] {
  const table = costs.costTable(2);
  table[0] = 1;
  return table;
}

/* ------------------------------------------------------------- creation -- */

/**
 * Create the creation record, if this character has none.
 *
 * Ports `ensure_creation_rules_exist` (Vampire.js:100). The counters are the
 * vampire creation pools: one skill at 4, two at 3, three at 2, four at 1, and
 * so on. `merits_0_remaining` and `flaws_0_remaining` are 7 because those pools
 * are spent as a sum of values, not as a count of picks -- pool index 0 because
 * merits and flaws have no free level.
 *
 * The 30 experience is granted through the ledger, so granting it twice would
 * be visible forever; the `has("creation")` guard above is what prevents that.
 */
async function ensureCreationRulesExist(character: Character): Promise<void> {
  if (character.has('creation')) {
    try {
      await Parse.Object.fetchAllIfNeeded([character.get('creation') as Parse.Object]);
    } catch (error) {
      // The legacy version logs this and carries on, leaving the caller to work
      // with whatever the pointer already holds. Kept: a dangling or unreadable
      // creation pointer must not stop a sheet from opening.
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
  // Set but deliberately not saved here: the legacy leaves `creation` dirty on
  // the character for whatever save comes next, and saving it now would write
  // the character mid-edit.
  character.set('creation', creation);
  await addExperienceNotation(character, {
    reason: 'Character Creation XP',
    alteration_earned: 30,
    earned: 30,
  });
}

/**
 * Spend a creation pool slot on a trait that has just changed.
 *
 * Ports `update_creation_rules_for_changed_trait` (Vampire.js:65).
 *
 * The creation record is left dirty rather than saved: the caller
 * (`updateTrait`) finishes with `Parse.Object.saveAll([trait, character])`,
 * which walks character -> creation -> trait. See the saveAll comment in
 * character/traits.ts for why that call is `saveAll` and why the trait is named
 * in it -- both are required by this function adding the trait to a pick list.
 */
async function updateCreationRulesForChangedTrait(
  character: Character,
  category: string,
  trait: SimpleTrait,
  freeValue: number,
): Promise<void> {
  // Outside merits and flaws, a change with no free value came out of no pool.
  if (!SUM_CREATION_CATEGORIES.includes(category) && !freeValue) return;
  if (!CREATION_POOL_CATEGORIES.includes(category)) return;

  const creation = character.get('creation') as Parse.Object | undefined;
  if (!creation) return;
  await Parse.Object.fetchAllIfNeeded([creation]);

  if (creation.get('completed')) {
    // These counters are creation-time bookkeeping and nothing reads them once
    // the wizard is finished, so writing to them afterwards only produced
    // meaningless negatives -- a post-creation Kith change drove
    // ctdbs_arts_1_remaining to -3, which then read as an overspend that had
    // never happened.
    return;
  }

  const picksName = `${category}_${freeValue}_picks`;
  const remainingName = `${category}_${freeValue}_remaining`;
  creation.addUnique(picksName, trait);

  if (SUM_CREATION_CATEGORIES.includes(category)) {
    // A sum pool: the counter is 7 minus the total of the values in it, not a
    // count of picks, and it is recomputed from the list -- which by now
    // includes the trait just added -- rather than decremented.
    const picks = (creation.get(picksName) as SimpleTrait[] | undefined) ?? [];
    const sum = await sumOfPicks(picks, trait);
    creation.set(remainingName, 7 - sum);
  } else {
    creation.increment(remainingName, -1);
  }
}

/* ------------------------------------------------------------- the venue -- */

export const vampireVenue: Venue = {
  name: 'Vampire',
  data: venueData.Vampire,
  costs,
  loadRules,
  /** Skills cap at 10; everything else at MAX_TRAIT_LEVEL. */
  maxTraitValue: (trait: SimpleTrait) => (trait.category === 'skills' ? 10 : MAX_TRAIT_LEVEL),
  totalCostCategories: TOTAL_COST_CATEGORIES,
  ensureCreationRulesExist,
  updateCreationRulesForChangedTrait,
  sumCreationCategories: SUM_CREATION_CATEGORIES,
};
