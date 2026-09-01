/**
 * Tests for the shared cost engine utilities.
 *
 * Run with: npx vitest run packages/venues/tests
 */
import { describe, it, expect } from 'vitest'
import {
  costTable,
  costOnTable,
  traitCostOnTable,
  maxTraitValue,
  calculateTraitToSpend,
  sumTraitValues,
  MAX_TRAIT_LEVEL,
} from '../src/costs'

describe('costTable', () => {
  it('creates a 20-entry cumulative table', () => {
    const table = costTable(3)
    expect(table).toHaveLength(MAX_TRAIT_LEVEL)
    expect(table[0]).toBe(3)   // 1 * 3
    expect(table[1]).toBe(6)   // 2 * 3
    expect(table[4]).toBe(15)  // 5 * 3
    expect(table[19]).toBe(60) // 20 * 3
  })

  it('entries are cumulative (i * costPerEntry)', () => {
    const table = costTable(1)
    for (let i = 0; i < MAX_TRAIT_LEVEL; i++) {
      expect(table[i]).toBe(i + 1)
    }
  })
})

describe('costOnTable', () => {
  it('sums entries up to value', () => {
    const table = costTable(3) // [3, 6, 9, 12, 15, ...]
    expect(costOnTable(table, 1)).toBe(3)    // first entry
    expect(costOnTable(table, 2)).toBe(9)    // 3 + 6
    expect(costOnTable(table, 3)).toBe(18)   // 3 + 6 + 9
    expect(costOnTable(table, 0)).toBe(0)    // nothing
  })

  it('treats undefined/null as 1', () => {
    const table = costTable(3)
    expect(costOnTable(table, undefined as unknown as number)).toBe(3)
    expect(costOnTable(table, null as unknown as number)).toBe(3)
  })

  it('returns undefined when value exceeds table length', () => {
    const table = costTable(3)
    expect(costOnTable(table, 21)).toBeUndefined()
    expect(costOnTable(table, 100)).toBeUndefined()
  })

  it('clamps negative values to 0', () => {
    const table = costTable(3)
    expect(costOnTable(table, -5)).toBe(0)
  })
})

describe('traitCostOnTable', () => {
  const mockTrait = (value: number, freeValue: number) =>
    ({
      get: (attr: string) => {
        if (attr === 'value') return value
        if (attr === 'free_value') return freeValue
        return undefined
      },
      get_base_name: () => 'Test',
    } as any)

  it('returns total_cost - free_cost', () => {
    const table = costTable(3) // [3, 6, 9, 12, 15, ...]
    const trait = mockTrait(3, 1) // value=3 (cost 18), free=1 (cost 3)
    expect(traitCostOnTable(table, trait)).toBe(15) // 18 - 3
  })

  it('returns undefined when total cost is off table', () => {
    const table = costTable(3)
    const trait = mockTrait(21, 0) // value exceeds table
    expect(traitCostOnTable(table, trait)).toBeUndefined()
  })

  it('handles zero free value', () => {
    const table = costTable(3)
    const trait = mockTrait(2, 0)
    expect(traitCostOnTable(table, trait)).toBe(9) // 3 + 6
  })
})

describe('maxTraitValue', () => {
  const mockTrait = (category: string) =>
    ({
      get: (attr: string) => (attr === 'category' ? category : undefined),
      get_base_name: () => 'Test',
    } as any)

  it('caps skills at 10', () => {
    expect(maxTraitValue(mockTrait('skills'))).toBe(10)
  })

  it('caps everything else at 20', () => {
    expect(maxTraitValue(mockTrait('disciplines'))).toBe(20)
    expect(maxTraitValue(mockTrait('attributes'))).toBe(20)
    expect(maxTraitValue(mockTrait('merits'))).toBe(20)
  })
})

describe('calculateTraitToSpend', () => {
  const mockTrait = (cost: number | undefined) =>
    ({
      get: (attr: string) => (attr === 'cost' ? cost : undefined),
      get_base_name: () => 'Test',
    } as any)

  it('returns newCost - oldCost', () => {
    const trait = mockTrait(10)
    expect(calculateTraitToSpend(20, trait)).toBe(10)
  })

  it('treats undefined cost as 0', () => {
    const trait = mockTrait(undefined)
    expect(calculateTraitToSpend(20, trait)).toBe(20)
  })

  it('returns undefined when newCost is undefined', () => {
    const trait = mockTrait(10)
    expect(calculateTraitToSpend(undefined, trait)).toBeUndefined()
  })
})

describe('sumTraitValues', () => {
  it('sums value attributes from an array', () => {
    const picks = [
      { get: (attr: string) => (attr === 'value' ? 3 : undefined) },
      { get: (attr: string) => (attr === 'value' ? 5 : undefined) },
      { get: (attr: string) => (attr === 'value' ? 2 : undefined) },
    ]
    expect(sumTraitValues(picks)).toBe(10)
  })

  it('returns 0 for non-arrays', () => {
    expect(sumTraitValues(null)).toBe(0)
    expect(sumTraitValues(undefined)).toBe(0)
    expect(sumTraitValues('not an array')).toBe(0)
  })

  it('treats NaN/non-numeric values as 0 (lodash 3 arraySum)', () => {
    const picks = [
      { get: (attr: string) => (attr === 'value' ? 3 : undefined) },
      { get: (attr: string) => (attr === 'value' ? 'not a number' : undefined) },
      { get: (attr: string) => (attr === 'value' ? null : undefined) },
    ]
    expect(sumTraitValues(picks)).toBe(3) // 3 + 0 + 0
  })
})
