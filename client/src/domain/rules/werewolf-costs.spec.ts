/**
 * Regression pins for the Werewolf cost engine.
 *
 * Every expected number here is derived from
 * `public/scripts/app/helpers/BNSWTAV1_WerewolfCosts.js`, not from what the
 * rules "should" be. The suite exists to catch the three ways this engine has
 * actually gone wrong:
 *
 *  1. A short cost table. `get_cost_table` was `_.range(1, 10)` while traits go
 *     to 20, and `_.take` past the end of an array returns the whole array, so
 *     levels 10-20 all cost what level 9 cost.
 *  2. A missing category branch returning `undefined`, which
 *     `Character.update_trait` then zeroed - that is how `wta_rites` was
 *     silently free. `undefined` must stay `undefined` and must never become 0.
 *  3. The flat/linear override losing its precedence over the category
 *     branches, which re-prices gifts, skills and backgrounds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FREE_CATEGORIES,
  MAX_TRAIT_LEVEL,
  calculate_trait_cost,
  get_affinities,
  get_cost_on_table,
  get_cost_table,
  get_trait_cost_on_table,
  gift_is_affinity,
  type CostCharacter,
  type CostTrait,
  type GiftDescription,
} from '@/domain/rules/BNSWTAV1_WerewolfCosts'

type Attrs = Record<string, unknown>

/**
 * A stand-in for a `SimpleTrait`. The cast is the whole point of the helper:
 * the engine's interfaces state real attribute types so the compiler can force
 * `undefined` to be handled, and a bag-of-attributes fake cannot express that
 * without one.
 *
 * No `get_base_name` here, so the engine's fallback split is what runs. One
 * test below supplies the mixin method instead.
 */
function fake_trait(attrs: Attrs): CostTrait {
  return { get: (attr: string) => attrs[attr] } as unknown as CostTrait
}

function fake_character(attrs: Attrs, rank = 0): CostCharacter {
  return {
    get: (attr: string) => attrs[attr],
    rank: () => rank,
  } as unknown as CostCharacter
}

function fake_description(attrs: Attrs): GiftDescription {
  return { get: (attr: string) => attrs[attr] }
}

/** A character with no affinities and no Rank. */
const nobody = fake_character({})

/** No gift descriptions loaded - the state before `initialize()` resolves. */
const no_descriptions: GiftDescription[] = []

beforeEach(() => {
  // `gift_is_affinity` carries the original's leftover `console.log`. Silenced
  // rather than asserted: it is noise, not a rule, and pinning it here would
  // make removing it look like a regression.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('get_cost_table', () => {
  it('is cumulative, one entry per level, up to MAX_TRAIT_LEVEL', () => {
    expect(MAX_TRAIT_LEVEL).toBe(20)

    const table = get_cost_table(1)
    // The off-by-eleven this replaced: nine entries for a twenty-level trait.
    expect(table).toHaveLength(MAX_TRAIT_LEVEL)
    expect(table).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ])
  })

  it('scales every entry by the cost per entry', () => {
    expect(get_cost_table(2)).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40,
    ])
    expect(get_cost_table(3)[2]).toBe(9)
  })
})

