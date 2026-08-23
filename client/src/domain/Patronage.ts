/**
 * Patronage -- the yearly paid membership record.
 *
 * Ported from `public/scripts/app/models/Patronage.js`,
 * `public/scripts/app/helpers/ExpirationMixin.js` and
 * `public/scripts/app/collections/Patronages.js`.
 *
 * ## Two things about patronage that look like defects and are not
 *
 * **A future-dated patronage is Active, not "not yet started".** `isActive` is
 * `expiresOn > now` and nothing else -- there is no start date in the test. A
 * row created today and expiring next year is Active from the moment it lands,
 * which is the point: patronage is granted, then runs out. Adding a
 * not-before check would make a member who paid at 23:50 in one time zone
 * appear unpaid to a storyteller in another, and the whole reason the record
 * carries only an expiry is to keep that class of confusion out.
 *
 * **Patronage rows are world-readable on purpose.** `cloud/main.js` stamps
 * every patronage created by the PayPal hook with public read, no public write,
 * and Administrator read/write. That is intended, not a leaked ACL: patron
 * status has to be publicly verifiable -- a storyteller checks whether a player
 * is a patron without being that player and without being an admin. The row
 * holds an owner pointer, a paid date and an expiry; it is not payment data.
 * The payment itself lives in `PaymentPaypal`, which is not public.
 */
import Parse from '@/parse'
import { PatronageObject } from '@/parse/classes'

/** A patronage record. The registered class for className "Patronage". */
export type Patronage = PatronageObject

/**
 * The shape `ExpirationMixin` needed: anything with `has` and `get`.
 *
 * The mixin was mixed into `Patronage` *and* into all three creature models
 * (`Vampire.js`, `Werewolf.js`, `ChangelingBetaSlice.js` each pass it as the
 * second argument to `Parse.Object.extend`), so these three functions are
 * shared, not patronage-specific. They live here because patronage is the only
 * consumer that reads them for their own sake; `Character` imports them.
 */
export interface ExpiringRecord {
  has(attribute: string): boolean
  get(attribute: string): unknown
}

/**
 * Has this record not yet expired?
 *
 * `expiresOn > Date.now()` compares a `Date` against a number, which works
 * because `>` coerces the Date through `valueOf`. Kept as-is rather than
 * "corrected" to `getTime()`, because the coercion is the behaviour.
 *
 * A record with no `expiresOn` at all is neither active nor expired -- both
 * predicates return false. `status` below resolves that tie towards "Expired".
 */
export function isActive(record: ExpiringRecord): boolean {
  if (record.has('expiresOn')) {
    // The cast is to `number` rather than `Date` so the comparison type-checks
    // in the same shape the runtime evaluates it: the raw stored value against
    // a millisecond count, coerced by `>`.
    return (record.get('expiresOn') as unknown as number) > Date.now()
  }
  return false
}

/** Has this record's expiry already passed? */
export function isExpired(record: ExpiringRecord): boolean {
  if (record.has('expiresOn')) {
    return (record.get('expiresOn') as unknown as number) < Date.now()
  }
  return false
}

/**
 * The word shown to a human: "Active" or "Expired".
 *
 * Asks `isActive` only. A record with no `expiresOn` reads "Expired" even
 * though `isExpired` is also false for it -- that asymmetry is the source's and
 * is the safe direction: an unparseable membership should not read as paid.
 */
export function expirationStatus(record: ExpiringRecord): 'Active' | 'Expired' {
  return isActive(record) ? 'Active' : 'Expired'
}

/** How `comparePatronages` orders. See the note on the comparator. */
export interface PatronageSortOptions {
  /**
   * Order by `createdAt` instead of `expiresOn`.
   *
   * The source tested `_.has(self, "sortbycreated")` -- PRESENCE of the
   * property, not its value -- so a collection with `sortbycreated = false`
   * still sorted by creation date. That is preserved: any value other than
   * `undefined`, including `false`, selects the created-at ordering.
   */
  sortByCreated?: boolean
}

/**
 * `collections/Patronages.js`'s comparator: newest first.
 *
 * The source reads reversed -- `l` is taken from `right` and `r` from `left` --
 * and then applies an ordinary ascending test, which is how it ends up
 * descending. Written out the same way here so it can be diffed against the
 * source; do not "simplify" the swap away without re-deriving the direction.
 *
 * `_.gt`/`_.lt` in lodash 3 are plain `>` and `<`. On `Date`s those compare by
 * timestamp; on `undefined` (an unsaved row has no `createdAt`) both are false
 * and the pair compares equal.
 */
