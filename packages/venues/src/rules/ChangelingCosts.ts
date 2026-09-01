/**
 * Changeling (CTD Beta Slice) experience costs.
 *
 * Ported from `public/scripts/app/helpers/BNSCTDBS_ChangelingCosts.js`, together
 * with `public/scripts/app/helpers/BNSCTDBS_ChangelingCostsFetcher.js` (the
 * memoised loader at the bottom of this file) and the two lookup methods of
 * `public/scripts/app/collections/BNSCTDBS_KithRules.js`.
 *
 * ## The one protocol this file must not break
 *
 * A cost function returns `number | undefined`, and the two are NOT
 * interchangeable:
 *
 *   - `0` means "this category is genuinely free" and is only ever returned for
 *     a member of `FREE_CATEGORIES`.
 *   - `undefined` means "no rule exists for this category", which
 *     `Character.update_trait` turns into a visible refusal -- it checks
 *     `_.isFinite(cost) && _.isFinite(spend)` and reports
 *     `No experience cost rule for category "<x>"` rather than saving.
 *
 * Before that protocol existed the fallthrough at the bottom of
 * `calculate_trait_cost` was `return 0`, so every category nobody had written a
 * branch for was silently free. `ctdbs_backgrounds` -- the category Changelings
 * actually buy Backgrounds in -- was one of them, for an unknown length of time.
 * Never write `?? 0`, `|| 0` or a non-null assertion on a value that came out of
 * this file.
 *
 * ## Why the collection and the Parse.Object subclass are gone
 *
 * The source engine was `Parse.Object.extend("ChangelingBetaSliceCosts")` and
 * used `initialize()` as an async loader. It is never saved and never queried;
 * the class name exists in `INLINE_CLASS_NAMES` only because a row type of that
 * name exists on the server. Nothing here needs to be a `Parse.Object`, so the
 * engine is a plain class and the table maths are free functions.
 *
 * `BNSCTDBS_KithRules` was a `Parse.Collection`, which does not exist in the Vue
 * client (see `client/src/parse/index.ts`). Its entire contents were the two
 * affinity lookups now in this file, so it collapses into the engine rather than
 * becoming a store: a fetched array of rule objects plus two pure functions over
 * it.
 */
/**
 * The highest level any trait can reach -- `max_trait_value` in the venue
 * models. Cost tables must cover every level a slider can select.
 */
export const MAX_TRAIT_LEVEL = 20

/**
 * Categories that genuinely cost nothing: focus tracks, expended pools,
 * skill/background specializations, and the link categories that only record
 * affinities.
 *
 * The list exists so that an *unlisted* category can be treated as a missing
 * rule rather than as free -- see the bottom of `calculate_trait_cost`. The
 * werewolf engine carries the fuller version of this note.
 */
export const FREE_CATEGORIES: readonly string[] = [
  'focus_physicals',
  'focus_mentals',
  'focus_socials',
  'health_levels',
  'willpower_sources',
  'lore_specializations',
  'academics_specializations',
  'drive_specializations',
  'linguistics_specializations',
  'ctdbs_arts_affinities_links',
  'ctdbs_holdings_specializations',
  'contacts_specializations',
  'allies_specializations',
  'influence_elite_specializations',
  'influence_underworld_specializations',
]

/**
 * The slice of a trait this engine reads.
 *
 * The attribute types are stated rather than left as `any` on purpose: `value`
 * really can be absent, and the compiler making that visible is the whole point
 * of the protocol above. Named to match the vampire and werewolf engines so one
 * trait object satisfies all three.
 */
export interface CostTrait {
  get(attr: 'value' | 'free_value'): number | undefined
  get(attr: 'name' | 'category'): string | undefined
  get(attr: string): unknown
  /**
   * `SimpleTraitMixin.get_base_name` -- the name up to the first ": ".
   *
   * Optional, and `base_name_of` below falls back to the same split. The mixin
   * lives on the SimpleTrait port, which this module does not own; accepting a
   * bare `Parse.Object` keeps the engine usable (and testable) either way.
   */
  get_base_name?(): string
}

