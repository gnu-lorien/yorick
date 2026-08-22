import type { Character, VenueName } from '../models/Character';
import type { Venue } from './types';
import { vampireVenue } from './vampire';
import { werewolfVenue } from './werewolf';
import { changelingVenue } from './changeling';

/**
 * Which venue a character plays by.
 *
 * This is the replacement for `helpers/VenueClass.js`, and the whole point of
 * the exercise. Vampire, Werewolf and ChangelingBetaSlice share one Mongo table
 * and one Parse className, so the legacy app cannot tell them apart by class:
 * it registers the className three times and then repairs the damage by handing
 * each module a private constructor and prototype layered over the one shared
 * registered class, plus a `__compatCast` the query shim calls on every result.
 *
 * Here the venue is a property of the row -- `type`, which every template
 * already switches on -- and this is a lookup. There is one class, one
 * prototype, and no dependence on module load order.
 */

const VENUES: Record<VenueName, Venue> = {
  Vampire: vampireVenue,
  Werewolf: werewolfVenue,
  ChangelingBetaSlice: changelingVenue,
};

/** The venue for a creature type. */
export function venueByName(name: VenueName): Venue {
  return VENUES[name];
}

/**
 * The venue this character plays by.
 *
 * Rows written before the werewolf and changeling venues existed carry no
 * `type` at all, and `Character.venue` reads those as vampires -- which is what
 * every legacy template does, since their checks are `type == "Werewolf"`,
 * `type == "ChangelingBetaSlice"`, else vampire.
 */
export function venueFor(character: Character): Venue {
  return VENUES[character.venue];
}

/**
 * The venue with its rules loaded, ready to price traits.
 *
 * Every engine needs something from the server before it can answer: the
 * vampire needs the clan rules that say which disciplines are in-clan, the
 * werewolf its gift affinities, the changeling its kith art affinities. The
 * legacy equivalent is `initialize()` on each cost helper, called from
 * `initialize_vampire_costs` before any cost is calculated.
 *
 * Calling it twice is safe and cheap -- each engine fetches once and shares the
 * result -- so a screen should just await it rather than tracking whether some
 * earlier screen already did.
 */
export async function readyVenueFor(character: Character): Promise<Venue> {
  const venue = venueFor(character);
  await venue.loadRules();
  return venue;
}

export { vampireVenue, werewolfVenue, changelingVenue };
export type { Venue } from './types';
