import type { Character } from '../models/Character';
import type { SimpleTrait } from '../models/SimpleTrait';
import type { VenueData } from './data';

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
