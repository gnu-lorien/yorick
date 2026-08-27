import { Parse } from '../init';
import { Character, CHARACTER_CLASS_NAME } from '../models/Character';
import type { SimpleTrait } from '../models/SimpleTrait';
import { readyVenueFor } from '../venues';
import type { Venue } from '../venues/types';
import { initializeTroupeMembership } from './troupeMembership';

/**
 * Load a character, ready to use.
 *
 * Ports the static `get_character` the three venue models share
 * (Vampire.js:314 and its two counterparts), plus `_get_character` and
 * `_get_character_from_cache` in mobileRouter. Every character screen goes
 * through it.
 *
 * The legacy version is recursive and re-enters itself three times -- once to
 * fetch, once to fetch the requested trait categories, once to finish -- which
 * makes it hard to see that it does four things in order. It does:
 *
 *   1. fetch the row, with a specific set of includes;
 *   2. fetch whichever trait categories the caller asked for;
 *   3. make sure a creation record exists;
 *   4. load the venue's cost rules and work out troupe membership.
 *
 * Steps 3 and 4 are not optional extras. `characterAcl` reads the troupe ids
 * that step 4 computes, and building an ACL before then silently grants no
 * staff access at all; and nothing can price a trait until the venue's rules
 * have loaded.
 */

/**
 * The includes every character fetch carries.
 *
 * `owner` is deliberately NOT among them, and the reason is worth keeping:
 * including it made parse-server DELETE the pointer when the owner was private,
 * and `characterAcl` reads a missing owner as "no owner" and grants the CURRENT
 * user read and write instead -- so opening someone else's sheet rewrote its ACL
 * to the viewer. Without the include the bare pointer survives, the ACL takes
 * its correct branch, and nothing on the sheet needs the owner's name.
 */
const CHARACTER_INCLUDES = ['portrait', 'backgrounds', 'extra_in_clan_disciplines'];

export interface LoadedCharacter {
  character: Character;
  venue: Venue;
}

/**
 * Which trait categories to fetch alongside the character.
 *
 * `"all"` means every category the venue defines, which is what the legacy
 * `categories == "all"` branch expands to. Most screens want none: a character
 * sheet lists the categories without needing their contents.
 */
export type Categories = string[] | 'all' | undefined;

export async function loadCharacter(id: string, categories?: Categories): Promise<LoadedCharacter> {
  const query = new Parse.Query(Character);
  for (const include of CHARACTER_INCLUDES) query.include(include);
  const character = await query.get(id);

  // The venue comes from the row's own `type`, so it cannot be known until the
  // row is here. The legacy router works around that by first issuing a
  // `select("type")` query purely to decide which venue module to call --
  // an extra round trip that a single class does not need.
  const venue = await readyVenueFor(character);

  await fetchCategories(character, venue, categories);
  await venue.ensureCreationRulesExist(character);
  // Throttled, as `initialize_troupe_membership(true)` is at the tail of the
  // legacy get_character. The walk is a query per troupe, and a character sheet
  // reached twice in a minute does not need it twice.
  await initializeTroupeMembership(character, { throttle: true });

  return { character, venue };
}

/** Fetch the trait rows held in the named categories. */
async function fetchCategories(
  character: Character,
  venue: Venue,
  categories: Categories,
): Promise<void> {
  if (!categories) return;
  const names =
    categories === 'all' ? venue.data.categories.map((entry) => entry.key) : categories;
  if (!names.length) return;

  const pending: SimpleTrait[] = [];
  for (const name of names) {
    const traits = character.get(name) as SimpleTrait[] | undefined;
    if (!traits) continue;
    // Only rows that exist server-side. `fetchAllIfNeeded` throws on an object
    // with no id rather than skipping it.
    for (const trait of traits) if (trait?.id) pending.push(trait);
  }
  if (pending.length) await Parse.Object.fetchAllIfNeeded(pending);
}

/**
 * A bare character pointer, for the screens that only need to link to one.
 *
 * Avoids a fetch where the id is all that is used -- building a back-button
 * target, for instance.
 */
export function characterPointer(id: string): Parse.Object {
  return Parse.Object.extend(CHARACTER_CLASS_NAME).createWithoutData(id);
}
