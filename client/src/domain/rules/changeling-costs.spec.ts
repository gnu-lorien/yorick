/**
 * What a regression in the Changeling cost engine would look like.
 *
 * Every number here is read off `BNSCTDBS_ChangelingCosts.js` -- the table is
 * `i * cost_per_entry` for i in 1..20, and a level's price is the sum of the
 * rows up to it -- and the ones that also appear in the E2E suite are noted, so
 * a disagreement between this file and `e2e/lifecycle-changeling.spec.js` is
 * visible rather than quiet.
 *
 * The three failures this file exists to catch:
 *
 *   1. a cost table that stops short of `MAX_TRAIT_LEVEL`, which is how levels
 *      10-20 were once charged what level 9 cost;
 *   2. an over-long value silently priced off the whole table instead of being
 *      refused;
 *   3. an unpriced category returning `0` instead of `undefined`, which is how
 *      `ctdbs_backgrounds` was free for an unknown length of time.
 */
import { describe, expect, it } from 'vitest'
import {
  FREE_CATEGORIES,
  MAX_TRAIT_LEVEL,
  art_is_affinity,
  calculate_trait_cost,
  get_arts_affinities,
  get_arts_affinities_for_kith,
  get_cost_on_table,
  get_cost_table,
  get_generation_cost_table,
  get_trait_cost_on_table,
  ChangelingBetaSliceCosts,
  type CostCharacter,
  type KithRuleRecord,
  type KithRules,
  type CostTrait,
} from '@/domain/rules/BNSCTDBS_ChangelingCosts'

type Attrs = Record<string, unknown>

/**
 * A stand-in for a `SimpleTrait`.
 *
 * The cast is the whole point of the helper: the engine's interfaces state real
 * attribute types so the compiler can force `undefined` to be handled, and a
 * bag-of-attributes fake cannot express that without one.
 *
 * No `get_base_name` here, so the engine's own fallback split
 * (`SimpleTraitMixin.get_base_name`) is what runs -- which is the shape a bare
 * `Parse.Object` arrives in.
 */
function trait(attrs: Attrs): CostTrait {
  return { get: (attr: string) => attrs[attr] } as unknown as CostTrait
}

/** A stand-in for a `ChangelingBetaSlice`, with its two engine-facing methods. */
function character(
  attrs: Attrs,
  { seeming = 0, realms }: { seeming?: number; realms?: unknown[] } = {},
): CostCharacter {
  return {
    get: (attr: string) => attrs[attr],
    seeming: () => seeming,
    realms: () => realms,
  } as unknown as CostCharacter
}

/** A stand-in for a `bnsctdbs_KithRule` row. */
function kithRule(attrs: Attrs): KithRuleRecord {
  return { get: (attr: string) => attrs[attr] } as unknown as KithRuleRecord
}

/**
 * Two of the seeded kiths. "Clurichaun" and "Sluagh" are the pair
 * `e2e/lifecycle-changeling.spec.js` swaps between when it checks that changing
 * Kith re-prices Arts.
 */
const KITH_RULES: KithRules = [
  kithRule({ name: 'Sluagh', art_1: 'Chicanery', art_2: 'Soothsay', art_3: 'Skycraft' }),
  // A kith with only two Arts: the third column is absent, and `_.without(…,
  // undefined)` dropped it rather than leaving a hole in the list.
  kithRule({ name: 'Clurichaun', art_1: 'Legerdemain', art_2: 'Wayfare' }),
]

describe('get_cost_table', () => {
  it('covers every level a trait can reach', () => {
    // The bug this pins: the table used to be `_.range(1, 10)`, nine entries,
    // while a trait can reach 20.
    expect(get_cost_table(2)).toHaveLength(MAX_TRAIT_LEVEL)
    expect(MAX_TRAIT_LEVEL).toBe(20)
  })

  it('is one row per level, each row costing level x rate', () => {
    expect(get_cost_table(2).slice(0, 5)).toEqual([2, 4, 6, 8, 10])
    expect(get_cost_table(4).slice(0, 5)).toEqual([4, 8, 12, 16, 20])
    expect(get_cost_table(6).slice(0, 5)).toEqual([6, 12, 18, 24, 30])
    expect(get_cost_table(8).slice(0, 5)).toEqual([8, 16, 24, 32, 40])
    // Last row, not a plateau: level 20 on the 2-table costs 40, not what level
    // 9 costs.
    expect(get_cost_table(2)[MAX_TRAIT_LEVEL - 1]).toBe(40)
  })
})

