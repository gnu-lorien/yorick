/**
 * The clan rule table -- which three disciplines each vampire clan grants.
 *
 * Ported from `public/scripts/app/models/BNSMETV1_ClanRule.js` (an empty
 * `Parse.Object.extend("bnsmetv1_ClanRule")`) and
 * `public/scripts/app/collections/BNSMETV1_ClanRules.js`.
 *
 * The className's lowercase prefix is not a typo -- `bnsmetv1_ClanRule` is what
 * the table is called. `@/parse/classes` holds the name in `RULE_CLASS_NAMES`.
 *
 * ## Two functions named `get_in_clan_disciplines`
 *
 * This is the trap in this file. The Backbone app had two, and they return
 * different things:
 *
 *   - `BNSMETV1_ClanRules#get_in_clan_disciplines(character)` -- the collection
 *     method, ported here as `getInClanDisciplines`. The clan's three slots and
 *     nothing else.
 *   - `BNSMETV1_VampireCosts#get_in_clan_disciplines(character)` -- the cost
 *     engine's, in `@/domain/rules/BNSMETV1_VampireCosts`. The clan's three
 *     slots PLUS whatever is filed under `extra_in_clan_disciplines`, which is
 *     how a Caitiff or a gift of the blood is recorded.
 *
 * Pricing a trait must use the engine's. A "what does this clan grant" display
 * uses this one. Reaching for the wrong one prices an out-of-clan discipline as
 * in-clan, or refuses to show a clan's own disciplines.
 *
 * The implementation is not duplicated: `getInClanDisciplines` delegates to
 * `clan_rule_disciplines`, which is where the ported body already lives.
 */
import Parse from '@/parse'
import { RULE_CLASS_NAMES } from '@/parse/classes'
import {
  clan_rule_disciplines,
  type ClanRuleRecord,
  type ClanRules,
  type CostCharacter,
} from '@/domain/rules/BNSMETV1_VampireCosts'

export type { ClanRuleRecord, ClanRules }

/**
 * `Parse.Collection` does not exist in the Vue client, so the collection is a
 * plain array and its one method is the function below. Whoever holds the array
 * -- a store, or `createVampireCosts`'s accessor -- owns the fetch.
 */

/** A query for every clan rule. */
export function clanRuleQuery(): Parse.Query {
  return new Parse.Query(RULE_CLASS_NAMES.clan)
}

/**
 * Load every clan rule.
 *
 * `Parse.Collection.fetch` was a bare `new Parse.Query(model).find()` -- no
 * limit, so the SDK's default of 100 rows applied. There have never been more
 * than a few dozen clans. Kept as `find()` rather than paged with `each()`,
 * because raising the ceiling would be a behaviour change hiding in a port.
 *
 * `loadall.js` did this once at startup into a global
 * (`this.BNSMETV1_ClanRules`) and never awaited it, which is why the cost
 * engine takes an accessor rather than an array: a caller bound before the
 * fetch landed would otherwise hold the empty pre-fetch list forever.
 */
export async function fetchClanRules(): Promise<ClanRules> {
  return (await clanRuleQuery().find()) as unknown as ClanRuleRecord[]
}

/**
 * The three disciplines a character's clan grants, INCLUDING empty slots.
 *
 * The `undefined` entries are deliberate and are the difference between this
 * and the kith equivalent, which strips them (see `@/domain/rules/KithRules`).
 * The old views filtered the holes out themselves with `_.without(…, undefined)`
 * at the point of display, so a caller that wants a clean list must still do
 * that -- and a caller that is checking "does this clan have a third
 * discipline?" needs the hole to be there.
 *
 * An unknown clan returns `[]`, not three `undefined`s. Those are different
 * answers: "there is no rule for this clan" versus "this clan grants nothing".
 *
 * Delegates to the engine's `clan_rule_disciplines`, which is the ported body.
 */
export function getInClanDisciplines(
  character: CostCharacter,
  clanRules: ClanRules,
): (string | undefined)[] {
  return clan_rule_disciplines(character, clanRules)
}
