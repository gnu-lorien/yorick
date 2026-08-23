/**
 * SimpleTrait: the row behind every dot on a character sheet.
 *
 * This one module replaces three AMD files, which between them held about forty
 * lines of code:
 *
 *   - `models/SimpleTrait.js`      -- `Parse.Object.extend("SimpleTrait", mixin)`
 *   - `models/SimpleTraitMixin.js` -- the actual behaviour
 *   - `models/FauxSimpleTrait.js`  -- `Backbone.Model.extend(mixin)`
 *
 * They were three files because the mixin had to be shared between a Parse
 * class and a Backbone class by an AMD module, and for no other reason. The
 * split is not worth preserving.
 *
 * ## Where the class registration went
 *
 * `Parse.Object.extend("SimpleTrait", …)` does not happen here. `@/parse/classes`
 * registers `SimpleTraitObject` for the className once, for the same reason it
 * registers `CharacterObject` once for "Vampire": parse@8 has exactly one class
 * per className, and a second registration is not additive. So the behaviour
 * that used to be passed into `extend` is installed onto that class's prototype
 * by `installSimpleTraitMixin()` below -- which is what `extend` did anyway.
 *
 * The methods stay methods rather than becoming free functions because the cost
 * engines already read them that way: `CostTrait` in
 * `@/domain/rules/BNSMETV1_VampireCosts` declares `get_base_name(): string` on
 * the trait it is handed. The free functions are exported as well, for callers
 * that hold an attribute bag rather than an object.
 *
 * ## FauxSimpleTrait
 *
 * A trait that is never saved. `Character.get_transformed` replays the recorded
 * change log backwards to reconstruct what a character looked like at an earlier
 * point, and each replayed row manufactures one of these to stand in for the
 * trait as it was. They go into the reconstructed character's category arrays
 * alongside real traits, get priced by the cost engines and rendered by the
 * print helpers, so they must present the same read surface -- but they have no
 * id, are never fetched, and must never reach `save`.
 *
 * In the Backbone app it was a `Backbone.Model`. There is no Backbone here, and
 * a `Parse.Object` would be the wrong stand-in (it can be saved by accident, and
 * every one of them would register in the SDK's object state), so it is a plain
 * class with a Backbone-shaped surface.
 */
import type Parse from '@/parse'
import { SimpleTraitObject } from '@/parse/classes'

/**
 * The separator between a trait's base name and its specialization.
 *
 * The literal `": "` -- a colon AND a space. "Lore: Kindred" is Lore
 * specialized in Kindred; "Lore:Kindred" is a trait called "Lore:Kindred".
 * Every stored name in the database was written by this rule, so changing it,
 * trimming around it, or accepting a bare colon would silently re-read live
 * data.
 */
export const SPECIALIZATION_SEPARATOR = ': '

/**
 * The attributes a SimpleTrait row carries.
 *
 * Taken from what actually reads and writes them: `Character.update_trait`,
 * `SimpleTraitChangeView`, and `cloud/main.js`'s `beforeSave("SimpleTrait")` /
 * `beforeDelete("SimpleTrait")` triggers, which mirror the row into a
 * VampireChange. Everything is optional because a trait is built up over
 * several `set` calls and because old rows predate several of these columns.
 *
 * The index signature is not laziness: the venue models store per-venue extras
 * on traits, and a closed shape would make an honest `get` on one of them a
 * compile error rather than the `undefined` it is at runtime.
 */
export interface SimpleTraitAttributes {
  /** Base name, or "base: specialization". See SPECIALIZATION_SEPARATOR. */
  name?: string
  /** The category array on the character this trait lives in, e.g. "skills". */
  category?: string
  /** Purchased level. */
  value?: number
  /** How much of `value` was granted free by a creation pool. */
  free_value?: number
  /** Experience cost, computed by the venue's cost engine, never by the view. */
  cost?: number
  /** Pointer to the owning character (className "Vampire" for all three venues). */
  owner?: Parse.Object
  /** Per-trait experience cost override, e.g. "fixed" / "multiplier". */
  experience_cost_type?: string
  /** The number that `experience_cost_type` applies. */
  experience_cost_modifier?: number
  /** Pointer to the VampireChange row that defined this trait. */
  definition_change?: Parse.Object
  [attribute: string]: unknown
}

/**
 * The smallest surface the name helpers need.
 *
 * Deliberately structural rather than "a SimpleTraitObject": a real
 * `Parse.Object`, a `FauxSimpleTrait` and a hand-built test double all satisfy
 * it, and none of them has to import the others.
 */
