/**
 * The character model: trait reads and writes, the creation pool, ACLs, long
 * texts, and the serialising queues that keep concurrent edits from racing.
 *
 * Ported from `public/scripts/app/models/Character.js`. Four things about the
 * target make a straight transcription impossible, and each is a structural
 * decision worth stating outright.
 *
 * ## 1. A prototype mixin, not a subclass and not a wrapper
 *
 * `@/parse/classes` registers exactly ONE class for the className "Vampire" --
 * `CharacterObject` -- because parse@8 has one class per className and the three
 * creature types share the table. A query decodes rows into `CharacterObject`s,
 * so anything declared here as a subclass would never come back from the server,
 * and anything declared as a wrapper would not be a `Parse.Object` -- which both
 * collaborators require: `@/domain/venues` types the character as
 * `VenueCharacter extends Parse.Object`, and `@/domain/CharacterExperience`
 * reads `troupes` and `_ltCache` off it as instance properties.
 *
 * So this file does what the original did -- it installs instance methods onto
 * the one registered class -- and `characterFor(object)` is the typed way in.
 * The original spelled this `Parse.Object.extend("Vampire", instance_methods)`;
 * `installCharacterMethods()` is the same act with the load-order dependence
 * removed. Per-instance state (`_ltCache`, `troupes`, the queues) is held in
 * WeakMaps behind accessors rather than as class fields, because a prototype
 * mixin has no constructor to initialise them in.
 *
 * ## 2. `.always()` was a mutex
 *
 * The original serialises writes through per-instance promise chains
 * (`_updateTraitWrapper`, `_ltPromise`, `_mismatchFetch`, ...) built with
 * Parse 1.5's `.always()`, which is `then(cb, cb)`: a rejection becomes a
 * fulfillment, so one failed save cannot wedge the queue for the rest of the
 * session. `WriteQueue` reproduces that and implements the `TraitQueue`
 * contract the Changeling venue drives directly. It deliberately does NOT use
 * `.finally()` -- `finally` re-throws, which is precisely the wedge `.always`
 * was chosen to avoid.
 *
 * ## 3. No parse-compat, so no Backbone surface
 *
 * `_serverData`, `_previousAttributes`, `cid`, `_byCid`, `Parse.Collection` and
 * model change events do not exist here. Each place the original leaned on one
 * of them is called out at the site with what replaced it:
 *
 *   - `modified_trait._serverData.name`  -> `modified_trait.revert("name")`
 *   - `cid` / `_byCid`                   -> `localIdOf()` from `@/domain/SimpleTrait`
 *   - `self.trigger("change:...")`       -> `touch()` from `@/parse/reactivity`
 *   - `delete self._serverData.troupes`  -> `forget_troupe_relation()`
 *
 * ## 4. `Parse.Promise.when` is not `Promise.all`
 *
 * 1.5's `when` waited for every input to SETTLE, resolved with separate
 * arguments, and rejected with an array indexed to the inputs. `Promise.all`
 * does none of that. `settle_all()` is the honest replacement, and every call
 * site destructures explicitly. Methods that resolved with two values
 * (`Parse.Promise.as(st, self)`) now return a tuple.
 *
 * ## What is NOT here
 *
 * The XP ledger and the change-log / approval replay are `@/domain/CharacterExperience`.
 * That module is a companion OBJECT (`CharacterExperience`), not a prototype
 * mixin, so this file exposes it as `character.experience` and delegates only
 * the two entry points its own methods need -- `add_experience_notation` and
 * `get_experience_notations`. Everything else on the ledger is reached through
 * `character.experience`. The venue behaviour is `@/domain/venues`, reached
 * through `character.venue`.
 */
import Parse from '@/parse'
import { isEqual } from 'lodash'

import { CharacterObject } from '@/parse/classes'
import { touch } from '@/parse/reactivity'
import {
  createSimpleTrait,
  installSimpleTraitMixin,
  localIdOf,
  type SimpleTrait,
} from '@/domain/SimpleTrait'
import {
  longTextQueryFor,
  minimalLongTextQueryFor,
  createLongText,
  type LongText,
} from '@/domain/LongText'
import { getExpectedVampireIds, updateVampireChangePermissionsFor } from '@/domain/cloud'
import { promiseFailReport, reportError } from '@/domain/errors'
import { ALL_VENUES, venueForCharacter } from '@/domain/venues'
import type { VenueKey } from '@/parse/classes'
import type {
  ExperienceNotationOptions as VenueExperienceNotationOptions,
  TraitQueue,
  VenueCharacter,
  VenueStrategy,
} from '@/domain/venues/types'
import {
  CharacterExperience,
  type ExperienceNotationOptions,
  type XpCharacter,
} from '@/domain/CharacterExperience'

/**
 * One row of `calculate_total_cost`: the trait and what it cost.
 *
 * `cost` is deliberately `number | undefined`. `undefined` means no cost rule
 * covers this trait, which is a finding, not a zero.
 */
export interface TraitCostEntry {
  trait: Parse.Object
  cost: number | undefined
}

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

/**
 * A refusal, carrying the numeric `code` the original used.
 *
 * The source rejected with plain objects -- `Parse.Promise.error({code: 1,
 * message: "..."})` -- and views branch on `error.code`. A real `Error`
 * subclass keeps `.code` and `.message` where those views look, adds a stack,
 * and makes `catch (e: unknown)` honest. `toJSON` is here so the
 * `JSON.stringify(errors)` in the failure log still prints the same text; a
 * bare `Error` stringifies to `{}`.
 */
export class CharacterError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'CharacterError'
    this.code = code
  }

  toJSON(): { code: number; message: string } {
    return { code: this.code, message: this.message }
  }
}

/* ------------------------------------------------------------------------- *
 * Progress reporting
 * ------------------------------------------------------------------------- */

type ProgressReporter = (text: string) => void

/*
 * `Character#progress` called `$.mobile.loading("show", …)` and fell back to
 * `console.log("Progress: " + text)` whenever jQuery Mobile was absent -- which
 * in this client is always. The fallback is the default here and the app wires
 * the real loader in at startup; reaching into a Pinia store from a domain
 * module would make this file untestable without an app instance. The venue
 * strategies made the same choice for `CreateDeps.progress`.
 */
let progress_reporter: ProgressReporter = (text) => {
  console.log('Progress: ' + text)
}

/** Point character progress messages at the app's loader. */
export function setCharacterProgressReporter(fn: ProgressReporter): void {
  progress_reporter = fn
}

/* ------------------------------------------------------------------------- *
 * The serialising queue
 * ------------------------------------------------------------------------- */

const IGNORE = (): undefined => undefined

/**
 * One `.always()` chain -- the `TraitQueue` the venues expect.
 *
 * `always(work)` appends `work` and returns the promise for THIS task, which is
 * what the original did: `self._x = self._x.always(fn); return self._x`. The
 * task runs whether the previous one succeeded or failed; that is the whole
 * point, and it is why a failed save does not stop the next edit from being
 * attempted.
 *
 * `then(work)` appends with rejection PROPAGATING, which is a different
 * promise: the Changeling Kith transaction uses both, and the difference
 * decides whether a failed unpick stops the save that follows it.
 *
 * `adopt(p)` installs a promise built off to the side as the new tail without
 * appending to it -- the Kith gate.
 *
 * Every promise that becomes the tail also gets a no-op handler attached on a
 * SIDE branch. That marks the rejection handled (so it is not reported as
 * unhandled, which `Parse.Promise` never did) without altering the tail itself,
 * so `then`'s propagation is unaffected.
 *
 * `.finally()` appears nowhere near this: it re-throws, so the first failure
 * would wedge the queue permanently.
 */
export class WriteQueue implements TraitQueue {
  private _tail: Promise<unknown> = Promise.resolve()

  get tail(): Promise<unknown> {
    return this._tail
  }

  private install<T>(p: Promise<T>): Promise<T> {
    this._tail = p
    void p.then(IGNORE, IGNORE)
    return p
  }

  always<T>(work: () => T | PromiseLike<T>): Promise<T> {
    return this.install(this._tail.then(work, work))
  }

  then<T>(work: () => T | PromiseLike<T>): Promise<T> {
    return this.install(this._tail.then(work))
  }

  adopt(p: Promise<unknown>): void {
    this._tail = p
    void p.then(IGNORE, IGNORE)
  }

  /** Resolve once everything queued so far has settled. Never rejects. */
  idle(): Promise<void> {
    return this._tail.then(IGNORE, IGNORE)
  }
}

/**
 * `Parse.Promise.when`, honestly.
 *
 * Waits for every input to SETTLE (not to succeed). Resolves with the values in
 * input order. If anything rejected, throws an ARRAY the same length as the
 * input, holding each slot's value or error -- which is the shape
 * `promiseFailReport`'s multi-promise branch reads.
 *
 * `Promise.all` matches none of that: it resolves with one array and rejects on
 * the FIRST error, leaving the other requests in flight and unreported.
 */
export async function settle_all<T>(promises: Array<Promise<T> | T>): Promise<T[]> {
  const settled = await Promise.allSettled(promises)
  if (settled.some((s) => s.status === 'rejected')) {
    throw settled.map((s) => (s.status === 'rejected' ? s.reason : s.value))
  }
  return settled.map((s) => (s as PromiseFulfilledResult<T>).value)
}

/* ------------------------------------------------------------------------- *
 * Faithful translations of lodash 3 behaviour
 * ------------------------------------------------------------------------- */

/** lodash 3's `_.isFinite`: finite AND a number. Strings are not numbers. */
function is_finite_number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * `_.sum(picks, "attributes.value")` under the vendored lodash 3.10.
 *
 * Two details lodash 4's `sumBy` does NOT reproduce, both load-bearing here
 * because the result is written straight into a creation-pool counter:
 *
 *   - `arraySum` accumulates `+value || 0` (lodash.js:1514), so a pick with no
 *     `value` -- an unfetched pointer, which a pick list routinely holds --
 *     contributes ZERO rather than poisoning the total. `_.sumBy` returns NaN
 *     for the same input, and `7 - NaN` is a NaN written to
 *     `<category>_<i>_remaining`.
 *   - `_.sum(undefined, …)` is 0, because `toIterable(null)` is `[]`. An unset
 *     pool therefore leaves 7 remaining, not NaN.
 *
 * `@/domain/venues/common` has the same function for the same reason; this copy
 * exists so this module does not depend on a venue's internals.
 */
function sum_trait_values(picks: unknown): number {
  if (!Array.isArray(picks)) return 0
  let total = 0
  for (const pick of picks as unknown[]) {
    const value = (pick as Parse.Object | null | undefined)?.get('value') as unknown
    total += Number(value) || 0
  }
  return total
}

/**
 * lodash 3's `_.parseInt`: base 10 unless the string carries an `0x` prefix.
 *
 * A bare `parseInt(x)` reads a leading-zero string as octal on older engines and
 * would silently disagree with what the old client stored in
 * `experience_cost_modifier` -- which is the multiplier a linear-cost trait is
 * priced by.
 *
 * The prefix test is `/^0[xX]/` with NO sign allowed, because that is lodash
 * 3.10's own `reHasHexPrefix` (`lodash.js:117`) and it is anchored. Verified
 * against the vendored copy: `_.parseInt('-0x1A')` is `-0` and
 * `_.parseInt('+0x10')` is `0` -- both take the base-10 branch and stop at the
 * `x`. Widening this to `/^[+-]?0[xX]/` sends a signed hex string down the
 * base-16 branch instead, so `'-0x1A'` becomes `-26` rather than `-0`, and every
 * level of that trait is then priced differently from the shipped app.
 */
