/**
 * Shared cost engine utilities.
 *
 * These functions are byte-compatible with the original lodash 3.10 helpers
 * and are used by all three venues. Each venue implements its own
 * `calculateTraitCost` that calls these utilities internally.
 *
 * ## lodash 3 quirks reproduced
 *
 * - `_.take(list, undefined)` takes ONE element (defaults n to 1).
 * - `_.sum` uses `result += +entry || 0` (NaN entries contribute zero).
 * - `_.each(undefined, …)` is a no-op (characters with no backgrounds yield
 *   `undefined` rather than throwing).
 */
import type { CostEngine, VenueCharacter, VenueTrait } from './types'

export const MAX_TRAIT_LEVEL = 20

/**
 * A cumulative cost table, one entry per trait level.
 *
 * Entry i (1-based) is `i * costPerEntry`. Always 20 entries.
 */
export function costTable(costPerEntry: number): number[] {
  return Array.from({ length: MAX_TRAIT_LEVEL }, (_, index) => (index + 1) * costPerEntry)
}

/**
 * The total price of reaching `value` on the table.
 *
 * Returns `undefined` if `value` exceeds the table length. An absent or null
 * `value` takes one entry (lodash 3 default), matching the original behavior
 * where a trait with no value was charged the first level's price.
 */
export function costOnTable(table: number[], value: number | null | undefined): number | undefined {
  if (value !== undefined && value !== null && value > table.length) {
    return undefined
  }
  const levels = value === undefined || value === null ? 1 : Math.max(0, value)
  let total = 0
  for (let i = 0; i < levels; i++) {
    const entry = table[i]
    if (entry !== undefined) {
      total += entry
    }
  }
  return total
}

/**
 * A trait's cost net of its free value: what the player actually pays.
 *
 * Returns `undefined` if either the total or free cost lookup is off the table.
 * `undefined` is the signal that `Character.update_trait` turns into a visible
 * refusal. Never 0: an unpriceable trait must not be handed over for free.
 */
export function traitCostOnTable(table: number[], trait: VenueTrait): number | undefined {
  const value = trait.get('value') as number | undefined
  const freeValue = (trait.get('free_value') as number | undefined) || 0
  const totalCost = costOnTable(table, value)
  const freeCost = costOnTable(table, freeValue)
  if (totalCost === undefined || freeCost === undefined) {
    return undefined
  }
  return totalCost - freeCost
}

/**
 * `max_trait_value` — skills cap at 10, everything else at 20.
 *
 * 20 is `MAX_TRAIT_LEVEL`. The table is twenty entries long because a table
 * shorter than the highest selectable value prices the top of the slider at
 * nothing (the plateau reads as a deliberate cap rather than an off-by-eleven).
 */
export function maxTraitValue(trait: VenueTrait): number {
  const category = trait.get('category')
  if (category === 'skills') {
    return 10
  }
  return 20
}

/**
 * The experience this change costs: `newCost - (trait.cost || 0)`.
 *
 * Returns `undefined` when `newCost` is undefined, rather than producing NaN.
 * The `|| 0` on the old cost is the source's: a trait that has never been
 * priced has no `cost` column at all.
 */
export function calculateTraitToSpend(newCost: number | undefined, trait: VenueTrait): number | undefined {
  if (newCost === undefined) {
    return undefined
  }
  const oldCost = (trait.get('cost') as number | undefined) || 0
  return newCost - oldCost
}

/**
 * `_.sum(list, "attributes.value")` under the vendored lodash 3.10, reproduced.
 *
 * - The `"attributes.value"` shorthand reaches into a Parse object's backing
 *   store. Under lodash 4 the identical call returns a list of `undefined` and
 *   sums to 0.
 * - `arraySum` is `result += +entry || 0`, NOT `reduce((a, b) => a + b)`. An
 *   entry that is absent, null or unparseable contributes ZERO rather than
 *   poisoning the total with NaN.
 *
 * A non-array (an unset pool) sums to 0, matching `_.sum(undefined, …)`.
 */
export function sumTraitValues(picks: unknown): number {
  if (!Array.isArray(picks)) {
    return 0
  }
  let total = 0
  for (const pick of picks) {
    const value = (pick as { get?: (attr: string) => unknown })?.get?.('value')
    total += Number(value) || 0
  }
  return total
}

/**
 * A lazy CostEngine implementation: the four method signatures that all venues
 * share, without the venue-specific `calculateTraitCost` body.
 *
 * Each venue fills in `calculateTraitCost` and wraps the shared utilities.
 */
export function createCostEngine(
  calculateTraitCost: (
    character: VenueCharacter,
    trait: VenueTrait,
  ) => number | undefined,
): CostEngine {
  return {
    calculateTraitCost,
    costTable,
    costOnTable,
    traitCostOnTable,
  }
}
