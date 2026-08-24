/**
 * The experience ledger, and the change-log / approval replay.
 *
 * Ported from `public/scripts/app/models/Character.js` (the `experience_*`,
 * `*_experience_notation`, `*_recorded_changes`, `*_approvals` and
 * `get_transformed*` methods), together with the four collections and three
 * models that only exist to serve them:
 * `collections/ExperienceNotationCollection.js`, `collections/Approvals.js`,
 * `collections/VampireChangeCollection.js`, `models/ExperienceNotation.js`,
 * `models/Approval.js`, `models/VampireChange.js` and `models/FauxSimpleTrait.js`.
 *
 * ## Why this file is the dangerous one
 *
 * A character's XP balance is **stored, not derived**. `experience_earned` and
 * `experience_spent` are columns on the character row; every notation row also
 * stores its own running `earned`/`spent` total alongside the `alteration_earned`
 * / `alteration_spent` delta that produced it. `experience_available()` is the
 * difference of the two character columns and nothing else.
 *
 * There is no server-side recalculation, no validation hook and no
 * reconciliation job. Whatever this code writes IS the balance, permanently,
 * for every character it touches. A port that computes the running totals even
 * slightly differently does not produce a visible error -- it quietly rewrites
 * every player's XP the next time they edit a trait. So the arithmetic below is
 * transcribed, not re-derived, including the parts that are wrong.
 *
 * The known-wrong parts are each marked `QUIRK:` where they live. In summary:
 *
 *   1. `add_experience_notation` "searches" for the new row's index with a
 *      predicate every row satisfies, so the answer is always 0. It works only
 *      because the ledger is sorted newest-first.
 *   2. `on_update_experience_notation` reads Backbone's changed-attribute hash,
 *      which holds NEW VALUES, and tests them for truthiness. Setting an
 *      alteration to `0` is therefore not seen as a change at all.
 *   3. `get_transformed` clones the character, and `clone()` does not deep-copy
 *      relations, so it repairs the sharing by nulling the relation's parent on
 *      the ORIGINAL and letting `initialize_troupe_membership` re-adopt it.
 *   4. When a change row names a trait the character no longer has, `_.xor`
 *      pushes `undefined` into the category array.
 *
 * None of the four are fixed here. Bug-compatibility is the requirement; the
 * E2E suite asserts the current behaviour.
 *
 * ## What the port changes structurally, and why
 *
 * **No `Parse.Collection`.** The Vue client does not load `parse-compat`, so
 * `Parse.Collection`, `cid`, `_byCid`, `getByCid` and model change events do not
 * exist. Each collection becomes a plain array in a `shallowRef`, plus the
 * collection's comparator as an explicit exported function, plus an explicit
 * re-sort at each point where the collection used to re-sort itself. The
 * comparators are load-bearing: the ledger arithmetic is defined over
 * newest-first order, and `.last()` on the approvals is only "the newest
 * approval" because that collection sorts ascending.
 *
 * **No change events.** The source hand-fires
 * `model.trigger('add'|'remove', model, ens, {index})` after a mutation
 * specifically to wake the views that were listening to the collection. There
 * is nothing to wake here: the arrays live in `shallowRef`s, so replacing the
 * array is the notification. The `{index}` payload the trigger carried is still
 * information a caller may want, so `add_experience_notation` and
 * `remove_experience_notation` RETURN it as a `LedgerMutation` instead. Ditto
 * `begin/finish_experience_notation_propagation`, which existed to show and hide
 * the jQuery Mobile spinner: they become the `onPropagationBegin` /
 * `onPropagationFinish` hooks in the constructor options, so a store or a page
 * can drive its own busy state.
 *
 * **Reactivity.** The arrays are `shallowRef`s and are REPLACED on every
 * structural change, never mutated in place -- a `Parse.Object` must never end
 * up inside a deep `reactive()` proxy (see `@/parse/reactivity`). Attribute
 * mutations on the rows themselves are picked up by `track`/`trackAll`, because
 * `installParseReactivity` wraps `set`.
 *
 * **Serialising queues.** `_experienceNotationsFetch`, `_addExperienceEntryWrapper`,
 * `_recordedChangesFetch`, `_approvalsFetch` and `_propagateExperienceUpdate` are
 * per-character promise chains built with Parse 1.5's `.always()`, which is
 * `then(cb, cb)`: a rejection becomes a fulfillment so the queue can never
 * wedge. They are ports of a mutex, not of cleanup code, and `queue()` below
 * reproduces them. `.finally()` is deliberately NOT used anywhere in this file:
 * it re-throws, which is exactly the wedge `.always()` was avoiding.
 */
import { shallowRef, type ShallowRef } from 'vue'
// `isEqual` and not `===`: the real-change test this mirrors is Parse 1.5's
// `_.isEqual(self.attributes[attr], val.value)`, and the attribute that most
// needs it is `entered`, a Date. Two Dates with the same time are never `===`.
import isEqual from 'lodash/isEqual'

import Parse from '@/parse'
import { experienceNotationQueryFor } from '@/domain/ExperienceNotation'
import {

  ApprovalObject,
  ExperienceNotationObject,
  VampireChangeObject,
} from '@/parse/classes'

/**
 * Parse 1.5's changed-attribute hash, as `on_update_experience_notation` reads it.
 *
 * This is a PRESENCE map, not a map of new values. `parse-1.5.0.js:5338` is
 * literally `options.changes[attr] = true`, guarded by an `isRealChange` test
 * that compares the incoming value against the stored one with `_.isEqual`
 * (`:5326-5331`). So an attribute is listed when, and only when, it actually
 * changed -- and it is listed as `true` regardless of what it changed to.
 *
 * That distinction is load-bearing in both directions, and the first port of
 * this file got it wrong in both:
 *
 * - `Character.js:582` is `if (c.alteration_earned || c.alteration_spent)`.
 *   Against a presence map this fires for ANY real change, **including a change
 *   to 0**. Against a map of new values, `0` is falsy and zeroing an alteration
 *   propagates nothing. `CharacterExperienceView.js:143` sets the attribute and
 *   deliberately does NOT call `en.save()` -- the propagation is what writes the
 *   row -- so under the wrong reading a storyteller correcting an XP award down
 *   to 0 sees the field show 0, nothing is saved, and the correction vanishes on
 *   the next reload while the character keeps spending against the old balance.
 *
 * - `Character.js:563` is `if (c.entered)`. Two `Date`s with the same time are
 *   `_.isEqual`, so re-confirming an unchanged date recorded nothing and no
 *   propagation ran. Without the real-change test, every no-op date edit issues
 *   a redundant `saveAll` of the whole recompute window.
 */
type ChangedAttributes = {
  entered?: true
  alteration_earned?: true
  alteration_spent?: true
}

