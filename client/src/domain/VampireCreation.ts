/**
 * VampireCreation -- the sheet-in-progress record that tracks how many picks a
 * character still has left during creation.
 *
 * Ported from `public/scripts/app/models/VampireCreation.js`. Despite the name
 * it is not vampire-specific: Werewolf and Changeling characters use the same
 * class, which is why the fix documented on `remainingPicks` mattered.
 *
 * The record holds one counter per (category, rating) sub-pool, named
 * `<category>_<rating>_remaining` -- for example `skills_3_remaining` is "how
 * many rating-3 skills are still to be picked".
 */
import Parse from '@/parse'
import { VampireCreationObject } from '@/parse/classes'

/** A creation record. The registered class for className "VampireCreation". */
export type VampireCreation = VampireCreationObject

/** A new, unsaved creation record. */
export function createVampireCreation(attributes?: Record<string, unknown>): VampireCreation {
  return new VampireCreationObject(attributes)
}

/** Every creation record. */
export function vampireCreationQuery(): Parse.Query<VampireCreation> {
  return new Parse.Query(VampireCreationObject)
}

/**
 * Total picks still available across every sub-pool of a category.
 *
 * This used to size its loop from a hardcoded map of the six Vampire
 * categories, so any category outside it -- every `wta_*` and `ctdbs_*` one --
 * fell back to a top rating of 1 and summed only the rating-1 and rating-0
 * sub-pools. The per-rating counters were always right; only this badge was
 * wrong.
 *
 * Reading the sub-pools that actually exist on the record needs no per-venue
 * table and cannot go stale when a venue gains a category.
 *
 * ## The bare-integer test is the whole function
 *
 * Only a bare rating belongs between the prefix and the suffix, so that
 * "skills" does not swallow "skills_specializations_1". `skills_` is a prefix
 * of `skills_specializations_1_remaining`, and that key ends in `_remaining`,
 * so without the `/^-?\d+$/` test on the middle segment a specialization pool
 * would be counted into the skills badge -- twice, since it is also counted
 * into its own category's badge. Do not relax this to "contains a digit" or to
 * `parseInt`: `parseInt("3_specializations")` is 3.
 *
 * The regex allows a leading `-` because the source did. A negative rating is
 * not a thing the app writes, but a `-1` sub-pool that somehow existed was
 * being summed before and would keep being summed.
 *
 * ## Two behaviours that look like oversights and are kept
 *
 * `_.isNumber` accepted `NaN`, so a corrupt counter poisons the total rather
 * than being skipped -- and a badge reading "NaN" is a visible fault, where a
 * silently-dropped counter is not. `typeof value === 'number'` behaves the same
 * way. (`_.isNumber` also accepted boxed `new Number(3)`, which nothing in this
 * app can produce; that difference is not reachable.)
 *
 * The length guard `key.length <= prefix.length + suffix.length` rejects
 * `<category>__remaining`, whose middle segment is empty. The regex would
 * reject it too; both are kept because the source had both.
 */
export function remainingPicks(creation: VampireCreation, category: string): number {
  const prefix = category + '_'
  const suffix = '_remaining'
  let r = 0
  // `attributes` is a public getter in parse@8, returning the estimated data --
  // the same bag the source iterated.
  const attributes = creation.attributes as Record<string, unknown>
  for (const key of Object.keys(attributes)) {
    const value = attributes[key]
    if (typeof value !== 'number') {
      continue
    }
    if (!key.startsWith(prefix) || key.length <= prefix.length + suffix.length) {
      continue
    }
    if (suffix !== key.slice(-suffix.length)) {
      continue
    }
    // Only a bare rating belongs between the two, so that "skills" does not
    // swallow "skills_specializations_1".
    if (!/^-?\d+$/.test(key.slice(prefix.length, key.length - suffix.length))) {
      continue
    }
    r += value
  }
  return r
}
