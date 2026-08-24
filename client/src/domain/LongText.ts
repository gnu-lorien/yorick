/**
 * Long texts -- the free-form prose attached to a character: background,
 * history, the printable extended text.
 *
 * Ported from `public/scripts/app/models/LongText.js`, which is an empty
 * `Parse.Object.extend("LongText")` and nothing else. Every operation on a long
 * text lives on `Character` (`get_long_text`, `update_long_text`,
 * `remove_long_text`, `get_minimal_long_texts`), because a long text is
 * identified by its owner and category rather than by anything of its own, and
 * because the character owns the serialising `_ltPromise` queue those methods
 * run through.
 *
 * So this module is deliberately thin: the type, a constructor, and the two
 * queries the character methods build. It exists so those queries are written
 * once and so a call site reads as a long-text read rather than as a string
 * literal.
 */
import Parse from '@/parse'
import { LongTextObject } from '@/parse/classes'

/** A long-text record. The registered class for className "LongText". */
export type LongText = LongTextObject

/**
 * The columns `get_minimal_long_texts` asks for.
 *
 * `ACL` is in the list on purpose. The minimal read is what tells a screen
 * WHICH long texts exist without paying for their bodies, and the ACL is what
 * tells it whether the viewer may see each one; dropping it would make every
 * text look readable until the full fetch failed.
 */
export const LONG_TEXT_MINIMAL_FIELDS = ['owner', 'category', 'ACL'] as const

/** A new, unsaved long text. The caller sets the ACL -- see `Character#get_me_acl`. */
export function createLongText(attributes?: Record<string, unknown>): LongText {
  return new LongTextObject(attributes)
}

/** Every long text. */
export function longTextQuery(): Parse.Query<LongText> {
  return new Parse.Query(LongTextObject)
}

/**
 * The one long text a character has in a category, if any.
 *
 * There is no uniqueness constraint on (owner, category) anywhere -- this is a
 * `first()` over an unordered query, so a character that somehow acquired two
 * rows in one category would show whichever the server returned first. The
 * source had the same shape; it is recorded here rather than guarded against.
 */
export function longTextQueryFor(owner: Parse.Object, category: string): Parse.Query<LongText> {
  return longTextQuery().equalTo('owner', owner).equalTo('category', category)
}

/**
 * Every long text a character has, without their bodies.
 *
 * `each()` rather than `find()`, so it pages past the 100-row default.
 */
export function minimalLongTextQueryFor(owner: Parse.Object): Parse.Query<LongText> {
  return longTextQuery().equalTo('owner', owner).select(...LONG_TEXT_MINIMAL_FIELDS)
}
