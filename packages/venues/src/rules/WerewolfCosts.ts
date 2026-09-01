/**
 * BNSWTAV1 - the Werewolf experience-cost engine.
 *
 * A port of `public/scripts/app/helpers/BNSWTAV1_WerewolfCosts.js`. Every rule,
 * every number and every ordering decision below is the original's; the
 * comments that explain WHY are carried over because they record measured bugs
 * and owner decisions rather than intent.
 *
 * Four things about this file are load-bearing and easy to break:
 *
 *  1. **`undefined` is not zero.** `calculate_trait_cost` returns `0` only for a
 *     category on the explicit `FREE_CATEGORIES` allowlist, and `undefined`
 *     when no rule exists at all. `Character.update_trait` turns the second into
 *     a visible refusal via `_.isFinite(cost) && _.isFinite(spend)`
 *     (Character.js:213). `wta_rites` and `ctdbs_backgrounds` were silently free
 *     for an unknown length of time because that distinction did not exist. Do
 *     not write `?? 0`, `|| 0` or a non-null assertion at any boundary in here.
 *
 *  2. **The flat/linear override outranks every category branch.** A trait
 *     carrying `experience_cost_type` is priced by that and returns before the
 *     category is even looked at. Reordering those checks changes what gifts
 *     cost.
 *
 *  3. **NaN is the other refusal.** The multiplying branches return
 *     `mod_value * n`, and `mod_value` is NaN whenever the trait has no `value`
 *     or a `flat`/`linear` modifier that does not parse. NaN is a `number` to
 *     TypeScript and falsy to a plain `if`, so consumers must test costs with
 *     `Number.isFinite` - which is exactly what `_.isFinite` did - and not with
 *     `=== undefined` alone.
 *
 *  4. **The refusal protocol has one hole, and it is the original's.** lodash
 *     3's `_.sum` counts a NaN entry as 0, so an `experience_cost_type` of
 *     "linear" whose modifier does not parse builds a table of NaNs, sums to 0,
 *     and the trait is saved as FREE. Reproduced deliberately -- see
 *     `take_and_sum` -- and pinned by the spec so nobody mistakes it for a port
 *     defect. Closing it is a rules change with an owner behind it.
 *
 * ## Structural changes from the AMD original
 *
 * - `Parse.Object.extend("WerewolfCosts", …)` becomes a plain class. Nothing in
 *   the app ever saved, queried or fetched a `WerewolfCosts` row; the `extend`
 *   was being used as an object factory. Keeping it a Parse subclass would add a
 *   registration nobody reads and route every method call through the
 *   reactivity wrapper in `@/parse/reactivity` for no gain. `classes.ts` still
 *   lists the className among `INLINE_CLASS_NAMES` for visibility.
 * - The `Backbone.Collection` of gift descriptions becomes a plain array, per
 *   the migration's rule 6 -- `Parse.Collection` and Backbone collections do not
 *   exist in the Vue client.
 * - The pure table maths is exported as module-level functions as well as
 *   methods. It has no instance state and it is the part a regression test
 *   needs to reach without a server.
 * - `get_affinities` reads the character's columns here rather than delegating
 *   to `Werewolf#get_affinities` (Werewolf.js:260). The venue strategies replace
 *   the per-venue model classes, so there is no `character.get_affinities()` to
 *   call; the logic is unchanged and is exported so the Werewolf strategy can
 *   use this copy instead of growing a second one.
 * - `get_trait_cost_on_table` returns `undefined` on a table overrun where the
 *   original's arithmetic produced NaN. Both are refused identically by the
 *   `_.isFinite` guard, and the Vampire and Changeling ports made the same
 *   choice; see the note on that function.
 */
/**
 * The highest level any trait can reach - `max_trait_value` in the venue
 * models. Cost tables must cover every level a slider can select.
 */
export const MAX_TRAIT_LEVEL = 20

/**
 * Categories that genuinely cost nothing: focus tracks, expended pools,
 * skill/background specializations, and the link categories that only record
 * affinities. Listing them explicitly is what lets an *unlisted* category be
 * treated as a missing rule rather than as free - see the bottom of
 * `calculate_trait_cost` and `Character.update_trait`.
 */
