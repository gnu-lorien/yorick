import { Parse } from '../init';
import type { Character } from '../models/Character';
import { characterAcl } from './acl';

/**
 * A character's experience ledger.
 *
 * Ports the ten experience methods on models/Character.js (:488-:681).
 *
 * The data model is a running balance, not a list of deltas. Each
 * ExperienceNotation carries both:
 *
 *   alteration_earned / alteration_spent   what this entry changed
 *   earned / spent                         the totals as at this entry
 *
 * and the character's own `experience_earned` / `experience_spent` mirror the
 * newest entry's totals. So inserting, editing or deleting one entry means
 * recomputing every entry newer than it, which is what
 * `recomputeRunningBalances` does.
 *
 * Entries are ordered newest-first -- `addDescending("entered")` then
 * `addDescending("createdAt")` -- so "newer" means a *lower* index. That
 * inversion is the single easiest thing to get wrong here, and it is why the
 * legacy code walks the slice with `reduceRight`.
 *
 * The legacy version drives all of this through Backbone collection events:
 * changing a notation fires `change`, which calls
 * `_finalize_triggered_experience_notation_changes`, which recomputes and saves.
 * Here the recomputation is a pure function over an array and the saving is
 * explicit, so there is no way for an edit to reach the server without its
 * consequences following.
 */

export interface ExperienceNotationOptions {
  entered?: Date;
  reason?: string;
  earned?: number;
  spent?: number;
  alteration_earned?: number;
  alteration_spent?: number;
}

/** The Parse class the ledger entries live in. */
export const EXPERIENCE_NOTATION_CLASS = 'ExperienceNotation';

/**
 * Must match `EXPERIENCE_NOTATION_FETCH_LIMIT` in models/Character.js:37, where
 * the reasoning is recorded.
 */
export const EXPERIENCE_NOTATION_FETCH_LIMIT = 1000;

export function experienceNotationQuery(character: Character): Parse.Query {
  return new Parse.Query(EXPERIENCE_NOTATION_CLASS)
    .equalTo('owner', character)
    .addDescending('entered')
    .addDescending('createdAt')
    .limit(EXPERIENCE_NOTATION_FETCH_LIMIT);
}

/**
 * Every ledger entry for a character, newest first.
 *
 * `find()`, not `each()`. Two reasons, and the first is not a preference:
 * `each()` refuses a sorted query outright -- "Cannot iterate on a query with
 * sort, skip, or limit" -- because it paginates by objectId and cannot honour
 * an ordering while doing so. The order here is the whole point, since the
 * running balances are computed by walking the list.
 *
 * The second is the limit. Both apps used to take the server's default page of
 * 100, so a character with more than 100 notations lost the oldest ones -- and
 * because `recomputeRunningBalances` walks exactly this list, the totals were
 * recomputed against a truncated ledger rather than merely displayed short.
 * Measured on the legacy side at 111 notations worth 140 XP: it loaded 100 and
 * rewrote `experience_earned` as 100. Forty XP gone, saved, and nothing said.
 * That was legacy bug #15 and it is fixed on both sides now.
 *
 * A raised ceiling, not a removed one. `each()` would page without any ceiling
 * but refuses a sorted query, and the order is load-bearing: `entered`
 * descending with `createdAt` as the tiebreak, so rows entered at the same
 * instant keep a stable position and their running balances with it.
 */
export async function fetchExperienceNotations(character: Character): Promise<Parse.Object[]> {
  return experienceNotationQuery(character).find();
}

/** What the character has left to spend. */
export function experienceAvailable(character: Character): number {
  return (
    ((character.get('experience_earned') as number) ?? 0) -
    ((character.get('experience_spent') as number) ?? 0)
  );
}

/**
 * A new entry with the defaults the legacy `_default_experience_notation` sets.
 *
 * "Unspecified reason" is a real default and shows up in the log, so an entry
 * created without one is visibly unexplained rather than blank.
 */
export function newExperienceNotation(
  character: Character,
  options: ExperienceNotationOptions = {},
): Parse.Object {
  const Notation = Parse.Object.extend(EXPERIENCE_NOTATION_CLASS);
  const notation = new Notation();
  notation.set({
    entered: options.entered ?? new Date(),
    reason: options.reason ?? 'Unspecified reason',
    earned: options.earned ?? 0,
    spent: options.spent ?? 0,
    alteration_earned: options.alteration_earned ?? 0,
    alteration_spent: options.alteration_spent ?? 0,
    owner: character,
  });
  notation.setACL(characterAcl(character));
  return notation;
}

/**
 * Recompute the running totals from `index` up to the newest entry.
 *
 * Ports `_propagate_experience_notation_change`. Returns the entries whose
 * totals changed; the caller saves them, together with the character.
 *
 * The accumulator starts at the entry *after* `index` -- one position older,
 * because the list is newest-first -- so the recomputation begins from a total
 * that is already correct. When `index` is the last (oldest) entry there is
 * nothing older to start from, so it starts from a zeroed entry.
 *
 * Then it walks `[0..index]` from the oldest of that slice to the newest,
 * adding each entry's alteration to the running total. `reduceRight` is what
 * makes that walk go in the right direction over a newest-first array.
 */