function parse_int_like(value: unknown): number {
  const text = String(value).trim()
  return /^0[xX]/.test(text) ? parseInt(text, 16) : parseInt(text, 10)
}

/**
 * lodash 3's `_.sortBy(list, "attributes.name")` ordering.
 *
 * `baseCompareAscending` sorts `undefined` last regardless of direction, and
 * `sortBy` is stable. `Array.prototype.sort` has been stable since ES2019, so
 * the only thing left to reproduce is the undefined-last rule.
 */
function compare_by_name(a: Parse.Object, b: Parse.Object): number {
  const an = a.get('name') as string | undefined
  const bn = b.get('name') as string | undefined
  if (an === bn) return 0
  if (an === undefined) return 1
  if (bn === undefined) return -1
  return an < bn ? -1 : 1
}

/* ------------------------------------------------------------------------- *
 * Typing shims for Parse's array/counter mutators
 * ------------------------------------------------------------------------- */

/*
 * `addUnique`, `remove` and `increment` are typed against `AtomicKey<T>`, which
 * a category name computed at runtime cannot satisfy. The casts are confined to
 * these three helpers rather than sprayed across the call sites, so there is one
 * place to look when the SDK's types change.
 */
interface LooseMutators {
  addUnique(attr: string, item: unknown): unknown
  remove(attr: string, item: unknown): unknown
  increment(attr: string, amount?: number): unknown
}

function add_unique(object: Parse.Object, attr: string, item: unknown): void {
  ;(object as unknown as LooseMutators).addUnique(attr, item)
}

function remove_from(object: Parse.Object, attr: string, item: unknown): void {
  ;(object as unknown as LooseMutators).remove(attr, item)
}

function increment_on(object: Parse.Object, attr: string, amount?: number): void {
  ;(object as unknown as LooseMutators).increment(attr, amount)
}

/* ------------------------------------------------------------------------- *
 * Per-instance state
 * ------------------------------------------------------------------------- */

/*
 * A prototype mixin has no constructor, so the instance state the original held
 * as plain fields lives in WeakMaps behind accessors. Weak so nothing here keeps
 * a character alive after the view holding it is gone.
 *
 * `troupes` and `_ltCache` are accessors rather than internal names because two
 * collaborators reach for them BY NAME: `get_transformed` in
 * `@/domain/CharacterExperience` does `c._ltCache = character._ltCache` and
 * `character.troupes.parent = null`. `troupes` reads `undefined` until
 * `initialize_troupe_membership` has run, which is exactly the
 * `mustFixBrokenRelation` test that code performs.
 */
const TRAIT_QUEUES = new WeakMap<object, WriteQueue>()
const LONG_TEXT_QUEUES = new WeakMap<object, WriteQueue>()
const MISMATCH_QUEUES = new WeakMap<object, WriteQueue>()
const LT_CACHES = new WeakMap<object, Record<string, LongText | null>>()
const TROUPE_RELATIONS = new WeakMap<object, Parse.Relation | undefined>()
const TROUPE_IDS = new WeakMap<object, string[]>()
const TROUPE_READ_AT = new WeakMap<object, number>()
const LEDGERS = new WeakMap<object, CharacterExperience>()
const MISMATCHED = new WeakMap<object, boolean>()

function queue_for(map: WeakMap<object, WriteQueue>, object: object): WriteQueue {
  let q = map.get(object)
  if (q === undefined) {
    q = new WriteQueue()
    map.set(object, q)
  }
  return q
}

/* ------------------------------------------------------------------------- *
 * The public shape
 * ------------------------------------------------------------------------- */

/** State the mixin exposes as accessors. See the WeakMap note above. */
export interface CharacterState {
  /**
   * The shared serialising write queue: the original's `_updateTraitWrapper`.
   * `update_trait` and `unpick_from_creation` both append to it, and the
   * Changeling Kith transaction drives it directly.
   */
  readonly traitQueue: WriteQueue
  /** The long-text queue: the original's `_ltPromise`. */
  readonly longTextQueue: WriteQueue
  /** The permissions-audit queue: the original's `_mismatchFetch`. */
  readonly mismatchQueue: WriteQueue
  /** The XP ledger / change log for this character. Created on first read. */
  readonly experience: CharacterExperience
  /** The `troupes` relation handle. `undefined` until membership is read. */
  troupes: Parse.Relation | undefined
  /** Long texts keyed by category. `null` means "asked, server has none". */
  _ltCache: Record<string, LongText | null>
  /** Result of the last permissions-mismatch check; `undefined` until run. */
  is_mismatched: boolean | undefined
  /**
   * The venue strategy for this record.
   *
   * An accessor rather than a method on the mixin object, because
   * `Object.assign` READS a getter off its source and copies the result as a
   * plain value -- which would freeze every character to whichever venue
   * happened to answer at install time. It is installed with
   * `Object.defineProperty` instead. `venueKey` is not redefined at all: it is
   * already a getter on `CharacterObject` in `@/parse/classes`, which is where
   * the "absent `type` means Vampire" decision belongs.
   */
  readonly venue: VenueStrategy

}

/** Everything `Character.js`'s `instance_methods` provided, minus the ledger. */
export interface CharacterMethods {
  /* -- the venue's own terms, delegated -- */
  generation(): number
  has_generation(): boolean
  rank(): number
  has_rank(): boolean
  seeming(): number
  has_seeming(): boolean
  get_in_clan_disciplines(): (string | undefined)[]
  get_affinities(): unknown[]
  get_arts_affinities(): Array<string | undefined>

  /* -- the venue's tables, as the model exposed them -- */
  all_simpletrait_categories(): readonly (readonly [string, string, string])[]
  all_text_attributes(): readonly string[]
  all_text_attributes_pretty_names(): readonly unknown[]

  /* -- ExpirationMixin -- */
  isActive(): boolean
  isExpired(): boolean
  status(): string

  /* -- progress -- */
  progress(text: string): void

  /* -- categories and trait reads -- */
  ensure_category(category: string): void
  get_category_for_fetch(category: string): Parse.Object[]
  get_trait_by_name(category: string, name: unknown): Promise<[SimpleTrait | undefined, Character]>
  get_trait(category: string, id: unknown): Promise<[SimpleTrait | undefined, Character]>

  /* -- trait writes -- */
  update_trait(
    nameOrTrait: string | Parse.Object,
    value?: number,
    category?: string,
    free_value?: number,
    wait?: boolean,
    experience_cost_type?: string,
    experience_cost_modifier?: number | string,
  ): Promise<[SimpleTrait, Character]>
  remove_trait(trait: Parse.Object): Promise<unknown>

  /* -- creation pool -- */
  release_creation_pick_for_trait(trait: Parse.Object): Promise<Character>
  unpick_from_creation(
    category: string,
    picked_trait_id: unknown,
    pick_index: number | string,
  ): Promise<Character>
  get_sum_creation_categories(): readonly string[]
  fetch_all_creation_elements(): Promise<Character>
  is_being_created(): boolean
  complete_character_creation(): Promise<Parse.Object>

  /* -- costs -- */
  calculate_trait_cost(trait: Parse.Object): number | undefined
  calculate_total_cost(): Promise<Record<string, TraitCostEntry>>
  calculate_trait_to_spend(trait: Parse.Object): number | undefined

  /* -- core text attributes -- */
  update_text(target: string, value: string): Promise<unknown>
  unpick_text(target: string): Promise<unknown>
  base_update_text(target: string, value: string): Promise<unknown>
  base_unpick_text(target: string): Promise<unknown>

  /* -- troupes and ACLs -- */
  get_troupe_ids(): readonly string[]
  has_troupe_membership(): boolean
  initialize_troupe_membership(throttle?: boolean): Promise<Character>
  get_me_acl(): Parse.ACL
  acl_for_me(): Promise<Parse.ACL>
  set_cached_acl(acl?: Parse.ACL): void
  forget_troupe_relation(): void
  update_troupe_acls(): Promise<Character>
  join_troupe(troupe: Parse.Object): Promise<Character>
  leave_troupe(troupe: Parse.Object): Promise<Character>

  /* -- permissions audit -- */
  get_owned_ids(): Promise<Record<string, string[]>>
  update_server_client_permissions_mismatch(): Promise<Character>
  check_server_client_permissions_mismatch(): Promise<Character>

  /* -- long texts -- */
  get_long_text(category: string, options?: { update?: boolean }): Promise<LongText | null | undefined>
  fetch_long_text(category: string, options?: { update?: boolean }): Promise<Character>
  has_long_text(category: string): Promise<boolean>
  has_fetched_long_text(category: string): boolean
  get_fetched_long_text(category: string): LongText | null | undefined
  update_long_text(category: string, new_text: string): Promise<LongText>
  remove_long_text(category: string, options?: { update?: boolean }): Promise<null | void>
  free_fetched_long_text(category: string): void
  get_minimal_long_texts(): Promise<LongText[]>

  /* -- derived reads -- */
  get_thumbnail(size: number | string): Promise<string | undefined>
  get_thumbnail_sync(size: number | string): string | undefined
  health_levels(): Array<[string, number | undefined]>
  get_willpower_total(): number
  get_sorted_skills(): Parse.Object[]
  get_grouped_skills(
    sortedSkills?: Parse.Object[],
    columnCount?: number,
  ): Array<Array<Parse.Object | undefined>>
  archive(): Promise<Parse.Object>

  /* -- the two ledger entry points this file's own methods need -- */
  /**
   * The parameter is a UNION of the two collaborators' option shapes.
   *
   * `@/domain/CharacterExperience` types it open (an index signature, because
   * `_.defaults` passes any extra key straight onto the row) and
   * `@/domain/venues/types` types it closed (`reason`, `alteration_earned`,
   * `earned` -- what `ensure_creation_rules_exist` passes). Neither is
   * assignable to the other, so accepting both is what lets `Character` satisfy
   * `VenueCharacter`. The compile-time assertion above is what caught this.
   */
  add_experience_notation(
    options: ExperienceNotationOptions | VenueExperienceNotationOptions,
  ): Promise<unknown>
  get_experience_notations(): Promise<readonly Parse.Object[]>
  /**
   * The character's own timeline and approvals.
   *
   * `Character.js` exposed these ON the character, and the approval screen and
   * the history slider both call them that way. Here the state lives on
   * `CharacterExperience`; these delegate, so `character.get_recorded_changes()`
   * means what it always did.
   */
  get_recorded_changes(): Promise<readonly unknown[]>
  get_approvals(): Promise<readonly unknown[]>
  /**
   * The venue's creation-pool bookkeeping for one changed trait.
   *
   * `Vampire.js` and its two twins defined this ON the character. Here the
   * rule lives on the venue strategy and `update_trait` calls it through
   * `this.venue`; this delegator exists because it is also part of the model's
   * public surface -- a caller with a character in hand should not have to know
   * which venue it belongs to in order to book a trait against its pools.
   */
  update_creation_rules_for_changed_trait(
    category: string,
    modified_trait: Parse.Object,
    freeValue: number | undefined,
  ): Promise<unknown>
  /** `Character._propagate_experience_notation_change` -- the balance recompute. */
  _propagate_experience_notation_change(
    notations: readonly unknown[],
    startIndex: number,
  ): readonly unknown[]
  wait_on_current_experience_update(): Promise<unknown>
}