export function comparePatronages(
  left: Patronage,
  right: Patronage,
  options: PatronageSortOptions = {},
): number {
  let l: unknown
  let r: unknown
  if (options.sortByCreated !== undefined) {
    l = right.createdAt
    r = left.createdAt
  } else {
    l = right.get('expiresOn')
    r = left.get('expiresOn')
  }
  if ((l as number) > (r as number)) {
    return 1
  } else if ((l as number) < (r as number)) {
    return -1
  }
  return 0
}

/** A new array in comparator order. */
export function sortPatronages(
  patronages: readonly Patronage[],
  options: PatronageSortOptions = {},
): Patronage[] {
  return [...patronages].sort((left, right) => comparePatronages(left, right, options))
}

/** Every patronage. The collection built exactly this in its `initialize`. */
export function patronageQuery(): Parse.Query<Patronage> {
  return new Parse.Query(PatronageObject)
}

export interface FetchPatronagesOptions extends PatronageSortOptions {
  /** Merge into `existing` rather than replacing it. Defaults to true. */
  add?: boolean
  /** Ask the server only for rows newer than what is held. Defaults to true. */
  update?: boolean
}

/**
 * Fetch patronages, incrementally.
 *
 * The collection's custom `fetch` did three things worth keeping:
 *
 *   1. With `update` and a non-empty collection it constrained the query to
 *      `createdAt > (the newest createdAt already held)`. That is what makes
 *      the admin patronage list cheap to refresh: the router calls
 *      `get_patronages()` on every visit and only pays for new rows.
 *   2. It used `each()`, not `find()`, so it pages past the 100-row default.
 *   3. `add` merged; otherwise it replaced. Backbone's `add` skipped a row
 *      whose id was already present rather than merging attributes into it
 *      (no `merge` option was passed), which is reproduced below.
 *
 * The one structural change: the source mutated a query object it kept for the
 * life of the collection, so each incremental fetch overwrote the previous
 * `$gt` on the same field. A fresh query per call has the same effect without
 * the shared mutable state.
 *
 * Resolves with the resulting list, sorted. The source resolved with the
 * collection itself, which callers then read `.models` off.
 */
export async function fetchPatronages(
  existing: readonly Patronage[] = [],
  options: FetchPatronagesOptions = {},
): Promise<Patronage[]> {
  const add = options.add ?? true
  const update = options.update ?? true

  const query = patronageQuery()
  if (update && existing.length !== 0) {
    // `_.sortBy` then `_.last` -- the newest createdAt held. Rows without a
    // createdAt sort first under `sortBy`, so they never become the boundary.
    const createds = existing
      .map((patronage) => patronage.createdAt)
      .filter((created): created is Date => created !== undefined)
      .sort((a, b) => a.getTime() - b.getTime())
    const newest = createds[createds.length - 1]
    if (newest !== undefined) {
      query.greaterThan('createdAt', newest)
    }
  }

  const latest: Patronage[] = []
  await query.each((patronage) => {
    latest.push(patronage)
  })

  if (!add) {
    return sortPatronages(latest, options)
  }

  const merged = [...existing]
  const seen = new Set(merged.map((patronage) => patronage.id))
  for (const patronage of latest) {
    if (patronage.id !== undefined && seen.has(patronage.id)) continue
    if (patronage.id !== undefined) seen.add(patronage.id)
    merged.push(patronage)
  }
  return sortPatronages(merged, options)
}

/**
 * The most recently expiring patronage for one user, or `undefined`.
 *
 * Ported from `helpers/UserWreqr.js#get_latest_patronage`, which lives with the
 * user directory in the source but is a patronage read and belongs here.
 *
 * The source ended in `.always(...)` returning the captured value, so a query
 * that FAILED still resolved -- with `undefined`. That is the behaviour a
 * profile page depends on: an unreadable or erroring patronage query renders as
 * "no patronage", not as a broken page. `.always` is `then(cb, cb)`; the
 * `catch` below is the same thing and, unlike `finally`, does not re-throw.
 */
export async function getLatestPatronage(user: Parse.User): Promise<Patronage | undefined> {
  const query = patronageQuery().equalTo('owner', user).descending('expiresOn')
  return await query.first().catch(() => undefined)
}