export function recomputeRunningBalances(
  character: Character,
  notations: Parse.Object[],
  index: number,
): Parse.Object[] {
  const older = notations[index + 1];
  const start = older ?? newExperienceNotation(character);

  const altered: Parse.Object[] = [];
  const newest = notations.slice(0, index + 1).reduceRight((previous, notation) => {
    notation.set(
      'earned',
      ((notation.get('alteration_earned') as number) ?? 0) +
        ((previous.get('earned') as number) ?? 0),
    );
    notation.set(
      'spent',
      ((notation.get('alteration_spent') as number) ?? 0) + ((previous.get('spent') as number) ?? 0),
    );
    altered.push(notation);
    return notation;
  }, start);

  // The character mirrors the newest entry's totals. When the slice was empty
  // -- index -1, nothing to recompute -- `newest` is the accumulator itself,
  // which is either the next older entry or a zeroed one. Both are correct.
  character.set('experience_earned', (newest.get('earned') as number) ?? 0);
  character.set('experience_spent', (newest.get('spent') as number) ?? 0);
  altered.push(character);
  return altered;
}

/**
 * Where a new entry belongs in a newest-first list.
 *
 * The legacy code adds the entry to the collection and then hunts for it by
 * client id, which works because the collection sorts on insert. Here the
 * position is computed directly, using the same keys the query orders by:
 * `entered` descending, then `createdAt` descending.
 *
 * A brand-new entry has no `createdAt` until it is saved, so entries with the
 * same `entered` put the new one first -- which is what the collection did too,
 * since an undefined sort key compares as newest.
 */
export function insertionIndexFor(notations: Parse.Object[], entered: Date): number {
  const target = entered.getTime();
  const index = notations.findIndex((notation) => {
    const existing = (notation.get('entered') as Date | undefined)?.getTime() ?? 0;
    return existing <= target;
  });
  return index === -1 ? notations.length : index;
}

/**
 * Add an entry and propagate its effect through every newer one.
 *
 * Ports `add_experience_notation`. Returns the full ledger, newest first, so a
 * caller rendering the log does not have to re-fetch.
 */
export async function addExperienceNotation(
  character: Character,
  options: ExperienceNotationOptions = {},
): Promise<Parse.Object[]> {
  const notations = await fetchExperienceNotations(character);
  const notation = newExperienceNotation(character, options);
  const entered = notation.get('entered') as Date;
  const index = insertionIndexFor(notations, entered);
  notations.splice(index, 0, notation);

  const altered = recomputeRunningBalances(character, notations, index);
  await Parse.Object.saveAll(altered);
  return notations;
}

/**
 * Delete an entry and propagate the gap through every newer one.
 *
 * Ports `remove_experience_notation`. The entry is removed from the list before
 * the recomputation, so the totals are rebuilt over the ledger as it will be --
 * and the recomputation starts at the index the entry *used to* occupy, which
 * after removal is the first entry that needs correcting.
 */
export async function removeExperienceNotation(
  character: Character,
  notation: Parse.Object,
): Promise<Parse.Object[]> {
  const notations = await fetchExperienceNotations(character);
  const index = notations.findIndex((candidate) => candidate.id === notation.id);
  if (index === -1) return notations;

  notations.splice(index, 1);
  const altered = recomputeRunningBalances(character, notations, index - 1);
  await Promise.all([notation.destroy(), Parse.Object.saveAll(altered)]);
  return notations;
}

/**
 * Change an entry's alterations and propagate.
 *
 * The legacy equivalent is `on_update_experience_notation`, reached through a
 * Backbone `change` event. Editing `entered` can move the entry, so the
 * recomputation starts from whichever position is older -- the one it left or
 * the one it arrived at -- because every entry newer than that is affected.
 */
export async function updateExperienceNotation(
  character: Character,
  notation: Parse.Object,
  changes: ExperienceNotationOptions,
): Promise<Parse.Object[]> {
  const notations = await fetchExperienceNotations(character);
  const previousIndex = notations.findIndex((candidate) => candidate.id === notation.id);
  if (previousIndex === -1) return notations;

  const target = notations[previousIndex]!;
  if (changes.alteration_earned !== undefined) {
    target.set('alteration_earned', changes.alteration_earned);
  }
  if (changes.alteration_spent !== undefined) {
    target.set('alteration_spent', changes.alteration_spent);
  }
  if (changes.reason !== undefined) target.set('reason', changes.reason);

  let index = previousIndex;
  if (changes.entered !== undefined) {
    target.set('entered', changes.entered);
    notations.splice(previousIndex, 1);
    const moved = insertionIndexFor(notations, changes.entered);
    notations.splice(moved, 0, target);
    // The older of the two positions, because everything newer than it needs
    // recomputing and a lower index means newer.
    index = Math.max(previousIndex, moved);
  }

  const altered = recomputeRunningBalances(character, notations, index);
  await Parse.Object.saveAll(altered);
  return notations;
}