/**
 * A character row with the model behaviour installed.
 *
 * This is the type every caller should use. It is an intersection rather than a
 * class because the behaviour is installed on `CharacterObject.prototype` -- see
 * the header note on why a subclass or a wrapper cannot work here.
 */
export type Character = CharacterObject & CharacterState & CharacterMethods

/*
 * Compile-time proof that a `Character` is what `@/domain/venues` asks for.
 *
 * Every call into a strategy below goes through `this as unknown as
 * VenueCharacter`, because a strategy also wants the SDK surface and TypeScript
 * cannot see through the prototype installation. A cast checks nothing, so the
 * contract is asserted once, here, where a drift in either file is a build
 * error rather than a runtime `undefined is not a function`.
 *
 * There is no matching assertion for `XpCharacter` (`@/domain/CharacterExperience`)
 * and that is deliberate: it declares `troupes` as `{ parent: unknown } | null`
 * where a real `Parse.Relation` declares `parent?: Parse.Object` -- optional
 * versus required, so the structural check fails on a property both sides agree
 * about at runtime. See the note at the `CharacterExperience` construction.
 */
const _venue_contract: (character: Character) => VenueCharacter = (character) => character
void _venue_contract

/* ------------------------------------------------------------------------- *
 * The methods
 * ------------------------------------------------------------------------- */