export interface TraitNameReader {
  get(attribute: 'name'): string | undefined
}

/** The same, plus the one write `set_specialization` performs. */
export interface TraitNameWriter extends TraitNameReader {
  set(attribute: 'name', value: string): unknown
}

/* ------------------------------------------------------------------------- *
 * Client-side identity -- the replacement for Backbone's `cid`
 * ------------------------------------------------------------------------- */

/**
 * `linkId()` was `this.id || this.cid`, and 23 template sites route on it: a
 * trait that has not been saved yet still has to be addressable in a URL while
 * the creation wizard walks the player through naming and specializing it.
 *
 * `cid` came from Backbone, via the parse-compat shim, and neither exists in
 * this client. So identity is minted here instead, in Backbone's own format
 * ("c1", "c2", …) because those strings end up in route paths and in E2E
 * expectations.
 *
 * The map is weak and keyed on the object, so a trait that falls out of a
 * character's category array is not retained by having once been rendered.
 * It also means the id is stable for the lifetime of the object without adding
 * an own property that `toJSON`, a Parse save, or Vue's proxying would see.
 */
let nextLocalId = 0
const localIds = new WeakMap<object, string>()

/** The client-side id for an object, minted on first use. */
export function localIdOf(object: object): string {
  let id = localIds.get(object)
  if (id === undefined) {
    nextLocalId += 1
    id = `c${nextLocalId}`
    localIds.set(object, id)
  }
  return id
}

/**
 * `this.id || this.cid`, verbatim.
 *
 * `||` and not `??`: an empty-string id must fall through to the local id, the
 * same way it did in the source. That should never happen -- but if a save ever
 * lands an empty objectId, the old app kept routing and this one should too.
 */
export function linkIdOf(object: { id?: string }): string {
  return object.id || localIdOf(object)
}

/* ------------------------------------------------------------------------- *
 * The mixin behaviour, as free functions
 * ------------------------------------------------------------------------- */

/**
 * The part of the name before `": "`.
 *
 * "Auspex: Heightened Senses" -> "Auspex". A name with no separator is entirely
 * its own base name. This is what the cost engines match rules against, which
 * is why a specialized trait is priced as its base trait.
 */
export function traitBaseName(trait: TraitNameReader): string {
  const name = trait.get('name') || ''
  const parts = name.split(SPECIALIZATION_SEPARATOR)
  // `split` always yields at least one element, so the fallback is unreachable;
  // it exists because `noUncheckedIndexedAccess` cannot know that.
  return parts[0] ?? ''
}

/**
 * The part of the name after the FIRST `": "`, or `undefined` when there is no
 * separator.
 *
 * `undefined` rather than `""` matters: `has_specialization` and this function
 * disagree on a name that ends in the separator ("Lore: " has a specialization
 * by `indexOf` and an empty one by `split`), and the views branch on the
 * emptiness. That asymmetry is the source's, and is left alone.
 *
 * A name containing two separators keeps only the middle segment -- "Lore:
 * Kindred: Elders" specializes to "Kindred". Also the source's behaviour.
 */
export function traitSpecialization(trait: TraitNameReader): string | undefined {
  const name = trait.get('name') || ''
  const parts = name.split(SPECIALIZATION_SEPARATOR)
  return parts[1]
}

/** Whether the name contains `": "` anywhere at all. */
export function traitHasSpecialization(trait: TraitNameReader): boolean {
  const name = trait.get('name') || ''
  return name.indexOf(SPECIALIZATION_SEPARATOR) !== -1
}

/**
 * Replace (or, with a falsy specialization, remove) the specialization.
 *
 * Note it rebuilds from `get_base_name()`, so calling it twice does not stack
 * separators, and passing `""`/`undefined`/`null` is how the views clear a
 * specialization.
 */
export function setTraitSpecialization<T extends TraitNameWriter>(
  trait: T,
  specialization: string | null | undefined,
): T {
  if (!specialization) {
    trait.set('name', traitBaseName(trait))
  } else {
    trait.set('name', traitBaseName(trait) + SPECIALIZATION_SEPARATOR + specialization)
  }
  return trait
}

/** One failed attribute, in the shape the source produced. */
export interface SimpleTraitValidationFailure {
  message: string
}

/** Failures keyed by attribute name. Only "value" and "free_value" appear. */
export type SimpleTraitValidationFailures = Record<string, SimpleTraitValidationFailure>

/** The attributes `validate` inspects. */
const VALIDATED_NUMERIC_ATTRIBUTES = ['value', 'free_value'] as const

