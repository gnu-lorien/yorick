import { Parse } from '../init';
import type { Character } from '../models/Character';
import { characterAcl } from './acl';

/**
 * A character's long texts: background, notes, extended print text.
 *
 * Ports the nine long-text methods on models/Character.js (:1133-:1300) and
 * models/LongText.js, which is nothing but `Parse.Object.extend("LongText")`
 * with an empty body -- so it is a class name here rather than a file.
 *
 * A LongText is a separate row keyed by (owner, category), never an attribute
 * of the character. That is the whole reason these methods exist: the three
 * bodies of prose are large, so the character sheet loads without them and each
 * screen pulls the one category it needs.
 *
 * Two pieces of state live on the character and are the part worth
 * understanding:
 *
 *   _ltCache    category -> LongText, or null for "asked, and there is none"
 *   _ltPromise  a chain every operation appends itself to
 *
 * The cache distinguishes *absent from the cache* from *absent on the server*.
 * `has_fetched_long_text` asks the first question and `get_fetched_long_text`
 * answers with the second, which is why a miss is stored as an explicit `null`
 * rather than by leaving the key out.
 *
 * The chain is what makes the cache worth having. Every method appends its work
 * with `.always()` -- `then(work, work)`, so a failure recovers rather than
 * poisoning everything queued behind it -- and the result is that two
 * overlapping calls for the same category run one after the other, and the
 * second finds the first one's answer in the cache instead of issuing a second
 * query. Dropping the serialisation would leave the cache correct and useless.
 *
 * The legacy versions also `trigger("change:longtext" + category)` after every
 * write, which is how the Backbone views learn to re-render. That does not port:
 * change notification is React state here (see docs/react-migration/README.md),
 * so a caller that changes a long text re-renders because it set state, not
 * because an event found it.
 */

/** The Parse class the texts live in. */
export const LONG_TEXT_CLASS = 'LongText';

/** The three categories the app writes, from mobileRouter.js:781-847. */
export type LongTextCategory = 'extended_print_text' | 'background' | 'notes';

export interface LongTextOptions {
  /** Re-read from the server even if the category is already cached. */
  update?: boolean;
}

/**
 * The two fields the legacy code hangs off the character object itself.
 *
 * Plain properties, not Parse attributes -- exactly as in the original, and for
 * the same reason: they must never be sent to the server on the next `save()`.
 * acl.ts stores `troupeIds` the same way and for the same reason.
 */
interface LongTextHost {
  _ltCache?: Record<string, Parse.Object | null>;
  _ltPromise?: Promise<unknown>;
}

function hostOf(character: Character): LongTextHost {
  return character as unknown as LongTextHost;
}

function cacheOf(character: Character): Record<string, Parse.Object | null> {
  const host = hostOf(character);
  host._ltCache ??= {};
  return host._ltCache;
}

/**
 * Queue `work` behind whatever this character's long-text calls are already
 * doing, and hand back its result.
 *
 * `then(work, work)` is `Parse.Promise.always`: the *next* operation runs
 * whether the previous one resolved or rejected. Chaining with a plain `.then`
 * instead would mean one failed query wedging every later long-text call on
 * that character for the life of the page.
 *
 * The rejection still reaches this call's own caller, because that caller holds
 * the promise this returns.
 */
function serialise<T>(character: Character, work: () => Promise<T>): Promise<T> {
  const host = hostOf(character);
  const next = (host._ltPromise ?? Promise.resolve()).then(work, work);
  host._ltPromise = next;
  return next;
}

export function longTextQuery(character: Character, category: string): Parse.Query {
  return new Parse.Query(LONG_TEXT_CLASS).equalTo('owner', character).equalTo('category', category);
}

/**
 * The character's text in this category, from the cache or the server.
 *
 * `null` means the server has no row for this category -- a character who has
 * never written a background. That is a cacheable answer and is cached, so the
 * empty case costs one query per page rather than one per render.
 */
export function getLongText(
  character: Character,
  category: string,
  options: LongTextOptions = {},
): Promise<Parse.Object | null> {
  return serialise(character, async () => {
    const cache = cacheOf(character);
    if (Object.hasOwn(cache, category) && !options.update) return cache[category] ?? null;

    const found = await longTextQuery(character, category).first();
    cache[category] = found ?? null;
    return cache[category] ?? null;
  });
}

/**
 * Prime the cache and hand back the character.
 *
 * The odd return value is the point: the router's handlers are written as
 * `get_character(cid).then(fetch_long_text).then(render)`, so this has to keep
 * the character flowing down the chain rather than replace it with the text.
 * The text is then read out of the cache with `getFetchedLongText`.
 */