export const FREE_CATEGORIES: readonly string[] = [
  'focus_physicals',
  'focus_mentals',
  'focus_socials',
  'health_levels',
  'willpower_sources',
  'wta_gnosis_sources',
  'lore_specializations',
  'academics_specializations',
  'drive_specializations',
  'linguistics_specializations',
  'extra_affinity_links',
  'wta_territory_specializations',
  'contacts_specializations',
  'allies_specializations',
  'influence_elite_specializations',
  'influence_underworld_specializations',
  'wta_monikers',
  'wta_totem_bonus_traits',
]

/**
 * What this engine needs from a `SimpleTrait`.
 *
 * Structural, so a `Parse.Object` satisfies it without this module importing
 * the SimpleTrait port. The attribute types are stated rather than left as
 * `any` on purpose: `value` really can be absent, and the compiler making that
 * visible is the whole point of rule 1 above.
 */
export interface CostTrait {
  get(attr: 'value' | 'free_value'): number | undefined
  get(attr: 'name' | 'category' | 'experience_cost_type'): string | undefined
  get(attr: 'experience_cost_modifier'): number | string | undefined
  get(attr: string): unknown
  /**
   * `SimpleTraitMixin.get_base_name` - the name up to the first ": ".
   *
   * Optional, and `base_name_of` below falls back to the same split. The mixin
   * lives on the SimpleTrait port, which this module does not own; accepting a
   * bare `Parse.Object` keeps the engine usable (and testable) either way.
   */
  get_base_name?(): string
}

/** A `Description` row. Only its name and affinity columns are read. */
export interface GiftDescription {
  get(attr: string): unknown
}

/** An `extra_affinity_links` row. Only its name is read. */
export interface AffinityLink {
  get(attr: string): unknown
}

/** What `get_affinities` needs from a character. */
export interface AffinityCharacter {
  get(attr: 'extra_affinity_links'): readonly AffinityLink[] | undefined
  get(attr: string): unknown
}

/** What `calculate_trait_cost` needs from a character. */
export interface CostCharacter extends AffinityCharacter {
  /**
   * The value of the "Rank" background, or 0 when the character has none
   * (`Werewolf#rank`, Werewolf.js:189). Supplied by the caller because Rank is
   * venue behaviour and belongs to the Werewolf strategy, not to the cost
   * tables.
   */
  rank(): number
}

/**
 * `_.chain(ct).take(n).sum().value()` under lodash 3.10, reproduced exactly.
 *
 * lodash 3's `take` is not lodash 4's and is not `Array.prototype.slice`, and
 * two of its behaviours reach real traits:
 *
 *  - `_.take(list, undefined)` takes ONE element, because lodash 3 defaults `n`
 *    to 1 when it is null or undefined (`n == null` in take's own guard). A
 *    trait with no `value` at all is therefore charged the first entry of the
 *    table rather than nothing. That is not a rule anyone wrote down, it is
 *    what the code does, and `update_trait` always sets `value` so it is only
 *    reachable from a hand-edited or partially fetched row.
 *  - `n` negative, NaN or fractional never throws: `baseSlice` clamps upward to
 *    the table length first and then does `end >>> 0`, which turns NaN into 0
 *    and truncates fractions toward zero.
 *
 * lodash 4's `take` returns `[]` for an undefined `n` instead of one element,
 * which is exactly the kind of silent v3 -> v4 drift this migration has to
 * translate rather than copy.
 *
 * And `_.sum` is not `reduce((a, b) => a + b)`. lodash 3's `arraySum` is
 * `result += +entry || 0` per entry (lodash.js:1514), so a NaN or non-numeric
 * entry contributes ZERO instead of poisoning the total. That is measurable and
 * it is not academic:
 *
 *     experience_cost_type "linear" with a modifier that does not parse
 *       -> get_cost_table(NaN) -> a table of twenty NaNs
 *       -> sum 0 -> the trait costs NOTHING and is saved without complaint.
 *
 * A trait that is silently free is precisely what `FREE_CATEGORIES` exists to
 * make impossible, so this is a live bug in the rules - and it is carried over
 * verbatim, because the port's job is to be bug-compatible. Fixing it is a
 * rules change with an owner decision behind it, not a translation detail.
 */