/** An `ctdbs_arts_affinities_links` row. Only its name is read. */
export interface AffinityLink {
  get(attr: string): unknown
}

/**
 * The slice of a Changeling character this engine reads.
 *
 * `seeming()` and `realms()` are `ChangelingBetaSlice.js`'s own methods and are
 * called here exactly as the source called them, because both are venue
 * behaviour and belong to the Changeling strategy rather than to the cost
 * tables:
 *
 *   - `seeming()` is `_raw_seeming() || 0`: the value of the `ctdbs_backgrounds`
 *     trait whose base name is "Seeming", or 0 when there is none.
 *   - `realms()` is `this.get("ctdbs_realms")` and is `undefined` on a character
 *     that has never owned a Realm.
 */
export interface CostCharacter {
  get(attr: 'ctdbs_kith'): string | undefined
  get(attr: 'ctdbs_arts_affinities_links'): readonly AffinityLink[] | undefined
  get(attr: string): unknown
  seeming(): number
  realms(): unknown[] | undefined
}

/** One row of `bnsctdbs_KithRule`: a kith and up to three affinity Arts. */
export interface KithRuleRecord {
  get(attr: 'name' | 'art_1' | 'art_2' | 'art_3'): string | undefined
  get(attr: string): unknown
}

/**
 * The kith-rule table, as a plain array.
 *
 * `Parse.Collection` does not exist in the Vue client (see the module note), so
 * the fetched rows are just an array and the two lookups are functions over it.
 */
export type KithRules = readonly KithRuleRecord[]

/**
 * `SimpleTraitMixin.get_base_name`: the name up to the first ": ", so that
 * "Soothsay: Omens" is recognised as Soothsay.
 *
 * Prefers the object's own method, which is what the Backbone models carried,
 * and otherwise does the same split. `(name || "").split(": ")[0]` -- and
 * `split` always yields at least one element, so the destructuring default is
 * unreachable rather than a silent substitution.
 */
function base_name_of(trait: CostTrait): string {
  if (typeof trait.get_base_name === 'function') {
    return trait.get_base_name()
  }
  const name = trait.get('name')
  const [base = ''] = (name ? String(name) : '').split(': ')
  return base
}

/**
 * Read one attribute off a value that may not be a Parse object at all.
 *
 * The source wrote `_.map(list, "attributes.name")`, which is lodash 3's deep
 * path shorthand reading the attribute bag directly. That never throws: a
 * pointer that was never fetched, or a plain object that wandered into the
 * array, yields `undefined`. `list.map(o => o.get("name"))` would throw on both,
 * so the guard is the port of the shorthand, not defensive decoration.
 */
function attribute_of(value: unknown, attr: string): unknown {
  if (value && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get(attr: string): unknown }).get(attr)
  }
  return undefined
}

/**
 * `trait.get("free_value") || 0` from the source: any falsy stored value -- 0,
 * `null`, `undefined`, `""` -- means no free levels were granted.
 *
 * This `|| 0` is the source's own and is about a *granted level*, not about a
 * cost. It is the one place in this file where a missing number becomes zero.
 */
function free_value_of(trait: CostTrait): number {
  const raw = trait.get('free_value')
  return raw ? Number(raw) : 0
}

/**
 * A cumulative cost table, one entry per trait level.
 *
 * This used to be `_.range(1, 10)` -- nine entries -- while `max_trait_value`
 * lets a trait reach 20. Because `_.take` past the end of an array silently
 * returns the whole array, `get_cost_on_table` charged levels 10-20 exactly what
 * level 9 cost, and the plateau looked like a deliberate cap rather than an
 * off-by-eleven.
 *
 * Entry `i` (1-based) is `i * cost_per_entry`; the cumulative total for a level
 * is the sum of the entries up to it, which is what `get_cost_on_table` does.
 */
export function get_cost_table(cost_per_entry: number): number[] {
  const table: number[] = []
  for (let i = 1; i <= MAX_TRAIT_LEVEL; i += 1) {
    table.push(i * cost_per_entry)
  }
  return table
}