/**
 * `validate`, verbatim: if `value` or `free_value` is PRESENT in the attributes
 * being set, it must be a finite number.
 *
 * Two details that are easy to get wrong on the way across:
 *
 *  - Presence is checked with an own-property test (`_.has`), not truthiness.
 *    A trait being set to 0 is valid; a trait whose `value` key is absent from
 *    this particular `set` is not validated at all, because a partial `set`
 *    only ever carries the attributes it is changing.
 *  - `_.isFinite` in the vendored lodash 3.10.0 is
 *    `typeof value == 'number' && nativeIsFinite(value)` (lodash.js:8689) --
 *    it does NOT coerce, so the string "3" fails. lodash 4 agrees, and so does
 *    `Number.isFinite`, which is what this uses. (The global `isFinite` would
 *    NOT: it coerces, and would accept "3", `null` and `""`.)
 *
 * Returns `undefined` when everything is fine -- the source returned nothing at
 * all in that case, and the SDK tests the result for truthiness.
 */
export function validateSimpleTraitAttributes(
  attributes: Record<string, unknown>,
): SimpleTraitValidationFailures | undefined {
  const failures: SimpleTraitValidationFailures = {}
  for (const name of VALIDATED_NUMERIC_ATTRIBUTES) {
    if (Object.hasOwn(attributes, name)) {
      const candidate = attributes[name]
      if (!Number.isFinite(candidate)) {
        failures[name] = {
          message: `${name} must be a number. Trying to save as ${String(candidate)}`,
        }
      }
    }
  }
  if (Object.keys(failures).length !== 0) {
    return failures
  }
  return undefined
}

/* ------------------------------------------------------------------------- *
 * The replay guard
 * ------------------------------------------------------------------------- */

/**
 * The category no replayed change may carry.
 *
 * R47b added `experience` rows to VampireChange for XP notations. Every other
 * row in the timeline describes either a trait (any category but "core") or a
 * text attribute ("core"), and `Character.get_transformed` replays it as one or
 * the other. An `experience` row is neither: replaying it manufactures a
 * FauxSimpleTrait in a category no venue has, and the approval view -- which
 * reconstructs the character at every step -- never finishes rendering.
 *
 * The Backbone app refuses them in TWO places, and both are load-bearing:
 * `_recorded_changes_query` adds `.notEqualTo("category", "experience")` so
 * they never arrive, and the replay loop skips them anyway in case a row
 * reaches it from somewhere else. Whoever ports `Character` must carry both;
 * this constant and guard exist so neither site has to spell the string again.
 *
 * They belong in the log, which queries VampireChange directly, and not in a
 * timeline of approvable states: "approve up to this XP award" is not a thing a
 * storyteller can act on.
 */
export const NON_REPLAYABLE_CHANGE_CATEGORY = 'experience'

/** False for the `experience` rows described above; true for everything else. */
export function isReplayableChangeCategory(category: unknown): boolean {
  return category !== NON_REPLAYABLE_CHANGE_CATEGORY
}

/* ------------------------------------------------------------------------- *
 * The methods, and their installation onto the registered Parse class
 * ------------------------------------------------------------------------- */

/**
 * What the mixin adds to a trait object.
 *
 * `validate` is deliberately absent from this interface. `Parse.Object` already
 * declares it as `(attrs) => Parse.Error | boolean`, and the app has always
 * returned a map of failures instead; re-declaring it here with the honest
 * return type would be a signature conflict rather than a merge. The
 * implementation is installed below with a cast and a note.
 */
export interface SimpleTraitMixin {
  /** Client-side identity for an object with no objectId yet. */
  readonly localId: string
  /** `id || localId` -- what the routes and templates address a trait by. */
  linkId(): string
  /** The part of the name before `": "`. */
  get_base_name(): string
  /** The part after `": "`, or `undefined`. */
  get_specialization(): string | undefined
  /** Whether the name contains `": "`. */
  has_specialization(): boolean
  /** Set or (falsy argument) clear the specialization. */
  set_specialization(specialization: string | null | undefined): this
}

/**
 * The prototype members, in one object so the Parse class and FauxSimpleTrait
 * cannot drift apart.
 *
 * `localId` is a getter, which is why this is installed with
 * `getOwnPropertyDescriptors` rather than `Object.assign` -- assigning would
 * evaluate the getter once and copy a single frozen string onto the prototype,
 * giving every trait in the app the same id.
 */
