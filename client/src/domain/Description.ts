/**
 * Descriptions -- the flavour text offered when a player picks a new trait.
 *
 * Ported from `public/scripts/app/models/Description.js`,
 * `public/scripts/app/collections/DescriptionCollection.js` and
 * `public/scripts/app/helpers/DescriptionFetcher.js`.
 *
 * The model itself was empty. Everything below comes from the collection and
 * the fetcher, which between them are the whole feature: a per-category cache
 * that loads once, then refreshes incrementally.
 */
import Parse from '@/parse'
import { DescriptionObject } from '@/parse/classes'

/** A description record. The registered class for className "Description". */
export type Description = DescriptionObject

/**
 * `DescriptionCollection`'s comparator: by `order`, then by `name`.
 *
 * Both passes are ascending, and the second only runs when the first ties --
 * which is the usual case, since `order` is unset on most rows. `_.gt`/`_.lt`
 * in lodash 3 are plain `>` and `<`, so a pair where both columns are absent
 * compares equal and keeps its incoming position.
 */
export function compareDescriptions(left: Description, right: Description): number {
  let l = left.get('order')
  let r = right.get('order')
  if (l > r) {
    return 1
  } else if (l < r) {
    return -1
  }
  l = left.get('name')
  r = right.get('name')
  if (l > r) {
    return 1
  } else if (l < r) {
    return -1
  }
  return 0
}

/** A new array in comparator order. */
export function sortDescriptions(descriptions: readonly Description[]): Description[] {
  return [...descriptions].sort(compareDescriptions)
}

/** Every description. */
export function descriptionQuery(): Parse.Query<Description> {
  return new Parse.Query(DescriptionObject)
}

/**
 * The descriptions filed under one category.
 *
 * `helpers/DescriptionFetcher.js` built exactly this and assigned it to the
 * cached collection's `query` on every call -- deliberately replacing the
 * previous query object, so that the incremental `updatedAt` constraint the
 * last fetch added did not survive into the next one.
 */
export function descriptionQueryForCategory(category: string): Parse.Query<Description> {
  return descriptionQuery().equalTo('category', category)
}

/**
 * The descriptions for one category whose name starts with a base trait name.
 *
 * From `views/SimpleTraitNewSpecializationView.js#register`: a specialization
 * picker offers only the descriptions belonging to its own trait, so
 * "Lore: Kindred" is matched by `startsWith("name", "Lore")`.
 */
export function descriptionQueryForSpecialization(
  category: string,
  baseName: string,
): Parse.Query<Description> {
  return descriptionQueryForCategory(category).startsWith('name', baseName)
}

export interface FetchDescriptionsOptions {
  /** Merge into `existing` rather than replacing it. Defaults to true. */
  add?: boolean
  /** Ask the server only for rows changed since what is held. Defaults to true. */
  update?: boolean
}

/**
 * Fetch descriptions through a caller-supplied query.
 *
 * The query is a parameter because it always was: `DescriptionCollection` had
 * no `initialize` and therefore no `query` of its own, and every consumer
 * (`DescriptionFetcher`, `SimpleTraitNewSpecializationView`,
 * `SimpleTraitSpecializationView`) assigned one before calling `fetch`. A
 * collection whose query was never assigned fell back to a bare query for the
 * whole class inside `Parse.Collection.fetch`.
 *
 * With `update` and a non-empty list the query is constrained to
 * `updatedAt > (the newest updatedAt already held)` -- note `updatedAt`, where
 * the patronage collection uses `createdAt`. Descriptions are edited in place
 * by admins, so a refresh has to catch an edited row and not only a new one.
 *
 * `add` merges; otherwise the result replaces. Backbone's `add` skipped a row
 * whose id was already present rather than merging into it (no `merge` option
 * was passed), which means an EDITED description that comes back from the
 * incremental query is dropped on the merge path. That is the source's
 * behaviour and it is preserved here rather than fixed.
 */