const characterMethods: CharacterMethods & ThisType<Character> = {
  /* --------------------------------------------------------------------- *
   * ExpirationMixin
   * --------------------------------------------------------------------- */

  isActive(): boolean {
    if (this.has('expiresOn')) return this.get('expiresOn') > Date.now()
    return false
  },

  isExpired(): boolean {
    if (this.has('expiresOn')) return this.get('expiresOn') < Date.now()
    return false
  },

  status(): string {
    return this.isActive() ? 'Active' : 'Expired'
  },

  progress(text: string): void {
    progress_reporter(text)
  },

  /* --------------------------------------------------------------------- *
   * Categories and trait reads
   * --------------------------------------------------------------------- */

  ensure_category(category: string): void {
    if (!this.has(category)) {
      this.set(category, [])
    }
  },

  /**
   * The members of a category worth handing to `fetchAllIfNeeded`.
   *
   * An id-less trait is one this session just created and has not saved yet;
   * asking the server to fetch it throws.
   */
  get_category_for_fetch(category: string): Parse.Object[] {
    const members = this.get(category) as Parse.Object[] | undefined
    if (!Array.isArray(members)) return []
    return members.filter((e) => e !== undefined && e.id !== undefined)
  },

  /**
   * Find a trait by name.
   *
   * Resolves with a TUPLE. The original was `Parse.Promise.as(st, self)`, whose
   * two values arrived as two callback parameters; no native promise does that.
   *
   * `_.find(models, "attributes.name", name)` is lodash 3's matches-property
   * shorthand, reaching through the SDK's private attribute bag. Under lodash 4
   * the identical call means something else and returns `undefined` for every
   * input, which is why this is written out as a predicate over `get`.
   */
  get_trait_by_name(
    category: string,
    name: unknown,
  ): Promise<[SimpleTrait | undefined, Character]> {
    const models = (this.get(category) as SimpleTrait[] | undefined) ?? []
    const wanted = '' + name
    const st = models.find((m) => m.get('name') === wanted)
    return Promise.resolve([st, this])
  },

  /**
   * Find a trait by id, fetching it if it is only a pointer.
   *
   * `id` may be a string, or an object carrying `id`/`cid` -- the original took
   * both. `cid` is gone, so the client-side identity is `localIdOf` from
   * `@/domain/SimpleTrait`, and the local-id lookup runs FIRST exactly as the
   * `cid` lookup did: a freshly created, still-unsaved trait has no server id.
   */
  async get_trait(
    category: string,
    id: unknown,
  ): Promise<[SimpleTrait | undefined, Character]> {
    const models = (this.get(category) as SimpleTrait[] | undefined) ?? []
    let wanted: unknown = id
    if (wanted !== null && typeof wanted === 'object') {
      const holder = wanted as { id?: string; cid?: string }
      wanted = holder.id ?? holder.cid
    }

    const by_local = models.find((m) => localIdOf(m) === wanted)
    if (by_local) {
      return [by_local, this]
    }

    const st = models.find((m) => m.id === wanted)

    /*
     * The original wrapped this in a try/catch for a TypeError, on the theory
     * that the object was "still saving", and recovered by saving it. Kept
     * verbatim including the recovery, because the recovery is the only thing
     * that returns a trait at all on that path -- and note that when `st` is
     * undefined the recovery throws too, as it did before.
     */
    let fetched: Parse.Object[]
    try {
      fetched = await Parse.Object.fetchAllIfNeeded([st as Parse.Object])
    } catch (e) {
      if (e instanceof TypeError) {
        console.log('Caught a typeerror indicating this object is still saving ' + e.message)
        console.log(safe_stringify(st))
        console.log(safe_stringify(models))
        const saved = (await (st as SimpleTrait).save()) as SimpleTrait
        return [saved, this]
      }
      throw e
    }
    return [fetched[0] as SimpleTrait | undefined, this]
  },

  /* --------------------------------------------------------------------- *
   * update_trait -- the ordering here IS the data-integrity contract
   * --------------------------------------------------------------------- */

  /**
   * Create or change a trait, price it, and save the whole graph.
   *
   * Every step is in the order the original had it, and several of those
   * orderings are the fix for a measured corruption. Read the inline comments
   * before moving anything.
   *
   * Resolves with `[trait, character]` -- the original's
   * `Parse.Promise.as(modified_trait, self)`.
   */
  update_trait(
    nameOrTrait: string | Parse.Object,
    value?: number,
    category?: string,
    free_value?: number,
    wait?: boolean,
    experience_cost_type?: string,
    experience_cost_modifier?: number | string,
  ): Promise<[SimpleTrait, Character]> {
    return this.traitQueue.always(async (): Promise<[SimpleTrait, Character]> => {
      let modified_trait: SimpleTrait

      /*
       * A trait argument carries its own category; a name argument does not.
       * If the trait has no `category` the key below becomes the literal string
       * "undefined" -- which is what the old client produced too, because every
       * one of these names ends up as an object key.
       */
      const cat = String(
        typeof nameOrTrait === 'string' ? category : nameOrTrait.get('category'),
      )

      if (wait === undefined) {
        wait = true
      }

      /*
       * Troupe membership FIRST, before anything can build an ACL.
       *
       * `get_me_acl` reads `troupe_ids`, which `initialize_troupe_membership`
       * fills, and in the Backbone app that ran LAST in the character fetch --
       * so a save issued before it resolved wrote rows carrying no LST_/AST_
       * roles at all, storytellers could not see the character, and nothing
       * anywhere reported it. Both the new-trait branch below and the XP
       * notation at the end stamp an ACL, so the read is hoisted here where it
       * cannot be skipped. It is throttled, so it costs one round trip per
       * character per 50 seconds and nothing after that.
       */
      await this.initialize_troupe_membership(true)

      this.ensure_category(cat)
      await Parse.Object.fetchAllIfNeeded(this.get_category_for_fetch(cat))

      const members = (this.get(cat) as SimpleTrait[] | undefined) ?? []

      if (typeof nameOrTrait !== 'string') {
        modified_trait = nameOrTrait as SimpleTrait

        // Membership check. Editing a trait the character does not hold would
        // price it against this character and then save it somewhere else.
        if (!members.includes(modified_trait)) {
          throw new CharacterError(0, 'Provided trait not already in Vampire as expected')
        }

        // Dirty-name uniqueness. Two traits in one category with the same name
        // are indistinguishable to every lookup in this file.
        if (modified_trait.dirty('name')) {
          const wanted_name = modified_trait.get('name')
          const matching_names = members.filter(
            (st) => st !== modified_trait && st.get('name') === wanted_name,
          )
          if (matching_names.length !== 0) {
            /*
             * Restore the server's name.
             *
             * The original read `modified_trait._serverData.name` directly.
             * `_serverData` is SDK-private state that only existed here through
             * parse-compat. `revert("name")` is the supported equivalent: it
             * drops the pending Set for that one key, leaving the last saved
             * value in place, and touches nothing else on the object.
             *
             * The code-2 branch is kept because views branch on the code, even
             * though `revert` has none of the failure modes reaching into
             * `_serverData` had -- it is effectively unreachable now.
             */
            let restore_failure: unknown
            try {
              modified_trait.revert('name')
            } catch (e) {
              restore_failure = e
            }
            if (restore_failure !== undefined) {
              throw new CharacterError(
                2,
                'Name matches an existing trait. Failed to restore original name. ' +
                  String(restore_failure),
              )
            }
            throw new CharacterError(1, 'Name matches an existing trait. Restoring original name')
          }
        }
      } else {
        const name = nameOrTrait

        // Reuse an existing trait of that name if the category already has one;
        // otherwise this is a new row. The original constructed the new trait
        // first and let the loop overwrite it, which is the same thing.
        let found: SimpleTrait | undefined
        for (const st of members) {
          if (st.get('name') === name) found = st
        }
        modified_trait = found ?? createSimpleTrait()

        modified_trait.setACL(this.get_me_acl())
        modified_trait.set({
          name,
          // `value || free_value`, verbatim: a value of 0 falls through to the
          // creation pool's free value. Not `??`.
          value: value || free_value,
          category: cat,
          /*
           * A bare owner pointer.
           *
           * The original wrote `new TempVampire({id: self.id})`, and the
           * parse-compat layer had to disable single-instance state for that to
           * be a genuinely separate object. This client leaves parse@8's browser
           * default (single-instance) alone, so an object built from the same
           * className and id shares state with the live character.
           * `createWithoutData` is the supported spelling of what that line was
           * reaching for, and the sharing is harmless here because the character
           * is named explicitly in the `saveAll` below anyway.
           */
          owner: CharacterObject.createWithoutData(this.id as string),
          free_value: free_value || 0,
        })
        if (experience_cost_type) {
          modified_trait.set('experience_cost_type', experience_cost_type)
          modified_trait.set('experience_cost_modifier', parse_int_like(experience_cost_modifier))
        }
      }

      const cost = this.calculate_trait_cost(modified_trait)
      const spend = this.calculate_trait_to_spend(modified_trait)
      if (!is_finite_number(cost) || !is_finite_number(spend)) {
        // A category with no branch in the venue's cost engine used to land
        // here and be quietly zeroed, which made the whole category free --
        // that is how `wta_rites` and `ctdbs_backgrounds` went unnoticed. Each
        // engine now returns 0 for categories that are *meant* to be free and
        // `undefined` only when no rule exists, so reaching this point is a
        // real gap and is refused OUT LOUD rather than granted for nothing.
        const message = 'No experience cost rule for category "' + cat + '"'
        console.log('update_trait refusing ' + modified_trait.get('name') + ': ' + message)
        // `reportError` renders the banner and returns a rejected promise
        // carrying the error, so awaiting it both shows the failure and throws
        // the refusal. The original called ReportError and then returned its
        // own `Parse.Promise.error`; this is the same two acts in one.
        await reportError(
          new CharacterError(3, message),
          "Couldn't update " + modified_trait.get('name'),
        )
        // Unreachable: `reportError` always rejects. Present so the compiler
        // knows this branch does not fall through.
        throw new CharacterError(3, message)
      }

      modified_trait.set('cost', cost)
      increment_on(this, 'change_count')

      /*
       * Only when it is not already there. Adding an object to an array it is
       * already in is a no-op by definition, so this guard changes no behaviour
       * on any server -- but leaving the redundant op pending silently DESTROYED
       * the category on parse-server 9, and that is worth writing down.
       *
       * Measured. parse-server returns an array field in the save response only
       * when the op actually changed it. A rename or a value change re-adds a
       * trait the array already holds, so the array does not change and
       * `backgrounds` is absent from the response -- while `change_count`'s
       * Increment, which did change, comes back. parse@8 then reaches
       * `else if (!(attr in response)) changes[attr] = pending[attr].applyTo(void 0)`
       * (parse-8.6.0.js:43309) and applies AddUnique to UNDEFINED rather than to
       * the stored array, so the client's category collapses to the single trait
       * just touched. The database stays correct; only the in-memory character
       * is wrong, which is what made it so hard to see.
       *
       * Downstream that is not a display glitch. The duplicate-name check above
       * reads the same array, so with one element left there is nothing to
       * collide with and a colliding rename is accepted (traits-lifecycle 246);
       * the category listing renders one row (approvals 79,
       * creation-changeling 238).
       *
       * parse-server 2.8.4 hid all of it by echoing the whole object back on
       * every save of a class carrying a beforeSave trigger, so `backgrounds`
       * was always in the response and the pending op was always overwritten by
       * the server's own array.
       *
       * The original passed `{silent: true}` to suppress a Backbone change
       * event. There are no model events here, so the option is dropped and
       * `touch()` at the end of this method is what tells Vue anything happened.
       */
      if (!members.includes(modified_trait)) {
        add_unique(this, cat, modified_trait)
      }

      this.progress('Updating trait ' + modified_trait.get('name'))

      const self = this
      const minimumPromise = (async () => {
        await self.venue.update_creation_rules_for_changed_trait(
          self as unknown as VenueCharacter,
          cat,
          modified_trait,
          free_value,
        )

        /*
         * saveAll, not save: this graph is two levels deep, and the trait is
         * named EXPLICITLY rather than left to the parent's cascade.
         *
         * `update_creation_rules_for_changed_trait` does
         * `creation.addUnique(<pool>_picks, modified_trait)`, so an id-less
         * trait sits two levels below the character:
         * character -> creation -> trait.
         *
         * Parse 1.5's `save` walked all of that: `_deepSaveAsync` collected
         * every dirty descendant and batched them in dependency order,
         * re-testing each round with `_canBeSerializedAsValue`.
         *
         * parse@8 kept that algorithm -- but only on the ARRAY path. `save()` on
         * a single object cascades exactly one level (`unsavedChildren` with
         * allowDeepUnsaved=false, parse-8.6.0.js:43931) and its `traverse`
         * THROWS "Cannot create a pointer to an unsaved Object." as soon as it
         * recurses into a dirty child and finds an id-less grandchild. `saveAll`
         * passes allowDeepUnsaved=true (:44772) and then does the same
         * batch-until-serializable loop 1.5 did.
         *
         * Measured: with a creation pool pick (free_value >= 1) the save
         * rejected with exactly that message; with free_value 0, where every
         * venue short-circuits before touching `creation`, the same call
         * succeeded. Nothing surfaced, because the catch below reports and then
         * RESOLVES -- so the wizard's hash never moved and seven specs died on
         * `waitForHashToLeave`.
         *
         * Naming the trait matters even on the array path: parse@8's
         * `unsavedChildren` indexes what it has walked by `className + ":" + id`
         * and skips anything already seen (parse-8.6.0.js:43065). The
         * character's `creation` is walked before its trait arrays, and the
         * creation record's `<pool>_picks` hold their OWN instances of the same
         * SimpleTrait rows -- clean ones -- so by the time the walk reaches the
         * dirty trait its identifier is already recorded as seen-and-not-dirty,
         * and the save drops it. Parse 1.5 de-duplicated by object IDENTITY, so
         * it could not hit that. Measured: raising Physical 5 -> 6 produced a
         * batch holding only the character's own PUT; the trait's new value
         * never reached the server, and the edit reported success.
         *
         * Ordering stays the SDK's job: a brand-new trait has no id, so
         * `canBeSerialized` is false for the character on the first round and it
         * is deferred to the next -- the same children-then-parent order 1.5's
         * `_deepSaveAsync` produced.
         */
        await Parse.Object.saveAll([modified_trait, self] as Parse.Object[])

        // Only when something was actually spent. A rename costs nothing and
        // must not write an XP row.
        if (spend !== 0) {
          await self.add_experience_notation({
            alteration_spent: spend,
            reason: 'Update ' + modified_trait.get('name') + ' to ' + modified_trait.get('value'),
          })
        }
        console.log('Finished saving character')
        return self
      })().catch((errors: unknown) => {
        // The original's `.fail` returned undefined, and in Parse 1.5 a `.fail`
        // handler that returns a value RESOLVES the promise. So a failed save
        // here is reported and then swallowed. Preserved deliberately: several
        // callers navigate on success, and making this reject would change
        // every one of them.
        console.log('Failing to save vampire because of ' + safe_stringify(errors))
        promiseFailReport(errors)
        return undefined
      })

      /*
       * `wait: false` returns before the save finishes -- and, because this
       * whole body is the queued task, it also lets the NEXT queued write start
       * while this save is still in flight. That is the original's behaviour,
       * not an oversight in the port; `minimumPromise` carries its own catch, so
       * nothing is left unhandled.
       */
      if (wait) {
        await minimumPromise
      }

      // Replaces `self.trigger("change:" + category)`. There are no model events
      // without parse-compat; `touch` bumps the revision counters that
      // `track`/`trackAll` subscribe to.
      touch(this)

      return [modified_trait, this]
    })
  },

  /* --------------------------------------------------------------------- *
   * Removal and the creation pool
   * --------------------------------------------------------------------- */

  /**
   * Hand a creation pool slot back if this trait is holding one.
   *
   * `unpick_from_creation` does this for the wizard's own unpick link, which
   * knows the slot index it is releasing. Nothing did it for a plain removal, so
   * removing a creation-picked trait destroyed the trait, refunded its cost, and
   * left `<category>_<i>_remaining` permanently one short -- and once creation is
   * complete there is no route back to reclaim the slot.
   *
   * The slot is found by SEARCHING THE PICK LISTS for the trait rather than by
   * trusting its `free_value`, because the trait's free value can be edited
   * after it was picked.
   */
  async release_creation_pick_for_trait(trait: Parse.Object): Promise<Character> {
    if (!this.has('creation')) {
      return this
    }
    await this.fetch_all_creation_elements()
    const creation = this.get('creation') as Parse.Object | undefined
    if (!creation) {
      return this
    }
    const category = String(trait.get('category'))
    let released = false

    // `_.range(-1, 10)`: slot -1 through 9.
    for (let i = -1; i < 10; i += 1) {
      const picks_name = category + '_' + i + '_picks'
      const remaining_name = category + '_' + i + '_remaining'
      const picks = creation.get(picks_name) as Array<Parse.Object | undefined> | undefined
      const holds = Array.isArray(picks)
        ? picks.some((pick) => !!pick && (pick === trait || (!!trait.id && pick.id === trait.id)))
        : false
      if (!holds) continue

      remove_from(creation, picks_name, trait)
      if (this.get_sum_creation_categories().includes(category)) {
        creation.set(remaining_name, 7 - sum_trait_values(creation.get(picks_name)))
      } else {
        increment_on(creation, remaining_name, 1)
      }
      released = true
    }

    if (!released) {
      return this
    }
    await creation.save()
    return this
  },

  /**
   * Destroy a trait, refund its cost, and release any creation slot it held.
   *
   * The refund is `-cost`. Note this method never calls `save()` on the
   * character: the character is written as part of the XP ledger's `saveAll`,
   * because propagating a notation always rewrites `experience_spent` on the row
   * too. Dropping the notation call would therefore also drop the `remove` and
   * the `increment` below.
   */
  async remove_trait(trait: Parse.Object): Promise<unknown> {
    await this.initialize_troupe_membership(true)
    await this.release_creation_pick_for_trait(trait)
    await trait.destroy()

    const en_options: ExperienceNotationOptions = {
      // `|| 0` here is the ORIGINAL's, and it is NOT a cost-engine boundary:
      // `cost` is the value already stored on the trait, so a missing one means
      // "never priced" and refunds nothing. The rule about never defaulting a
      // cost to zero applies to `calculate_trait_cost`, above.
      alteration_spent: (trait.get('cost') || 0) * -1,
      reason: 'Removed ' + trait.get('name'),
    }
    remove_from(this, String(trait.get('category')), trait)
    increment_on(this, 'change_count')
    return this.add_experience_notation(en_options)
  },

  /**
   * The wizard's unpick link: release slot `pick_index` and delete the trait.
   *
   * The creation record is saved BEFORE the trait is destroyed. Reversed, a
   * failure between the two leaves the pool holding a pointer to a row that no
   * longer exists, and the wizard cannot render.
   *
   * Shares `traitQueue` with `update_trait`, as the original shared
   * `_updateTraitWrapper`: an unpick interleaved with a trait write would read
   * pool counters the other one is halfway through changing.
   */
  unpick_from_creation(
    category: string,
    picked_trait_id: unknown,
    pick_index: number | string,
  ): Promise<Character> {
    return this.traitQueue.always(async () => {
      await this.fetch_all_creation_elements()
      const [picked_trait] = await this.get_trait(category, picked_trait_id)

      const picks_name = category + '_' + pick_index + '_picks'
      const remaining_name = category + '_' + pick_index + '_remaining'
      const creation = this.get('creation') as Parse.Object

      remove_from(creation, picks_name, picked_trait)
      if (this.get_sum_creation_categories().includes(category)) {
        creation.set(remaining_name, 7 - sum_trait_values(creation.get(picks_name)))
      } else {
        increment_on(creation, remaining_name, 1)
      }

      this.progress('Removing creation trait')
      await creation.save()
      await this.remove_trait(picked_trait as Parse.Object)
      return this
    })
  },

  /** Categories whose creation counter is `7 - sum(picks)`, not a count. */
  get_sum_creation_categories(): readonly string[] {
    return this.venue.SUM_CREATION_CATEGORIES
  },

  /**
   * Make sure every trait referenced by a creation pick list is loaded.
   *
   * The pick lists hold pointers, and an unfetched pointer's `value` reads as
   * `undefined` -- which is how a merits pool with 7 spent shows 7 remaining.
   * The category list differs per venue and comes from the strategy; everything
   * else about this is shared.
   */
  async fetch_all_creation_elements(): Promise<Character> {
    await this.venue.ensure_creation_rules_exist(this as unknown as VenueCharacter)
    const creation = this.get('creation') as Parse.Object

    /*
     * `_.union` dedupes by SameValueZero -- object identity, for these -- and
     * skips non-array arguments, so an absent pick list contributed nothing
     * rather than throwing. The Set reproduces both. Ordering differs from the
     * original (which prepended each list); `fetchAllIfNeeded` is
     * order-insensitive, so that is not observable.
     */
    const seen = new Set<unknown>()
    const collected: unknown[] = []
    for (const category of this.venue.CREATION_LIST_CATEGORIES) {
      for (let i = -1; i < 10; i += 1) {
        const picks = creation.get(category + '_' + i + '_picks')
        if (!Array.isArray(picks)) continue
        for (const pick of (picks as unknown[]).flat()) {
          if (seen.has(pick)) continue
          seen.add(pick)
          collected.push(pick)
        }
      }
    }

    // `.without(undefined).filter(function (id) { return id.id; })`. A null in a
    // pick list throws here, exactly as it did before; that has never been
    // observed and guarding it would hide a corrupt pool.
    const objectIds = collected
      .filter((pick) => pick !== undefined)
      .filter((pick) => (pick as Parse.Object).id) as Parse.Object[]

    await Parse.Object.fetchAllIfNeeded(objectIds)
    return this
  },

  is_being_created(): boolean {
    return !(this.get('creation') as Parse.Object).get('completed')
  },

  async complete_character_creation(): Promise<Parse.Object> {
    await this.fetch_all_creation_elements()
    const creation = this.get('creation') as Parse.Object
    creation.set('completed', true)
    return creation.save()
  },

  /* --------------------------------------------------------------------- *
   * Costs
   * --------------------------------------------------------------------- */

  /**
   * What this trait costs at its current value.
   *
   * `undefined` means "no rule exists for this category" and is NOT zero. Do not
   * add a fallback here: `update_trait` turns the `undefined` into a visible
   * refusal, which is the only thing standing between an unpriced category and
   * free traits for everyone in it.
   */
  calculate_trait_cost(trait: Parse.Object): number | undefined {
    return this.venue.calculate_trait_cost(
      this as unknown as VenueCharacter,
      trait as never,
    )
  },

  /*
   * The venue's own terms, reachable from the character.
   *
   * `generation` is Vampire's, `rank` Werewolf's, `seeming` Changeling's, and
   * each existed only on its own venue's prototype in the Backbone app -- so
   * asking a werewolf for its generation threw a TypeError. That is reproduced,
   * with a message that names the mismatch instead of "not a function": these
   * are called from the printable sheet, the cost engines and the E2E fixture
   * helpers, and a wrong-venue call is a bug in the caller worth reading.
   */
  generation(): number {
    return namedVenueTerm(this, 'Vampire', 'generation')
  },

  has_generation(): boolean {
    return namedVenueTermPresent(this, 'Vampire', 'has_generation')
  },

  rank(): number {
    return namedVenueTerm(this, 'Werewolf', 'rank')
  },

  has_rank(): boolean {
    return namedVenueTermPresent(this, 'Werewolf', 'has_rank')
  },

  seeming(): number {
    return namedVenueTerm(this, 'ChangelingBetaSlice', 'seeming')
  },

  has_seeming(): boolean {
    return namedVenueTermPresent(this, 'ChangelingBetaSlice', 'has_seeming')
  },

  get_in_clan_disciplines(): (string | undefined)[] {
    return venueMethod(this, 'get_in_clan_disciplines') as (string | undefined)[]
  },

  get_affinities(): unknown[] {
    return venueMethod(this, 'get_affinities') as unknown[]
  },

  get_arts_affinities(): Array<string | undefined> {
    return venueMethod(this, 'get_arts_affinities') as Array<string | undefined>
  },

  /*
   * The venue's tables, reachable from the character itself.
   *
   * `Vampire.js` exposed these as statics AND, through the shared prototype, as
   * instance methods -- `c.all_simpletrait_categories()` is what the printable
   * sheet, the creation wizard and the E2E fixture helpers all call. The tables
   * live on the venue strategy now; these are the model-shaped way in.
   */
  all_simpletrait_categories(): readonly (readonly [string, string, string])[] {
    return this.venue.ALL_SIMPLETRAIT_CATEGORIES as never
  },

  all_text_attributes(): readonly string[] {
    return this.venue.TEXT_ATTRIBUTES
  },

  all_text_attributes_pretty_names(): readonly unknown[] {
    return this.venue.TEXT_ATTRIBUTES_PRETTY_NAMES
  },

  /** The XP delta this edit represents: new cost minus the cost already paid. */
  calculate_trait_to_spend(trait: Parse.Object): number | undefined {
    return this.venue.calculate_trait_to_spend(
      this as unknown as VenueCharacter,
      trait as never,
    )
  },

  /**
   * What every priced trait on this sheet cost, keyed `"<category>-<name>"`.
   *
   * A port of the three venue implementations (`Vampire.js:239-262`,
   * `Werewolf.js:216-238`, `ChangelingBetaSlice.js:212-234`), which differ only
   * in their category list -- that list is `venue.TOTAL_COST_CATEGORIES`.
   *
   * Its one caller is the character-costs screen, and that screen is the only
   * place in the app where the price of each individual trait is visible. That
   * makes it the detection surface for exactly the defect the cost engines'
   * `undefined`-is-not-zero protocol exists to prevent: `wta_rites` and
   * `ctdbs_backgrounds` were free per-CATEGORY, so they showed up here as a
   * column of zeroes long before they showed up as a wrong balance.
   *
   * `cost` is `number | undefined` and is NOT defaulted. An unpriceable trait
   * must read as unpriceable on the audit screen; rendering it as 0 is the
   * thing this screen exists to catch.
   */
  async calculate_total_cost(): Promise<Record<string, TraitCostEntry>> {
    const ids = this.venue.TOTAL_COST_CATEGORIES.flatMap(
      (category) => (this.get(category) as Parse.Object[] | undefined) ?? [],
    ).filter((trait): trait is Parse.Object => trait !== undefined && trait !== null)

    const traits = await Parse.Object.fetchAllIfNeeded(ids)

    const response: Record<string, TraitCostEntry> = {}
    for (const trait of traits) {
      const key = `${trait.get('category')}-${trait.get('name')}`
      response[key] = { trait, cost: this.calculate_trait_cost(trait) }
    }
    return response
  },

  /* --------------------------------------------------------------------- *
   * Core text attributes
   * --------------------------------------------------------------------- */

  /**
   * Set a core text attribute, dispatching through the venue.
   *
   * Only Changeling overrides this (a Kith change grants and releases affinity
   * Arts), so the strategy's `update_text` is optional and the base runs when it
   * is absent. A venue override reaches the base through `base_update_text`,
   * which is what `Character.baseMethods.update_text.apply(self, …)` was doing
   * in the Backbone app.
   */
  update_text(target: string, value: string): Promise<unknown> {
    const venue = this.venue as VenueStrategy & {
      update_text?(character: VenueCharacter, target: string, value: string): Promise<unknown>
    }
    if (venue.update_text) {
      return venue.update_text(this as unknown as VenueCharacter, target, value)
    }
    return this.base_update_text(target, value)
  },

  /** See `update_text`. */
  unpick_text(target: string): Promise<unknown> {
    const venue = this.venue as VenueStrategy & {
      unpick_text?(character: VenueCharacter, target: string): Promise<unknown>
    }
    if (venue.unpick_text) {
      return venue.unpick_text(this as unknown as VenueCharacter, target)
    }
    return this.base_unpick_text(target)
  },

  /**
   * The unoverridden `update_text`: save the attribute and mark the matching
   * creation step done.
   *
   * Resolves with `undefined` rather than the character when the save fails --
   * the original ended in `.fail(PromiseFailReport)`, and a Parse 1.5 `.fail`
   * that returns a value RESOLVES the promise. Callers that navigate on success
   * therefore navigate on failure too. Preserved; the E2E suite asserts it.
   */
  async base_update_text(target: string, value: string): Promise<unknown> {
    this.set(target, value)
    try {
      await this.save()
      const creations = await Parse.Object.fetchAllIfNeeded([this.get('creation') as Parse.Object])
      const creation = first_or_throw(creations, 'creation record')
      if (creation.get(target)) {
        return this
      }
      creation.set(target, true)
      await creation.save()
      return this
    } catch (e) {
      promiseFailReport(e)
      return undefined
    }
  },

  /**
   * The unoverridden `unpick_text`. Unlike `base_update_text` this one has no
   * `.fail` in the original and genuinely rejects.
   */
  async base_unpick_text(target: string): Promise<unknown> {
    this.unset(target)
    await this.save()
    const creations = await Parse.Object.fetchAllIfNeeded([this.get('creation') as Parse.Object])
    const creation = first_or_throw(creations, 'creation record')
    creation.set(target, false)
    await creation.save()
    return this
  },

  /* --------------------------------------------------------------------- *
   * Troupe membership and ACLs
   * --------------------------------------------------------------------- */

  /**
   * The troupes this character belongs to.
   *
   * Throws rather than answering `[]` when membership has not been read: an
   * empty answer is indistinguishable from "no troupes", and that ambiguity is
   * what silently writes rows troupe staff cannot see.
   */
  get_troupe_ids(): readonly string[] {
    const ids = TROUPE_IDS.get(this)
    if (ids === undefined) {
      throw new Error(
        'get_troupe_ids() before initialize_troupe_membership(); await character.acl_for_me()',
      )
    }
    return ids
  },

  /** Whether troupe membership has been read at least once. */
  has_troupe_membership(): boolean {
    return TROUPE_IDS.has(this)
  },

  /**
   * Read the character's troupe membership from the server.
   *
   * `throttle` skips the round trip if the last read was under 50 seconds ago,
   * which is what the character loader passes on every navigation.
   */
  async initialize_troupe_membership(throttle = false): Promise<Character> {
    let initialize = true
    if (TROUPE_IDS.has(this) && throttle) {
      const last = TROUPE_READ_AT.get(this)
      if (last !== undefined && Date.now() - last < 50000) {
        initialize = false
      }
    }
    if (!initialize) {
      return this
    }

    TROUPE_READ_AT.set(this, Date.now())
    /*
     * Keep the previous answer until a new one is complete.
     *
     * The ids are published only once the query finishes. Publishing an empty
     * array up front and filling it as results arrive would let any ACL built
     * mid-read omit troupe roles -- silently, which is the exact failure this
     * whole ordering guarantee exists to prevent -- and would also leave the
     * character holding an EMPTY membership if the read then failed.
     */
    const previous = TROUPE_IDS.get(this)
    const ids: string[] = []

    if (this.troupes === undefined) {
      // Never been set up in the first place. `targetClassName` has to be stated
      // because a relation with no server data yet does not know what it points
      // at, and `query()` cannot be built without it.
      const relation = this.relation('troupes')
      relation.targetClassName = 'Troupe'
      this.troupes = relation
    }
    /*
     * The original had a second branch here for `_.isNull(self.troupes.parent)`
     * -- "was trickily overwritten for the sake of get_transformed". Parse 1.5
     * shared ONE live relation object between a character and its clone, so
     * `get_transformed` nulled the parent to stop the clone writing through it,
     * and this branch re-adopted it afterwards. `@/domain/CharacterExperience`
     * still performs that null, so the re-adoption stays available: setting
     * `troupes` to `undefined` there (or nulling its parent) makes the next call
     * rebuild the relation from the character, which is the same repair.
     */
    if (this.troupes.parent === null || this.troupes.parent === undefined) {
      const relation = this.relation('troupes')
      relation.targetClassName = 'Troupe'
      this.troupes = relation
    }

    const q = this.troupes.query()
    try {
      await q.each((troupe) => {
        ids.push(troupe.id as string)
      })
    } catch (error) {
      /*
       * A failed read must not cost the user their edit.
       *
       * Every write path awaits this before building an ACL, so an unguarded
       * rejection here refuses a trait edit, a rename or a long-text save that
       * the Backbone app would have completed -- it never read troupes on those
       * paths at all. But answering with an empty membership is worse: that is
       * precisely the role-less ACL this ordering exists to prevent, and it
       * would be written to the server rather than merely displayed.
       *
       * So: if a previous read succeeded, keep its answer and carry on with a
       * possibly-stale but structurally correct ACL. The throttle timestamp is
       * rolled back so the next attempt retries immediately instead of trusting
       * the failure for 50 seconds.
       *
       * With no previous answer there is nothing honest to build an ACL from,
       * and the refusal stands -- but as a named error rather than a raw
       * relation-query rejection, because a view branching on `error.code` would
       * otherwise fall through to its generic handler.
       */
      TROUPE_READ_AT.delete(this)
      if (previous !== undefined) {
        TROUPE_IDS.set(this, previous)
        console.log(
          'Could not refresh troupe membership; using the previous answer. ' +
            ((error as { message?: string })?.message ?? String(error)),
        )
        return this
      }
      throw new Parse.Error(
        Parse.Error.CONNECTION_FAILED,
        "Could not read this character's troupe membership, so the permissions " +
          'for any change cannot be worked out. Nothing was saved. ' +
          ((error as { message?: string })?.message ?? String(error)),
      )
    }
    TROUPE_IDS.set(this, ids)
    return this
  },

  /**
   * The ACL every row owned by this character must carry.
   *
   * No public access. Owner read+write -- or the CURRENT user's, when the owner
   * attribute is ABSENT, which is how a newly created character gets an ACL
   * before its owner pointer is set. Administrator read+write. And `LST_<id>`
   * and `AST_<id>` read+write for every troupe id in `troupe_ids`.
   *
   * That last part is why this method THROWS when membership has not been read.
   * `troupe_ids` is filled by `initialize_troupe_membership`, which the old
   * `get_character` ran LAST in its fetch chain -- so any save issued before it
   * resolved wrote rows with no troupe roles on them, storytellers could not see
   * the character, and NOTHING ANYWHERE REPORTED IT. Answering `[]` while the
   * fetch is in flight makes that failure silent and plausible; throwing makes
   * it a stack trace at the exact call site.
   *
   * Every write path in this file hoists `initialize_troupe_membership(true)`
   * above its first ACL, so the throw is a guard against a NEW caller getting
   * the order wrong, not a hazard for existing ones. In async code use
   * `acl_for_me()`, which cannot be got wrong.
   */
  get_me_acl(): Parse.ACL {
    const troupe_ids = TROUPE_IDS.get(this)
    if (troupe_ids === undefined) {
      throw new Error(
        'get_me_acl() called before initialize_troupe_membership(). Await ' +
          'acl_for_me() instead; building an ACL now would omit every LST_/AST_ ' +
          'role and hide this character from its own storytellers.',
      )
    }

    const acl = new Parse.ACL()
    acl.setPublicReadAccess(false)
    acl.setPublicWriteAccess(false)

    const owner = this.get('owner')
    if (owner === undefined) {
      const current = Parse.User.current()
      acl.setReadAccess(current as Parse.User, true)
      acl.setWriteAccess(current as Parse.User, true)
    } else {
      acl.setReadAccess(owner, true)
      acl.setWriteAccess(owner, true)
    }

    acl.setRoleReadAccess('Administrator', true)
    acl.setRoleWriteAccess('Administrator', true)

    for (const id of troupe_ids) {
      acl.setRoleReadAccess('LST_' + id, true)
      acl.setRoleWriteAccess('LST_' + id, true)
      acl.setRoleReadAccess('AST_' + id, true)
      acl.setRoleWriteAccess('AST_' + id, true)
    }
    return acl
  },

  /**
   * The ACL, with the troupe read guaranteed to have happened first.
   *
   * Throttled, so it costs a round trip once per character per 50 seconds and
   * nothing thereafter -- which is what lets `get_me_acl` afford to be strict.
   */
  async acl_for_me(): Promise<Parse.ACL> {
    await this.initialize_troupe_membership(true)
    return this.get_me_acl()
  },

  /** Stash the ACL as JSON on the character, for the server-side hooks. */
  set_cached_acl(acl?: Parse.ACL): void {
    const resolved = acl ?? this.get_me_acl()
    this.set('acl_to_json', JSON.stringify(resolved.toJSON()))
  },

  /**
   * Drop the cached view of the `troupes` relation.
   *
   * WHAT THE ORIGINAL DID, AND WHY IT CANNOT BE COPIED
   *
   * `update_troupe_acls` ran four deletes after saving the character:
   *
   *     delete self.attributes.troupes;
   *     delete self.troupes;
   *     delete self._previousAttributes.troupes;
   *     delete self._serverData.troupes;
   *
   * Two of those keys -- `_previousAttributes` and `_serverData` -- are
   * SDK-private state that only exists in the Backbone app because parse-compat
   * rebuilds Backbone's model surface on top of parse@8. This client does not
   * load parse-compat, so those objects are not there to delete from.
   *
   * WHAT THEY WERE FOR
   *
   * `join_troupe` and `leave_troupe` mutate the relation (`troupes.add(t)` /
   * `.remove(t)`) and then call this method to save. After that save the
   * in-memory relation still carried the pre-save picture, and the next
   * `initialize_troupe_membership` would reuse it instead of asking the server.
   * The deletes forced a rebuild.
   *
   * WHAT THIS DOES INSTEAD
   *
   * Drops the two things actually cached here: the relation handle, and the
   * throttle timestamp that would otherwise let the next
   * `initialize_troupe_membership(true)` skip the re-read. `troupe_ids` is left
   * alone -- deliberately, because the original left it alone too, and the ACL
   * being written in the same method is built from it.
   *
   * Nothing else needs clearing. parse@8 rebuilds a `Parse.Relation` from the
   * attribute on every `relation()` call, and after a successful save that
   * attribute holds the server's answer, not ours.
   */
  forget_troupe_relation(): void {
    this.troupes = undefined
    TROUPE_READ_AT.delete(this)
  },

  /**
   * Rewrite the ACL on the character and on everything it owns.
   *
   * Long, sequential and chatty on purpose: each step reports progress, and each
   * one can take seconds on a character with hundreds of traits.
   */
  async update_troupe_acls(): Promise<Character> {
    const allsts: Parse.Object[] = []

    this.progress('Updating character permissions')
    const newACL = await this.acl_for_me()
    this.set_cached_acl(newACL)
    this.setACL(newACL)
    await this.save()

    this.progress('Updating trait permissions')
    this.forget_troupe_relation()

    const trait_query = new Parse.Query('SimpleTrait')
    trait_query.equalTo('owner', this as unknown as Parse.Object)
    await trait_query.each((st) => {
      st.setACL(this.get_me_acl())
      allsts.push(st)
    })

    this.progress('Saving trait permissions')
    /*
     * `Parse.Promise.when` over per-trait saves, with each save's `.fail`
     * returning a value -- which in Parse 1.5 RESOLVES that save. So one
     * unsaveable trait never aborted the rest, and the `Parse.Error` it built
     * was thrown away. `settle_all` plus a per-save `catch` reproduces that;
     * `Promise.all` would abandon the remaining traits on the first refusal.
     */
    await settle_all(
      allsts.map((st) => {
        const name = st.get('name')
        return st
          .save()
          .catch(
            () => new Parse.Error(Parse.Error.OTHER_CAUSE, 'Could not save ' + name),
          ) as Promise<unknown>
      }),
    )

    this.progress('Fetching experience notations')
    const ens = await this.get_experience_notations()

    this.progress('Updating experience notations')
    for (const en of ens) {
      en.setACL(this.get_me_acl())
    }
    await Parse.Object.saveAll(ens as Parse.Object[])

    this.progress('Updating server side change log')
    await updateVampireChangePermissionsFor(this.id as string)

    this.progress('Fetching long texts to update')
    const longtexts = await this.get_minimal_long_texts()

    this.progress('Updating long texts with new permissions')
    for (const lt of longtexts) {
      lt.setACL(this.get_me_acl())
    }
    await Parse.Object.saveAll(longtexts as Parse.Object[])

    this.progress('Finishing up!')
    return this
  },

  async join_troupe(troupe: Parse.Object): Promise<Character> {
    await this.initialize_troupe_membership()
    this.troupes?.add(troupe)
    TROUPE_IDS.get(this)?.push(troupe.id as string)
    return this.update_troupe_acls()
  },

  /**
   * Leave a troupe.
   *
   * BUG PRESERVED, DELIBERATELY. The original line is
   *
   *     self.troupe_ids = _.remove(self.troupe_ids, troupe.id);
   *
   * and lodash 3's `_.remove(array, predicate)` removes the elements MATCHING a
   * predicate and returns THE REMOVED ONES. Passing a string makes `getCallback`
   * build the property shorthand `value => value[troupe.id]`, which is
   * `undefined` for every string in the array -- so nothing is removed,
   * `_.remove` returns `[]`, and `troupe_ids` is assigned the empty array.
   *
   * The consequence is not cosmetic: `update_troupe_acls` runs next and rewrites
   * the character and every trait, notation and long text it owns with an ACL
   * carrying NO `LST_`/`AST_` roles at all. Leaving one troupe therefore removes
   * staff access for every other troupe the character is still in. The relation
   * itself is updated correctly, so a later `initialize_troupe_membership` reads
   * the right ids back -- but nothing re-applies the ACLs.
   *
   * Reproduced verbatim because bug-compatibility is the requirement and the E2E
   * suite asserts current behaviour. The fix is one line
   * (`ids.filter((id) => id !== troupe.id)`) plus a decision about re-running
   * the ACL pass over the characters already damaged.
   */
  async leave_troupe(troupe: Parse.Object): Promise<Character> {
    await this.initialize_troupe_membership()
    this.troupes?.remove(troupe)
    TROUPE_IDS.set(this, [])
    return this.update_troupe_acls()
  },

  /* --------------------------------------------------------------------- *
   * Permissions audit
   * --------------------------------------------------------------------- */

  /** A spiritual clone of `get_expected_vampire_ids` in cloud/main.js. */
  async get_owned_ids(): Promise<Record<string, string[]>> {
    const results: Record<string, string[]> = {
      SimpleTrait: [],
      ExperienceNotation: [],
      VampireChange: [],
    }
    const class_names = ['SimpleTrait', 'ExperienceNotation', 'VampireChange']
    await settle_all(
      class_names.map(async (class_name) => {
        const q = new Parse.Query(class_name)
          .equalTo('owner', this as unknown as Parse.Object)
          .select('id')
        await q.each((t) => {
          results[class_name]?.push(t.id as string)
        })
      }),
    )
    return results
  },

  /**
   * Compare what the client can see against what the server says it owns.
   *
   * `Parse.Promise.when(a, b).then(function (client, server) {…})` delivered the
   * two results as two ARGUMENTS. Destructured explicitly here.
   *
   * `_.eq` in lodash 3 is an alias for `isEqual` (lodash.js:12065) -- a DEEP
   * comparison, not reference equality. lodash 4's `eq` is SameValueZero, which
   * would report every character as mismatched.
   */
  update_server_client_permissions_mismatch(): Promise<Character> {
    return this.mismatchQueue.always(async () => {
      const [client, server] = await settle_all<unknown>([
        this.get_owned_ids(),
        getExpectedVampireIds(this.id as string),
      ])
      this.is_mismatched = !isEqual(client, server)
      return this
    })
  },

  check_server_client_permissions_mismatch(): Promise<Character> {
    if (this.is_mismatched === undefined) {
      return this.update_server_client_permissions_mismatch()
    }
    return Promise.resolve(this)
  },

  /* --------------------------------------------------------------------- *
   * Long texts
   * --------------------------------------------------------------------- */

  /**
   * Get a long text from the server or the local cache.
   *
   * Resolves with the LongText, or `null` when the server has none in that
   * category. Serialised through `longTextQueue` (the original's `_ltPromise`)
   * with `has_long_text` and `get_minimal_long_texts`, because all three write
   * or read the same cache.
   */
  get_long_text(
    category: string,
    options?: { update?: boolean },
  ): Promise<LongText | null | undefined> {
    const opts = options ?? { update: false }
    return this.longTextQueue.always(async () => {
      const cache = this._ltCache
      if (Object.prototype.hasOwnProperty.call(cache, category)) {
        if (!opts.update) {
          return cache[category]
        }
      }
      const lt = await longTextQueryFor(this as unknown as Parse.Object, category).first()
      cache[category] = lt === undefined ? null : lt
      // Replaces `self.trigger("change:longtext" + category, lt)`.
      touch(this)
      return cache[category]
    })
  },

  /** Cache a long text on the character; resolves with the character. */
  async fetch_long_text(category: string, options?: { update?: boolean }): Promise<Character> {
    await this.get_long_text(category, options)
    return this
  },

  /** Whether the SERVER has a long text in this category. Does not cache. */
  has_long_text(category: string): Promise<boolean> {
    return this.longTextQueue.always(async () => {
      const lt = await longTextQueryFor(this as unknown as Parse.Object, category).first()
      return lt !== undefined
    })
  },

  /** Whether a long text in this category is locally cached. */
  has_fetched_long_text(category: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._ltCache, category)
  },

  /** Read from the local cache only. `undefined` means "never asked". */
  get_fetched_long_text(category: string): LongText | null | undefined {
    return this._ltCache[category]
  },

  /** Create or update the long text in this category. */
  async update_long_text(category: string, new_text: string): Promise<LongText> {
    const acl = await this.acl_for_me()
    let lt = await this.get_long_text(category, { update: true })
    if (lt === null || lt === undefined) {
      lt = createLongText({
        category,
        owner: this as unknown as Parse.Object,
        text: new_text,
      })
    } else {
      lt.set({ text: new_text })
    }
    lt.setACL(acl)
    await lt.save()
    this._ltCache[category] = lt
    touch(this)
    return lt
  },

  /** Remove the long text in this category from the server and the cache. */
  async remove_long_text(category: string, options?: { update?: boolean }): Promise<null | void> {
    // `_.defaults`, not an object spread. lodash 3's `assignDefaults` is
    // `objectValue === undefined ? sourceValue : objectValue`, so a key that is
    // PRESENT but `undefined` still gets the default -- verified against the
    // vendored copy: `_.defaults({update: undefined}, {update: true})` is
    // `{update: true}`. A spread would let that explicit `undefined` win and
    // make `update` falsy, so `get_long_text` would return the CACHED row and
    // this would destroy a stale object instead of the current one.
    const opts = { update: options?.update === undefined ? true : options.update }
    const lt = await this.get_long_text(category, opts)
    if (!lt) {
      return null
    }
    // The original passed `{wait: true}`, which is a Backbone collection option
    // -- it tells a collection to hold the removal until the server confirms.
    // `Parse.Object#destroy` has never read it, and there is no collection here
    // to hold anything, so it is dropped rather than translated.
    await lt.destroy()
    delete this._ltCache[category]
    touch(this)
  },

  /** Drop a long text from the local cache only. */
  free_fetched_long_text(category: string): void {
    delete this._ltCache[category]
  },

  /**
   * Every long text this character owns, with only the fields needed to rewrite
   * an ACL. Used by `update_troupe_acls`, which would otherwise pull the full
   * text of every entry on the sheet.
   */
  get_minimal_long_texts(): Promise<LongText[]> {
    return this.longTextQueue.always(async () => {
      const longtexts: LongText[] = []
      await minimalLongTextQueryFor(this as unknown as Parse.Object).each((lt) => {
        longtexts.push(lt)
      })
      return longtexts
    })
  },

  /* --------------------------------------------------------------------- *
   * Derived reads
   * --------------------------------------------------------------------- */

  /**
   * The portrait thumbnail URL, fetching the portrait if needed.
   *
   * `head_skull.png` is the fallback for a character with no portrait, and it is
   * a relative path resolved against the app, not a Parse file.
   */
  async get_thumbnail(size: number | string): Promise<string | undefined> {
    const portrait = this.get('portrait') as Parse.Object | undefined
    if (!portrait) {
      return 'head_skull.png'
    }
    const fetched = await portrait.fetch()
    // The original also logged `get_thumbnail_sync(size)` here. Dropped: it is
    // debug output with no effect, and it makes a synchronous read look like
    // part of the fetch.
    return (fetched.get('thumb_' + size) as Parse.File).url()
  },

  /**
   * The portrait thumbnail URL without a round trip.
   *
   * The original was `_.result(self, "attributes.portrait.attributes.thumb_" +
   * size + ".url", "head_skull.png")`: a deep path through the Backbone
   * attribute bags, with the resolved `url` INVOKED because lodash's `result`
   * calls a function it lands on. Written out here -- reaching through
   * `.attributes` is reaching into SDK-private state, and `get()` gives the same
   * values.
   *
   * The fallback applies at every missing step: no portrait, an unfetched
   * portrait pointer (whose `thumb_*` reads as undefined), or a portrait with no
   * file at that size.
   */
  get_thumbnail_sync(size: number | string): string | undefined {
    const portrait = this.get('portrait') as Parse.Object | undefined
    if (!portrait) return 'head_skull.png'
    const file = portrait.get('thumb_' + size) as Parse.File | undefined
    if (!file || typeof file.url !== 'function') return 'head_skull.png'
    return file.url()
  },

  /** Health levels in display order, as `[name, value]` pairs. */
  health_levels(): Array<[string, number | undefined]> {
    const order = ['Healthy', 'Injured', 'Incapacitated']
    const levels: Record<string, number | undefined> = {}
    const stored = (this.get('health_levels') as Parse.Object[] | undefined) ?? []
    for (const hl of stored) {
      levels[String(hl.get('name'))] = hl.get('value') as number | undefined
    }
    return order.map((n) => [n, levels[n]])
  },

  /**
   * Total willpower.
   *
   * `_.sum(wps, "attributes.value")` again, so a source with no value counts as
   * zero rather than turning the total into NaN. See `sum_trait_values`.
   */
  get_willpower_total(): number {
    return sum_trait_values(this.get('willpower_sources'))
  },

  get_sorted_skills(): Parse.Object[] {
    const skills = (this.get('skills') as Parse.Object[] | undefined) ?? []
    return [...skills].sort(compare_by_name)
  },

  /**
   * Skills laid out in columns for the printable sheet.
   *
   * Note the original built `{0: [], 1: [], 2: []}` and then zipped exactly
   * three columns regardless of `columnCount`, so any other count silently drops
   * the extras. Preserved; the only caller passes 3 (CharacterPrintView.js:391).
   */
  get_grouped_skills(
    sortedSkills?: Parse.Object[],
    columnCount = 3,
  ): Array<Array<Parse.Object | undefined>> {
    let remaining = sortedSkills ?? this.get_sorted_skills()
    const columns: Array<Parse.Object[]> = []
    const shiftAmount = Math.ceil(remaining.length / columnCount)
    for (let i = 0; i < columnCount; i += 1) {
      columns[i] = remaining.slice(0, shiftAmount)
      remaining = remaining.slice(shiftAmount)
    }

    // `_.zip` of exactly three columns, padding short ones with undefined.
    const first = columns[0] ?? []
    const second = columns[1] ?? []
    const third = columns[2] ?? []
    const height = Math.max(first.length, second.length, third.length)
    const rows: Array<Array<Parse.Object | undefined>> = []
    for (let i = 0; i < height; i += 1) {
      rows.push([first[i], second[i], third[i]])
    }
    return rows
  },

  /** Drop the owner pointer. The character stays queryable by storytellers. */
  async archive(): Promise<Parse.Object> {
    this.unset('owner')
    return this.save()
  },

  /* --------------------------------------------------------------------- *
   * The two ledger entry points this file's own methods need
   *
   * The rest of the ledger and the whole change-log / approval replay live in
   * `@/domain/CharacterExperience` and are reached through `character.experience`.
   * These two are forwarded because `update_trait`, `remove_trait` and
   * `update_troupe_acls` call them, and because `@/domain/venues/common`'s
   * `ensure_creation_rules_exist` calls `add_experience_notation` on the
   * character itself.
   * --------------------------------------------------------------------- */

  add_experience_notation(
    options: ExperienceNotationOptions | VenueExperienceNotationOptions,
  ): Promise<unknown> {
    return this.experience.add_experience_notation(options as ExperienceNotationOptions)
  },

  get_experience_notations(): Promise<readonly Parse.Object[]> {
    return this.experience.get_experience_notations() as Promise<readonly Parse.Object[]>
  },

  get_recorded_changes(): Promise<readonly unknown[]> {
    return this.experience.get_recorded_changes() as Promise<readonly unknown[]>
  },

  get_approvals(): Promise<readonly unknown[]> {
    return this.experience.get_approvals() as Promise<readonly unknown[]>
  },

  _propagate_experience_notation_change(
    notations: readonly unknown[],
    startIndex: number,
  ): readonly unknown[] {
    return this.experience._propagate_experience_notation_change(
      notations as never,
      startIndex,
    ) as readonly unknown[]
  },

  update_creation_rules_for_changed_trait(
    category: string,
    modified_trait: Parse.Object,
    freeValue: number | undefined,
  ): Promise<unknown> {
    return this.venue.update_creation_rules_for_changed_trait(
      this as unknown as VenueCharacter,
      category,
      modified_trait as never,
      freeValue,
    ) as Promise<unknown>
  },

  wait_on_current_experience_update(): Promise<unknown> {
    return this.experience.wait_on_current_experience_update()
  },
}