describe('get_cost_on_table', () => {
  const table = get_cost_table(1)

  it('sums every level up to the value', () => {
    expect(get_cost_on_table(table, 1)).toBe(1)
    expect(get_cost_on_table(table, 5)).toBe(15) // 1+2+3+4+5
    expect(get_cost_on_table(table, MAX_TRAIT_LEVEL)).toBe(210) // 1..20
  })

  it('costs nothing at value 0', () => {
    expect(get_cost_on_table(table, 0)).toBe(0)
  })

  it('returns undefined past MAX_TRAIT_LEVEL rather than the whole table', () => {
    // The point of the guard: `_.take` would silently return all 20 entries and
    // 210 would read as a correct total. An unusable number is refused out loud
    // by Character.update_trait instead.
    expect(get_cost_on_table(table, MAX_TRAIT_LEVEL + 1)).toBeUndefined()
    expect(get_cost_on_table(table, 99)).toBeUndefined()
  })

  it('charges one table entry for a trait with no value at all', () => {
    // lodash 3's `_.take(list, undefined)` takes ONE element, not none. Not a
    // rule anyone wrote down - it is what the original did, and lodash 4 would
    // silently return 0 here instead.
    expect(get_cost_on_table(get_cost_table(2), undefined)).toBe(2)
  })

  it('counts a NaN table entry as zero, the way lodash 3 summed', () => {
    // `arraySum` is `result += +entry || 0`, so NaN contributes 0 rather than
    // poisoning the total. Measured against the vendored lodash 3.10, and the
    // reason `get_cost_table(NaN)` prices a trait at nothing rather than
    // refusing it - see the "silently free" test below.
    expect(get_cost_on_table(get_cost_table(Number.NaN), 5)).toBe(0)
    expect(get_cost_on_table([1, Number.NaN, 3], 3)).toBe(4)
  })
})

describe('get_trait_cost_on_table', () => {
  it('subtracts the levels granted free at creation', () => {
    const table = get_cost_table(2)
    // value 4 -> 2+4+6+8 = 20; free_value 1 -> 2; net 18.
    expect(get_trait_cost_on_table(table, fake_trait({ value: 4, free_value: 1 }))).toBe(18)
  })

  it('treats an absent free_value as none', () => {
    expect(get_trait_cost_on_table(get_cost_table(1), fake_trait({ value: 3 }))).toBe(6)
  })

  it('refuses rather than under-charging when the table is overrun', () => {
    // The original produced NaN here, because `undefined - number` is NaN; the
    // port returns `undefined`, which `_.isFinite` refuses identically. What
    // must never happen either way is a 0.
    const cost = get_trait_cost_on_table(get_cost_table(1), fake_trait({ value: 21 }))
    expect(cost).toBeUndefined()
    expect(cost).not.toBe(0)
    expect(Number.isFinite(cost as unknown as number)).toBe(false)
  })
})

describe('calculate_trait_cost - category branches', () => {
  it('prices attributes at 3 per level above the free ones', () => {
    const trait = fake_trait({ category: 'attributes', value: 5, free_value: 2 })
    expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBe(9)
  })

  it('prices merits at 1 and flaws at -1 per level', () => {
    expect(
      calculate_trait_cost(nobody, fake_trait({ category: 'wta_merits', value: 3 }), no_descriptions),
    ).toBe(3)
    expect(
      calculate_trait_cost(nobody, fake_trait({ category: 'wta_flaws', value: 2 }), no_descriptions),
    ).toBe(-2)
  })

  it('prices backgrounds on the 2-per-entry table', () => {
    const trait = fake_trait({ category: 'wta_backgrounds', value: 4, free_value: 1 })
    expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBe(18)
  })

  it('prices rites at 2 per level - they are not free', () => {
    // The measured bug: with no branch at all this returned `undefined`,
    // `update_trait`'s guard zeroed it, and every Rite was free.
    const trait = fake_trait({ category: 'wta_rites', value: 3 })
    expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBe(6)
    expect(FREE_CATEGORIES).not.toContain('wta_rites')
  })

  it('doubles skill costs at Rank 3 and above', () => {
    const trait = fake_trait({ category: 'skills', value: 3 })
    // Rank 0-2: the 1-per-entry table, 1+2+3.
    expect(calculate_trait_cost(fake_character({}, 0), trait, no_descriptions)).toBe(6)
    expect(calculate_trait_cost(fake_character({}, 2), trait, no_descriptions)).toBe(6)
    // Rank 3+: the 2-per-entry table, 2+4+6.
    expect(calculate_trait_cost(fake_character({}, 3), trait, no_descriptions)).toBe(12)
    expect(calculate_trait_cost(fake_character({}, 5), trait, no_descriptions)).toBe(12)
  })
})