/* ------------------------------------------------------------------ *
 * Structural types
 *
 * These are interfaces rather than the registered Parse subclasses for the
 * same reason `@/domain/rules/*` uses interfaces: the arithmetic is the thing
 * worth testing, and a test that has to stand up an initialised SDK to check a
 * running balance is a test nobody runs. Every real caller passes
 * `ExperienceNotationObject`, `VampireChangeObject`, `ApprovalObject` and the
 * ported `Character`, all of which satisfy these shapes.
 * ------------------------------------------------------------------ */

/** Anything `Parse.Object.saveAll` can be handed. */
export interface Saveable {
  save(...args: unknown[]): Promise<unknown>
}

/**
 * One row of the ledger: an `ExperienceNotation`.
 *
 * Attributes it carries: `entered` (Date), `reason` (string), `earned`,
 * `spent` (the STORED running totals), `alteration_earned`,
 * `alteration_spent` (this row's delta) and `owner` (a pointer to the
 * character).
 */
export interface ExperienceNotationLike extends Saveable {
  id?: string
  /* `any`, exactly as `Parse.Object.get` is typed: the attribute set is dynamic. */
  get(attribute: string): any
  set(attribute: string, value: unknown): unknown
  destroy(...args: unknown[]): Promise<unknown>
  setACL?(acl: Parse.ACL): unknown
}

/** One row of the audit log: a `VampireChange`. */
export interface VampireChangeLike {
  id?: string
  createdAt?: Date
  /* `any`, exactly as `Parse.Object.get` is typed: the attribute set is dynamic. */
  get(attribute: string): any
}

/** One `VampireApproval`. `get("change")` points at a `VampireChange`. */
export interface ApprovalLike {
  id?: string
  createdAt?: Date
  /* `any`, exactly as `Parse.Object.get` is typed: the attribute set is dynamic. */
  get(attribute: string): any
}

/** A trait as `get_transformed` reads it out of a character's category array. */
export interface TraitLike {
  /* `any`, exactly as `Parse.Object.get` is typed: the attribute set is dynamic. */
  get(attribute: string): any
}

/**
 * The slice of a character this module touches.
 *
 * `troupes` and `_ltCache` are instance properties rather than attributes --
 * they are not stored on the row -- and both are here only because
 * `get_transformed` reaches into them. See the comment on `get_transformed`.
 */
export interface XpCharacter {
  id?: string
  /* `any`, exactly as `Parse.Object.get` is typed: the attribute set is dynamic. */
  get(attribute: string): any
  set(attribute: string, value: unknown): unknown
  save(...args: unknown[]): Promise<unknown>
  /** Parse's shallow copy. See `get_transformed` for what it does not copy. */
  clone?(): XpCharacter
  /**
   * The `troupes` Parse relation, created by
   * `Character.initialize_troupe_membership`. Absent until that has run once.
   */
  troupes?: { parent: unknown } | null
  /** `Character`'s long-text cache, keyed by category. */
  _ltCache?: Record<string, unknown>
  /**
   * The ACL every notation is stamped with, from `Character.get_me_acl()`.
   * Optional on the interface so the arithmetic is testable without one; it is
   * NOT optional in production -- a notation saved without it is a row the
   * player's storytellers cannot read.
   */
  get_me_acl?(): Parse.ACL
  /** Set by `get_transformed` on the clone it returns. */
  transform_description?: TransformDescriptionEntry[]
}

/** A character that has been rewound by `get_transformed`. */
export type TransformedCharacter = XpCharacter & {
  transform_description: TransformDescriptionEntry[]
}

/**
 * One entry of the human-readable diff `get_transformed` accumulates.
 *
 * The source pushes two different untyped shapes into one array -- trait rows
 * carry `fake`, core rows carry `old_text` -- and `CharacterApprovalView` reads
 * both out of the same list, so they stay one type here with the fields
 * optional rather than becoming a discriminated union that would not match what
 * the views index into.
 */
export interface TransformDescriptionEntry {
  category: string
  name: string
  /** Trait rows only. `undefined` for a `define`, which un-creates the trait. */
  fake?: FauxSimpleTrait | undefined
  /** Core rows only. */
  old_text?: string | undefined
  type: 'changed' | 'define' | 'removed' | 'update'
}

/**
 * The attributes `_default_experience_notation` fills in.
 *
 * The index signature is not decoration: the source is
 * `_.defaults(options || {}, {...})`, which augments the caller's object and
 * hands the WHOLE thing to `new ExperienceNotation(...)`. Any extra key a
 * caller passes lands on the row, so extra keys are carried through here too.
 */
export interface ExperienceNotationOptions {
  entered?: Date
  reason?: string
  earned?: number
  spent?: number
  alteration_earned?: number
  alteration_spent?: number
  owner?: unknown
  [attribute: string]: unknown
}

/**
 * What the source announced with `model.trigger('add'|'remove', model, ens, {index})`.
 *
 * There are no collection events in the Vue client, so the payload is returned
 * instead of broadcast. `model` is deliberately the model the source passed,
 * which for `add` is NOT necessarily the notation that was just added -- see
 * the QUIRK on `add_experience_notation`.
 */
export interface LedgerMutation {
  model: ExperienceNotationLike
  index: number
  notations: readonly ExperienceNotationLike[]
}

/* ------------------------------------------------------------------ *
 * Comparators
 * ------------------------------------------------------------------ */

/**
 * `ExperienceNotationCollection`'s comparator: newest `entered` first.
 *
 * The ledger arithmetic is defined over this order and only this order. Each
 * row's running total is itself plus every row BELOW it, so "below" has to mean
 * "older". Reversing this comparator does not reorder a table, it changes what
 * every character's balance is.
 */
export function compare_experience_notations(
  leftm: ExperienceNotationLike,
  rightm: ExperienceNotationLike,
): number {
  const left = leftm.get('entered')
  const right = rightm.get('entered')
  if (left > right) {
    return -1
  } else if (right > left) {
    return 1
  }
  return 0
}

/**
 * `Approvals`' comparator: ASCENDING by `createdAt`.
 *
 * The source spells this by swapping the operands (`l = right.createdAt;
 * r = left.createdAt`) and then comparing with `_.gt`/`_.lt`, which reads like a
 * descending sort and is not one. It matters because `get_transformed_last_approved`
 * takes `approvals.last()` and means "the most recent approval", and
 * `get_approvals` pages forward from `approvals.last().createdAt`. Both are
 * wrong the moment this sorts the other way.
 */
