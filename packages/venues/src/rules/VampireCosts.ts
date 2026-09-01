/**
 * BNS MET V1 vampire experience costs.
 *
 * Ported from `public/scripts/app/helpers/BNSMETV1_VampireCosts.js`. This is the
 * engine that decides what a trait change costs a player, and its output is
 * consumed by `Character.update_trait`, which does:
 *
 *     if (!_.isFinite(cost) || !_.isFinite(spend)) { ...refuse out loud... }
 *
 * That check is the whole reason every cost function here returns
 * `number | undefined` and never widens to `number`. `undefined` means "there is
 * no rule for this", which is a different thing from "this is free". Two whole
 * categories (`wta_rites`, `ctdbs_backgrounds`) were silently free for an
 * unknown length of time because a missing branch fell through to 0. Categories
 * that are genuinely free are on the FREE_CATEGORIES allowlist below and return
 * a literal 0; everything else returns `undefined` and gets refused.
 *
 * ## What changed in the port, and why
 *
 * **No `Parse.Object`.** The source was `Parse.Object.extend("VampireCosts", …)`
 * -- an object that never saved, never fetched and held no attributes. The only
 * instance state it carried was `this.ClanRules`, assigned in `initialize`. The
 * className is still registered in `@/parse/classes` (INLINE_CLASS_NAMES) for
 * the table's sake; the rules engine itself is plain functions, which is also
 * what lets it be unit-tested without a server.
 *
 * **The clan-rule collection is a parameter, not a module global.** The source
 * read `this.ClanRules`, set in `initialize` from the global
 * `window.BNSMETV1_ClanRules` that `loadall.js` constructs and fetches once at
 * startup, falling back to constructing and fetching its own collection inside a
 * `try/catch` on a ReferenceError. Both halves of that are gone here:
 *
 *   - `Parse.Collection` does not exist in the Vue client, so the rules arrive
 *     as a plain array of rule records (whatever holds them -- a store -- owns
 *     the fetch).
 *   - The dependency is passed in explicitly as the last argument of every
 *     function that needs it, so a caller cannot accidentally price a character
 *     against rules that have not loaded yet without it being visible in the
 *     call. `createVampireCosts()` binds an *accessor* rather than an array
 *     precisely because the fetch is asynchronous: an engine bound to the array
 *     at import time would capture the empty pre-fetch state forever, which is
 *     the failure the old `try/catch` was groping at.
 *
 * **lodash is gone.** The source ran on the vendored lodash 3.10.0, whose
 * `_.take(array, undefined)` defaults n to **1**, not 0 (lodash.js:5391), and
 * whose `_.eq` is `isEqual`. Both are called out at the sites where they matter.
 *
 * ## Types the engine reads
 *
 * The character and trait parameters are structural interfaces, not the ported
 * `CharacterObject`/`SimpleTraitObject` classes. That keeps this module free of
 * the class graph (and of Parse itself), and a real `Parse.Object` -- whose
 * `get` is typed `(attr: string) => any` -- satisfies them as-is.
 */

/**
 * The highest level any trait can reach -- `max_trait_value` in the venue
 * models (`Vampire.max_trait_value` returns 10 for skills and 20 for everything
 * else). Cost tables must cover every level a slider can select.
 */
export const MAX_TRAIT_LEVEL = 20

/**
 * Categories that genuinely cost nothing: focus tracks, expended pools,
 * skill/background specializations, and the link categories that only record
 * affinities. Listing them explicitly is what lets an *unlisted* category be
 * treated as a missing rule rather than as free -- see the bottom of
 * `calculate_trait_cost` and `Character.update_trait`.
 */
export const FREE_CATEGORIES = [
  'focus_physicals',
  'focus_mentals',
  'focus_socials',
  'health_levels',
  'willpower_sources',
  'lore_specializations',
  'academics_specializations',
  'drive_specializations',
  'linguistics_specializations',
  'extra_in_clan_disciplines',
  'haven_specializations',
  'contacts_specializations',
  'allies_specializations',
  'sabbat_rituals',
  'vampiric_texts',
  'influence_elite_specializations',
  'influence_underworld_specializations',
  'status_traits',
] as const

/** A category name that is on the free allowlist. */
export type FreeCategory = (typeof FREE_CATEGORIES)[number]

/** Anything with a `name` attribute -- the extra in-clan discipline records. */
export interface NamedRecord {
  get(attribute: 'name'): string | undefined
}