describe('calculate_trait_cost - free versus unknown', () => {
  it('returns 0 for a category on the FREE_CATEGORIES allowlist', () => {
    for (const category of ['wta_monikers', 'health_levels', 'extra_affinity_links']) {
      expect(FREE_CATEGORIES).toContain(category)
      const trait = fake_trait({ category, value: 3 })
      expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBe(0)
    }
  })

  it('returns undefined - NOT 0 - for a category with no rule', () => {
    // This is the distinction the whole engine exists to preserve. A category
    // nobody wrote a rule for is a gap, and `Character.update_trait` refuses it
    // out loud; zeroing it here would make the category free for everyone.
    const trait = fake_trait({ category: 'wta_not_a_real_category', value: 3 })
    const cost = calculate_trait_cost(nobody, trait, no_descriptions)

    expect(cost).toBeUndefined()
    expect(cost).not.toBe(0)
    // The exact test `Character.update_trait` applies (Character.js:213).
    expect(Number.isFinite(cost as unknown as number)).toBe(false)
  })

  it('refuses a level past the top of the table instead of under-charging', () => {
    // The off-by-eleven's real consequence: with a nine-entry table this would
    // have quietly charged what level 9 cost.
    const trait = fake_trait({ category: 'wta_backgrounds', value: MAX_TRAIT_LEVEL + 1 })
    expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBeUndefined()
  })

  it('does not price a trait with no value as free', () => {
    // NaN, not 0: `update_trait` refuses it. A `?? 0` anywhere in the engine
    // would turn this into a free trait.
    const trait = fake_trait({ category: 'attributes' })
    const cost = calculate_trait_cost(nobody, trait, no_descriptions)
    expect(cost).not.toBe(0)
    expect(Number.isFinite(cost as number)).toBe(false)
  })

  it('returns undefined for a trait with no category at all', () => {
    expect(calculate_trait_cost(nobody, fake_trait({ value: 3 }), no_descriptions)).toBeUndefined()
  })
})

describe('calculate_trait_cost - the flat/linear override', () => {
  it('outranks the category branch', () => {
    // Same trait as the attributes test above, which would be 3 x 3 = 9.
    const trait = fake_trait({
      category: 'attributes',
      value: 5,
      free_value: 2,
      experience_cost_type: 'flat',
      experience_cost_modifier: 7,
    })
    expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBe(21)
  })

  it('outranks the FREE_CATEGORIES allowlist too', () => {
    const trait = fake_trait({
      category: 'wta_monikers',
      value: 2,
      experience_cost_type: 'linear',
      experience_cost_modifier: 2,
    })
    // The 2-per-entry table at value 2: 2+4.
    expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBe(6)
  })

  it('builds the linear table from the modifier', () => {
    const trait = fake_trait({
      category: 'wta_flaws',
      value: 2,
      experience_cost_type: 'linear',
      experience_cost_modifier: 3,
    })
    // 3+6, not the flaws branch's -2.
    expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBe(9)
  })

  it('parses a string modifier the way _.parseInt did', () => {
    const trait = fake_trait({
      category: 'wta_merits',
      value: 4,
      experience_cost_type: 'flat',
      experience_cost_modifier: '5',
    })
    expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBe(20)
  })

  it('yields a non-finite cost when a flat modifier is missing', () => {
    const trait = fake_trait({
      category: 'wta_merits',
      value: 4,
      experience_cost_type: 'flat',
    })
    const cost = calculate_trait_cost(nobody, trait, no_descriptions)
    expect(Number.isFinite(cost as number)).toBe(false)
    expect(cost).not.toBe(0)
  })

  it('prices a linear trait with an unparseable modifier at NOTHING', () => {
    // A live bug in the rules, pinned here so it is not mistaken for a port
    // defect and not "fixed" without an owner decision. `_.parseInt` gives NaN,
    // `get_cost_table(NaN)` is twenty NaNs, and lodash 3's sum counts each NaN
    // as 0 -- so the trait costs 0, passes `_.isFinite`, and saves. This is the
    // one path where a missing rule does NOT become a refusal.
    const trait = fake_trait({
      category: 'wta_merits',
      value: 4,
      experience_cost_type: 'linear',
    })
    expect(calculate_trait_cost(nobody, trait, no_descriptions)).toBe(0)
  })
})

