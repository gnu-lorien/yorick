/**
 * Parse subclass registration, and the one design decision this migration must
 * not get wrong.
 *
 * ## Three creature types, one table
 *
 * `Vampire.js`, `Werewolf.js` and `ChangelingBetaSlice.js` all call
 * `Parse.Object.extend("Vampire", …)`. That is deliberate and permanent: the
 * three creature types share one Mongo table, and the project's standing rule
 * is that they are never split. Splitting them is a data migration on live
 * player records, not a refactor.
 *
 * Parse SDK 1.5 turned a repeated className into an inheritance chain, so each
 * module got its own constructor, prototype and statics for free. parse@8 has
 * exactly one class per className -- `if (classMap[adjustedClassName])` short-
 * circuits before it picks a parent -- so all three modules receive the *same*
 * function and the same prototype, and whichever registers last wins for every
 * venue. That was measured, not theorised: choosing "Vampire" in the new-
 * character form produced a row with `type: "ChangelingBetaSlice"`, and
 * `calculate_trait_cost` resolved to the Changeling implementation for every
 * character.
 *
 * The Backbone app works around this with `helpers/VenueClass.js` (a hand-rolled
 * per-module constructor and prototype) plus a `__compatCast` hook patched into
 * `Parse.Query` to re-flavour every query result. Both files exist only to
 * rebuild inheritance the SDK removed.
 *
 * ## What this migration does instead
 *
 * One registered class, `CharacterObject`, and venue behaviour in strategy
 * objects selected on the record's `type` attribute. There is nothing to cast,
 * nothing to re-flavour, no dependence on module load order, and no fourth
 * registration of the same className for the SDK to reject. A query returns
 * `CharacterObject`s and `character.venue` answers what kind of creature it is.
 *
 * The discriminant has one trap that a TypeScript union would not tolerate and
 * which is load-bearing: **`type` absent means Vampire**. Vampire records
 * predate the column and were never backfilled, so `undefined`, `null` and
 * `"Vampire"` are all the same creature. `venueOf` is the only place that
 * decision is made.
 */
import Parse from 'parse'

/** The three creature types, as stored in the `type` column. */
export type VenueKey = 'Vampire' | 'Werewolf' | 'ChangelingBetaSlice'

/**
 * Resolve a stored `type` to a venue.
 *
 * Absent means Vampire -- see the note above. An unrecognised value also means
 * Vampire rather than throwing: a character whose `type` is corrupt should
 * still open, because refusing to render it is how a player loses access to a
 * sheet they can otherwise repair.
 */
export function venueOf(type: unknown): VenueKey {
  if (type === 'Werewolf') return 'Werewolf'
  if (type === 'ChangelingBetaSlice') return 'ChangelingBetaSlice'
  return 'Vampire'
}

/**
 * The shared character class.
 *
 * Registered once for className "Vampire". Instance behaviour that differs by
 * creature type is not on this class -- it is on the venue strategies in
 * `@/domain/venues`, reached through `venueOf(this.get('type'))`.
 */
export class CharacterObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('Vampire', attributes as never)
  }

  /** Which creature this record is. `undefined` type means Vampire. */
  get venueKey(): VenueKey {
    return venueOf(this.get('type'))
  }
}

export class SimpleTraitObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('SimpleTrait', attributes as never)
  }
}

export class VampireCreationObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('VampireCreation', attributes as never)
  }
}

export class VampireChangeObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('VampireChange', attributes as never)
  }
}

export class ApprovalObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('VampireApproval', attributes as never)
  }
}

export class ExperienceNotationObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('ExperienceNotation', attributes as never)
  }
}

export class LongTextObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('LongText', attributes as never)
  }
}

export class TroupeObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('Troupe', attributes as never)
  }
}

export class PatronageObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('Patronage', attributes as never)
  }
}

export class ReferendumObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('Referendum', attributes as never)
  }
}

export class ReferendumBallotObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('ReferendumBallot', attributes as never)
  }
}

export class DescriptionObject extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('Description', attributes as never)
  }
}

/**
 * Classes with no model file in the Backbone app.
 *
 * These were all constructed inline as `new Parse.Object("Name")`, which is why
 * a survey of `models/` never listed them -- and why several carry live data
 * that no migration plan sized against the model directory would account for:
 * every uploaded image (`CharacterPortrait`, `TroupePortrait`), the payment
 * record behind the patronage paywall (`PaymentPaypal`), the troupe
 * relationship graph (`CharacterRelationship`), and per-venue cost overrides
 * (`VampireCosts`, `WerewolfCosts`, `ChangelingBetaSliceCosts`).
 *
 * They are registered here so they are visible in one place rather than
 * appearing as string literals at their call sites.
 */
export const INLINE_CLASS_NAMES = [
  'CharacterPortrait',
  'TroupePortrait',
  'PaymentPaypal',
  'CharacterRelationship',
  'VampireCosts',
  'WerewolfCosts',
  'ChangelingBetaSliceCosts',
  'CategoryProperties',
  'UserFacebookData',
] as const

/**
 * The five game-rule reference classes.
 *
 * Informational reference data, kept by owner decision. Their className casing
 * is not a typo -- it is what the table is called.
 */
export const RULE_CLASS_NAMES = {
  clan: 'bnsmetv1_ClanRule',
  elderDiscipline: 'bnsmetv1_ElderDisciplineRule',
  technique: 'bnsmetv1_TechniqueRule',
  ritual: 'bnsmetv1_RitualRule',
  kith: 'bnsctdbs_KithRule',
} as const

let registered = false

/**
 * Register every subclass with the SDK.
 *
 * Must run before the first query, so that results decode to these classes
 * rather than to bare `Parse.Object`s.
 */
export function registerYorickClasses(): void {
  if (registered) return
  registered = true

  Parse.Object.registerSubclass('Vampire', CharacterObject)
  Parse.Object.registerSubclass('SimpleTrait', SimpleTraitObject)
  Parse.Object.registerSubclass('VampireCreation', VampireCreationObject)
  Parse.Object.registerSubclass('VampireChange', VampireChangeObject)
  Parse.Object.registerSubclass('VampireApproval', ApprovalObject)
  Parse.Object.registerSubclass('ExperienceNotation', ExperienceNotationObject)
  Parse.Object.registerSubclass('LongText', LongTextObject)
  Parse.Object.registerSubclass('Troupe', TroupeObject)
  Parse.Object.registerSubclass('Patronage', PatronageObject)
  Parse.Object.registerSubclass('Referendum', ReferendumObject)
  Parse.Object.registerSubclass('ReferendumBallot', ReferendumBallotObject)
  Parse.Object.registerSubclass('Description', DescriptionObject)
}