describe('get_cost_on_table', () => {
  const ct = get_cost_table(2)

  it('accumulates the rows up to the value', () => {
    expect(get_cost_on_table(ct, 0)).toBe(0)
    // Both of these are asserted by the E2E suite as BACKGROUND_AT_1 and
    // BACKGROUND_AT_2.
    expect(get_cost_on_table(ct, 1)).toBe(2)
    expect(get_cost_on_table(ct, 2)).toBe(6)
    expect(get_cost_on_table(ct, 3)).toBe(12)
    // 2 * (1+2+…+20)
    expect(get_cost_on_table(ct, MAX_TRAIT_LEVEL)).toBe(420)
  })

  it('refuses a value past the end of the table instead of capping it', () => {
    expect(get_cost_on_table(ct, MAX_TRAIT_LEVEL)).toBe(420)
    expect(get_cost_on_table(ct, MAX_TRAIT_LEVEL + 1)).toBeUndefined()
    expect(get_cost_on_table(ct, 100)).toBeUndefined()
    // Explicitly not the old `_.take` behaviour, which returned the whole table
    // and read as a correct total.
    expect(get_cost_on_table(ct, 21)).not.toBe(420)
  })

  it('takes one row for a missing value, the way lodash 3 take did', () => {
    // Not zero. A trait with no `value` attribute is charged the first row.
    // `_.take`'s guard is a loose `n == null`, so a stored null behaves the same
    // -- measured against the vendored lodash 3.10.0, not assumed.
    expect(get_cost_on_table(ct, undefined)).toBe(2)
    expect(get_cost_on_table(ct, null)).toBe(2)
  })
})

describe('get_trait_cost_on_table', () => {
  const ct = get_cost_table(2)

  it('charges the value net of the free levels', () => {
    expect(get_trait_cost_on_table(ct, trait({ value: 3, free_value: 1 }))).toBe(12 - 2)
    expect(get_trait_cost_on_table(ct, trait({ value: 3, free_value: 3 }))).toBe(0)
  })

  it('treats a missing free_value as none granted', () => {
    expect(get_trait_cost_on_table(ct, trait({ value: 2 }))).toBe(6)
    expect(get_trait_cost_on_table(ct, trait({ value: 2, free_value: 0 }))).toBe(6)
  })

  it('is undefined when either lookup runs off the table', () => {
    expect(get_trait_cost_on_table(ct, trait({ value: 21, free_value: 1 }))).toBeUndefined()
  })
})

describe('get_generation_cost_table', () => {
  it('discounts only the first level', () => {
    const ct = get_generation_cost_table()
    expect(ct[0]).toBe(1)
    expect(ct.slice(1, 4)).toEqual([4, 6, 8])
    expect(ct).toHaveLength(MAX_TRAIT_LEVEL)
  })
})

