/**
 * VampireChange -- the audit row written for every edit to a character.
 *
 * Ported from `public/scripts/app/models/VampireChange.js` (an empty
 * `Parse.Object.extend`) and
 * `public/scripts/app/collections/VampireChangeCollection.js` (a `model:`
 * declaration and nothing else -- no comparator, so its order is whatever the
 * query returned).
 *
 * Like `VampireCreation`, the "Vampire" in the name is historical: Werewolf and
 * Changeling characters write to this same table.
 *
 * The two queries below are the same rows read for two different purposes, and
 * they are NOT interchangeable -- see the note on `recordedChangesQueryFor`.
 */
import Parse from '@/parse'
import { VampireChangeObject } from '@/parse/classes'

/** An audit row. The registered class for className "VampireChange". */
export type VampireChange = VampireChangeObject

/** A new, unsaved change row. */
export function createVampireChange(attributes?: Record<string, unknown>): VampireChange {
  return new VampireChangeObject(attributes)
}

/** Every change row. */
export function vampireChangeQuery(): Parse.Query<VampireChange> {
  return new Parse.Query(VampireChangeObject)
}

/**
 * The approval and history TIMELINE for one character -- not the whole audit log.
 *
 * From `Character#_recorded_changes_query`. Every row this returns is replayed
 * by `get_transformed`, which assumes a row describes either a trait (any
 * category but "core") or a text attribute ("core"). R47b added `experience`
 * rows for XP notations, and those are neither: replaying one manufactures a
 * FauxSimpleTrait in a category no venue has, and the approval view -- which
 * reconstructs the character at every step -- never finishes rendering.
 *
 * They belong in the log, which queries VampireChange directly through
 * `logQueryFor` below, and not in a timeline of approvable states: "approve up
 * to this XP award" is not a thing a storyteller can act on.
 *
 * Ascending by `createdAt`, because the replay walks it forwards. `limit(1000)`
 * is the source's, and it is a real ceiling rather than a paging step: a
 * character with more than a thousand recorded changes silently replays only
 * the first thousand. Recorded rather than raised -- raising it is a
 * performance decision about the approval screen, not a port.
 */
export function recordedChangesQueryFor(owner: Parse.Object): Parse.Query<VampireChange> {
  return vampireChangeQuery()
    .equalTo('owner', owner)
    .notEqualTo('category', 'experience')
    .addAscending('createdAt')
    .limit(1000)
}

/**
 * One page of the character log, newest first.
 *
 * From `views/CharacterLogView.js`, which pages with `skip`/`limit` as the user
 * scrolls. Unlike the timeline query this one includes `experience` rows -- the
 * log is where they belong.
 */
export function logQueryFor(
  owner: Parse.Object,
  start: number,
  pageSize: number,
): Parse.Query<VampireChange> {
  const query = vampireChangeQuery().equalTo('owner', owner).addDescending('createdAt')
  query.skip(start)
  query.limit(pageSize)
  return query
}

/**
 * Fetch the whole timeline for a character.
 *
 * `Parse.Collection.fetch` ran `find()`, so this is `find()` and not `each()`:
 * with `limit(1000)` already on the query, paging through it with `each` would
 * change what comes back. The serialising `_recordedChangesFetch` queue that
 * wraps this call stays on `Character`.
 */
export async function fetchRecordedChanges(owner: Parse.Object): Promise<VampireChange[]> {
  return await recordedChangesQueryFor(owner).find()
}

/**
 * Fetch only the timeline rows newer than what is held, and merge them.
 *
 * From `Character#update_recorded_changes`, which took the boundary from
 * `_.last(self.recorded_changes.models).createdAt` -- the last element, which
 * is the newest only because the query returns them ascending and the
 * collection has no comparator to re-order them. That coupling is why the
 * boundary is computed from the maximum here instead: it is the same value for
 * every list the query can produce, and it does not break if a caller sorts.
 *
 * The caller decides when to use this rather than a full fetch; the source
 * fell back to `fetch_recorded_changes` when the list was empty, because
 * `_.last([])` is `undefined` and `greaterThan("createdAt", undefined)` is not
 * a constraint anyone wants to send.
 */
export async function updateRecordedChanges(
  owner: Parse.Object,
  existing: readonly VampireChange[],
): Promise<VampireChange[]> {
  if (existing.length === 0) {
    return await fetchRecordedChanges(owner)
  }

  const createds = existing
    .map((change) => change.createdAt)
    .filter((created): created is Date => created !== undefined)
    .sort((a, b) => a.getTime() - b.getTime())
  const newest = createds[createds.length - 1]

  const query = recordedChangesQueryFor(owner)
  if (newest !== undefined) {
    query.greaterThan('createdAt', newest)
  }
  const latest = await query.find()

  // Backbone's `add` skipped rows whose id was already present (no `merge`
  // option was passed), and appended the rest in arrival order. The collection
  // has no comparator, so appending IS the order.
  const merged = [...existing]
  const seen = new Set(merged.map((change) => change.id))
  for (const change of latest) {
    if (change.id !== undefined && seen.has(change.id)) continue
    if (change.id !== undefined) seen.add(change.id)
    merged.push(change)
  }
  return merged
}