export function compare_approvals(left: ApprovalLike, right: ApprovalLike): number {
  const l = right.createdAt
  const r = left.createdAt
  // `_.gt`/`_.lt` on Dates is `>`/`<` on their valueOf; undefined on either
  // side makes both comparisons false, which returns 0, which is what the
  // source did with an unsaved approval too.
  if (l !== undefined && r !== undefined && l > r) {
    return -1
  } else if (l !== undefined && r !== undefined && l < r) {
    return 1
  }
  return 0
}

/**
 * `VampireChangeCollection` declares no comparator, so the audit log keeps the
 * order the query returned it in -- ascending `createdAt`, set by
 * `_recorded_changes_query`. `takeRightWhile` in `get_transformed_last_approved`
 * depends on that, so there is deliberately no comparator here either.
 */

/* ------------------------------------------------------------------ *
 * lodash 3 translations
 *
 * The old app vendors lodash 3.10.0. These four are the array helpers
 * `get_transformed` uses, written out because the v3 -> v4 differences in this
 * area are silent and because the exact semantics (dedupe? reference equality?
 * what happens to `undefined`?) decide what a rewound character sheet shows.
 * ------------------------------------------------------------------ */

/**
 * `_.xor(a, b)` -- symmetric difference, deduplicated, elements of `a` first.
 *
 * Membership is reference equality for the objects this holds, matching
 * lodash's SameValueZero for everything except NaN, which cannot appear here.
 */
function xor<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = []
  for (const value of a) {
    if (!b.includes(value) && !out.includes(value)) out.push(value)
  }
  for (const value of b) {
    if (!a.includes(value) && !out.includes(value)) out.push(value)
  }
  return out
}

/** `_.without(list, value)` -- every occurrence removed, order preserved. */
function without<T>(list: readonly T[] | undefined, value: T): T[] {
  // lodash returns [] for a non-array first argument, which is reachable here:
  // a change row can name a category the character has never had.
  if (!Array.isArray(list)) return []
  return list.filter((entry) => entry !== value)
}

/** `_.union(a, b)` -- concatenation, deduplicated, first occurrence wins. */
function union<T>(a: readonly T[] | undefined, b: readonly T[]): T[] {
  const out: T[] = []
  for (const value of Array.isArray(a) ? a : []) {
    if (!out.includes(value)) out.push(value)
  }
  for (const value of b) {
    if (!out.includes(value)) out.push(value)
  }
  return out
}

/**
 * `_.takeRightWhile(list, predicate)` -- the longest suffix whose every element
 * satisfies the predicate, returned in the list's own order.
 *
 * Used to mean "every change recorded after the approved one". Note that when
 * NO element fails the predicate the whole list comes back, which is how a
 * character whose approved change has been deleted replays its entire history.
 */
function takeRightWhile<T>(list: readonly T[], predicate: (value: T, index: number) => boolean): T[] {
  let start = list.length
  while (start > 0) {
    const candidate = list[start - 1]
    // `noUncheckedIndexedAccess`: index is in range by construction, but the
    // compiler cannot see it, and a bare assertion is banned in this codebase.
    if (candidate === undefined) break
    if (!predicate(candidate, start - 1)) break
    start -= 1
  }
  return list.slice(start)
}

/* ------------------------------------------------------------------ *
 * FauxSimpleTrait
 * ------------------------------------------------------------------ */

let fauxTraitSequence = 0

/**
 * A trait that only ever exists in a rewound character sheet.
 *
 * The source is `Backbone.Model.extend(SimpleTraitMixin)` -- deliberately NOT a
 * `Parse.Object`, so that `get_transformed`'s reconstruction can never be
 * saved. It is reproduced here as a plain class for the same reason, plus one
 * the source did not have: a `Parse.Object` put into a rewound sheet would be
 * tracked by `@/parse/reactivity` and would be indistinguishable from a real
 * trait to anything that walks the character.
 *
 * `linkId()` was `this.id || this.cid`. There is no `cid` in the Vue client, so
 * per the migration's rule for client identity this generates a local id and
 * keeps it on the object. It is unique per process, not per document -- nothing
 * persists it, because nothing persists a faux trait.
 */
export class FauxSimpleTrait {
  /** Stands in for Backbone's `cid`. Never saved, never sent to the server. */
  readonly localId: string
  /** Always absent: a faux trait has no server row. Kept so `linkId` reads like the source. */
  readonly id: string | undefined = undefined
  /** Set by the approval view on traits that a rewind says were deleted. */
  is_deleted = false

  private readonly attributes: Record<string, unknown>

  constructor(attributes: Record<string, unknown> = {}) {
    fauxTraitSequence += 1
    this.localId = `faux${fauxTraitSequence}`
    this.attributes = { ...attributes }
  }

  /* `any`, exactly as `Parse.Object.get` is typed: the attribute set is dynamic. */
  get(attribute: string): any {
    return this.attributes[attribute]
  }

  set(attribute: string, value: unknown): this {
    this.attributes[attribute] = value
    return this
  }

  linkId(): string {
    return this.id || this.localId
  }

  /** SimpleTraitMixin: everything before the ": " specialization separator. */
  get_base_name(): string {
    const name: string = this.get('name') || ''
    return name.split(': ')[0] ?? ''
  }

  get_specialization(): string | undefined {
    const name: string = this.get('name') || ''
    return name.split(': ')[1]
  }

  has_specialization(): boolean {
    const name: string = this.get('name') || ''
    return name.indexOf(': ') !== -1
  }

  set_specialization(specialization: string | undefined): this {
    if (!specialization) {
      this.set('name', this.get_base_name())
    } else {
      this.set('name', `${this.get_base_name()}: ${specialization}`)
    }
    return this
  }
}

/* ------------------------------------------------------------------ *
 * Promise helpers
 * ------------------------------------------------------------------ */

/**
 * `Parse.Promise.prototype.always` -- `then(cb, cb)`.
 *
 * Not `.finally()`. `finally` re-throws whatever it was handed, so one rejected
 * link would leave every later link in the chain rejected and the queue wedged
 * for the lifetime of the character. `always` converts a rejection into a
 * fulfillment, which is the entire point of using it as a mutex, and it
 * propagates the callback's return value (a `.finally` does not).
 */
function queue<T>(previous: Promise<unknown>, work: () => Promise<T> | T): Promise<T> {
  return previous.then(work, work)
}

/**
 * `Parse.Promise.when(a, b)`, honestly.
 *
 * `Promise.all` is not a translation of this. `when`:
 *   - waits for EVERY input to settle, then
 *   - resolves with the results as SEPARATE ARGUMENTS (a tuple here), or
 *   - rejects with an ARRAY of errors indexed to the inputs.
 * `Promise.all` rejects on the first failure without waiting for the rest, and
 * rejects with the single error. `remove_experience_notation` runs a destroy and
 * a batch save side by side and must not abandon one because the other failed.
 */