/* ------------------------------------------------------------------------- *
 * Installation
 * ------------------------------------------------------------------------- */

let installed = false

/**
 * Install the character behaviour on `CharacterObject.prototype`.
 *
 * This is `Parse.Object.extend("Vampire", instance_methods)` without the load
 * -order dependence. In the Backbone app the venue modules got these methods
 * only because Parse 1.5 chained repeated registrations of the className
 * "Vampire" into an inheritance graph -- which made base behaviour a function of
 * RequireJS load order, and which parse@8 cannot do at all. Here there is one
 * class, one installation, and an explicit call.
 *
 * Idempotent, and safe to call before any character exists.
 */
export function installCharacterMethods(): void {
  if (installed) return
  installed = true

  // Traits handed to the venues must answer `get_base_name()`; the venue types
  // require it and every venue path that reads a trait's identity calls it
  // unguarded, exactly as the source did.
  installSimpleTraitMixin()

  /*
   * `Object.assign` copies data properties only -- it READS a getter off the
   * source and stores the result. Every accessor is therefore installed below
   * with `Object.defineProperty`, and `characterMethods` holds nothing but
   * plain functions. `venueKey` is deliberately absent from it: `CharacterObject`
   * already declares that getter, and assigning over it throws.
   */
  Object.assign(CharacterObject.prototype, characterMethods)

  const proto = CharacterObject.prototype as unknown as Record<string, unknown>

  /** The venue strategy for this record. Resolved per read, never cached. */
  define_accessor(proto, 'venue', function (this: object) {
    return venueForCharacter(this as unknown as VenueCharacter)
  })

  define_accessor(proto, 'traitQueue', function (this: object) {
    return queue_for(TRAIT_QUEUES, this)
  })
  define_accessor(proto, 'longTextQueue', function (this: object) {
    return queue_for(LONG_TEXT_QUEUES, this)
  })
  define_accessor(proto, 'mismatchQueue', function (this: object) {
    return queue_for(MISMATCH_QUEUES, this)
  })

  define_accessor(
    proto,
    '_ltCache',
    function (this: object) {
      let cache = LT_CACHES.get(this)
      if (cache === undefined) {
        cache = {}
        LT_CACHES.set(this, cache)
      }
      return cache
    },
    function (this: object, value: unknown) {
      LT_CACHES.set(this, (value ?? {}) as Record<string, LongText | null>)
    },
  )

  define_accessor(
    proto,
    'troupes',
    function (this: object) {
      return TROUPE_RELATIONS.get(this)
    },
    function (this: object, value: unknown) {
      TROUPE_RELATIONS.set(this, value as Parse.Relation | undefined)
    },
  )

  define_accessor(
    proto,
    'is_mismatched',
    function (this: object) {
      return MISMATCHED.get(this)
    },
    function (this: object, value: unknown) {
      if (value === undefined) MISMATCHED.delete(this)
      else MISMATCHED.set(this, value as boolean)
    },
  )

  define_accessor(proto, 'experience', function (this: object) {
    let ledger = LEDGERS.get(this)
    if (ledger === undefined) {
      // The cast is the one place the two ports meet. `XpCharacter` names
      // `troupes` as `{parent: unknown} | null`, where a real `Parse.Relation`
      // declares `parent?: Parse.Object` -- optional versus required, so the
      // structural check fails on a property both sides agree about. Nothing
      // about the runtime shape differs.
      ledger = new CharacterExperience(this as unknown as XpCharacter)
      LEDGERS.set(this, ledger)
    }
    return ledger
  })
}

