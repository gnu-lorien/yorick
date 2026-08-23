import { Parse } from '../init';
import type { Character } from '../models/Character';
import type { SimpleTrait } from '../models/SimpleTrait';
import type { Venue } from '../venues/types';
import { getTrait, removeTrait } from './traits';

/**
 * The creation wizard's pool bookkeeping, in the parts that are venue-agnostic.
 *
 * Each venue seeds its own counters and spends them by its own rules -- see
 * `ensureCreationRulesExist` and `updateCreationRulesForChangedTrait` on the
 * Venue interface. What is shared is the *shape*: a creation record carries a
 * pair of fields per pool,
 *
 *     <category>_<freeValue>_picks       the traits taken from that pool
 *     <category>_<freeValue>_remaining   how many slots are left
 *
 * and `freeValue` indexes which pool a pick came out of. The wizard offers, for
 * instance, one skill at 4, two at 3, three at 2 and four at 1; a skill picked
 * at 3 has `free_value` 3 and consumes a slot from `skills_3_remaining`.
 */

/**
 * The range of pool indices to search.
 *
 * `-1` through `9`, from `_.range(-1, 10)` in `release_creation_pick_for_trait`.
 * It starts below zero because merits and flaws use pool 0 -- they have no
 * levels -- and the loop has to reach it, and it runs to 9 because no venue
 * offers a creation pool above that.
 */
const POOL_INDICES = Array.from({ length: 11 }, (_, i) => i - 1);

/**
 * Hand a creation pool slot back if this trait is holding one.
 *
 * Ports `release_creation_pick_for_trait` (Character.js:42). The wizard's own
 * unpick link does this itself, because it knows which slot it is releasing;
 * nothing did it for a plain removal, so removing a creation-picked trait
 * destroyed the trait, refunded its cost, and left `<category>_<i>_remaining`
 * permanently one short -- and once creation is complete there is no route back
 * to reclaim the slot.
 *
 * The slot is found by searching the pick lists for the trait rather than by
 * trusting its `free_value`, because a trait's free value can be edited after
 * it was picked.
 */
export async function releaseCreationPickForTrait(
  character: Character,
  venue: Venue,
  trait: SimpleTrait,
): Promise<void> {
  if (!character.has('creation')) return;

  await fetchAllCreationElements(character, venue);
  const creation = character.get('creation') as Parse.Object | undefined;
  if (!creation) return;

  const category = trait.category;
  let released = false;

  for (const i of POOL_INDICES) {
    const picksName = `${category}_${i}_picks`;
    const remainingName = `${category}_${i}_remaining`;
    const picks = (creation.get(picksName) as SimpleTrait[] | undefined) ?? [];

    // Matched by identity or by id: the pick list may hold a different instance
    // of the same row, since single-instance mode is off.
    const holds = picks.some((pick) => pick === trait || (trait.id && pick.id === trait.id));
    if (!holds) continue;

    creation.remove(picksName, trait);
    if (venue.sumCreationCategories.includes(category)) {
      // A sum pool: the counter is 7 minus the total of the values still in it,
      // not a count of picks. Recomputed from the list rather than decremented,
      // because the trait's value may have changed since it was picked.
      const remainingPicks = (creation.get(picksName) as SimpleTrait[] | undefined) ?? [];
      const sum = remainingPicks.reduce((total, pick) => total + (pick.value ?? 0), 0);
      creation.set(remainingName, 7 - sum);
    } else {
      creation.increment(remainingName, 1);
    }
    released = true;
  }

  if (!released) return;
  await creation.save();
}

/**
 * Fetch every trait held in the creation record's pick lists.
 *
 * Ports `fetch_all_creation_elements`. The picks are stored as pointers, so
 * without this the values needed to recompute a sum pool are not loaded and the
 * counter is rebuilt from zeroes.
 *
 * The category list is the venue's own -- the legacy code hard-codes a
 * different one in each venue model, and they are the categories that have
 * creation pools rather than all of them.
 */