async function when2<A, B>(a: Promise<A>, b: Promise<B>): Promise<[A, B]> {
  const settled = await Promise.allSettled([a, b])
  const errors: unknown[] = new Array(settled.length)
  let hadError = false
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      errors[index] = outcome.reason
      hadError = true
    }
  })
  if (hadError) throw errors
  const [first, second] = settled
  // Both are fulfilled here; the narrowing is spelled out rather than asserted.
  if (first === undefined || second === undefined) throw errors
  if (first.status !== 'fulfilled' || second.status !== 'fulfilled') throw errors
  return [first.value, second.value]
}

/* ------------------------------------------------------------------ *
 * The ledger arithmetic -- free functions, no I/O
 * ------------------------------------------------------------------ */

/**
 * `Character.experience_available`.
 *
 * Verbatim: the difference of two stored columns. It returns `NaN` when either
 * column is missing, which is what the source returns and what a brand-new
 * character briefly shows. It is deliberately NOT defended with `|| 0`: a zero
 * here would render as a real balance of zero and hide the fact that the row
 * has no XP columns yet, and `?? 0` at a numeric boundary is exactly the class
 * of mistake that made two whole trait categories free.
 */
export function experience_available(character: XpCharacter): number {
  return character.get('experience_earned') - character.get('experience_spent')
}

/**
 * `Character._propagate_experience_notation_change` -- the running-balance recompute.
 *
 * Transcribed. The shape, for the record:
 *
 *   - The seed is the row at `index + 1`, i.e. the newest row OLDER than the
 *     window, whose running total is by definition already correct. When the
 *     window reaches the bottom of the ledger there is no such row and the seed
 *     is a throwaway notation with `earned: 0, spent: 0`.
 *   - `reduceRight` over `[0 .. index]` walks the window oldest-first, so each
 *     row is computed from the row below it, which was computed a step earlier.
 *   - `earned = alteration_earned + previous.earned`, and the same for `spent`.
 *     No clamping, no rounding, no `|| 0`: a missing alteration yields `NaN` and
 *     that `NaN` then poisons every row above it, which is the current behaviour
 *     and is why the defaults in `_default_experience_notation` matter.
 *   - The sets are silent in the source because a `change` event here would
 *     re-enter `on_update_experience_notation`. There are no events in this
 *     client, so silence is the default; Vue sees the write through the
 *     `@/parse/reactivity` wrapper on `set`.
 *   - The FINAL row of the reduce -- the newest row in the window, or the seed
 *     when the window was empty -- is copied onto the character as
 *     `experience_earned` / `experience_spent`. That copy is the character's
 *     balance. There is no other source of truth for it anywhere in the system.
 *
 * Returns the objects to save, in the source's order: `reduceRight` walks the
 * newest-first window from its end, so the touched notations come out OLDEST
 * first, and the character is appended last.
 */
export function propagate_experience_notation_change(
  character: XpCharacter,
  experience_notations: readonly ExperienceNotationLike[],
  index: number,
  makeDefaultNotation: () => ExperienceNotationLike,
): Saveable[] {
  let initial_accumulator: ExperienceNotationLike
  if (index + 1 < experience_notations.length) {
    const seed = experience_notations[index + 1]
    // `noUncheckedIndexedAccess`: guarded by the bounds test above. Spelled out
    // rather than asserted, because an assertion here would be a silent `0`
    // waiting to happen.
    if (seed === undefined) {
      initial_accumulator = makeDefaultNotation()
    } else {
      initial_accumulator = seed
    }
  } else {
    initial_accumulator = makeDefaultNotation()
  }

  const altered_ens: Saveable[] = []
  const recompute_window = experience_notations.slice(0, index + 1)
  let previous_en = initial_accumulator
  for (let i = recompute_window.length - 1; i >= 0; i -= 1) {
    const en = recompute_window[i]
    if (en === undefined) continue
    const tearned = en.get('alteration_earned') + previous_en.get('earned')
    en.set('earned', tearned)
    const tspent = en.get('alteration_spent') + previous_en.get('spent')
    en.set('spent', tspent)
    altered_ens.push(en)
    previous_en = en
  }
  const final_en = previous_en

  character.set('experience_earned', final_en.get('earned'))
  character.set('experience_spent', final_en.get('spent'))
  altered_ens.push(character)
  return altered_ens
}

/* ------------------------------------------------------------------ *
 * get_transformed -- replaying the audit log backwards
 * ------------------------------------------------------------------ */

/**
 * `Character.get_transformed` -- rewind a character by undoing `changes`.
 *
 * The caller passes the changes newest-first (see `get_transformed_last_approved`)
 * and each one is UNDONE, so the result is what the sheet looked like before
 * them. That inversion is why `define` removes a trait and `remove` adds one
 * back.
 *
 * ## The clone, and the three effects that must survive the port
 *
 * `this.clone()` is Parse's shallow copy, and it does not deep-copy a
 * `Parse.Relation`: the clone ends up pointing at the SAME relation object as
 * the original, whose `parent` still says "the original". The source's fix is
 * to null the parent ON THE ORIGINAL -- "I have to change the parent and hope
 * nothing is still set on them", in its own words -- and to rely on
 * `Character.initialize_troupe_membership`, which tests `_.isNull(self.troupes.parent)`
 * and re-adopts the relation on its next run. It is repair-by-collision, and
 * removing either half breaks the other. All three effects are reproduced:
 *
 *   1. `clone()` is still what builds the alternate character.
 *   2. `character.troupes.parent` is set to `null` on the ORIGINAL, but only
 *      when `troupes` is defined -- i.e. only once `initialize_troupe_membership`
 *      has run, which is the `mustFixBrokenRelation` test.
 *   3. `_ltCache` is copied by REFERENCE onto the clone, so the rewound sheet
 *      shares the original's long-text cache. The source calls that "include
 *      extended printed text on transformed character by default"; the sharing
 *      also means a long text fetched through the clone lands on the original,
 *      which is load-bearing for the print view and is left alone.
 *
 * Nothing here is `deep`-copied and nothing here is safer than the source. If a
 * later change replaces `clone()`, it has to keep all three or state what it
 * did instead.
 */