const SIMPLE_TRAIT_MIXIN = {
  get localId(): string {
    return localIdOf(this as object)
  },

  linkId(this: { id?: string }): string {
    return linkIdOf(this)
  },

  get_base_name(this: TraitNameReader): string {
    return traitBaseName(this)
  },

  get_specialization(this: TraitNameReader): string | undefined {
    return traitSpecialization(this)
  },

  has_specialization(this: TraitNameReader): boolean {
    return traitHasSpecialization(this)
  },

  set_specialization<T extends TraitNameWriter>(this: T, specialization: string | null | undefined): T {
    return setTraitSpecialization(this, specialization)
  },
}

/*
 * `SimpleTraitMixin.js` also carried `_findUnsavedChildren`, which logged the
 * child count before and after delegating to `Parse.Object._findUnsavedChildren`.
 * It is NOT ported, and not because it is noisy: it was never called. In Parse
 * 1.5 `_findUnsavedChildren` is a STATIC (parse-1.5.0.js:6171) invoked as
 * `Parse.Object._findUnsavedChildren(model.attributes, …)`, so an instance
 * method of that name sat on the prototype and was never reached -- which is
 * just as well, since its body calls `.apply(this, object, children, files)`,
 * passing a plain object where `apply` wants an argument array and dropping the
 * remaining two arguments on the floor. Debug scaffolding left behind while
 * someone was chasing the deep-save problem that `Character.update_trait`'s
 * `saveAll` comment now documents. parse@8 renamed the function `unsavedChildren`
 * anyway.
 */

/**
 * Teach the registered `SimpleTraitObject` the mixin.
 *
 * Idempotent, and called once at module load below -- importing anything from
 * this module is enough to install it. That mirrors the AMD app, where
 * requiring `models/SimpleTrait` was what produced a class with these methods.
 */
let installed = false

export function installSimpleTraitMixin(): void {
  if (installed) return
  installed = true

  const proto = SimpleTraitObject.prototype as object
  Object.defineProperties(proto, Object.getOwnPropertyDescriptors(SIMPLE_TRAIT_MIXIN))

  /*
   * `validate` is installed separately because of a real behavioural difference
   * between the two SDKs, which the port inherits rather than introduces.
   *
   * Parse 1.5 / Backbone: a truthy `validate` result made `set` return `false`
   * and fire an "error" event, and the caller carried on.
   * parse@8: `set` does `const validationError = this.validate(newValues); if
   * (validationError) throw validationError;` (ParseObject.js:763). So a
   * non-numeric value now THROWS the failures map out of `set` -- synchronously,
   * into whatever promise chain the caller is in.
   *
   * That is already how the shipped app behaves (the parse-compat shim does not
   * intercept validation), so it is bug-compatible to keep it. The cast is
   * because the SDK's own type says `Parse.Error | boolean` while every version
   * of this app has returned a failures map; the SDK only ever tests the result
   * for truthiness.
   */
  Object.defineProperty(proto, 'validate', {
    value: function validate(this: unknown, attributes: Record<string, unknown>) {
      return validateSimpleTraitAttributes(attributes)
    },
    writable: true,
    configurable: true,
  })
}

/*
 * Module augmentation, so that every `SimpleTraitObject` in the app -- including
 * the ones a `Parse.Query` decodes -- is typed with the methods that
 * `installSimpleTraitMixin` puts on its prototype.
 */
declare module '@/parse/classes' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SimpleTraitObject extends SimpleTraitMixin {}
}

/** A saved-or-savable trait: the registered Parse class plus the mixin. */
export type SimpleTrait = SimpleTraitObject

/**
 * `new SimpleTrait` / `new SimpleTrait({…})` from the Backbone app.
 *
 * A thin factory rather than a subclass, because subclassing here would be a
 * second class for one className -- exactly what `@/parse/classes` exists to
 * prevent.
 */
export function createSimpleTrait(attributes?: SimpleTraitAttributes): SimpleTrait {
  return new SimpleTraitObject(attributes as Record<string, unknown> | undefined)
}

/* ------------------------------------------------------------------------- *
 * FauxSimpleTrait
 * ------------------------------------------------------------------------- */

/**
 * The read surface shared by real and faux traits.
 *
 * Anything that consumes traits out of a character's category arrays -- the
 * cost engines, the print helpers, the sheet views -- sees this, because after
 * a `get_transformed` replay the array holds both kinds.
 */
