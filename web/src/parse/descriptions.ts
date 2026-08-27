import { Parse } from './init';
import { Description } from './models/Description';

/**
 * The lookup rows behind every picker: clans, disciplines, gifts, merits.
 *
 * Ports helpers/DescriptionFetcher.js and the parts of
 * collections/DescriptionCollection.js that matter to a picker: page the whole
 * category in with `each`, and hold it in the collection's sort order.
 *
 * The incremental-fetch machinery is not ported. `DescriptionCollection.fetch`
 * asks only for rows newer than the newest one it holds, and
 * `fetch_avoiding_wait` returns immediately whenever anything is cached -- a
 * hand-written query cache, which is what TanStack Query is for. What is NOT
 * optional is the paging and the order.
 */

/**
 * The collection's comparator: `order` first, then `name`.
 *
 * Written with bare `>` / `<` because that is what lodash 3's `_.gt` and
 * `_.lt` do, and the distinction shows up on rows with no `order` at all: both
 * comparisons are false against a number, so the pair is reported equal and the
 * sort falls through to `name`. Sorting on `order ?? Infinity` would look
 * tidier and would put those rows somewhere else entirely.
 */
function byOrderThenName(left: Description, right: Description): number {
  const leftOrder = left.get('order');
  const rightOrder = right.get('order');
  if (leftOrder > rightOrder) return 1;
  if (leftOrder < rightOrder) return -1;
  const leftName = left.get('name');
  const rightName = right.get('name');
  if (leftName > rightName) return 1;
  if (leftName < rightName) return -1;
  return 0;
}

/**
 * Every Description row in a category, in the order the pickers show them.
 *
 * `each`, not `find`: several categories hold more rows than the server's
 * default page of 100, and a truncated list is a list of things a player is
 * quietly not allowed to pick.
 */
export async function fetchDescriptions(category: string): Promise<Description[]> {
  const rows: Description[] = [];
  await new Parse.Query(Description).equalTo('category', category).each((row) => {
    rows.push(row);
  });
  return rows.sort(byOrderThenName);
}

/** The names of the rows that cannot be taken without a specialization. */
export function requireSpecialization(descriptions: Description[]): string[] {
  return descriptions
    .filter((row) => row.get('requirement') === 'requires_specialization')
    .map((row) => row.get('name') as string);
}