function take_and_sum(ct: readonly number[], n: number | undefined): number {
  // `if (!length) return []` - an empty table sums to 0 whatever `n` is.
  if (ct.length === 0) {
    return 0
  }

  const count = n === undefined || n === null ? 1 : n
  let end = count < 0 ? 0 : count
  if (end > ct.length) {
    end = ct.length
  }
  // `(end - start) >>> 0` with start 0. NaN becomes 0; 3.7 becomes 3.
  const size = end >>> 0

  // `result += +entry || 0` - lodash 3's `arraySum`, NaN entries included.
  return ct.slice(0, size).reduce((total, entry) => total + (Number(entry) || 0), 0)
}

/**
 * A cumulative cost table, one entry per trait level.
 *
 * This used to be `_.range(1, 10)` - nine entries - while `max_trait_value`
 * lets a trait reach 20. Because `_.take` past the end of an array silently
 * returns the whole array, `get_cost_on_table` charged levels 10-20 exactly
 * what level 9 cost, and the plateau looked like a deliberate cap rather than
 * an off-by-eleven.
 */
export function get_cost_table(cost_per_entry: number): number[] {
  const table: number[] = []
  for (let level = 1; level <= MAX_TRAIT_LEVEL; level += 1) {
    table.push(level * cost_per_entry)
  }
  return table
}

/**
 * The total cost of buying a trait up to `value` on the given table.
 *
 * Returns `undefined` - never a number - once `value` runs past the end of the
 * table.
 */
export function get_cost_on_table(
  ct: readonly number[],
  value: number | undefined,
): number | undefined {
  // `undefined > ct.length` is false in JavaScript, so an absent value falls
  // through to `take_and_sum` here exactly as it did in the original. The
  // explicit `!== undefined` is only there to satisfy the compiler; it changes
  // no outcome.
  if (value !== undefined && value > ct.length) {
    // Never under-charge in silence. `_.take` would return the whole table and
    // read as a correct total; an unusable number is refused out loud by
    // Character.update_trait.
    return undefined
  }
  return take_and_sum(ct, value)
}

/**
 * What a trait costs on a table, net of the levels granted free at creation.
 *
 * `undefined` when either lookup runs off the table.
 *
 * The one place this is not byte-for-byte the original: `total_cost -
 * free_cost` was plain arithmetic, and `undefined - number` is `NaN`, not
 * `undefined`, so an overrun reached `update_trait` as NaN. `_.isFinite`
 * refuses NaN and `undefined` identically, so no character is charged
 * differently - but `undefined` is the protocol the whole migration keys off,
 * the Vampire and Changeling ports return it here, and a caller testing
 * `cost === undefined` should not be fooled by a NaN that answers `false`.
 */
export function get_trait_cost_on_table(
  ct: readonly number[],
  trait: CostTrait,
): number | undefined {
  const value = trait.get('value')
  const free_value = trait.get('free_value') || 0
  const total_cost = get_cost_on_table(ct, value)
  const free_cost = get_cost_on_table(ct, free_value)
  if (total_cost === undefined || free_cost === undefined) {
    return undefined
  }
  return total_cost - free_cost
}

/**
 * Is this category on the free allowlist? `_.contains`, which is strict - and
 * which answered `false` for an absent category, as this does.
 */
export function is_free_category(category: string | undefined): boolean {
  return FREE_CATEGORIES.some((free) => free === category)
}

/** `SimpleTraitMixin.get_base_name`, with the mixin or without it. */
function base_name_of(trait: CostTrait): string {
  if (typeof trait.get_base_name === 'function') {
    return trait.get_base_name()
  }
  const name = trait.get('name') || ''
  // `name.split(": ")[0]`. `split` always yields at least one element, so the
  // `?? ''` here is for `noUncheckedIndexedAccess` and cannot mask a rule.
  return name.split(': ')[0] ?? ''
}

/**
 * The affinity names a character counts as their own: tribe, auspice, breed and
 * every extra affinity link.
 *
 * Ported from `Werewolf#get_affinities` (Werewolf.js:260). Two lodash-3 forms
 * were translated rather than copied:
 *
 *  - `_.map(links, "attributes.name")` is the deep-property shorthand, which
 *    reads a `Parse.Object`'s backing attributes. In lodash 4 the same call
 *    returns a list of `undefined`, so it becomes `link.get("name")`.
 *  - `_.without(list, undefined)` drops `undefined` and ONLY `undefined`. A
 *    `null` tribe stayed in the list and still does. Values are returned raw
 *    and uncoerced; the description side of the comparison can never hold a
 *    falsy affinity (see `gift_is_affinity`), so a null here simply never
 *    matches anything.
 */