describe('arts affinities', () => {
  it('reads the affinity arts off the kith rule', () => {
    expect(get_arts_affinities_for_kith(KITH_RULES, 'Sluagh')).toEqual([
      'Chicanery',
      'Soothsay',
      'Skycraft',
    ])
  })

  it('drops an absent third art rather than leaving a hole', () => {
    expect(get_arts_affinities_for_kith(KITH_RULES, 'Clurichaun')).toEqual([
      'Legerdemain',
      'Wayfare',
    ])
  })

  it('is empty for a kith with no rule, and for no kith at all', () => {
    expect(get_arts_affinities_for_kith(KITH_RULES, 'Nocker')).toEqual([])
    expect(get_arts_affinities_for_kith(KITH_RULES, undefined)).toEqual([])
  })

  it('adds the arts recorded as affinity links', () => {
    const c = character({
      ctdbs_kith: 'Clurichaun',
      ctdbs_arts_affinities_links: [trait({ name: 'Primal' })],
    })
    expect(get_arts_affinities(KITH_RULES, c)).toEqual(['Legerdemain', 'Wayfare', 'Primal'])
  })

  it('survives a character with no links array', () => {
    const c = character({ ctdbs_kith: 'Clurichaun' })
    expect(get_arts_affinities(KITH_RULES, c)).toEqual(['Legerdemain', 'Wayfare'])
  })

  it('matches an affinity against a specialized art name', () => {
    const c = character({ ctdbs_kith: 'Sluagh' })
    expect(art_is_affinity(KITH_RULES, c, trait({ name: 'Soothsay' }))).toBe(true)
    expect(art_is_affinity(KITH_RULES, c, trait({ name: 'Soothsay: Omens' }))).toBe(true)
    expect(art_is_affinity(KITH_RULES, c, trait({ name: 'Primal' }))).toBe(false)
  })

  it('prefers a trait that carries its own get_base_name', () => {
    // The SimpleTrait port owns the mixin; when it is there it is used, and when
    // it is not the fallback split above produces the same answer.
    const c = character({ ctdbs_kith: 'Sluagh' })
    const withMixin = {
      get: (attr: string) => (attr === 'name' ? 'Soothsay: Omens' : undefined),
      get_base_name: () => 'Soothsay',
    } as unknown as CostTrait
    expect(art_is_affinity(KITH_RULES, c, withMixin)).toBe(true)
  })
})