export async function fetchLongText(
  character: Character,
  category: string,
  options: LongTextOptions = {},
): Promise<Character> {
  await getLongText(character, category, options);
  return character;
}

/**
 * Whether the server has a row in this category.
 *
 * Deliberately does not touch the cache, as the original does not: this asks a
 * question about the server, and answering it by populating the cache would
 * make a later `getLongText` return a text this call never looked at.
 */
export function hasLongText(character: Character, category: string): Promise<boolean> {
  return serialise(character, async () => {
    const found = await longTextQuery(character, category).first();
    return found !== undefined;
  });
}

/** Whether this category has been asked about at all. See the class comment. */
export function hasFetchedLongText(character: Character, category: string): boolean {
  return Object.hasOwn(cacheOf(character), category);
}

/**
 * The cached text, without a round trip.
 *
 * Three-valued, and callers rely on it: a `Parse.Object` is a text, `null` is
 * "the server has none", `undefined` is "nobody has asked yet".
 */
export function getFetchedLongText(
  character: Character,
  category: string,
): Parse.Object | null | undefined {
  return cacheOf(character)[category];
}

/**
 * Write the text in this category, creating the row if there is not one.
 *
 * Re-reads with `{update: true}` first. That is not caution about staleness so
 * much as about identity: writing through a cached object that another tab has
 * since deleted would recreate it, and re-reading is how the original decides
 * between `new LongText(...)` and `lt.set("text", ...)`.
 *
 * The `save()` is on the LongText alone -- the character is never saved here,
 * which is why editing a long text writes no VampireChange row and never
 * appears in the character log. That is intended (e2e/long-texts.spec.js:285
 * defends it): these texts can be long enough that logging them would bury the
 * audit trail.
 *
 * Unlike the rest of this module the write is *not* appended to the chain: the
 * original calls `get_long_text(...).then(save)` without assigning the result
 * back to `self._ltPromise`, so a concurrent read can interleave between the
 * re-read and the save. Reproduced rather than tightened, because making the
 * whole thing atomic would change which of two racing writers wins.
 */
export async function updateLongText(
  character: Character,
  category: string,
  newText: string,
): Promise<Parse.Object> {
  const existing = await getLongText(character, category, { update: true });

  let longText = existing;
  if (longText === null) {
    const LongText = Parse.Object.extend(LONG_TEXT_CLASS);
    longText = new LongText() as Parse.Object;
    longText.set({ category, owner: character, text: newText });
  } else {
    longText.set('text', newText);
  }

  // The same ACL the character carries, so a text never outlives the
  // permissions of the row it belongs to. It reads `owner` off the character
  // and the troupe ids off `troupeIds` -- see acl.ts, and note that a character
  // whose troupe membership has not been initialised silently grants no staff
  // access at all.
  longText.setACL(characterAcl(character));

  await longText.save();
  cacheOf(character)[category] = longText;
  return longText;
}

/**
 * Delete the row for this category, and forget it locally.
 *
 * `options.update` defaults to *true* here where `getLongText` defaults it to
 * false: destroying whatever happens to be in the cache would delete a row that
 * may no longer be the current one.
 *
 * The original's `destroy({wait: true})` is a Backbone collection option -- do
 * not remove the model from its collections until the server confirms -- and
 * there are no collections here, so there is nothing for it to mean.
 */
export async function removeLongText(
  character: Character,
  category: string,
  options: LongTextOptions = {},
): Promise<void> {
  const existing = await getLongText(character, category, { update: options.update ?? true });
  if (!existing) return;
  await existing.destroy();
  delete cacheOf(character)[category];
}

/**
 * Forget a category locally, leaving the server row alone.
 *
 * Used to drop a large body of text once a screen is done with it. Note it
 * removes the key rather than setting it to `null`, so `hasFetchedLongText`
 * goes back to false and the next read re-queries.
 */
export function freeFetchedLongText(character: Character, category: string): void {
  delete cacheOf(character)[category];
}

/**
 * Every long text this character has, with the text itself left behind.
 *
 * `select` fetches only owner, category and ACL, which is what makes this
 * affordable: the caller wants to know which categories exist and who may read
 * them, and the bodies are the expensive part. Pages with `each` rather than
 * `find` so a character with many categories is not silently truncated.
 *
 * These objects do not go in the cache, and must not: they have no `text`, and
 * a later `getFetchedLongText` returning one would look like an empty text.
 */
export function getMinimalLongTexts(character: Character): Promise<Parse.Object[]> {
  return serialise(character, async () => {
    const longTexts: Parse.Object[] = [];
    await new Parse.Query(LONG_TEXT_CLASS)
      .equalTo('owner', character)
      .select('owner', 'category', 'ACL')
      .each((longText) => {
        longTexts.push(longText);
      });
    return longTexts;
  });
}