describe('get_affinities', () => {
  it('collects tribe, auspice, breed and every extra affinity link', () => {
    const character = fake_character({
      wta_tribe: 'Black Furies',
      wta_auspice: 'Ragabash',
      wta_breed: 'Homid',
      extra_affinity_links: [
        fake_description({ name: 'Bone Gnawers' }),
        fake_description({ name: 'Glass Walkers' }),
      ],
    })
    expect(get_affinities(character)).toEqual([
      'Black Furies',
      'Ragabash',
      'Homid',
      'Bone Gnawers',
      'Glass Walkers',
    ])
  })

  it('drops the columns a character has not set', () => {
    const character = fake_character({ wta_breed: 'Lupus' })
    expect(get_affinities(character)).toEqual(['Lupus'])
  })
})

describe('gift_is_affinity', () => {
  const descriptions = [
    fake_description({
      name: 'Heightened Senses',
      affinity_1: 'Homid',
      // A blank column is not an affinity: the original mapped falsy values to
      // `undefined` and then dropped them.
      affinity_2: '',
      affinity_3: 'Bone Gnawers',
    }),
  ]
  const homid = fake_character({ wta_breed: 'Homid' })
  const lupus = fake_character({ wta_breed: 'Lupus' })

  it('matches on the base name, ignoring the specialization', () => {
    const trait = fake_trait({ category: 'wta_gifts', name: 'Heightened Senses: Smell', value: 1 })
    expect(gift_is_affinity(homid, trait, descriptions)).toBe(true)
  })

  it('uses the trait mixin get_base_name when the trait has one', () => {
    const attrs: Attrs = {
      category: 'wta_gifts',
      // Deliberately a name the fallback split could not resolve, so this test
      // fails if the mixin method stops being preferred.
      name: 'nonsense',
      value: 1,
    }
    const trait = {
      get: (attr: string) => attrs[attr],
      get_base_name: () => 'Heightened Senses',
    } as unknown as CostTrait
    expect(gift_is_affinity(homid, trait, descriptions)).toBe(true)
  })

  it('is false when no affinity overlaps', () => {
    const trait = fake_trait({ category: 'wta_gifts', name: 'Heightened Senses', value: 1 })
    expect(gift_is_affinity(lupus, trait, descriptions)).toBe(false)
  })

  it('is false when the gift has no description', () => {
    const trait = fake_trait({ category: 'wta_gifts', name: 'Not A Gift', value: 1 })
    expect(gift_is_affinity(homid, trait, descriptions)).toBe(false)
  })

  it('never matches a blank affinity column', () => {
    // An empty-string breed would intersect `affinity_2` if blanks were kept.
    const blank = fake_character({ wta_breed: '' })
    const trait = fake_trait({ category: 'wta_gifts', name: 'Heightened Senses', value: 1 })
    expect(gift_is_affinity(blank, trait, descriptions)).toBe(false)
  })

  it('prices an affinity gift at 4 per level and any other at 6', () => {
    const trait = fake_trait({ category: 'wta_gifts', name: 'Heightened Senses', value: 2 })
    expect(calculate_trait_cost(homid, trait, descriptions)).toBe(8)
    expect(calculate_trait_cost(lupus, trait, descriptions)).toBe(12)
  })

  it('prices every gift as non-affinity before the descriptions load', () => {
    // The race both apps have: `initialize()` has not resolved, so the affinity
    // lookup finds nothing and an affinity gift over-charges by 2 per level.
    const trait = fake_trait({ category: 'wta_gifts', name: 'Heightened Senses', value: 2 })
    expect(calculate_trait_cost(homid, trait, no_descriptions)).toBe(12)
  })
})