describe('calculate_trait_cost', () => {
  const c = character({ ctdbs_kith: 'Sluagh' })

  it('prices attributes at 3 per level bought', () => {
    // ATTRIBUTE_PER_POINT in the E2E suite.
    expect(
      calculate_trait_cost(KITH_RULES, c, trait({ category: 'attributes', value: 5, free_value: 2 })),
    ).toBe(9)
  })

  it('prices an affinity art at 4 per level and any other at 6', () => {
    // AFFINITY_ART_AT_1 and NON_AFFINITY_ART_AT_1 in the E2E suite.
    const affinity = trait({ category: 'ctdbs_arts', name: 'Soothsay', value: 1 })
    const other = trait({ category: 'ctdbs_arts', name: 'Primal', value: 1 })
    expect(calculate_trait_cost(KITH_RULES, c, affinity)).toBe(4)
    expect(calculate_trait_cost(KITH_RULES, c, other)).toBe(6)
    // Cumulative, so level 2 is 4+8 and 6+12.
    expect(
      calculate_trait_cost(KITH_RULES, c, trait({ category: 'ctdbs_arts', name: 'Soothsay', value: 2 })),
    ).toBe(12)
    expect(
      calculate_trait_cost(KITH_RULES, c, trait({ category: 'ctdbs_arts', name: 'Primal', value: 2 })),
    ).toBe(18)
  })

  it('prices merits at face value and flaws at its negative', () => {
    expect(
      calculate_trait_cost(KITH_RULES, c, trait({ category: 'ctdbs_merits', value: 3, free_value: 1 })),
    ).toBe(2)
    expect(calculate_trait_cost(KITH_RULES, c, trait({ category: 'ctdbs_flaws', value: 2 }))).toBe(-2)
  })

  it('prices BOTH background spellings on the same 2-per-level table', () => {
    /*
     * The regression this test exists for: `ctdbs_backgrounds` is the category
     * Changelings actually buy Backgrounds in, it had no branch, and so every
     * purchase fell through to the old `return 0` and cost nothing. Both
     * spellings must price, and must price identically.
     */
    for (const category of ['backgrounds', 'ctdbs_backgrounds']) {
      expect(calculate_trait_cost(KITH_RULES, c, trait({ category, value: 1 }))).toBe(2)
      expect(calculate_trait_cost(KITH_RULES, c, trait({ category, value: 2 }))).toBe(6)
      expect(calculate_trait_cost(KITH_RULES, c, trait({ category, value: 1 }))).not.toBe(0)
    }
  })

  it('prices skills at 1 per level below Seeming 3 and 2 per level at or above it', () => {
    const t = trait({ category: 'skills', value: 3 })
    const low = character({ ctdbs_kith: 'Sluagh' }, { seeming: 2 })
    const high = character({ ctdbs_kith: 'Sluagh' }, { seeming: 3 })
    expect(calculate_trait_cost(KITH_RULES, low, t)).toBe(6)
    expect(calculate_trait_cost(KITH_RULES, high, t)).toBe(12)
  })

  it('prices realms by how many the character owns, not by the trait value', () => {
    /*
     * Recorded, not endorsed. The branch reads the 8-per-level table at the
     * COUNT of `ctdbs_realms`, so the trait being bought contributes nothing to
     * its own price, and `Character.update_trait` adds the new trait only after
     * asking -- so the first Realm is read at count 0 and is free.
     */
    const t = trait({ category: 'ctdbs_realms', value: 5 })
    expect(calculate_trait_cost(KITH_RULES, character({}, { realms: [] }), t)).toBe(0)
    expect(calculate_trait_cost(KITH_RULES, character({}, { realms: [trait({})] }), t)).toBe(8)
    expect(
      calculate_trait_cost(KITH_RULES, character({}, { realms: [trait({}), trait({})] }), t),
    ).toBe(24)
    // The trait's own value changes nothing on this path.
    expect(
      calculate_trait_cost(
        KITH_RULES,
        character({}, { realms: [trait({})] }),
        trait({ category: 'ctdbs_realms', value: 1 }),
      ),
    ).toBe(8)
  })

  it('returns 0 for a category that is genuinely free', () => {
    for (const category of FREE_CATEGORIES) {
      expect(calculate_trait_cost(KITH_RULES, c, trait({ category, value: 3 }))).toBe(0)
    }
    // Named explicitly so the list cannot shrink to nothing and still pass.
    expect(FREE_CATEGORIES).toContain('health_levels')
    expect(FREE_CATEGORIES).toContain('ctdbs_arts_affinities_links')
    expect(FREE_CATEGORIES).toContain('ctdbs_holdings_specializations')
  })

  it('returns undefined -- NOT 0 -- for a category with no rule', () => {
    /*
     * The whole point of the protocol. `Character.update_trait` checks
     * `_.isFinite(cost)` and refuses the save out loud; a 0 here would make the
     * category free and nobody would find out.
     */
    for (const category of ['ctdbs_noble_houses', 'wta_rites', 'disciplines', '', 'nonsense']) {
      const cost = calculate_trait_cost(KITH_RULES, c, trait({ category, value: 3 }))
      expect(cost).toBeUndefined()
      expect(cost).not.toBe(0)
      expect(Number.isFinite(cost)).toBe(false)
    }
  })

  it('refuses a value past the end of the table rather than capping it', () => {
    const cost = calculate_trait_cost(
      KITH_RULES,
      c,
      trait({ category: 'ctdbs_backgrounds', value: MAX_TRAIT_LEVEL + 1 }),
    )
    expect(cost).toBeUndefined()
  })
})

describe('ChangelingBetaSliceCosts', () => {
  it('answers with the kith rules it was built with', () => {
    const costs = new ChangelingBetaSliceCosts(KITH_RULES)
    const c = character({ ctdbs_kith: 'Sluagh' })
    expect(costs.get_arts_affinities_for_kith('Sluagh')).toEqual([
      'Chicanery',
      'Soothsay',
      'Skycraft',
    ])
    expect(costs.art_is_affinity(c, trait({ name: 'Chicanery' }))).toBe(true)
    expect(costs.calculate_trait_cost(c, trait({ category: 'ctdbs_arts', name: 'Chicanery', value: 1 }))).toBe(4)
  })

  it('prices every art as non-affinity when it has no rules', () => {
    // What the source's fetcher handed a second caller that arrived mid-fetch.
    // Recorded so the behaviour of an unloaded engine is not a surprise.
    const costs = new ChangelingBetaSliceCosts()
    const c = character({ ctdbs_kith: 'Sluagh' })
    expect(costs.calculate_trait_cost(c, trait({ category: 'ctdbs_arts', name: 'Chicanery', value: 1 }))).toBe(6)
  })
})