export function get_transformed(
  character: XpCharacter,
  changes: readonly VampireChangeLike[],
): TransformedCharacter {
  // The source opens with "do not define self to prevent self-modification".
  // It then modifies `this.troupes` anyway, three lines later.
  const mustFixBrokenRelation = character.troupes !== undefined && character.troupes !== null
  if (character.clone === undefined) {
    throw new Error('get_transformed needs a cloneable character')
  }
  const c = character.clone() as TransformedCharacter
  if (mustFixBrokenRelation && character.troupes) {
    character.troupes.parent = null
  }
  c._ltCache = character._ltCache
  const description: TransformDescriptionEntry[] = []

  for (const change of changes) {
    if (change.get('category') === 'experience') {
      // Belt and braces with `_recorded_changes_query`: an XP notation is not a
      // trait and not a text attribute, so there is nothing here to replay onto
      // the character.
      continue
    }
    if (change.get('category') !== 'core') {
      const category: string = change.get('category')
      const existing: TraitLike[] | undefined = c.get(category)
      const current: TraitLike | undefined = Array.isArray(existing)
        ? existing.find((st: TraitLike | undefined) => {
            if (st === undefined) {
              // Source keeps this log and then dereferences anyway. Preserved:
              // a character whose category array has a hole is a fetch that did
              // not complete, and swallowing it here would turn a loud failure
              // into a wrong sheet.
              console.log(
                'Something went wrong fetching the full character object and now a name is undefined',
              )
            }
            const trait = st as TraitLike
            return trait.get('name') === change.get('name')
          })
        : undefined

      // The undo values: `old_*` when the change recorded one, otherwise the
      // change's own value. `||` not `??`, as in the source -- an `old_value` of
      // 0 falls through to `value`, which is a difference nobody has measured
      // and which is not being changed here.
      const trait = new FauxSimpleTrait({
        name: change.get('old_text') || change.get('name'),
        free_value: change.get('free_value'),
        value: change.get('old_value') || change.get('value'),
        cost: change.get('old_cost') || change.get('cost'),
        category: change.get('category'),
      })

      if (change.get('type') === 'update') {
        // QUIRK: when the trait is no longer on the sheet, `current` is
        // `undefined` and `xor` pushes `undefined` INTO the category array,
        // because `undefined` appears in exactly one of the two lists. Every
        // later pass over that category then hits the `st === undefined` branch
        // above. Reproduced, not fixed.
        c.set(category, xor(Array.isArray(existing) ? existing : [], [current, trait]))
        description.push({
          category: category,
          name: change.get('name'),
          fake: trait,
          type: 'changed',
        })
      } else if (change.get('type') === 'define') {
        // Undoing a definition: the trait did not exist yet.
        c.set(category, without(existing, current))
        description.push({
          category: category,
          name: trait.get('name'),
          fake: undefined,
          type: 'define',
        })
      } else if (change.get('type') === 'remove') {
        // Undoing a removal: put the trait back.
        c.set(category, union(existing, [trait]))
        description.push({
          category: category,
          name: trait.get('name'),
          fake: trait,
          type: 'removed',
        })
      }
    } else {
      if (change.get('type') === 'core_define') {
        c.set(change.get('name'), undefined)
        description.push({
          category: change.get('category'),
          name: change.get('name'),
          old_text: undefined,
          type: 'define',
        })
      } else if (change.get('type') === 'core_update') {
        c.set(change.get('name'), change.get('old_text'))
        description.push({
          category: change.get('category'),
          name: change.get('name'),
          old_text: change.get('old_text'),
          type: 'update',
        })
      }
    }
  }

  c.transform_description = description
  return c
}

/* ------------------------------------------------------------------ *
 * The ledger object
 * ------------------------------------------------------------------ */

export interface CharacterExperienceOptions {
  /**
   * Builds a notation row. Defaults to a real `ExperienceNotation` Parse
   * object; injectable so the arithmetic can be exercised without an SDK.
   */
  createNotation?: (attributes: Record<string, unknown>) => ExperienceNotationLike
  /** Defaults to `Parse.Object.saveAll`. */
  saveAll?: (objects: readonly Saveable[]) => Promise<unknown>
  /** Replaces `trigger("begin_experience_notation_propagation")`. */
  onPropagationBegin?: () => void
  /** Replaces `trigger("finish_experience_notation_propagation")`. */
  onPropagationFinish?: () => void
}

/**
 * The per-character experience ledger, change log and approval list.
 *
 * One instance per character, held for as long as the character is held. It
 * owns the three arrays that used to be `Parse.Collection`s and the five
 * promise chains that used to be instance properties on the character.
 */
export class CharacterExperience {
  readonly character: XpCharacter

  /** `Character.experience_notations`. Newest `entered` first, always. */
  readonly notations: ShallowRef<readonly ExperienceNotationLike[]> = shallowRef([])
  /** `Character.recorded_changes`. Ascending `createdAt`, as queried. */
  readonly recordedChanges: ShallowRef<readonly VampireChangeLike[]> = shallowRef([])
  /** `Character.approvals`. Ascending `createdAt`, so the last is the newest. */
  readonly approvals: ShallowRef<readonly ApprovalLike[]> = shallowRef([])

  /*
   * `!_.isUndefined(self.experience_notations)` and friends. The source tested
   * whether the COLLECTION had been constructed, not whether it had loaded --
   * a second call made while the first fetch is still in flight returns
   * immediately with an empty collection. Reproduced with an explicit flag,
   * because a plain empty array cannot express "constructed but not fetched".
   */
  private notationsInitialised = false
  private recordedChangesInitialised = false
  private approvalsInitialised = false

  /* The five serialising queues, each `Parse.Promise.as()` until first used. */
  private _experienceNotationsFetch: Promise<unknown> = Promise.resolve()
  private _addExperienceEntryWrapper: Promise<unknown> = Promise.resolve()
  private _recordedChangesFetch: Promise<unknown> = Promise.resolve()
  private _approvalsFetch: Promise<unknown> = Promise.resolve()
  private _propagateExperienceUpdate: Promise<unknown> = Promise.resolve()

  private readonly options: CharacterExperienceOptions

  constructor(character: XpCharacter, options: CharacterExperienceOptions = {}) {
    this.character = character
    this.options = options
  }

  /* ---------------- experience_available ---------------- */

  /** See the free function. */
  experience_available(): number {
    return experience_available(this.character)
  }

  /* ---------------- notation construction ---------------- */

  /**
   * `Character._default_experience_notation`.
   *
   * The defaults are the reason the arithmetic terminates in numbers rather
   * than `NaN`: a row with no `alteration_earned` would poison every row above
   * it, and every row above that, all the way to the character's stored
   * balance. `_.defaults` fills only keys that are absent or `undefined`, so a
   * caller passing `alteration_earned: 0` keeps its zero -- these zeroes are
   * `_.defaults`, not the defensive `|| 0` this codebase bans at numeric
   * boundaries.
   */
  private _default_experience_notation(
    options: ExperienceNotationOptions = {},
  ): ExperienceNotationLike {
    const properties: Record<string, unknown> = { ...options }
    const defaults: Record<string, unknown> = {
      entered: new Date(),
      reason: 'Unspecified reason',
      earned: 0,
      spent: 0,
      alteration_earned: 0,
      alteration_spent: 0,
      owner: this.character,
    }
    for (const key of Object.keys(defaults)) {
      if (properties[key] === undefined) properties[key] = defaults[key]
    }
    const create =
      this.options.createNotation ??
      ((attributes: Record<string, unknown>) =>
        new ExperienceNotationObject(attributes) as unknown as ExperienceNotationLike)
    const en = create(properties)
    // `en.setACL(self.get_me_acl())`. The ACL is what makes the row readable by
    // the character's storytellers; a notation saved without it is invisible to
    // everyone but its owner. It is conditional only so the arithmetic can be
    // unit-tested; the `Character` port must supply `get_me_acl`.
    const acl = this.character.get_me_acl?.()
    if (acl !== undefined && en.setACL) {
      en.setACL(acl)
    }
    return en
  }