/**
 * lodash 3's `_.take(array, n)` element count, reproduced because it is
 * load-bearing at this boundary and lodash 4 does not agree with it.
 *
 * From `lib/lodash.js` (3.10.0): `if (n == null) { n = 1 } else { n = n < 0 ? 0
 * : (+n || 0) }`. Measured against the vendored copy:
 *
 *   - `undefined` AND `null` take ONE row, not zero -- the test is loose `==`.
 *     A trait whose `value` attribute is missing or null is therefore charged
 *     the first row of the table rather than nothing. That is what the app does
 *     today, and turning it into a zero here would make those traits free.
 *   - a negative `n` clamps to 0, and so does `NaN`.
 *   - a fraction truncates: 2.5 takes two rows.
 */
function take_count(value: number | null | undefined): number {
  if (value === undefined || value === null) return 1
  if (value < 0) return 0
  const n = Number(value)
  return Number.isNaN(n) ? 0 : n
}

/**
 * The cumulative cost of reaching `value` on `ct`.
 *
 * `value` is deliberately `number | null | undefined`: it arrives from
 * `trait.get("value")`, which can be absent or stored null, and both
 * `undefined > ct.length` and `null > ct.length` are false in JS, so a missing
 * value falls through to the table read exactly as it did before.
 */
export function get_cost_on_table(
  ct: readonly number[],
  value: number | null | undefined,
): number | undefined {
  if (value !== undefined && value !== null && value > ct.length) {
    // Never under-charge in silence. `_.take` would return the whole table and
    // read as a correct total; an unusable number is refused out loud by
    // Character.update_trait.
    return undefined
  }
  let total = 0
  for (const entry of ct.slice(0, take_count(value))) {
    total += entry
  }
  return total
}

/**
 * What a trait costs on `ct` net of the levels it was given for free.
 *
 * The source computed `total_cost - free_cost` directly, which is NaN as soon as
 * either lookup is off the end of the table. `undefined` is returned instead:
 * `Character.update_trait` refuses both identically (`_.isFinite` rejects NaN
 * and `undefined` alike), and `undefined` is the signal the rest of this file
 * uses for "no usable cost", where a NaN would survive a `=== undefined` check
 * somewhere downstream and be written to the trait.
 */
export function get_trait_cost_on_table(
  ct: readonly number[],
  trait: CostTrait,
): number | undefined {
  // Not coerced with `Number()`: `undefined` and `NaN` take different numbers of
  // rows off the table (see `take_count`), and flattening the two here would
  // change what a trait with no `value` attribute costs. Widened to include
  // `null` because the column really can hold one and `get_cost_on_table` prices
  // it the way `_.take` did.
  const value: number | null | undefined = trait.get('value')
  const free_value = free_value_of(trait)
  const total_cost = get_cost_on_table(ct, value)
  const free_cost = get_cost_on_table(ct, free_value)
  if (total_cost === undefined || free_cost === undefined) {
    return undefined
  }
  return total_cost - free_cost
}

/**
 * The Vampire Generation table, carried over with the rest of the engine.
 *
 * Nothing in the Changeling venue reads it -- only `BNSMETV1_VampireCosts` has a
 * branch that calls its own copy -- but it is part of what this engine defines,
 * so it is ported rather than dropped. The first level costs 1 instead of 2.
 */
export function get_generation_cost_table(): number[] {
  const ct = get_cost_table(2)
  ct[0] = 1
  return ct
}

/**
 * Is this category on the free allowlist?
 *
 * `_.contains`, which is strict equality against the list. Named to match the
 * vampire and werewolf engines; the source inlined the call.
 */
export function is_free_category(category: string | undefined): boolean {
  return FREE_CATEGORIES.some((free) => free === category)
}

/**
 * The affinity Arts a kith grants.
 *
 * `_.without([art_1, art_2, art_3], undefined)` stripped exactly `undefined` --
 * a `null` or a non-string left in the column survived it -- so the filter tests
 * for `undefined` and nothing else. The cast records that the columns hold art
 * names; it does not add a check the source had.
 */