export function get_affinities(character: AffinityCharacter): unknown[] {
  const affinities: unknown[] = [
    character.get('wta_tribe'),
    character.get('wta_auspice'),
    character.get('wta_breed'),
  ].filter((affinity) => affinity !== undefined)

  // `_.map(undefined, …)` is `[]` in lodash 3, so a character with no links is
  // not an error.
  const links = character.get('extra_affinity_links') ?? []
  const extra_affinities = links
    .map((link) => link.get('name'))
    .filter((name) => name !== undefined)

  return affinities.concat(extra_affinities)
}

/**
 * Does this gift fall inside one of the character's affinities?
 *
 * The answer decides 4 experience per level versus 6, so the failure mode
 * matters: with `descriptions` empty - which is what it is until
 * `WerewolfCosts.initialize()` resolves - every gift is priced as
 * non-affinity at 6. That is the original's behaviour too, and it is a real
 * race in both apps: pricing a gift before the description query lands
 * over-charges by 2 per level.
 */
export function gift_is_affinity(
  character: AffinityCharacter,
  trait: CostTrait,
  descriptions: readonly GiftDescription[],
): boolean {
  // Get the trait's description
  const base_name = base_name_of(trait)
  const description = descriptions.find((d) => d.get('name') === base_name)

  if (!description) {
    return false
  }

  // Get the affinities for the trait from description. `_.range(1, 4)` is
  // 1, 2, 3 - so affinity_1 through affinity_3, and no further.
  //
  // The original mapped each column through `if (a) { return a; }` and then
  // dropped `undefined` from the result, so a blank or empty-string affinity
  // column was never an affinity. Truthiness, not presence, is the test.
  const trait_affinities: unknown[] = []
  for (let i = 1; i <= 3; i += 1) {
    const affinity = description.get('affinity_' + i)
    if (affinity) {
      trait_affinities.push(affinity)
    }
  }
  // Carried over verbatim from the original (BNSWTAV1_WerewolfCosts.js:80),
  // where it is a leftover debug print. It is noise rather than a rule, and it
  // is noisier here than it was there: in the Vue client a cost is recomputed
  // by a `computed`, so this can fire on every re-render. Removing it is a
  // deliberate follow-up, not a silent tidy-up during the port.
  console.log(trait_affinities)
  // Get the character affinities
  const character_affinities = get_affinities(character)
  // Take the union and see if it's empty
  const combined = trait_affinities.filter((affinity) =>
    character_affinities.includes(affinity),
  )

  return combined.length !== 0
}

/**
 * What a trait costs this character, in experience.
 *
 * `undefined` means "no rule for this category" and is refused by
 * `Character.update_trait`. `0` means free, and only ever comes from
 * `FREE_CATEGORIES`.
 *
 * @param descriptions the loaded `wta_gifts` descriptions; required rather than
 * defaulted, because an empty list quietly re-prices every affinity gift.
 */
