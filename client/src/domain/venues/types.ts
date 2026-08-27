/**
 * The venue strategy contract.
 *
 * ## Why strategies rather than three classes
 *
 * `Vampire.js`, `Werewolf.js` and `ChangelingBetaSlice.js` are three modules
 * that each call `Parse.Object.extend("Vampire", …)` -- one Mongo table, three
 * creature types, permanently. Parse 1.5 turned the repeated className into an
 * inheritance chain and handed each module its own constructor; parse@8 returns
 * the SAME constructor every time, so the Backbone app needs `VenueClass.js` and
 * a `__compatCast` query hook to rebuild what the SDK removed.
 *
 * Here there is one registered class (`CharacterObject`, `@/parse/classes`) and
 * the per-creature behaviour lives in the three objects that implement this
 * interface. Nothing to cast, nothing that depends on module load order. The
 * strategy is chosen by `venueOf(character.get('type'))`, and that function is
 * the only place the load-bearing trap lives: **a `type` of `undefined` means
 * Vampire**, because Vampire records predate the column.
 *
 * ## What is data and what is code
 *
 * `ALL_SIMPLETRAIT_CATEGORIES`, `TEXT_ATTRIBUTES`, `SUM_CREATION_CATEGORIES` and
 * the creation seed are PERSISTED DATA, not labels. Every string in them is a
 * Parse column name or a value already written to live rows. They are typed as
 * plain `string` deliberately: narrowing them to a union would invite a future
 * edit that "cleans up" a name and silently orphans a column.
 */
import Parse from '@/parse'
import type { VenueKey } from '@/parse/classes'

export type { VenueKey }

/**
 * `.always()` -- `then(cb, cb)` -- as a free function.
 *
 * `Character` serialises its writes through a per-instance promise chain, and
 * the Backbone code extends that chain with `.always` on purpose: a rejection
 * becomes a fulfillment, so one failed trait update does not wedge every write
 * that follows it. `.finally()` is NOT the same thing -- it re-throws, which is
 * exactly the wedge the chain exists to avoid -- so the translation is written
 * out rather than reached for from the standard library.
 *
 * `work` takes no arguments even though the rejection handler is called with the
 * error, matching the source: every `.always` callback in the venues ignores it.
 */
export function alwaysOf<T>(previous: Promise<unknown>, work: () => T | PromiseLike<T>): Promise<T> {
  return previous.then(work, work)
}

/**
 * The serialising write queue that `Character` owns (`_updateTraitWrapper`).
 *
 * The Changeling Kith transaction is the only venue code that touches it, and it
 * needs all four operations below because the source uses all four: it appends
 * with `.always` in some places and `.then` in others (the difference decides
 * whether a failed unpick stops the save that follows it), and it builds one
 * promise OFF TO THE SIDE of the queue -- the gate in `update_text` -- which it
 * must be able to install as the new tail without appending to it.
 *
 * `Character` must hand every venue the same object it uses for its own
 * `update_trait` / `unpick_from_creation`, or the ordering the Kith transaction
 * depends on is not ordering at all.
 */
export interface TraitQueue {
  /**
   * Everything queued so far.
   *
   * This promise CAN be rejected: `.always(cb)` is `then(cb, cb)`, so it
   * recovers whatever came before it but rejects if `cb` itself fails -- and a
   * refused `update_trait` does exactly that. What the chain guarantees is that
   * a rejection cannot WEDGE it, because the next `.always` recovers it. A
   * `.then` appender does not, which is why `update_text` installs a
   * deliberately non-rejecting view of its gate with `adopt`.
   */
  readonly tail: Promise<unknown>
  /** Append with `.always` semantics; the result becomes the new tail. */
  always<T>(work: () => T | PromiseLike<T>): Promise<T>
  /** Append with `.then` semantics; the result becomes the new tail. */
  then<T>(work: () => T | PromiseLike<T>): Promise<T>
  /** Install `p` as the new tail without appending anything to it. */
  adopt(p: Promise<unknown>): void
}

/**
 * A `SimpleTrait` row, as the venues use it.
 *
 * `get_base_name` is `SimpleTraitMixin`'s -- the name up to the first ": ". It
 * is required rather than optional here because every venue path that reads a
 * trait's identity (`_raw_generation`, the Kith retention test, the affinity
 * comparison) calls it unguarded, exactly as the source did.
 */
export interface VenueTrait extends Parse.Object {
  get_base_name(): string
}

/** A `Patronage` row. Only its expiry is read during character creation. */
export interface PatronageRecord {
  get(attribute: 'expiresOn'): unknown
}

/** The options object `Character#add_experience_notation` takes. */
export interface ExperienceNotationOptions {
  reason: string
  alteration_earned: number
  earned: number
}