export function get_arts_affinities_for_kith(rules: KithRules, kith: unknown): string[] {
  const rule = rules.find((m) => m.get('name') === kith)
  if (!rule) {
    return []
  }
  return [rule.get('art_1'), rule.get('art_2'), rule.get('art_3')].filter(
    (art): art is string => art !== undefined,
  )
}

/**
 * Every Art this character treats as an affinity: the ones its kith grants, plus
 * the ones recorded as `ctdbs_arts_affinities_links` traits.
 *
 * The link names can be `undefined` when a pointer in that array was never
 * fetched -- see `attribute_of` -- and the source passed those straight through
 * into the list, so they are kept rather than filtered out.
 */
export function get_arts_affinities(
  rules: KithRules,
  character: CostCharacter,
): Array<string | undefined> {
  const icds = get_arts_affinities_for_kith(rules, character.get('ctdbs_kith'))
  const links = character.get('ctdbs_arts_affinities_links')
  // `_.map(undefined, …)` is `[]` in lodash 3, so a character with no links at
  // all contributes nothing rather than throwing.
  const eicds = Array.isArray(links)
    ? links.map((link) => attribute_of(link, 'name') as string | undefined)
    : []
  return [...icds, ...eicds]
}

/**
 * Is this Art one of the character's affinities?
 *
 * The source guarded with `if ([] == icds) return false`, which compares two
 * object references and is therefore always false -- the branch never ran. It is
 * not reproduced because `some` over an empty list already returns false, which
 * is the answer that branch was reaching for.
 *
 * Both the base name and the full name are tested, because an affinity is
 * recorded by base name while the trait may carry a `": specialization"` suffix.
 *
 * The comparison was `_.eq`, which in the vendored lodash 3.10 is an alias of
 * `isEqual` (deep) and in lodash 4 is SameValueZero. For the strings and
 * `undefined`s that reach it, both agree with `===`.
 */
export function art_is_affinity(
  rules: KithRules,
  character: CostCharacter,
  trait: CostTrait,
): boolean {
  const icds = get_arts_affinities(rules, character)
  return icds.some((icd) => {
    // Need to check if an in-clan includes a specialized name
    if (icd === base_name_of(trait)) {
      return true
    }
    if (icd === trait.get('name')) {
      return true
    }
    return false
  })
}

/**
 * What it costs this character to hold this trait at its current value.
 *
 * Returns `undefined` for any category with no rule -- see the protocol at the
 * top of this file. The branch order is the source's, including where
 * `character.seeming()` is read.
 */
