/**
 * Referendums -- the community votes listed at `#referendums`.
 *
 * Ported from `public/scripts/app/models/Referendum.js` and
 * `public/scripts/app/collections/Referendums.js`.
 *
 * Yes, referendums have portraits, and the pair of thumbnail methods below is
 * character-for-character the pair on `Troupe` and on `Character`. The source
 * duplicated them in all three models; the duplication is kept rather than
 * hoisted into a shared helper, because these are three unrelated classes that
 * happen to agree today and a shared helper would quietly bind them together.
 */
import Parse from '@/parse'
import { ReferendumObject } from '@/parse/classes'

/** A referendum record. The registered class for className "Referendum". */
export type Referendum = ReferendumObject

/** What `getReferendumThumbnail*` falls back to. */
const THUMBNAIL_FALLBACK = 'head_skull.png'

/**
 * The columns the referendum list reads.
 *
 * Taken from `views/ReferendumsListView.js#register`, which narrowed the query
 * before running it. Kept as a constant for the same reason the troupes store
 * keeps its own: this query runs for every visitor to the list, and widening it
 * hands out the full contents of every referendum record.
 */
export const REFERENDUM_LIST_FIELDS = [
  'id',
  'name',
  'portrait',
  'shortdescription',
  'order',
] as const

/**
 * The referendum's portrait thumbnail at `size`, fetching the portrait first.
 *
 * The source logged `get_thumbnail_sync(size)` to the console on each call --
 * a debug leftover with no reader, not reproduced. Everything else is
 * unchanged, including that the portrait is re-fetched every time.
 */
export async function getReferendumThumbnail(
  referendum: Referendum,
  size: number | string,
): Promise<string | undefined> {
  const portrait = referendum.get('portrait') as Parse.Object | undefined
  if (!portrait) {
    return THUMBNAIL_FALLBACK
  }
  const fetched = await portrait.fetch()
  // `.url()` on a missing thumb throws, as it did before.
  return (fetched.get('thumb_' + size) as Parse.File).url()
}

/**
 * The thumbnail URL from what is already in memory, or `head_skull.png`.
 *
 * The source was
 * `_.result(self, "attributes.portrait.attributes.thumb_" + size + ".url", "head_skull.png")`.
 * lodash 3's `_.result` invokes the resolved value when it is a function, bound
 * to its parent -- `url` is a `Parse.File` method, so the result is the URL
 * string. The default is returned only when the path resolves to `undefined`,
 * which is exactly the unfetched-pointer case. `attributes` is SDK-private in
 * parse@8, so the walk goes through `get()`, which reads the same data.
 *
 * `_.result` in lodash 4 does not support this shape, which is why the
 * expression is written out rather than translated call-for-call.
 *
 * `string | undefined`, not `string`: `Parse.File#url()` can answer
 * `undefined`, and `_.result` substituted its default BEFORE invoking the
 * function, so that case returned `undefined` rather than the fallback.
 * Coercing it here would invent a behaviour the source did not have.
 */
export function getReferendumThumbnailSync(
  referendum: Referendum,
  size: number | string,
): string | undefined {
  const portrait = referendum.get('portrait') as Parse.Object | undefined
  const thumb = portrait?.get('thumb_' + size) as Parse.File | undefined
  if (!thumb || typeof thumb.url !== 'function') {
    return THUMBNAIL_FALLBACK
  }
  return thumb.url()
}

/**
 * `collections/Referendums.js`'s comparator: by `order`, ascending.
 *
 * `_.gt`/`_.lt` in lodash 3 are plain `>` and `<`. A referendum with no `order`
 * compares equal to everything, so it keeps its incoming position rather than
 * sorting to either end.
 */
export function compareReferendums(left: Referendum, right: Referendum): number {
  const l = left.get('order')
  const r = right.get('order')
  if (l > r) {
    return 1
  } else if (l < r) {
    return -1
  }
  return 0
}

/** A new array in comparator order. */
export function sortReferendums(referendums: readonly Referendum[]): Referendum[] {
  return [...referendums].sort(compareReferendums)
}

/** Every referendum. */
export function referendumQuery(): Parse.Query<Referendum> {
  return new Parse.Query(ReferendumObject)
}

/**
 * The referendums owned by another referendum.
 *
 * This is `collections/Referendums.js#fetch`, ported as-is including its
 * oddity: it queries the *Referendum* class for rows whose `owner` is the
 * referendum it was handed. `ReferendumBallots` does the same thing for
 * ballots, and this looks like it was copied from there. Nothing in the app
 * calls it -- `views/ReferendumsListView.js` builds its own narrowed query and
 * resets the collection directly -- so it has no observed behaviour to be
 * bug-compatible with, and it is ported rather than dropped only so that a
 * caller that turns up knows what it used to do.
 *
 * `each()` rather than `find()`, so it pages past the 100-row default.
 */
export async function fetchReferendumsOwnedBy(owner: Referendum): Promise<Referendum[]> {
  const query = referendumQuery().equalTo('owner', owner)
  const latest: Referendum[] = []
  await query.each((referendum) => {
    latest.push(referendum)
  })
  return sortReferendums(latest)
}

/**
 * Every referendum, narrowed to the columns the list renders.
 *
 * `views/ReferendumsListView.js#register` took a `filter` callback that got the
 * query before it ran -- that is how the router restricts the list to open
 * votes. The callback is kept, because the alternative is the page building the
 * `select`/`include` pair itself and drifting from the constant above.
 */
export async function fetchReferendumList(
  filter?: (query: Parse.Query<Referendum>) => void,
): Promise<Referendum[]> {
  const query = referendumQuery()
  query.select(...REFERENDUM_LIST_FIELDS)
  query.include('portrait')
  if (filter) filter(query)
  const incoming: Referendum[] = []
  await query.each((referendum) => {
    incoming.push(referendum)
  })
  return sortReferendums(incoming)
}