export function calculate_trait_cost(
  character: CostCharacter,
  trait: CostTrait,
  descriptions: readonly GiftDescription[],
): number | undefined {
  const category = trait.get('category')
  const value = trait.get('value')
  const free_value = trait.get('free_value') || 0
  // `value - free_value`. An absent value gives NaN here, as it did in the
  // original, and NaN is refused out loud by `update_trait`. Defaulting it
  // would price the trait at minus its free levels and hand out experience.
  const mod_value = (value === undefined ? NaN : value) - free_value
  const experience_cost_type = trait.get('experience_cost_type')
  // `_.parseInt` in lodash 3.10 is the native `parseInt` on every engine where
  // `parseInt(" 08") === 8`, which is all of them now: ToString first, then
  // parse, with radix auto-detection. A missing or non-numeric modifier gives
  // NaN, which multiplies through to NaN and is refused - do NOT default it.
  const experience_cost_modifier = parseInt(String(trait.get('experience_cost_modifier')))

  // This override comes FIRST and outranks every category branch below. A trait
  // that carries an explicit cost type is priced by it whatever category it
  // sits in, and moving these two checks below the category branches would
  // change what gifts, skills and backgrounds cost.
  if ('flat' === experience_cost_type) {
    return mod_value * experience_cost_modifier
  } else if ('linear' === experience_cost_type) {
    return get_trait_cost_on_table(get_cost_table(experience_cost_modifier), trait)
  }

  if ('attributes' === category) {
    return mod_value * 3
  }

  if ('wta_gifts' === category) {
    if (gift_is_affinity(character, trait, descriptions)) {
      return mod_value * 4
    } else {
      return mod_value * 6
    }
  }

  if ('wta_merits' === category) {
    return mod_value
  }

  if ('wta_flaws' === category) {
    return mod_value * -1
  }

  if ('wta_backgrounds' === category) {
    return get_trait_cost_on_table(get_cost_table(2), trait)
  }

  // Rites are the Werewolf analogue of the Vampire's Rituals, which this
  // codebase prices at 2 experience per level (BNSMETV1_VampireCosts,
  // "rituals"), and the model already files them under the same print section
  // as Backgrounds. Before this branch existed the cost resolved to `undefined`
  // and `Character.update_trait`'s `_.isFinite` guard zeroed it, so every Rite
  // was silently free.
  if ('wta_rites' === category) {
    return mod_value * 2
  }

  // Read here, exactly where the original read it: after the branches above and
  // before the skills branch, which means it is also read for the free and
  // unknown categories below. That is wasted work, not a bug, and moving it
  // would change which categories can fail on a character that cannot answer
  // `rank()`.
  const rank = character.rank()

  if ('skills' === category) {
    let skill_ct: number[]
    if (rank >= 3) {
      skill_ct = get_cost_table(2)
    } else {
      skill_ct = get_cost_table(1)
    }
    return get_trait_cost_on_table(skill_ct, trait)
  }

  if (is_free_category(category)) {
    return 0
  }

  // Deliberately `undefined`, not 0: there is no rule for this category, which
  // is a different thing from a rule that says "free". `Character.update_trait`
  // turns this into a visible refusal rather than a silent giveaway.
  return undefined
}

/**
 * The stateful half of the engine: the gift descriptions, and the methods that
 * need them.
 *
 * `Werewolf#initialize_costs` (Werewolf.js:250) constructs one of these per
 * character and awaits `initialize()`, and that shape is preserved.
 */
export class WerewolfCosts {
  /**
   * Every `Description` row in category "wta_gifts" - the rows that carry the
   * `affinity_1..3` columns.
   *
   * A plain array replaces the `Backbone.Collection`. It is REPLACED rather
   * than appended to when a load finishes, which matters twice: a reload no
   * longer exposes a half-filled list the way the original's
   * `self.descriptions = new Descriptions` before the query did, and a store
   * holding this engine in a `shallowRef` sees one reference change it can act
   * on. This class deliberately holds no Vue state of its own - a view that
   * prices gifts must re-run its `computed` after `initialize()` resolves,
   * because filling this array is not a `Parse.Object` mutation and
   * `@/parse/reactivity` cannot see it.
   */
   descriptions: GiftDescription[] = []

   constructor(descriptions: GiftDescription[] = []) {
     this.descriptions = descriptions
   }

  /** @see get_affinities */
  get_affinities(character: AffinityCharacter): unknown[] {
    return get_affinities(character)
  }

  /** @see gift_is_affinity */
  gift_is_affinity(character: AffinityCharacter, trait: CostTrait): boolean {
    return gift_is_affinity(character, trait, this.descriptions)
  }

  /** @see get_cost_table */
  get_cost_table(cost_per_entry: number): number[] {
    return get_cost_table(cost_per_entry)
  }

  /** @see get_cost_on_table */
  get_cost_on_table(ct: readonly number[], value: number | undefined): number | undefined {
    return get_cost_on_table(ct, value)
  }

  /** @see get_trait_cost_on_table */
  get_trait_cost_on_table(ct: readonly number[], trait: CostTrait): number | undefined {
    return get_trait_cost_on_table(ct, trait)
  }

  /** @see calculate_trait_cost */
  calculate_trait_cost(character: CostCharacter, trait: CostTrait): number | undefined {
    return calculate_trait_cost(character, trait, this.descriptions)
  }
}

export default WerewolfCosts