export async function fetchDescriptions(
  query: Parse.Query<Description>,
  existing: readonly Description[] = [],
  options: FetchDescriptionsOptions = {},
): Promise<Description[]> {
  const add = options.add ?? true
  const update = options.update ?? true

  if (update && existing.length !== 0) {
    const updateds = existing
      .map((description) => description.updatedAt)
      .filter((updated): updated is Date => updated !== undefined)
      .sort((a, b) => a.getTime() - b.getTime())
    const newest = updateds[updateds.length - 1]
    if (newest !== undefined) {
      query.greaterThan('updatedAt', newest)
    }
  }

  const latest: Description[] = []
  await query.each((description) => {
    latest.push(description)
  })

  if (!add) {
    return sortDescriptions(latest)
  }

  const merged = [...existing]
  const seen = new Set(merged.map((description) => description.id))
  for (const description of latest) {
    if (description.id !== undefined && seen.has(description.id)) continue
    if (description.id !== undefined) seen.add(description.id)
    merged.push(description)
  }
  return sortDescriptions(merged)
}

/**
 * One cached list of descriptions per category.
 *
 * `helpers/DescriptionFetcher.js` was a module-level object keyed by category,
 * holding a collection that outlived every view that used it. That cache is the
 * point: the three "new trait" screens are entered and left repeatedly during
 * character creation, and without it each entry re-reads the category.
 *
 * `Parse.Collection` does not exist here, so an entry is a plain array plus the
 * bookkeeping the collection carried.
 */
interface CategoryCacheEntry {
  descriptions: Description[]
  /** In-flight fetch, so two screens opening at once share one request. */
  pending: Promise<Description[]> | null
}

const cacheByCategory = new Map<string, CategoryCacheEntry>()

function entryFor(category: string): CategoryCacheEntry {
  let entry = cacheByCategory.get(category)
  if (!entry) {
    entry = { descriptions: [], pending: null }
    cacheByCategory.set(category, entry)
  }
  return entry
}

/** What is cached for a category right now, without asking the server. */
export function cachedDescriptionsForCategory(category: string): Description[] {
  return entryFor(category).descriptions
}

/**
 * The descriptions for a category, fetched only if none are held.
 *
 * This is `fetch_avoiding_wait`, and the name says what it is for: the three
 * "new trait" screens call it on every entry, and after the first entry the
 * list is already in memory, so making the user watch a spinner for a list that
 * has not changed is the thing being avoided.
 *
 * The source's version started the fetch either way and then threw the promise
 * away when the collection was non-empty -- `var p = self.fetch(options)` runs
 * before the `if`. So a second visit still issued the request, still merged
 * whatever came back into the shared collection, and merely stopped waiting for
 * it. That is a fire-and-forget refresh, not a skipped one, and it is kept:
 * dropping it would mean an admin's edit never reaching a session that had
 * already opened the screen once.
 */
export function fetchDescriptionsForCategoryAvoidingWait(
  category: string,
): Promise<Description[]> {
  const entry = entryFor(category)
  const hadDescriptions = entry.descriptions.length !== 0

  const pending = fetchDescriptions(descriptionQueryForCategory(category), entry.descriptions)
    .then((descriptions) => {
      entry.descriptions = descriptions
      entry.pending = null
      return descriptions
    })
    .catch((error: unknown) => {
      entry.pending = null
      throw error
    })
  entry.pending = pending

  if (hadDescriptions) {
    // Resolve immediately with what is held; the refresh above keeps running.
    // The rejection is swallowed here because nobody is waiting on it -- an
    // unhandled rejection from a background refresh would be reported as an
    // application error the user cannot act on.
    pending.catch(() => undefined)
    return Promise.resolve(entry.descriptions)
  }
  return pending
}

/** Drop the per-category cache. For tests, and for a sign-out. */
export function resetDescriptionCache(): void {
  cacheByCategory.clear()
}