  private saveAll(objects: readonly Saveable[]): Promise<unknown> {
    if (this.options.saveAll) return this.options.saveAll(objects)
    return Parse.Object.saveAll(objects as unknown as Parse.Object[])
  }

  /* ---------------- fetching the ledger ---------------- */

  /**
   * `Character.get_experience_notations`.
   *
   * The source took `register` and `already_exists` callbacks so a Backbone
   * view could subscribe to the collection it was handed. Both are dropped:
   * `this.notations` is a `shallowRef` a component can read directly, which is
   * the subscription.
   */
  get_experience_notations(): Promise<readonly ExperienceNotationLike[]> {
    if (this.notationsInitialised) {
      return Promise.resolve(this.notations.value)
    }
    this.notationsInitialised = true
    // The source also wired `on("change")` / `on("remove")` here. There are no
    // collection events in this client: callers reach
    // `on_update_experience_notation` / `on_remove_experience_notation` through
    // `set_experience_notation_attributes` and `remove_experience_notation`.
    return this.fetch_experience_notations()
  }

  /**
   * `Character.fetch_experience_notations`.
   *
   * The query orders by `entered` then `createdAt` descending; the comparator
   * then re-sorts on `entered` alone, which is why `createdAt` only breaks ties
   * that arrive from the server and is not a stable tiebreak afterwards.
   */
  fetch_experience_notations(): Promise<readonly ExperienceNotationLike[]> {
    this._experienceNotationsFetch = queue(this._experienceNotationsFetch, async () => {
      // The shared builder, not a second copy of the same query -- it is where
      // the `limit(1000)` lives, and a hand-rolled duplicate here is exactly
      // how this fetch ended up capped at Parse's default page of 100 while
      // the timeline's was not.
      const q = experienceNotationQueryFor(this.character as unknown as Parse.Object)
      const found = (await q.find()) as unknown as ExperienceNotationLike[]
      // `fetch({reset: true})` -- replace, do not merge.
      this.notations.value = found.slice().sort(compare_experience_notations)
      this.notationsInitialised = true
      return this.notations.value
    })
    return this._experienceNotationsFetch as Promise<readonly ExperienceNotationLike[]>
  }

  /**
   * Adopt an already-fetched ledger.
   *
   * There is no equivalent in the source, where the collection could only be
   * filled by its own query. It exists because a Pinia store may already hold
   * the rows, and because the propagation tests need a hand-built ledger.
   */
  seed_experience_notations(notations: readonly ExperienceNotationLike[]): void {
    this.notations.value = notations.slice().sort(compare_experience_notations)
    this.notationsInitialised = true
  }

  /** `Character.wait_on_current_experience_update`. */
  wait_on_current_experience_update(): Promise<unknown> {
    return this._propagateExperienceUpdate
  }

  /* ---------------- propagation ---------------- */

  /**
   * `Character._finalize_triggered_experience_notation_changes`.
   *
   * The recompute happens SYNCHRONOUSLY and immediately -- only the batch save
   * is queued. That ordering is why the screen can show the new balance before
   * the server has it, and why `wait_on_current_experience_update` exists for
   * anything that needs the write to have landed.
   *
   * DEVIATION, stated per the migration's queue rule: the source ends this
   * chain with `.fail(log)`, and Parse 1.5 runs with `_isPromisesAPlusCompliant:
   * false`, so a `fail` handler that returns nothing leaves the chain REJECTED.
   * The next call then appends `.done(saveAll)` to a rejected promise, which
   * SKIPS the save -- one failed batch silently stops every later batch from
   * being written, while the character's in-memory balance keeps moving. This
   * port logs and then resolves, so the queue heals. It is a behaviour change on
   * the failure path only, and it is the safer direction: the alternative is a
   * character whose stored balance stops tracking its ledger with no error
   * anywhere.
   */
  private _finalize_triggered_experience_notation_changes(changed_index: number): Promise<unknown> {
    const altered_ens = this._propagate_experience_notation_change(
      this.notations.value,
      changed_index,
    )
    this._propagateExperienceUpdate = this._propagateExperienceUpdate
      .then(() => this.saveAll(altered_ens))
      .then(() => {
        this.options.onPropagationFinish?.()
      })
      .catch((error: unknown) => {
        if (Array.isArray(error)) {
          for (const e of error) {
            console.log('Something failed' + (e as { message?: string })?.message)
          }
        } else {
          console.log('error updating experience' + (error as { message?: string })?.message)
        }
      })
    return this._propagateExperienceUpdate
  }

  /**
   * `_propagate_experience_notation_change`, with this instance's hooks bound.
   *
   * Not private: `Character` delegates to it, because the legacy model exposed
   * it under this exact name and the recompute is a legitimate thing to ask a
   * character for -- `CharacterExperienceView` calls it on every notation edit.
   */
  _propagate_experience_notation_change(
    experience_notations: readonly ExperienceNotationLike[],
    index: number,
  ): Saveable[] {
    this.options.onPropagationBegin?.()
    return propagate_experience_notation_change(this.character, experience_notations, index, () =>
      this._default_experience_notation(),
    )
  }

  /* ---------------- reacting to an edited row ---------------- */