function define_accessor(
  target: Record<string, unknown>,
  name: string,
  get: (this: object) => unknown,
  set?: (this: object, value: unknown) => void,
): void {
  Object.defineProperty(target, name, {
    get,
    set,
    configurable: true,
    enumerable: false,
  })
}

/**
 * Every pointer column any venue asks `get_character` to include.
 *
 * The union, deduplicated, because the first fetch cannot know the venue -- the
 * `type` discriminant is on the row being fetched. Including a column a
 * particular venue does not use is a no-op on the server; the alternative is an
 * extra round trip purely to learn the type.
 */
const ALL_GET_CHARACTER_INCLUDES: readonly string[] = Array.from(
  new Set(ALL_VENUES.flatMap((venue) => [...venue.GET_CHARACTER_INCLUDES])),
)

/**
 * The shared character cache a load reads and writes.
 *
 * The Backbone router WAS this object: it passed *itself* as `character_cache`
 * and `Model.get_character` recursively mutated `router._character`
 * (`mobileRouter.js:1618-1676`). That made the currently-open character de facto
 * global state, which is why the router also carried `last_fetched_character_id`
 * and a staleness check. Naming the shape here keeps that state explicit and
 * lets a store own it instead of the router.
 */
export interface CharacterCache {
  _character: Character | null
}