export interface SimpleTraitLike extends SimpleTraitMixin {
  readonly id?: string
  readonly attributes: SimpleTraitAttributes
  get(attribute: string): unknown
  has(attribute: string): boolean
  /**
   * Set by the approval and print replays directly on the object (NOT as an
   * attribute) to render a trait struck through as removed. See
   * `CharacterApprovalView.js:336` and `CharactersPrintView.js:327`, both of
   * which do `trait.fake.is_deleted = true` before pushing the trait into the
   * reconstructed category.
   */
  is_deleted?: boolean
}

/**
 * A trait that exists only in memory.
 *
 * Backbone's `Model` in the source; a plain class here. It keeps the Backbone
 * accessor shape (`get`/`set`/`has`/`unset`/`attributes`) because that is what
 * every consumer of a trait calls, and because the replay hands these objects
 * to code that cannot tell the two kinds apart.
 *
 * Three things it deliberately does NOT have:
 *
 *  - `save`, `fetch`, `destroy`. A faux trait reaching the server would write a
 *    reconstructed historical value over the live one. There is no method to
 *    call by accident.
 *  - Automatic validation on `set`. Backbone only validates when the caller
 *    passes `{validate: true}`, and neither the replay nor the views ever did,
 *    so `validate` here is available and never self-invoked. Same as before.
 *  - Change events. There are none in this client (see `@/parse/reactivity`).
 *    A faux trait is a plain object, so Vue can proxy it -- the rule against
 *    `reactive()` applies to `Parse.Object`, not to this. In practice they ride
 *    the character's reactivity, since the replay puts them into a category via
 *    `character.set(category, …)`, which is instrumented. `is_deleted` is the
 *    exception: it is assigned directly and emits no signal, which is safe only
 *    because both call sites assign it BEFORE the `set` that publishes the
 *    array. Keep that order.
 */
export class FauxSimpleTrait implements SimpleTraitLike {
  /** Always undefined. A faux trait has never been saved and never will be. */
  readonly id?: string

  readonly attributes: SimpleTraitAttributes

  /** See `SimpleTraitLike.is_deleted`. */
  is_deleted?: boolean

  constructor(attributes?: SimpleTraitAttributes) {
    // Copied, not adopted: the replay builds the literal from a VampireChange's
    // fields, and a shared reference would let a later edit of one reach the
    // other.
    this.attributes = { ...attributes }
  }

  get(attribute: 'name' | 'category' | 'experience_cost_type'): string | undefined
  get(attribute: 'value' | 'free_value' | 'cost' | 'experience_cost_modifier'): number | undefined
  get(attribute: string): unknown
  get(attribute: string): unknown {
    return this.attributes[attribute]
  }

  /** Backbone's two call shapes: `set(key, value)` and `set({…})`. */
  set(attributes: SimpleTraitAttributes): this
  set(attribute: string, value: unknown): this
  set(attributeOrAttributes: string | SimpleTraitAttributes, value?: unknown): this {
    if (typeof attributeOrAttributes === 'string') {
      this.attributes[attributeOrAttributes] = value
    } else {
      Object.assign(this.attributes, attributeOrAttributes)
    }
    return this
  }

  unset(attribute: string): this {
    delete this.attributes[attribute]
    return this
  }

  has(attribute: string): boolean {
    const value = this.attributes[attribute]
    return value !== undefined && value !== null
  }

  /** A shallow copy, matching Backbone's `clone()`. */
  clone(): FauxSimpleTrait {
    return new FauxSimpleTrait(this.attributes)
  }

  toJSON(): SimpleTraitAttributes {
    return { ...this.attributes }
  }

  /**
   * Available, never self-invoked -- see the class comment. Returns the
   * failures map, or `undefined`.
   */
  validate(attributes: Record<string, unknown>): SimpleTraitValidationFailures | undefined {
    return validateSimpleTraitAttributes(attributes)
  }

  get localId(): string {
    return localIdOf(this)
  }

  linkId(): string {
    return linkIdOf(this)
  }

  get_base_name(): string {
    return traitBaseName(this)
  }

  get_specialization(): string | undefined {
    return traitSpecialization(this)
  }

  has_specialization(): boolean {
    return traitHasSpecialization(this)
  }

  set_specialization(specialization: string | null | undefined): this {
    return setTraitSpecialization(this, specialization)
  }
}

/** Distinguish a replayed stand-in from a real row. */
export function isFauxSimpleTrait(trait: unknown): trait is FauxSimpleTrait {
  return trait instanceof FauxSimpleTrait
}

// Installing on import is what `require("models/SimpleTrait")` used to do.
installSimpleTraitMixin()