export async function fetchAllCreationElements(
  character: Character,
  venue: Venue,
): Promise<void> {
  const creation = character.get('creation') as Parse.Object | undefined;
  if (!creation) return;

  await Parse.Object.fetchAllIfNeeded([creation]);

  const pending: Parse.Object[] = [];
  for (const category of venue.data.categories.map((c) => c.key)) {
    for (const i of POOL_INDICES) {
      const picks = creation.get(`${category}_${i}_picks`) as Parse.Object[] | undefined;
      if (!picks) continue;
      for (const pick of picks) {
        if (pick && pick.id !== undefined) pending.push(pick);
      }
    }
  }
  if (pending.length) await Parse.Object.fetchAllIfNeeded(pending);
}

/**
 * How many picks are left across every sub-pool of a category.
 *
 * Ports `remaining_picks` (VampireCreation.js). It reads the sub-pools that are
 * actually on the record rather than a per-venue table of top ratings, which is
 * what the badge next to each heading shows.
 *
 * The digit test is the load-bearing part. Without it the prefix `skills_`
 * would also match `skills_specializations_1_remaining`, and the Skills badge
 * would silently absorb a different pool's count.
 */
export function remainingPicks(creation: Parse.Object, category: string): number {
  const prefix = `${category}_`;
  const suffix = '_remaining';
  let total = 0;
  for (const [key, value] of Object.entries(creation.attributes as Record<string, unknown>)) {
    if (typeof value !== 'number') continue;
    if (!key.startsWith(prefix) || key.length <= prefix.length + suffix.length) continue;
    if (!key.endsWith(suffix)) continue;
    const middle = key.slice(prefix.length, key.length - suffix.length);
    if (!/^-?\d+$/.test(middle)) continue;
    total += value;
  }
  return total;
}

/** The traits taken out of one sub-pool, in the order they were picked. */
export function picksIn(creation: Parse.Object, category: string, index: number): SimpleTrait[] {
  return (creation.get(`${category}_${index}_picks`) as SimpleTrait[] | undefined) ?? [];
}

/** How many slots are left in one sub-pool. */
export function remainingIn(creation: Parse.Object, category: string, index: number): number {
  const value = creation.get(`${category}_${index}_remaining`) as number | undefined;
  return typeof value === 'number' ? value : 0;
}

/**
 * Give a creation pick back and delete the trait it bought.
 *
 * Ports `unpick_from_creation`. It differs from `releaseCreationPickForTrait`
 * in knowing which sub-pool it is crediting -- the wizard's unpick link carries
 * the index -- so it does not have to search for the trait, and in going on to
 * remove the trait afterwards.
 *
 * The slot is credited *before* `removeTrait` runs, and `removeTrait` then
 * releases nothing because the pick list no longer holds the trait. Reversing
 * the two would refund the slot twice.
 */
export async function unpickFromCreation(
  character: Character,
  venue: Venue,
  category: string,
  pickedTraitId: string,
  pickIndex: number,
): Promise<void> {
  await fetchAllCreationElements(character, venue);
  const trait = await getTrait(character, category, pickedTraitId);
  if (!trait) return;

  const creation = character.get('creation') as Parse.Object | undefined;
  if (!creation) return;

  const picksName = `${category}_${pickIndex}_picks`;
  const remainingName = `${category}_${pickIndex}_remaining`;
  creation.remove(picksName, trait);
  if (venue.sumCreationCategories.includes(category)) {
    const remaining = (creation.get(picksName) as SimpleTrait[] | undefined) ?? [];
    const sum = remaining.reduce((subtotal, pick) => subtotal + (pick.value ?? 0), 0);
    creation.set(remainingName, 7 - sum);
  } else {
    creation.increment(remainingName, 1);
  }
  await creation.save();
  await removeTrait(character, venue, trait);
}

/** True while the character is still going through the creation wizard. */
export function isBeingCreated(character: Character): boolean {
  const creation = character.get('creation') as Parse.Object | undefined;
  if (!creation) return false;
  return !creation.get('completed');
}

/**
 * Mark creation finished.
 *
 * Ports `complete_character_creation`. After this the pool counters are frozen:
 * every venue's `updateCreationRulesForChangedTrait` checks `completed` and
 * returns without touching them, so a later edit cannot drive one negative.
 */
export async function completeCharacterCreation(character: Character): Promise<void> {
  const creation = character.get('creation') as Parse.Object | undefined;
  if (!creation) return;
  creation.set('completed', true);
  await creation.save();
}