/**
 * Load a character, its traits, its creation record and its troupe membership.
 *
 * A port of `Model.get_character` (`Vampire.js:314-368`, and the identical
 * functions in `Werewolf.js` and `ChangelingBetaSlice.js`, which differ only in
 * their includes and in whether the troupe read is throttled). Every screen that
 * shows a character goes through this.
 *
 * The source is recursive, re-entering itself after each stage with the cache
 * carrying the partial result. That is reproduced as a loop; the stages, their
 * order and their side effects are unchanged, because each one depends on the
 * last:
 *
 *  1. **Fetch the row**, with `portrait` and the venue's own pointer columns
 *     included. Deliberately NOT `owner` -- including it makes parse-server
 *     delete the pointer for a private owner, and `get_me_acl` reads a missing
 *     owner as "no owner" and grants the CURRENT user read and write, so opening
 *     someone else's sheet would rewrite its ACL to the viewer.
 *  2. **Flush a stale cache.** If the cache holds a DIFFERENT character, it is
 *     SAVED before being discarded. That save is not incidental: the Backbone
 *     app edited the cached character in place, so dropping it without saving
 *     would silently discard pending edits when the user opened another sheet.
 *  3. **Hydrate the requested trait categories.** `"all"` expands to every
 *     category the venue declares.
 *  4. **Seed the creation record, the cost tables, and troupe membership** -- in
 *     that order. Troupe membership is LAST in the source, which is exactly why
 *     `get_me_acl` throws when it has not run: any save issued before this
 *     resolved wrote rows with no `LST_`/`AST_` roles on them.
 *
 * The `characters` argument accepts a category name, a list of them, or the
 * string `"all"`, matching the source's overloading.
 */
