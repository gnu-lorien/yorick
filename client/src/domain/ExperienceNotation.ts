/**
 * Experience notations -- the XP ledger rows shown on a character's experience
 * screen.
 *
 * Ported from `public/scripts/app/models/ExperienceNotation.js` (an empty
 * `Parse.Object.extend`) and
 * `public/scripts/app/collections/ExperienceNotationCollection.js` (a
 * comparator and nothing else). The behaviour lives on `Character`, which owns
 * the serialising `_experienceNotationsFetch` queue and the running-total
 * propagation; this module owns the ordering, the query, and the local identity
 * problem below.
 */
import Parse from '@/parse'
import { ExperienceNotationObject } from '@/parse/classes'

/** An XP ledger row. The registered class for className "ExperienceNotation". */
export type ExperienceNotation = ExperienceNotationObject

/** A new, unsaved notation. */
export function createExperienceNotation(
  attributes?: Record<string, unknown>,
): ExperienceNotation {
  return new ExperienceNotationObject(attributes)
}

/**
 * The collection's comparator: newest `entered` date first.
 *
 * Written with bare `>` in the source, not lodash, and returning `-1` when the
 * LEFT value is greater -- that is what makes it descending. Rows with equal or
 * incomparable `entered` values (an unset date on a row the player has not
 * dated yet) compare equal and keep their incoming order, which is the order
 * the query returned them in.
 */
export function compareExperienceNotations(
  left: ExperienceNotation,
  right: ExperienceNotation,
): number {
  const l = left.get('entered')
  const r = right.get('entered')
  if (l > r) {
    return -1
  } else if (r > l) {
    return 1
  }
  return 0
}

/** A new array in comparator order. */
export function sortExperienceNotations(
  notations: readonly ExperienceNotation[],
): ExperienceNotation[] {
  return [...notations].sort(compareExperienceNotations)
}

/** Every notation. */
export function experienceNotationQuery(): Parse.Query<ExperienceNotation> {
  return new Parse.Query(ExperienceNotationObject)
}

/**
 * One character's XP ledger, newest first.
 *
 * From `Character#fetch_experience_notations`. The server-side ordering is
 * `entered` then `createdAt`, both descending -- the second is the tie-break
 * that keeps two awards entered on the same day in the order they were
 * recorded. The comparator above only knows about `entered`, so the
 * `createdAt` tie-break survives only because the sort is stable and the query
 * already delivered them in that order. Both halves are needed; dropping
 * either re-orders same-day awards.
 */
export function experienceNotationQueryFor(
  owner: Parse.Object,
): Parse.Query<ExperienceNotation> {
  return experienceNotationQuery()
    .equalTo('owner', owner)
    .addDescending('entered')
    .addDescending('createdAt')
    /*
     * `limit(1000)`, because the running balance is computed over the WHOLE
     * ledger and Parse's default page is 100.
     *
     * Without it a character with more than a hundred notations had its
     * balance recomputed from the newest hundred and the rest silently
     * discarded -- the totals simply came out wrong, with nothing to say so.
     * The same ceiling the timeline query uses; a character past a thousand
     * entries is a real limit, recorded rather than raised.
     */
    .limit(1000)
}

/**
 * A stable identity for a notation that has never been saved.
 *
 * ### What this replaces
 *
 * Backbone gave every model a `cid`, and the experience screen leant on it
 * hard: the Edit and Delete buttons carry `notation-id="<%= log.cid %>"`, and
 * six call sites in `views/CharacterExperienceView.js` resolve that attribute
 * back to a row through `collection.getByCid(id)`. `Character#add_experience_notation`
 * also asks `if (ens._byCid[model.cid])` before inserting.
 *
 * The Vue client does not use `parse-compat`, so `cid`, `_byCid` and
 * `getByCid` do not exist. A notation still needs an identity before it is
 * saved, because a player can add a row, edit it and delete it again without
 * ever hitting the server -- `objectId` is `undefined` for that entire
 * sequence, and keying a list on `undefined` collapses every new row onto one.
 *
 * So the identity is generated here and kept on the object under a symbol,
 * which -- unlike a `set()` attribute -- cannot be serialised to the server, is
 * invisible to `attributes`, and does not dirty the object. `localIdOf` is
 * idempotent: the same object always answers the same id.
 *
 * Use `keyOf` for list keys and lookups: it prefers the real `objectId` once
 * there is one, exactly as `getByCid(id) || get(id)` did at
 * `CharacterExperienceView.js:187`.
 */
const LOCAL_ID = Symbol('yorick.localId')

let localIdCounter = 0

interface LocallyIdentified {
  [LOCAL_ID]?: string
}

/** The object's local id, generating one on first ask. */
export function localIdOf(object: Parse.Object): string {
  const carrier = object as unknown as LocallyIdentified
  let id = carrier[LOCAL_ID]
  if (id === undefined) {
    localIdCounter += 1
    id = 'local-' + localIdCounter
    carrier[LOCAL_ID] = id
  }
  return id
}

/** The saved id if there is one, otherwise the local id. Never `undefined`. */
export function keyOf(object: Parse.Object): string {
  return object.id ?? localIdOf(object)
}

/**
 * An index of notations by `keyOf`, replacing `_byCid`.
 *
 * Rebuild it from the list rather than maintaining it: the Backbone version was
 * a live getter over `models` for exactly that reason -- an index that is
 * updated separately from the list it indexes drifts out of sync, and this one
 * is consulted while rows are being added.
 */
export function indexByKey<T extends Parse.Object>(objects: readonly T[]): Map<string, T> {
  const index = new Map<string, T>()
  for (const object of objects) {
    index.set(keyOf(object), object)
  }
  return index
}