/**
 * What a venue strategy needs from the character it is acting on.
 *
 * Extends `Parse.Object` for the storage half (`get`/`set`/`has`/`save`) and
 * names the `Character` methods the venues call. It is stated structurally, not
 * imported, because `Character` is another module in this migration; this
 * interface is the contract between the two.
 *
 * There is no `cid`, no `_serverData` and no change events here -- the Vue
 * client does not load `parse-compat`, so none of them exist. Where the source
 * relied on them the venue code says so at the point of use.
 */
export interface VenueCharacter extends Parse.Object {
  /** `Character#progress` -- the loading-spinner text. */
  progress(text: string): void

  /** This venue's `SUM_CREATION_CATEGORIES`. Read by `unpick_from_creation`. */
  get_sum_creation_categories(): readonly string[]

  /** `Character#update_trait`. Appends to `traitQueue` and returns its tail. */
  update_trait(
    nameOrTrait: string | Parse.Object,
    value: number,
    category: string,
    free_value?: number,
    wait?: boolean,
    experience_cost_type?: string,
    experience_cost_modifier?: number | string,
  ): Promise<unknown>

  /** `Character#unpick_from_creation`. Appends to `traitQueue`. */
  unpick_from_creation(
    category: string,
    picked_trait_id: string | undefined,
    pick_index: number,
  ): Promise<unknown>

  /** `Character#add_experience_notation`. */
  add_experience_notation(options: ExperienceNotationOptions): Promise<unknown>

  /**
   * `Character.baseMethods.update_text` / `unpick_text` -- the UNOVERRIDDEN
   * implementations.
   *
   * The Changeling strategy overrides both and then calls back into the base,
   * which the source spells `Character.baseMethods.update_text.apply(self, …)`.
   * `Character` dispatches its public `update_text` through the strategy, so a
   * venue calling `character.update_text` here would recurse forever; these two
   * names are how it reaches past its own override.
   */
  base_update_text(target: string, value: string): Promise<unknown>
  base_unpick_text(target: string): Promise<unknown>

  /** The shared serialising write queue. @see TraitQueue */
  readonly traitQueue: TraitQueue
}

/**
 * One row of `ALL_SIMPLETRAIT_CATEGORIES`: `[column, pretty name, group]`.
 *
 * The first element is a live Parse column name; the other two drive the sheet's
 * headings and grouping.
 */
export type CategoryTriple = readonly [column: string, prettyName: string, group: string]

/**
 * One entry of `TEXT_ATTRIBUTES_PRETTY_NAMES`.
 *
 * Two of them are functions of the character rather than strings -- Vampire's
 * "Faction" and Changeling's "Group". Both currently ignore their argument and
 * return a constant, which is plainly a hook someone left half-built; it is
 * carried over as-is rather than flattened, because flattening it would delete
 * the hook.
 */
export type PrettyName = string | ((character: VenueCharacter) => string)

/**
 * The attribute bag a new `VampireCreation` row is seeded with.
 *
 * Every venue's seed is a literal in its own module. It is EXACT: each
 * `<pool>_<rating>_remaining` is how many picks of that rating the wizard hands
 * out, and getting one wrong hands a player free traits or refuses ones they are
 * owed.
 */
export type CreationSeed = Readonly<Record<string, number | boolean>>

/**
 * One of the traits every new character of a venue starts with.
 *
 * `free_value` is not decoration: it is what makes the trait cost nothing, and
 * `value` and `free_value` differ in exactly one place across the three venues
 * (Werewolf's Gnosis, 10 and 6).
 */
export interface StartingTrait {
  readonly name: string
  readonly value: number
  readonly category: string
  readonly free_value: number
}

/**
 * The collaborators `create` needs that are not this module's to own.
 *
 * `create` is a static in the source (`Model.create`), reaching for the current
 * user, the patronage helper and the venue's own `get_character`. The first is
 * the SDK's and is used directly; the other two live in modules this migration
 * splits differently, so they arrive as parameters. That also makes the whole
 * creation sequence testable without a server.
 */
export interface CreateDeps {
  /** `UserWreqr.get_latest_patronage`. */
  get_latest_patronage(user: Parse.User): Promise<PatronageRecord | null | undefined>
  /** `Model.get_character(id)` -- the loader `Character` owns. */
  get_character(id: string): Promise<VenueCharacter>
  /**
   * The progress ticker.
   *
   * Optional. The source's `progress` fell back to `console.log("Progress: " +
   * text)` whenever jQuery Mobile was absent, which in the Vue client is always,
   * so that fallback is the default here.
   */
  progress?(text: string): void
}

/**
 * Everything one creature type does differently.
 *
 * Methods take the character as their first parameter rather than living on it:
 * the strategy is a singleton per venue and holds no per-character state, so
 * there is nothing to construct and nothing to keep in sync when a character is
 * re-fetched.
 */
export interface VenueStrategy {
  /** Which creature this is. Matches the `type` column, except see below. */
  readonly key: VenueKey