/**
 * The slice of a trait this engine reads.
 *
 * `get_base_name()` is `SimpleTraitMixin.get_base_name`: the part of `name`
 * before `": "`, so that "Auspex: Heightened Senses" is recognised as Auspex.
 */
export interface CostTrait {
  get(attribute: 'value' | 'free_value'): number | undefined
  get(attribute: 'name' | 'category'): string | undefined
  get_base_name(): string
}

/**
 * The slice of a character this engine reads.
 *
 * `generation()` is `Vampire.generation()`: the value of the "Generation"
 * background, or 1 when the character has none (`_raw_generation() || 1`,
 * Vampire.js:194). It stays a method on the object the caller passes rather than
 * being re-derived here, so the `|| 1` default lives in exactly one place. A
 * caller whose character class does not carry the method passes an adapter --
 * structural typing makes that a two-line object literal.
 */
export interface CostCharacter {
  get(attribute: 'clan'): string | undefined
  get(attribute: 'extra_in_clan_disciplines'): readonly NamedRecord[] | undefined
  generation(): number
}

/** One row of `bnsmetv1_ClanRule`: a clan and its three in-clan disciplines. */
export interface ClanRuleRecord {
  get(attribute: 'clan' | 'discipline_1' | 'discipline_2' | 'discipline_3'): string | undefined
}

/**
 * The clan-rule table, as a plain array.
 *
 * `Parse.Collection` does not exist in the Vue client (see the module note), so
 * the collection becomes an array and its one method becomes
 * `clan_rule_disciplines` below.
 */
export type ClanRules = readonly ClanRuleRecord[]

/** A lazy handle on the clan rules, for callers bound before the fetch lands. */
export type ClanRulesAccessor = () => ClanRules

/**
 * `BNSMETV1_ClanRules.get_in_clan_disciplines`, ported off `Parse.Collection`.
 *
 * Returns the matching clan's three discipline slots, any of which may be
 * `undefined` when the row leaves one blank -- call sites in the old views
 * filtered those out themselves (`_.without(…, undefined)`), so the holes are
 * preserved rather than compacted here.
 *
 * The comparison is `==`, as in the source. It is loose only in the case that
 * matters: a rule row with no `clan` matches a character with no `clan`.
 */
export function clan_rule_disciplines(
  character: CostCharacter,
  clanRules: ClanRules,
): (string | undefined)[] {
  const clanName = character.get('clan')
  const rule = clanRules.find((m) => m.get('clan') == clanName)

  if (!rule) {
    return []
  }

  return [rule.get('discipline_1'), rule.get('discipline_2'), rule.get('discipline_3')]
}

/**
 * Every discipline the character treats as in-clan: the clan's own three, plus
 * whatever is filed under `extra_in_clan_disciplines` (a FREE_CATEGORY -- that
 * is how a Caitiff or a gift of the blood is recorded).
 *
 * The source read the extras with `_.map(list, "attributes.name")`, a lodash 3
 * deep-path shorthand that reaches into the Parse object's raw attribute bag.
 * lodash 4 would still resolve that path, but `attributes` is SDK-private, so
 * this asks the object instead: `o.get("name")`.
 */
export function get_in_clan_disciplines(
  character: CostCharacter,
  clanRules: ClanRules,
): (string | undefined)[] {
  const icds = clan_rule_disciplines(character, clanRules)
  const extras = character.get('extra_in_clan_disciplines') ?? []
  const eicds = extras.map((e) => e.get('name'))
  return [...icds, ...eicds]
}

/**
 * Is this discipline in-clan for this character?
 *
 * The source opened with `if ([] == icds) { return false; }`, which compares two
 * distinct array objects by reference and is therefore always false -- dead
 * code. Its intent (an empty list means not in-clan) is already what the search
 * below produces, so it is recorded here rather than reproduced.
 *
 * `_.eq` in lodash 3.10 is `isEqual` (lodash.js:12065); in lodash 4 it is
 * SameValueZero. For the strings involved both agree with `===`, including the
 * one odd case worth naming: a clan rule with an empty discipline slot
 * (`undefined`) matches a trait with no `name` (`undefined`) under all three.
 * That quirk is preserved, not fixed.
 */
export function discipline_is_in_clan(
  character: CostCharacter,
  trait: CostTrait,
  clanRules: ClanRules,
): boolean {
  const icds = get_in_clan_disciplines(character, clanRules)
  return icds.some((icd) => {
    // Need to check if an in-clan includes a specialized name.
    if (icd === trait.get_base_name()) {
      return true
    }
    if (icd === trait.get('name')) {
      return true
    }
    return false
  })
}