export async function get_character(
  id: string,
  categories: string | readonly string[] = [],
  cache: CharacterCache = { _character: null },
): Promise<Character> {
  let wanted: string[] = typeof categories === 'string' ? [categories] : [...categories]

  for (;;) {
    if (cache._character === null) {
      const query = new Parse.Query(CharacterObject)
      query.include('portrait')
      /*
       * The venue is not known until the row is read -- `type` is on the record
       * -- so the includes cannot be venue-specific on the FIRST fetch. The
       * source had the same problem and solved it by having three separate
       * statics, one per venue, each already knowing which to use. Here the
       * union of all three is included: they are pointer columns, an include for
       * a column this venue does not have is a no-op, and the alternative is a
       * second round trip to learn the type before fetching the data.
       */
      for (const include of ALL_GET_CHARACTER_INCLUDES) query.include(include)
      const found = await query.get(id)
      cache._character = characterFor(found as CharacterObject)
      continue
    }

    if (cache._character.id !== id) {
      // Save before discarding -- see step 2 above.
      await cache._character.save()
      cache._character = null
      continue
    }

    const character = cache._character

    if (wanted.length === 1 && wanted[0] === 'all') {
      wanted = character.venue.ALL_SIMPLETRAIT_CATEGORIES.map((entry) => entry[0] as string)
    }

    if (wanted.length !== 0) {
      const pointers = wanted
        .flatMap((category) => (character.get(category) as Parse.Object[] | undefined) ?? [])
        // `.filter(function (id) { return id.id; })` in the source: a pointer
        // that never got an objectId cannot be fetched and would throw.
        .filter((trait): trait is Parse.Object => !!trait && !!trait.id)
      await Parse.Object.fetchAllIfNeeded(pointers)
      wanted = []
      continue
    }

    /*
     * Troupe membership FIRST -- a deliberate reordering, and the only one in
     * this function.
     *
     * The source ran `ensure_creation_rules_exist().then(initialize_costs)
     * .then(initialize_troupe_membership)` (`Vampire.js:363-367`). But
     * `ensure_creation_rules_exist` WRITES: it seeds the creation record and
     * adds the +30 "Character Creation XP" notation, and
     * `_default_experience_notation` stamps `get_me_acl()` on that notation. So
     * in the Backbone app that row was written before membership had ever been
     * read, `_.each(undefined, ...)` contributed no roles, and the notation
     * landed carrying no `LST_`/`AST_` entries at all -- invisible to the
     * character's own storytellers, with nothing anywhere reporting it.
     *
     * This is the defect `get_me_acl`'s throw was built to surface, and it
     * surfaced it: the guard fired here the first time a character was created
     * through the ported code.
     *
     * Reading membership first costs one relation query that this function was
     * going to make anyway, three lines later. For a brand-new character it
     * returns empty -- which is correct, and produces exactly the ACL the old
     * code produced by accident. For an existing character it produces the
     * right one, where the old code produced a role-less one.
     */
    await character.initialize_troupe_membership(character.venue.TROUPE_MEMBERSHIP_THROTTLED)
    await character.venue.ensure_creation_rules_exist(character as unknown as VenueCharacter)
    await character.venue.initialize_costs()
    return character
  }
}

/**
 * A character row, typed with the model behaviour and with that behaviour
 * guaranteed installed.
 *
 * This is a cast, not a wrapper: the object IS the character, so two views of
 * the same row share one `traitQueue` and one long-text cache -- which is the
 * whole point of those queues. `install` is idempotent and cheap.
 */
export function characterFor(object: CharacterObject): Character {
  installCharacterMethods()
  return object as Character
}

/* ------------------------------------------------------------------------- *
 * Small shared helpers
 * ------------------------------------------------------------------------- */

/**
 * The venue's own numeric term, under the name its own venue uses.
 *
 * Generation, rank and seeming are ONE slot -- the venue strategies unify it as
 * `venue_term` -- but they are three different words, and in the Backbone app
 * each method existed only on its own venue's prototype: asking a werewolf for
 * its generation was a TypeError, not its rank.
 *
 * The guard keeps that. Unifying the slot must not quietly answer a
 * wrong-venue question with the right-venue number, because the caller asking
 * a werewolf for a generation has a bug and the answer would look plausible.
 */
function namedVenueTerm(character: Character, venue: VenueKey, name: string): number {
  assertVenue(character, venue, name)
  return character.venue.venue_term(character as unknown as VenueCharacter)
}

function namedVenueTermPresent(character: Character, venue: VenueKey, name: string): boolean {
  assertVenue(character, venue, name)
  return character.venue.has_venue_term(character as unknown as VenueCharacter)
}

function assertVenue(character: Character, venue: VenueKey, name: string): void {
  if (character.venue.key !== venue) {
    throw new CharacterError(
      4,
      `${name}() is defined for a ${venue} character; this one is a ${character.venue.key}`,
    )
  }
}

/** A method only some venues define, called on the venue that does. */
function venueMethod(character: Character, name: string): unknown {
  const venue = character.venue as unknown as Record<string, ((ch: unknown) => unknown) | undefined>
  const fn = venue[name]
  if (typeof fn !== 'function') {
    throw new CharacterError(
      4,
      `${name}() is not defined for a ${character.venue.key} character`,
    )
  }
  return fn.call(venue, character)
}

function safe_stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * The first element, or a named error.
 *
 * The original indexed `[0]` straight into `fetchAllIfNeeded`'s result and let a
 * TypeError happen when the list came back empty -- which it does when the
 * character has no `creation` pointer at all. Same failure, with a message that
 * says which pointer was missing.
 */
function first_or_throw<T>(list: T[], what: string): T {
  const first = list[0]
  if (first === undefined) {
    throw new CharacterError(4, 'Expected a ' + what + ' and the server returned none')
  }
  return first
}
