/**
 * The kith rule table -- which Arts each Changeling kith has an affinity for.
 *
 * Ported from `public/scripts/app/models/BNSCTDBS_KithRule.js` (an empty
 * `Parse.Object.extend("bnsctdbs_KithRule")`) and
 * `public/scripts/app/collections/BNSCTDBS_KithRules.js`.
 *
 * The className's lowercase prefix is not a typo -- `bnsctdbs_KithRule` is what
 * the table is called. `@/parse/classes` holds the name in `RULE_CLASS_NAMES`.
 *
 * ## This strips `undefined`; the clan version does not
 *
 * `get_arts_affinities_for_kith` runs its three slots through
 * `_.without([…], undefined)`. `BNSMETV1_ClanRules#get_in_clan_disciplines`
 * does not. The two tables are shaped identically and are read differently, and
 * that difference is on purpose, not an inconsistency to tidy up:
 *
 *   - a clan's three discipline slots are POSITIONAL -- callers index them and
 *     the views filter the holes out at the point of display;
 *   - a kith's affinity Arts are a SET -- every caller asks "is this Art an
 *     affinity?", and a hole in the set would answer yes for a trait with no
 *     name (`undefined === undefined`).
 *
 * `_.without` stripped exactly `undefined`. A `null` or a non-string left in the
 * column survived it, and still does.
 *
 * ## Two functions named `get_arts_affinities`
 *
 * As with the clan rules, the collection method and the cost engine's method
 * share a name and do different things:
 *
 *   - `BNSCTDBS_KithRules#get_arts_affinities(character)` -- the collection
 *     method, ported here as `getArtsAffinities`. The kith's Arts only.
 *   - `BNSCTDBS_ChangelingCosts#get_arts_affinities(character)` -- in
 *     `@/domain/rules/BNSCTDBS_ChangelingCosts`. The kith's Arts PLUS the ones
 *     recorded as `ctdbs_arts_affinities_links` traits, and it does NOT strip
 *     the `undefined`s those links can contribute.
 *
 * Pricing an Art must use the engine's: an affinity Art costs 4 per level where
 * a non-affinity costs 6, and a character whose affinity came from a link would
 * be overcharged by this one.
 *
 * The implementation is not duplicated: both functions here delegate to
 * `get_arts_affinities_for_kith`, which is where the ported body already lives.
 */
import Parse from '@/parse'
import { RULE_CLASS_NAMES } from '@/parse/classes'
import {
  get_arts_affinities_for_kith,
  type CostCharacter,
  type KithRuleRecord,
  type KithRules,
} from '@/domain/rules/BNSCTDBS_ChangelingCosts'

export type { KithRuleRecord, KithRules }

/** A query for every kith rule. */
export function kithRuleQuery(): Parse.Query {
  return new Parse.Query(RULE_CLASS_NAMES.kith)
}

/**
 * Load every kith rule.
 *
 * `Parse.Collection.fetch` was a bare `new Parse.Query(model).find()` -- no
 * limit, so the SDK's default of 100 rows applied, which is more than the kith
 * list has ever held. Kept as `find()` rather than paged, because raising the
 * ceiling would be a behaviour change hiding in a port.
 *
 * `@/domain/rules/BNSCTDBS_ChangelingCosts` keeps its own private copy of this
 * fetch behind `get_changeling_costs()`, which memoises the resulting engine.
 * Use that one when you want the cost engine; use this one when you want the
 * table itself (a kith picker, an admin rule editor).
 */
export async function fetchKithRules(): Promise<KithRules> {
  return (await kithRuleQuery().find()) as unknown as KithRuleRecord[]
}

/**
 * The affinity Arts a named kith grants, with empty slots stripped.
 *
 * An unknown kith returns `[]`. So does a kith whose three slots are all empty
 * -- unlike the clan version, those two cases are indistinguishable here, which
 * is fine for a set membership test and is why the two differ.
 *
 * The match is `===` on `name`, so a kith of `undefined` matches a rule row
 * with no `name`. That quirk is the source's.
 */
export function getArtsAffinitiesForKith(rules: KithRules, kith: unknown): string[] {
  return get_arts_affinities_for_kith(rules, kith)
}

/**
 * The affinity Arts this character's kith grants.
 *
 * Reads `ctdbs_kith` off the character and defers to the function above. Does
 * NOT include `ctdbs_arts_affinities_links` -- see the module note; that is the
 * cost engine's job.
 */
export function getArtsAffinities(rules: KithRules, character: CostCharacter): string[] {
  return getArtsAffinitiesForKith(rules, character.get('ctdbs_kith'))
}
