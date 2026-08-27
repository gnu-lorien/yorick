import { Parse } from '../init';
import type { Character } from '../models/Character';

/**
 * The audit trail: every field a character has ever had changed.
 *
 * Ports models/VampireChange.js, collections/VampireChangeCollection.js and the
 * four methods on models/Character.js (:682-:756) that read them --
 * `get_recorded_changes`, `_recorded_changes_query`, `update_recorded_changes`
 * and `fetch_recorded_changes` -- plus the log page's own query, which lives in
 * views/CharacterLogView.js rather than on the model.
 *
 * The legacy model and collection are both empty `extend` calls; a class with
 * no behaviour is a `Parse.Object` of the right className and nothing more, so
 * neither needs a file of its own here.
 *
 * Two different readings of the same table, and they must not be confused:
 *
 *   the timeline  `recordedChangesQuery` -- oldest first, XP rows excluded,
 *                 capped at 1000. Feeds the history and approval screens,
 *                 which replay it to reconstruct the character.
 *   the log       `changeLogQuery` -- newest first, everything, paged. Feeds
 *                 the log screen, which just prints rows.
 */

/** The Parse class the change rows live in. */
export const VAMPIRE_CHANGE_CLASS = 'VampireChange';

/**
 * `recorded_changes` is the approval and history *timeline*, not the whole
 * audit log.
 *
 * Every row in it is replayed by `get_transformed`, which assumes a row
 * describes either a trait (any category but "core") or a text attribute
 * ("core"). R47b added `experience` rows for XP notations, and those are
 * neither: replaying one manufactures a FauxSimpleTrait in a category no venue
 * has, and the approval view -- which reconstructs the character at every step
 * -- never finishes rendering.
 *
 * They belong in the log, which queries VampireChange directly, and not in a
 * timeline of approvable states: "approve up to this XP award" is not a thing
 * a storyteller can act on.
 */
export function recordedChangesQuery(character: Character): Parse.Query {
  return new Parse.Query(VAMPIRE_CHANGE_CLASS)
    .equalTo('owner', character)
    .notEqualTo('category', 'experience')
    .addAscending('createdAt')
    .limit(1000);
}

/**
 * The whole timeline, oldest first.
 *
 * Ports `fetch_recorded_changes`, which resets its collection from
 * `_recorded_changes_query`. `find()` rather than `each()` on purpose: the
 * query's own `limit(1000)` is the original's cap, and paging past it here
 * would hand the history screen rows the legacy one never shows. A character
 * with more than a thousand non-XP changes is truncated in both apps.
 */
export async function fetchRecordedChanges(character: Character): Promise<Parse.Object[]> {
  return recordedChangesQuery(character).find();
}

/**
 * Extend a timeline already in hand with whatever has been recorded since.
 *
 * Ports `update_recorded_changes`. The incremental query is
 * `greaterThan("createdAt", <the newest row held>)` and the fetch is
 * `{add: true}`, so the result is an append rather than a replacement -- and
 * the newest row is the *last* one, the list being oldest-first.
 *
 * An empty list falls back to the full fetch, exactly as the original does: the
 * incremental query has no anchor to ask "since when" about.
 *
 * The legacy version chains every call onto `self._recordedChangesFetch` with
 * `.always()` so that two overlapping updates cannot interleave and duplicate
 * rows into the shared collection. That serialisation does not come across
 * because there is no shared collection: the list is a value passed in and
 * returned, held in the caller's React state, so the last call to resolve
 * simply wins.
 */
export async function updateRecordedChanges(
  character: Character,
  known: Parse.Object[],
): Promise<Parse.Object[]> {
  if (known.length === 0) return fetchRecordedChanges(character);

  const newest = known[known.length - 1]!;
  const added = await recordedChangesQuery(character)
    .greaterThan('createdAt', newest.createdAt)
    .find();
  return added.length ? [...known, ...added] : known;
}