  /**
   * The literal written to the `type` column by `create`, or `undefined` when
   * the column is deliberately left unset.
   *
   * Only Vampire is `undefined`, and that is not an oversight -- Vampire records
   * predate the column, so an absent `type` already means Vampire on live data
   * and writing "Vampire" into new rows would make the two populations disagree
   * about how a Vampire is spelled.
   */
  readonly TYPE_ATTRIBUTE: string | undefined

  /** `[column, pretty name, group]` for every trait category. PERSISTED DATA. */
  readonly ALL_SIMPLETRAIT_CATEGORIES: readonly CategoryTriple[]
  /** The free-text columns on the sheet. PERSISTED DATA. */
  readonly TEXT_ATTRIBUTES: readonly string[]
  /** Their headings, positionally aligned with `TEXT_ATTRIBUTES`. */
  readonly TEXT_ATTRIBUTES_PRETTY_NAMES: readonly PrettyName[]
  /**
   * The categories whose creation counter is `7 - sum(values)` rather than a
   * decrementing count of picks. PERSISTED DATA. Merits and flaws, per venue.
   */
  readonly SUM_CREATION_CATEGORIES: readonly string[]

  /** The exact pool seed for a new `VampireCreation` row. */
  readonly CREATION_SEED: CreationSeed
  /**
   * The categories `fetch_all_creation_elements` hydrates -- the ones that can
   * hold creation picks.
   */
  readonly CREATION_LIST_CATEGORIES: readonly string[]
  /** The categories `calculate_total_cost` prices. */
  readonly TOTAL_COST_CATEGORIES: readonly string[]
  /** The pointer columns `get_character`'s query includes, besides `portrait`. */
  readonly GET_CHARACTER_INCLUDES: readonly string[]
  /**
   * Whether `get_character` throttles `initialize_troupe_membership`.
   *
   * Only Vampire passes `true` (Vampire.js:367). Werewolf and Changeling call it
   * bare. Nothing in either file explains the difference, and it is reproduced
   * rather than unified.
   */
  readonly TROUPE_MEMBERSHIP_THROTTLED: boolean
  /** The traits every new character of this venue is created holding. */
  readonly STARTING_TRAITS: readonly StartingTrait[]

  /**
   * `get_sum_creation_categories` (Vampire.js:62) -- the method shape the
   * source defined and `Character#unpick_from_creation` calls.
   *
   * Returns the same list as `SUM_CREATION_CATEGORIES`; both exist because the
   * data is useful to read directly and the method is what the original API
   * was.
   */
  get_sum_creation_categories(): readonly string[]

  /**
   * The categories whose `<category>_<i>_picks` arrays hold creation picks --
   * `listCategories` in `fetch_all_creation_elements` (Vampire.js:153).
   *
   * Same list as `CREATION_LIST_CATEGORIES`, in method form for the same
   * reason.
   */
  creation_pick_categories(): readonly string[]

  /** Load this venue's cost engine. Idempotent; safe to call on every open. */
  initialize_costs(): Promise<void>

  /** The highest value a slider may select for this trait. */
  max_trait_value(trait: VenueTrait): number

  /**
   * What this trait costs at its current value.
   *
   * `undefined` means NO RULE EXISTS for the category, and `Character#update_trait`
   * turns that into a visible refusal. It is never a stand-in for zero: the
   * engines return a literal `0` only for the categories on their explicit
   * FREE_CATEGORIES allowlist. Two categories (`wta_rites`, `ctdbs_backgrounds`)
   * were silently free for an unknown length of time because that distinction
   * did not exist.
   */
  calculate_trait_cost(character: VenueCharacter, trait: VenueTrait): number | undefined

  /** The experience this change costs: `new_cost - (trait.cost || 0)`. */
  calculate_trait_to_spend(character: VenueCharacter, trait: VenueTrait): number | undefined

  /** Create the character's `VampireCreation` row if it has none. */
  ensure_creation_rules_exist(character: VenueCharacter): Promise<VenueCharacter | undefined>

  /** Book a changed trait against the creation pools. */
  update_creation_rules_for_changed_trait(
    character: VenueCharacter,
    category: string,
    modified_trait: Parse.Object,
    freeValue: number | undefined,
  ): Promise<VenueCharacter>

  /** Make a new character of this venue. */
  create(name: string, deps: CreateDeps): Promise<VenueCharacter>

  /**
   * The venue term that shifts prices, and whether the character has one.
   *
   * Vampire calls it generation (default 1), Werewolf rank (default 0),
   * Changeling seeming (default 0). All three read a background by base name and
   * all three defer to `|| <default>`, so a stored value of 0 reads as the
   * default -- that is the source's arithmetic and it is preserved.
   */
  raw_venue_term(character: VenueCharacter): number | undefined
  venue_term(character: VenueCharacter): number
  has_venue_term(character: VenueCharacter): boolean
}
