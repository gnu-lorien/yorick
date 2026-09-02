import type { Character } from '../models/Character';
import type { SimpleTrait } from '../models/SimpleTrait';
import type { VenueData } from '@yorick/venues';

/**
 * What distinguishes a vampire from a werewolf from a changeling.
 *
 * The three share one Parse class and one table (see Character.ts), so
 * everything that differs between them is here rather than in a subclass. The
 * legacy app achieves the same split with three modules that each register the
 * className "Vampire" and are handed private prototypes by
 * helpers/VenueClass.js; this is that arrangement written as data.
 */

/**
 * The highest level any trait can reach.
 *
 * From `max_trait_value` in the venue models. It matters to the cost engines
 * because a cost table must cover every level a slider can select: the vampire
 * table was once nine entries long while traits could reach 20, and since
 * taking more entries than a table holds silently returns the whole table,
 * levels 10-20 were charged exactly what level 9 cost. The plateau read as a
 * deliberate cap rather than as an off-by-eleven.
 */
export const MAX_TRAIT_LEVEL = 20;

export interface CostEngine {
  /**
   * What a trait costs in experience, or `undefined` when no rule covers it.
   *
   * The distinction is load-bearing and must not be collapsed. A category that
   * is *meant* to be free returns 0; a category the engine has no branch for
   * returns undefined, and `Character.updateTrait` refuses the change out loud
   * rather than granting it for nothing. That is how `wta_rites` and
   * `ctdbs_backgrounds` were found to be silently free.
   */
  calculateTraitCost(character: Character, trait: SimpleTrait): number | undefined;

  /**
   * A cumulative cost table: entry i is the price of reaching level i+1.
   *
   * Always MAX_TRAIT_LEVEL entries long, for the reason above.
   */
  costTable(costPerEntry: number): number[];

  /**
   * The total cost of holding a trait at `value`, or undefined if `value`
   * exceeds the table.
   *
   * Returning undefined rather than clamping is the fix for the plateau
   * described on MAX_TRAIT_LEVEL: an unusable number is refused, never
   * silently under-charged.
   */
  costOnTable(table: number[], value: number): number | undefined;

  /** A trait's cost net of its free value: what the player actually pays. */
  traitCostOnTable(table: number[], trait: SimpleTrait): number | undefined;
}

export interface Venue {
  name: 'Vampire' | 'Werewolf' | 'ChangelingBetaSlice';

  /** The static tables: categories, text attributes, sum-creation categories. */
  data: VenueData;

  /** The cost engine, once its rules have loaded. */
  costs: CostEngine;

  /** Load whatever rules the cost engine needs. Safe to call more than once. */
  loadRules(): Promise<void>;

  /**
   * The highest value this trait may take.
   *
   * Venue-specific: the vampire caps skills at 10 and everything else at 20.
   */
  maxTraitValue(trait: SimpleTrait): number;

  /**
   * The categories `calculate_total_cost` walks when totalling a sheet.
   *
   * Deliberately not "every category": the venue models each list a subset,
   * and the costs screen totals exactly that subset.
   */
  totalCostCategories: string[];

  /**
   * Create the creation record, if this character has none.
   *
   * Ports `ensure_creation_rules_exist`. Each venue seeds a different set of
   * pool counters, and all three then grant the same 30 experience with the
   * reason "Character Creation XP" -- which is a ledger entry, so it must not
   * be granted twice.
   */
  ensureCreationRulesExist(character: Character): Promise<void>;

  /**
   * Set a free-text attribute, when the venue does more than store it.
   *
   * Only the changeling defines one, for `ctdbs_kith`: choosing a Kith grants
   * its affinity Arts free and spends the Art creation pool, and repicking has
   * to reconcile both rather than accumulate. `undefined` -- or a hook that
   * returns false -- means "not mine", and the plain `updateText` runs.
   */
  applyText?(character: Character, target: string, value: unknown): Promise<boolean>;

  /** The same for clearing one. See `applyText`. */
  releaseText?(character: Character, target: string): Promise<boolean>;

  /**
   * Spend a creation pool slot on a trait that has just changed.
   *
   * Ports `update_creation_rules_for_changed_trait`. Two guards in every venue
   * matter and are easy to drop:
   *
   * - Outside the sum categories (merits and flaws), a change with no
   *   `freeValue` touches no pool at all and returns immediately.
   * - A completed creation record is left alone. Those counters are
   *   creation-time bookkeeping that nothing reads afterwards, so writing to
   *   them later only produced meaningless negatives -- a post-creation Kith
   *   change drove `ctdbs_arts_1_remaining` to -3, which then read as an
   *   overspend that had never happened.
   */
  updateCreationRulesForChangedTrait(
    character: Character,
    category: string,
    trait: SimpleTrait,
    freeValue: number,
  ): Promise<void>;

  /**
   * The categories whose creation pool is spent as a sum of trait values.
   *
   * Everywhere else a pick costs one slot; in these, a 3-point merit costs
   * three. Comes from the venue's SUM_CREATION_CATEGORIES.
   */
  sumCreationCategories: string[];
}

/**
 * Rules a venue loads from the server before its costs can be calculated.
 *
 * Vampire needs clan rules (which disciplines are in-clan), werewolf needs
 * tribe and auspice affinities, changeling needs kith art affinities. All three
 * are fetched once and shared, which is what `initialize()` does in the legacy
 * cost helpers.
 */
export interface VenueRulesLoader {
  load(): Promise<void>;
  loaded: boolean;
}