export function calculate_trait_cost(
  rules: KithRules,
  character: CostCharacter,
  trait: CostTrait,
): number | undefined {
  const category = trait.get('category')
  const value = trait.get('value')
  const free_value = free_value_of(trait)
  // `value - free_value` in the source. `Number()` on each side is what the `-`
  // operator does anyway, so an absent value is still NaN here and is still
  // refused by `Character.update_trait`.
  const mod_value = Number(value) - free_value

  if (category === 'attributes') {
    return mod_value * 3
  }

  if (category === 'ctdbs_arts') {
    if (art_is_affinity(rules, character, trait)) {
      return get_trait_cost_on_table(get_cost_table(4), trait)
    } else {
      return get_trait_cost_on_table(get_cost_table(6), trait)
    }
  }

  /* Merits can have a "free" value if they're given by some other merit */
  if (category === 'ctdbs_merits') {
    return mod_value
  }

  if (category === 'ctdbs_flaws') {
    return mod_value * -1
  }

  // "backgrounds" is the Vampire/Werewolf spelling and is not in this venue's
  // category list at all; `ctdbs_backgrounds` is the one Changelings actually
  // use, and it had no branch, so every Background purchase resolved to the
  // `return 0` fallthrough at the bottom and cost nothing. Both spellings are
  // priced on the same 2-per-level table the other two venues use.
  if (category === 'backgrounds' || category === 'ctdbs_backgrounds') {
    return get_trait_cost_on_table(get_cost_table(2), trait)
  }

  // Read here, before the branches that use it, because that is where the
  // source's `var seeming = character.seeming()` sat -- every category from this
  // point down calls it, free ones and unpriced ones included.
  const seeming = character.seeming()

  if (category === 'skills') {
    let skill_ct: number[]
    if (seeming < 3) {
      skill_ct = get_cost_table(1)
    } else {
      skill_ct = get_cost_table(2)
    }
    return get_trait_cost_on_table(skill_ct, trait)
  }

  if (category === 'ctdbs_realms') {
    /*
     * Realms are priced by HOW MANY the character has, not by the level of the
     * one being bought: the trait's own `value` and `free_value` are not read on
     * this path at all. Reading the 8-per-level table at the realm count makes
     * each additional Realm cost 8 more than the last, and re-rating an existing
     * Realm cost whatever the current count says.
     *
     * `Character.update_trait` adds the trait to its category *after* asking for
     * a cost, so a brand-new Realm is counted at the number the character already
     * owns -- the first one is read at count 0 and is free.
     *
     * Left exactly as found. It is not covered by the E2E suite; the venue's
     * category list at `ChangelingBetaSlice.js:37` is the only other place
     * `ctdbs_realms` appears.
     */
    const owned = character.realms()
    if (owned === undefined || owned === null) {
      /*
       * The source wrote `character.realms().length`, which throws a TypeError
       * on a character that has no `ctdbs_realms` array yet. Preserved as an
       * explicit throw: `?? 0` would price that character's first Realm as a
       * count of zero, which is free, and free-by-accident is exactly the class
       * of bug this engine's `undefined` protocol exists to stop.
       */
      throw new TypeError(
        "Cannot read properties of undefined (reading 'length') -- character has no ctdbs_realms",
      )
    }
    const realms = owned.length
    return get_cost_on_table(get_cost_table(8), realms)
  }

  if (is_free_category(category)) {
    return 0
  }

  // Was `return 0`, which made every category anyone forgot to price silently
  // free - exactly how `ctdbs_backgrounds` went unnoticed. Deliberately
  // `undefined` now; `Character.update_trait` turns it into a visible refusal.
  return undefined
}

/**
 * The venue's cost engine, holding the kith rules the affinity lookups need.
 *
 * Method-for-method what `ChangelingBetaSliceCosts` exposed, so
 * `ChangelingBetaSlice`'s call sites (`self.Costs.calculate_trait_cost(self, t)`,
 * `self.Costs.get_arts_affinities(self)`,
 * `self.Costs.get_arts_affinities_for_kith(kith)`) port across unchanged. The
 * free functions above are the implementation and can be used without an
 * instance wherever no kith rules are involved.
 */
export class ChangelingBetaSliceCosts {
  readonly kithRules: KithRules

  constructor(kithRules: KithRules = []) {
    this.kithRules = kithRules
  }

  get_arts_affinities(character: CostCharacter): Array<string | undefined> {
    return get_arts_affinities(this.kithRules, character)
  }

  get_arts_affinities_for_kith(kith: unknown): string[] {
    return get_arts_affinities_for_kith(this.kithRules, kith)
  }

  art_is_affinity(character: CostCharacter, trait: CostTrait): boolean {
    return art_is_affinity(this.kithRules, character, trait)
  }

  get_cost_table(cost_per_entry: number): number[] {
    return get_cost_table(cost_per_entry)
  }

  get_cost_on_table(
    ct: readonly number[],
    value: number | null | undefined,
  ): number | undefined {
    return get_cost_on_table(ct, value)
  }

  get_trait_cost_on_table(ct: readonly number[], trait: CostTrait): number | undefined {
    return get_trait_cost_on_table(ct, trait)
  }

  get_generation_cost_table(): number[] {
    return get_generation_cost_table()
  }

  calculate_trait_cost(
    character: CostCharacter,
    trait: CostTrait,
  ): number | undefined {
    return calculate_trait_cost(this.kithRules, character, trait)
  }
}