/**
 * A cumulative cost table, one entry per trait level.
 *
 * This used to be `_.range(1, 10)` -- nine entries -- while `max_trait_value`
 * lets a trait reach 20. Because `_.take` past the end of an array silently
 * returns the whole array, `get_cost_on_table` charged levels 10-20 exactly what
 * level 9 cost, and the plateau looked like a deliberate cap rather than an
 * off-by-eleven.
 */
export function get_cost_table(cost_per_entry: number): number[] {
  return Array.from({ length: MAX_TRAIT_LEVEL }, (_entry, index) => (index + 1) * cost_per_entry)
}

/**
 * The total price of reaching `value` on `ct`: the sum of every level up to it.
 *
 * `value` is `number | null | undefined` because the source's callers could
 * reach here with an unset trait value, and lodash 3's `take` defaults n to
 * **1** rather than to 0 -- so an unset value was charged the first level's
 * price, not nothing. That is a quirk rather than a rule, but it is what live
 * characters were priced with, so it is preserved and named here instead of
 * being quietly corrected.
 *
 * `null` counts as unset for exactly the same reason, and getting that wrong
 * hands out free traits. lodash's guard is a LOOSE `n == null`
 * (`lodash.js:5391`), which catches `null` as well as `undefined`. Verified
 * against the vendored copy:
 *
 *     _.chain([3,6,9,12,15]).take(null).sum().value()  // => 3
 *
 * A strict `=== undefined` test instead sends `null` to `Math.max(0, null)`,
 * which is 0, which sums to 0 -- and 0 is a finite number, so
 * `Character.update_trait`'s `isFinite` refusal never fires and the trait saves
 * as free. `null > ct.length` is also false, so the range guard does not catch
 * it either. This is the `wta_rites` / `ctdbs_backgrounds` defect class exactly:
 * silent, permanent in the audit log, and only visible to a storyteller
 * recomputing costs by hand.
 *
 * A stored `null` arrives from existing data rather than from this client --
 * `SimpleTrait`'s `validate` refuses a non-finite value on the way in.
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
  // `_.take` clamps a negative n to 0 and defaults an absent one -- `null` or
  // `undefined` -- to 1.
  const levels = value === undefined || value === null ? 1 : Math.max(0, value)
  return ct.slice(0, levels).reduce((total, entry) => total + entry, 0)
}

/**
 * What the player actually pays for a trait: its full price less the part that
 * was granted free (creation picks, or a merit that hands out another trait).
 *
 * The source wrote `total_cost - free_cost` unguarded, so an out-of-range level
 * produced `undefined - 0` -- NaN. NaN and `undefined` are refused identically
 * by `Character.update_trait`'s `_.isFinite` check, and TypeScript will not let
 * the subtraction happen at all, so the refusal is returned as `undefined`.
 * Never as 0: an unpriceable trait must not be handed over for free.
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
 * Generation is priced off its own table: 2 per level like a background, except
 * that the first dot costs 1.
 */
export function get_generation_cost_table(): number[] {
  const ct = get_cost_table(2)
  ct[0] = 1
  return ct
}

/** Is this category on the free allowlist? `_.contains`, which is strict. */
export function is_free_category(category: string | undefined): boolean {
  return FREE_CATEGORIES.some((free) => free === category)
}

/**
 * The cost of a trait at its current value, for this character.
 *
 * Branch order is load-bearing and matches the source exactly -- in particular
 * `disciplines` is tested twice, once for in-clan and once (further down, after
 * generation is known) for out-of-clan.
 *
 * Returns `undefined` when no branch claims the category. That is not an
 * oversight to paper over with `?? 0`; it is the signal `Character.update_trait`
 * turns into a visible refusal.
 */