  /**
   * `Character.on_update_experience_notation`.
   *
   * `changed` is Parse 1.5's `options.changes` hash -- a PRESENCE map, see
   * `ChangedAttributes`. An attribute is listed only when it really changed,
   * and is listed as `true` whatever it changed to, which is why
   * `if (c.alteration_earned || c.alteration_spent)` fires for a correction
   * down to `0` as readily as for one up to `40`.
   *
   * The recompute window is asymmetric on purpose. `previous_index` is captured
   * BEFORE the re-sort, and the window is widened to the further of the two
   * positions, because a row that moves OLDER passes rows that must be
   * recomputed while a row that moves NEWER does not -- recomputing only from
   * the new index would leave the rows it passed holding totals that count it
   * twice.
   */
  on_update_experience_notation(
    en: ExperienceNotationLike,
    changed: ChangedAttributes = {},
  ): Promise<unknown> {
    let changedFlag = false
    let previous_index: number | undefined

    if (changed.entered) {
      changedFlag = true
      previous_index = this.notations.value.indexOf(en)
      // `self.experience_notations.sort()`. There is no self-sorting collection
      // here, so the re-sort is explicit -- and the array is REPLACED rather
      // than sorted in place, so the `shallowRef` notifies.
      this.notations.value = this.notations.value.slice().sort(compare_experience_notations)
    }
    if (changed.alteration_earned || changed.alteration_spent) {
      changedFlag = true
    }
    if (!changedFlag) {
      return Promise.resolve([])
    }

    let changed_index = this.notations.value.indexOf(en)
    if (previous_index !== undefined && previous_index > changed_index) {
      changed_index = previous_index
    }
    return this._finalize_triggered_experience_notation_changes(changed_index)
  }

  /**
   * `Character.on_remove_experience_notation`.
   *
   * The source read the index out of the Backbone remove event's options; here
   * the caller passes it, and `remove_experience_notation` is the only caller.
   */
  on_remove_experience_notation(index: number): Promise<unknown> {
    return this._finalize_triggered_experience_notation_changes(index)
  }

  /**
   * Set attributes on a row and run the propagation the change event used to.
   *
   * No equivalent in the source, where `en.set(...)` fired a Backbone `change`
   * and the collection forwarded it to `on_update_experience_notation`. With no
   * events, something has to make that call, and leaving it to each view is how
   * a screen ends up editing the ledger without recomputing it.
   *
   * The `changed` hash handed on is built the way Parse 1.5 built it: an
   * attribute appears, mapped to the literal `true`, only when its new value
   * differs from the one already stored. See `ChangedAttributes`.
   *
   * `reason` is accepted and set but never propagates: it does not enter the
   * arithmetic, and the source's view saved it explicitly (`en.save()`), which
   * the caller must still do.
   */
  set_experience_notation_attributes(
    en: ExperienceNotationLike,
    attributes: {
      entered?: Date
      alteration_earned?: number
      alteration_spent?: number
      reason?: string
    },
  ): Promise<unknown> {
    const changed: ChangedAttributes = {}

    const record = (key: 'entered' | 'alteration_earned' | 'alteration_spent', value: unknown) => {
      // `isRealChange` first, then set. Reading the current value after the set
      // would compare the attribute with itself and never record anything.
      if (!isEqual(en.get(key), value)) changed[key] = true
      en.set(key, value)
    }

    if (attributes.entered !== undefined) record('entered', attributes.entered)
    if (attributes.alteration_earned !== undefined) {
      record('alteration_earned', attributes.alteration_earned)
    }
    if (attributes.alteration_spent !== undefined) {
      record('alteration_spent', attributes.alteration_spent)
    }
    if (attributes.reason !== undefined) {
      en.set('reason', attributes.reason)
    }
    return this.on_update_experience_notation(en, changed)
  }

  /* ---------------- adding and removing rows ---------------- */

  /**
   * `Character.add_experience_notation`.
   *
   * QUIRK, reproduced deliberately. The source adds the new notation to the
   * collection and then "finds" its index with:
   *
   *     for (var i = 0; i < ens.models.length; i++) {
   *       model = ens.models[i];
   *       if (ens._byCid[model.cid]) { index = i; break; }
   *     }
   *
   * `_byCid` is the collection's own index of its own members, so the test is
   * true for EVERY model and the loop always breaks on the first iteration.
   * `index` is always `0` and `model` is always `ens.models[0]`. The code is
   * correct anyway -- but only because the ledger is sorted newest-first and a
   * notation entered "now" lands at 0.
   *
   * The result is reproduced, not the search. Rewriting it to find the actual
   * row would change the recompute window for any caller that passes an
   * `entered` in the past, and a different window is a different stored balance
   * on a live character. If that is ever worth fixing it is its own change with
   * its own test, not a side effect of a port.
   *
   * The returned `LedgerMutation` replaces `model.trigger('add', model, ens, {index})`.
   * `model` is `notations[0]`, matching the source -- which is the newly added
   * row in every case the app actually produces, and is not when `entered` is
   * backdated.
   */
  add_experience_notation(options: ExperienceNotationOptions = {}): Promise<LedgerMutation> {
    this._addExperienceEntryWrapper = queue(this._addExperienceEntryWrapper, () =>
      this.get_experience_notations(),
    ).then(async () => {
      const en = this._default_experience_notation(options)
      // `ens.add(en, {silent: true})` -- Backbone inserts and re-sorts. No
      // events here, so only the insert-and-sort survives.
      this.notations.value = this.notations.value.concat([en]).sort(compare_experience_notations)

      // The always-zero search, written out so it is obvious it is always zero.
      const index = this.notations.value.length > 0 ? 0 : undefined
      const model = index === undefined ? undefined : this.notations.value[index]
      if (index === undefined || model === undefined) {
        // Unreachable: the row was just added. The source would have thrown on
        // `model.trigger` here instead.
        throw new Error('experience ledger empty immediately after an add')
      }

      const altered_ens = this._propagate_experience_notation_change(this.notations.value, index)
      await this.saveAll(altered_ens)
      this.options.onPropagationFinish?.()
      const mutation: LedgerMutation = { model, index, notations: this.notations.value }
      return mutation
    })
    return this._addExperienceEntryWrapper as Promise<LedgerMutation>
  }

  /**
   * `Character.remove_experience_notation`.
   *
   * The source accepts a model or an array and only ever uses the first
   * element, so this takes one row. The index is read BEFORE the removal, which
   * is what makes the recompute window right: after the row is gone, the row
   * that inherits its index is the one whose running total is now wrong, and
   * `index + 1` is the first row below the window that is still correct.
   *
   * `Parse.Promise.when(destroy, saveAll)` is not `Promise.all` -- see `when2`.
   * The batch save must still be attempted when the destroy fails and vice
   * versa, because a half-applied removal leaves the stored balances and the
   * ledger disagreeing.
   *
   * Note this method runs on NO queue in the source. It is not serialised
   * against `add_experience_notation`, and two removals started together can
   * interleave. Left as-is.
   */
  remove_experience_notation(en: ExperienceNotationLike): Promise<LedgerMutation> {
    const model = en
    return this.get_experience_notations().then(async () => {
      const index = this.notations.value.indexOf(en)
      // `ens.remove(en, {silent: true})`.
      this.notations.value = this.notations.value.filter((row) => row !== en)
      const altered_ens = this._propagate_experience_notation_change(this.notations.value, index)
      await when2(en.destroy(), this.saveAll(altered_ens))
      this.options.onPropagationFinish?.()
      return { model, index, notations: this.notations.value }
    })
  }