/**
 * The timeline, fetched or refreshed.
 *
 * Ports `get_recorded_changes(register)`, whose two branches are exactly these
 * two: a character that has never been read fetches the lot, one that has asks
 * only for what is new. The legacy version memoises the collection on the
 * character itself and re-registers the caller's callback against it; here the
 * memo is the caller's own state and `known` is it.
 *
 * The `self.on("saved", self.update_recorded_changes, self)` binding does not
 * come across either. It is how a Backbone view learns that saving the
 * character added rows; a React screen re-runs this after its own save.
 */
export function getRecordedChanges(
  character: Character,
  known?: Parse.Object[],
): Promise<Parse.Object[]> {
  return known === undefined
    ? fetchRecordedChanges(character)
    : updateRecordedChanges(character, known);
}

/* ------------------------------------------------------------------ log -- */

/**
 * One page of the log, newest first.
 *
 * Ports `update_collection_query_and_fetch` in views/CharacterLogView.js. No
 * `notEqualTo("category", "experience")` here: the log is the whole audit
 * trail, and the XP rows the timeline excludes are exactly what it is for.
 */
export function changeLogQuery(character: Character, start: number, changeBy: number): Parse.Query {
  return new Parse.Query(VAMPIRE_CHANGE_CLASS)
    .equalTo('owner', character)
    .addDescending('createdAt')
    .skip(start)
    .limit(changeBy);
}

export async function fetchChangeLog(
  character: Character,
  start: number,
  changeBy: number,
): Promise<Parse.Object[]> {
  return changeLogQuery(character, start, changeBy).find();
}

/* -------------------------------------------------------------- display -- */

/**
 * The twelve columns both change tables print, in template order.
 *
 * Identical in templates/character-history-selected-view.html and the
 * `characterLogView` template in index.html, and the order is the column order
 * -- each `data-priority` is just the index plus one.
 *
 * This and `formatChangeEntry` below are display concerns living in the model
 * layer, which is deliberate: the log screen and the history screen render the
 * same table from the same rows, and the alternative is the same twelve names
 * and the same three-branch formatter written out twice.
 */
export const CHANGE_HEADERS = [
  'createdAt',
  'category',
  'name',
  'type',
  'old_value',
  'value',
  'old_free_value',
  'free_value',
  'old_cost',
  'cost',
  'old_text',
  'new_text',
] as const;

export type ChangeHeader = (typeof CHANGE_HEADERS)[number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `moment(d).format('lll')` -- "Aug 21, 2026 9:11 PM", in local time. */
function lll(date: Date): string {
  const hours24 = date.getHours();
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${hours}:${minutes} ${meridiem}`;
}

/**
 * One cell of a change table.
 *
 * Ports the `format_entry` both views define. Three things in it look like
 * clutter and are not:
 *
 * - `log.has(entry)` before `log.get(entry)`. See CharacterApprovalView's copy
 *   of the same comment: a recorded 0 must not render as an empty cell, and a
 *   truthiness test on the value alone would do exactly that.
 * - the fall through to `log[entry]`. `createdAt` is not an attribute, it is a
 *   property of the object, so `has("createdAt")` is false and the value has to
 *   be read off the object itself. It is the only column that takes this path,
 *   and it is the whole reason the branch exists.
 * - the `undefined` guard, which only CharacterHistoryView's copy carries. It
 *   prints the literal string "Undefined log", and it is reachable: the history
 *   template indexes `logs[idForPickedIndex]` with a picked index of -1
 *   whenever the character has no non-XP changes, which is the state every
 *   freshly created character is in.
 */
export function formatChangeEntry(change: Parse.Object | undefined, header: ChangeHeader): string {
  if (change === undefined) {
    console.log('Undefined log');
    return 'Undefined log';
  }
  const value = change.has(header)
    ? (change.get(header) as unknown)
    : (change as unknown as Record<string, unknown>)[header];
  if (value instanceof Date) return lll(value);
  return value === undefined || value === null ? '' : String(value);
}