export function calculate_trait_cost(
  character: CostCharacter,
  trait: CostTrait,
  clanRules: ClanRules,
): number | undefined {
  const category = trait.get('category')
  const name = trait.get('name')
  const value = trait.get('value')
  const free_value = trait.get('free_value') || 0
  /*
   * `value - free_value` with no default on `value`, exactly as the source had
   * it: a trait with no value produced NaN, and NaN fails `_.isFinite` just as
   * `undefined` does, so the update is refused either way.
   *
   * Returning early on an unset value instead would be a real behaviour change:
   * the FREE_CATEGORIES branch at the bottom returns a literal 0 no matter what
   * the value is, and an early return would turn a valueless status trait into a
   * refusal.
   */
  const mod_value = value === undefined ? Number.NaN : value - free_value

  if ('attributes' == category) {
    return mod_value * 3
  }

  if ('disciplines' == category && discipline_is_in_clan(character, trait, clanRules)) {
    return get_trait_cost_on_table(get_cost_table(3), trait)
  }

  if ('humanity' == category || 'paths' == category) {
    return mod_value * 10
  }

  /* Merits can have a "free" value if they're given by some other merit */
  if ('merits' == category) {
    return mod_value
  }

  if ('flaws' == category) {
    return mod_value * -1
  }

  if ('rituals' == category) {
    return mod_value * 2
  }

  const generation = character.generation()

  let background_ct: number[]
  let skill_ct: number[]
  let ooc_discipline_ct: number[]
  /*
   * These prohibitive defaults are live rules, not placeholders. A technique
   * bought by a character of generation 4+, or an elder discipline below
   * generation 3, is priced at 9999/99999 per dot so that no player can afford
   * it -- the sheet refuses by arithmetic rather than by a message.
   */
  let technique_cost = 9999
  let ic_elder_cost = 99999
  let ooc_elder_cost = 99999
  let ic_luminary_cost = 99999

  if ('backgrounds' == category) {
    if (name == 'Generation') {
      background_ct = get_generation_cost_table()
    } else if (generation == 1) {
      background_ct = get_cost_table(1)
    } else {
      background_ct = get_cost_table(2)
    }
    return get_trait_cost_on_table(background_ct, trait)
  }

  if ('skills' == category) {
    if (generation == 1) {
      skill_ct = get_cost_table(1)
    } else {
      skill_ct = get_cost_table(2)
    }
    return get_trait_cost_on_table(skill_ct, trait)
  }

  if ('disciplines' == category) {
    // Must be OOC to have gotten this far
    if (generation < 5) {
      ooc_discipline_ct = get_cost_table(4)
    } else {
      ooc_discipline_ct = get_cost_table(5)
    }
    return get_trait_cost_on_table(ooc_discipline_ct, trait)
  }

  if ('techniques' == category) {
    if (generation < 3) {
      technique_cost = 12
    } else if (generation == 3) {
      technique_cost = 20
    }
    return mod_value * technique_cost
  }

  if ('elder_disciplines' == category) {
    if (generation >= 3) {
      ic_elder_cost = 18
    }
    if (generation >= 5) {
      ooc_elder_cost = 30
    } else if (generation >= 3) {
      ooc_elder_cost = 24
    }
    if (discipline_is_in_clan(character, trait, clanRules)) {
      return mod_value * ic_elder_cost
    } else {
      return mod_value * ooc_elder_cost
    }
  }

  if ('luminary_disciplines' == category) {
    if (generation >= 5 && discipline_is_in_clan(character, trait, clanRules)) {
      ic_luminary_cost = 24
    }
    return mod_value * ic_luminary_cost
  }

  if (is_free_category(category)) {
    return 0
  }

  // Deliberately `undefined`, not 0: there is no rule for this category, which
  // is a different thing from a rule that says "free". `Character.update_trait`
  // turns this into a visible refusal rather than a silent giveaway.
  return undefined
}

/** The engine with its clan-rule dependency bound. */
export interface VampireCostsEngine {
  get_in_clan_disciplines(character: CostCharacter): (string | undefined)[]
  discipline_is_in_clan(character: CostCharacter, trait: CostTrait): boolean
  calculate_trait_cost(character: CostCharacter, trait: CostTrait): number | undefined
}

/**
 * Bind the clan rules once, for call sites that want the old method shape
 * (`costs.calculate_trait_cost(character, trait)`).
 *
 * Takes an accessor rather than an array on purpose. The clan-rule table is
 * fetched asynchronously at startup, and the venue strategies are constructed
 * before that resolves; binding the array itself would freeze the engine to the
 * empty pre-fetch state and quietly make every discipline out-of-clan. Reading
 * through the accessor on each call means the engine picks the rules up the
 * moment they land -- and, if they never land, prices disciplines out-of-clan
 * rather than throwing, which is the behaviour the old `try/catch` around
 * `initialize` produced.
 */
export function createVampireCosts(getClanRules: ClanRulesAccessor): VampireCostsEngine {
  return {
    get_in_clan_disciplines: (character) => get_in_clan_disciplines(character, getClanRules()),
    discipline_is_in_clan: (character, trait) =>
      discipline_is_in_clan(character, trait, getClanRules()),
    calculate_trait_cost: (character, trait) =>
      calculate_trait_cost(character, trait, getClanRules()),
  }
}