  /* ---------------- the change log ---------------- */

  /**
   * `Character._recorded_changes_query`.
   *
   * `recorded_changes` is the approval and history TIMELINE, not the whole
   * audit log. Every row in it is replayed by `get_transformed`, which assumes
   * a row describes either a trait (any category but "core") or a text
   * attribute ("core"). R47b added `experience` rows for XP notations, and
   * those are neither: replaying one manufactures a `FauxSimpleTrait` in a
   * category no venue has, and the approval view -- which reconstructs the
   * character at every step -- never finishes rendering.
   *
   * They belong in the log, which queries `VampireChange` directly, and not in
   * a timeline of approvable states: "approve up to this XP award" is not a
   * thing a storyteller can act on.
   *
   * The `limit(1000)` is the source's, and it is a real ceiling: a character
   * with more than 1000 non-experience changes silently loses the oldest of
   * them from every rewind.
   */
  private _recorded_changes_query(): Parse.Query<VampireChangeObject> {
    return new Parse.Query(VampireChangeObject)
      .equalTo('owner', this.character as unknown as Parse.Object)
      .notEqualTo('category', 'experience')
      .addAscending('createdAt')
      .limit(1000)
  }

  /**
   * `Character.get_recorded_changes`.
   *
   * The source also did `self.on("saved", self.update_recorded_changes, self)`
   * so a character save refreshed the log. There is no "saved" event here;
   * whatever performs the save calls `update_recorded_changes()`.
   */
  get_recorded_changes(): Promise<readonly VampireChangeLike[]> {
    if (this.recordedChangesInitialised) {
      return this.update_recorded_changes()
    }
    this.recordedChangesInitialised = true
    return this.fetch_recorded_changes()
  }

  /** `Character.update_recorded_changes` -- append rows newer than the last held. */
  update_recorded_changes(): Promise<readonly VampireChangeLike[]> {
    if (this.recordedChanges.value.length === 0) {
      return this.fetch_recorded_changes()
    }
    this._recordedChangesFetch = queue(this._recordedChangesFetch, async () => {
      const last = this.recordedChanges.value[this.recordedChanges.value.length - 1]
      if (last === undefined) return this.recordedChanges.value
      const lastCreated = last.createdAt
      const q = this._recorded_changes_query()
      if (lastCreated !== undefined) q.greaterThan('createdAt', lastCreated)
      const found = (await q.find()) as unknown as VampireChangeLike[]
      // `fetch({add: true})` -- merge, keeping what is already held. Backbone
      // deduplicated by id; so does this. Order stays as queried (ascending
      // createdAt), because `VampireChangeCollection` has no comparator and
      // `get_transformed_last_approved` reads the array from the right.
      const known = new Set(this.recordedChanges.value.map((change) => change.id))
      const additions = found.filter((change) => change.id === undefined || !known.has(change.id))
      this.recordedChanges.value = this.recordedChanges.value.concat(additions)
      return this.recordedChanges.value
    })
    return this._recordedChangesFetch as Promise<readonly VampireChangeLike[]>
  }

  /** `Character.fetch_recorded_changes` -- replace the whole log. */
  fetch_recorded_changes(): Promise<readonly VampireChangeLike[]> {
    this._recordedChangesFetch = queue(this._recordedChangesFetch, async () => {
      const found = (await this._recorded_changes_query().find()) as unknown as VampireChangeLike[]
      this.recordedChanges.value = found
      this.recordedChangesInitialised = true
      return this.recordedChanges.value
    })
    return this._recordedChangesFetch as Promise<readonly VampireChangeLike[]>
  }

  /** For a store that already holds the log, and for tests. */
  seed_recorded_changes(changes: readonly VampireChangeLike[]): void {
    this.recordedChanges.value = changes.slice()
    this.recordedChangesInitialised = true
  }

  /* ---------------- approvals ---------------- */

  /**
   * `Character.get_approvals`.
   *
   * Pages forward from the newest approval already held, so a repeat call is
   * cheap. `q.each` in the source iterates every match in batches with no
   * ordering guarantee of its own; the ascending comparator is what puts them
   * back in order afterwards, and `.last()` being the newest depends on it.
   */
  get_approvals(): Promise<readonly ApprovalLike[]> {
    this._approvalsFetch = queue(this._approvalsFetch, async () => {
      const q = new Parse.Query(ApprovalObject)
      q.equalTo('owner', this.character as unknown as Parse.Object)

      if (this.approvals.value.length !== 0) {
        const newest = this.approvals.value[this.approvals.value.length - 1]
        if (newest?.createdAt !== undefined) {
          q.greaterThan('createdAt', newest.createdAt)
        }
      }

      const found: ApprovalLike[] = []
      // `q.each` walks the whole result set rather than one page of it.
      await q.each((approval) => {
        found.push(approval as unknown as ApprovalLike)
      })
      this.approvals.value = this.approvals.value.concat(found).sort(compare_approvals)
      this.approvalsInitialised = true
      return this.approvals.value
    })
    return this._approvalsFetch as Promise<readonly ApprovalLike[]>
  }

  /** For a store that already holds the approvals, and for tests. */
  seed_approvals(approvals: readonly ApprovalLike[]): void {
    this.approvals.value = approvals.slice().sort(compare_approvals)
    this.approvalsInitialised = true
  }

  /** True once `get_approvals` has completed at least once. */
  get approvalsLoaded(): boolean {
    return this.approvalsInitialised
  }

  /**
   * `Character.get_transformed_last_approved` -- the sheet as last approved.
   *
   * `takeRightWhile(... model.id != last_approved_change_id)` is every change
   * recorded AFTER the approved one, in log order; `.reverse()` puts them
   * newest-first, which is the order `get_transformed` undoes them in.
   *
   * Returns `null` when the character has never been approved, exactly as the
   * source's `Parse.Promise.as(null)` did.
   */
  get_transformed_last_approved(): Promise<TransformedCharacter | null> {
    return this.get_approvals()
      .then(() => this.get_recorded_changes())
      .then(() => {
        if (this.approvals.value.length === 0) {
          return null
        }
        const lastApproval = this.approvals.value[this.approvals.value.length - 1]
        if (lastApproval === undefined) return null
        const last_approved_recorded_change_id = lastApproval.get('change').id
        const changesToApply = takeRightWhile(
          this.recordedChanges.value,
          (model) => model.id !== last_approved_recorded_change_id,
        ).reverse()
        return get_transformed(this.character, changesToApply)
      })
  }

  /** `Character.get_transformed`, bound to this instance's character. */
  get_transformed(changes: readonly VampireChangeLike[]): TransformedCharacter {
    return get_transformed(this.character, changes)
  }
}
