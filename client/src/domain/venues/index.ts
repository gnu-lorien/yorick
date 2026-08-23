/**
 * The venue registry.
 *
 * `venueFor` is the seam that replaces `helpers/VenueClass.js` and the
 * `__compatCast` query shim. Both of those exist only because Parse 1.5 turned
 * three registrations of the className "Vampire" into an inheritance chain and
 * parse@8 does not: the Backbone app has to rebuild a per-module constructor and
 * then re-flavour every query result into it. Here there is one registered class
 * and the creature type is a lookup.
 *
 * Callers should reach a strategy through `venueForCharacter`, which routes on
 * the record's `type`. That routing has one trap and it is load-bearing: **an
 * absent `type` means Vampire**. Vampire rows predate the column and were never
 * backfilled, so `undefined`, `null` and `"Vampire"` are the same creature.
 * `venueOf` in `@/parse/classes` is the only place that decision is made -- and
 * it is why the three venues are not modelled as a TypeScript discriminated
 * union on `type`, which would insist the discriminant is always present.
 */
import { venueOf, type VenueKey } from '@/parse/classes'
import { vampireVenue } from '@/domain/venues/vampire'
import { werewolfVenue } from '@/domain/venues/werewolf'
import { changelingVenue } from '@/domain/venues/changeling'
import type { VenueStrategy, VenueCharacter } from '@/domain/venues/types'

export * from '@/domain/venues/types'
export { vampireVenue } from '@/domain/venues/vampire'
export { werewolfVenue } from '@/domain/venues/werewolf'
export { changelingVenue } from '@/domain/venues/changeling'

/**
 * Every venue, keyed by the value stored in the `type` column.
 *
 * The strategies are singletons: they hold no per-character state, so there is
 * nothing to construct per sheet and nothing to keep in sync when a character is
 * re-fetched. Each one does hold its venue's loaded cost engine, which is global
 * reference data and is fetched once.
 */
const VENUES: Readonly<Record<VenueKey, VenueStrategy>> = {
  Vampire: vampireVenue,
  Werewolf: werewolfVenue,
  ChangelingBetaSlice: changelingVenue,
}

/** The strategy for a venue key. Total -- every key has one. */
export function venueFor(key: VenueKey): VenueStrategy {
  return VENUES[key]
}

/**
 * The strategy for a character, routed on its stored `type`.
 *
 * An unrecognised or absent `type` resolves to Vampire rather than throwing: a
 * character whose `type` is corrupt should still open, because refusing to
 * render it is how a player loses access to a sheet they could otherwise repair.
 */
export function venueForCharacter(character: VenueCharacter): VenueStrategy {
  return venueFor(venueOf(character.get('type')))
}

/** Every strategy, in the order the venues were added to the app. */
export const ALL_VENUES: readonly VenueStrategy[] = [vampireVenue, werewolfVenue, changelingVenue]
