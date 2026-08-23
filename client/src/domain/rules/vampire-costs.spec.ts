/**
 * Regression pins for the vampire cost engine.
 *
 * Every number in here is derived from
 * `public/scripts/app/helpers/BNSMETV1_VampireCosts.js`, not from what the rules
 * "ought" to be -- the point of the suite is to catch a change in behaviour
 * during the port, including changes that would look like improvements.
 *
 * The two shapes worth stating outright, because both have already cost this
 * project real data:
 *
 *   - A cost table covers all 20 levels. It used to be `_.range(1, 10)`, and
 *     `_.take` past the end of an array returns the whole array, so levels 10-20
 *     were all charged what level 9 cost.
 *   - An unknown category returns `undefined`, never 0. `wta_rites` and
 *     `ctdbs_backgrounds` were silently free because a missing branch fell
 *     through to a zero.
 */
import { describe, expect, it } from 'vitest'

import {
  FREE_CATEGORIES,
  MAX_TRAIT_LEVEL,
  calculate_trait_cost,
  clan_rule_disciplines,
  createVampireCosts,
  discipline_is_in_clan,
  get_cost_on_table,
  get_cost_table,
  get_generation_cost_table,
  get_in_clan_disciplines,
  get_trait_cost_on_table,
  is_free_category,
  type ClanRuleRecord,
  type ClanRules,
  type CostCharacter,
  type CostTrait,
} from '@/domain/rules/BNSMETV1_VampireCosts'

/*
 * Test doubles rather than `Parse.Object`s: the engine takes structural
 * interfaces, so nothing here needs an initialised SDK or a server. `get` is
 * typed `any` for the same reason the real `Parse.Object.get` is.
 */

interface TraitAttributes {
  name?: string
  category?: string
  value?: number
  free_value?: number
}

function trait(attributes: TraitAttributes): CostTrait {
  return {
    get(attribute: string): any {
      return (attributes as Record<string, unknown>)[attribute]
    },
    // SimpleTraitMixin.get_base_name: everything before the ": " specialization
    // separator, and "" when the trait has no name at all.
    get_base_name(): string {
      const name = attributes.name || ''
      return name.split(': ')[0] ?? ''
    },
  }
}

function character(options: {
  clan?: string
  generation?: number
  extra_in_clan_disciplines?: string[]
}): CostCharacter {
  const extras = (options.extra_in_clan_disciplines ?? []).map((name) => ({
    get: (): any => name,
  }))
  return {
    get(attribute: string): any {
      if (attribute === 'clan') return options.clan
      if (attribute === 'extra_in_clan_disciplines') return extras
      return undefined
    },
    // Vampire.generation() is `_raw_generation() || 1`.
    generation: () => options.generation || 1,
  }
}

function clanRule(
  clan: string | undefined,
  discipline_1?: string,
  discipline_2?: string,
  discipline_3?: string,
): ClanRuleRecord {
  const row: Record<string, string | undefined> = {
    clan,
    discipline_1,
    discipline_2,
    discipline_3,
  }
  return { get: (attribute: string): any => row[attribute] }
}

const CLAN_RULES: ClanRules = [
  clanRule('Brujah', 'Celerity', 'Potence', 'Presence'),
  clanRule('Caitiff'), // a real shape: a row with no disciplines filled in
]

const BRUJAH = character({ clan: 'Brujah', generation: 4 })

describe('cost tables', () => {
  it('covers every level a slider can select', () => {
    // The off-by-eleven pin: 20 entries, not 9.
    expect(MAX_TRAIT_LEVEL).toBe(20)
    expect(get_cost_table(2)).toHaveLength(20)
    expect(get_cost_table(1)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ])
    expect(get_cost_table(3).slice(0, 4)).toEqual([3, 6, 9, 12])
    expect(get_cost_table(5)[19]).toBe(100)
  })

  it('charges the running total of every level up to the value', () => {
    // The table holds per-level prices; the cost is their sum, so the shape is
    // cumulative and quadratic, not linear.
    const ct = get_cost_table(3)
    expect(get_cost_on_table(ct, 1)).toBe(3)
    expect(get_cost_on_table(ct, 2)).toBe(9)
    expect(get_cost_on_table(ct, 3)).toBe(18)
    expect(get_cost_on_table(ct, 5)).toBe(45)
    // 3 * (1 + 2 + … + 20)
    expect(get_cost_on_table(ct, MAX_TRAIT_LEVEL)).toBe(630)
  })

  it('costs nothing at level 0', () => {
    expect(get_cost_on_table(get_cost_table(4), 0)).toBe(0)
  })

  it('returns undefined past MAX_TRAIT_LEVEL rather than plateauing', () => {
    const ct = get_cost_table(2)
    expect(get_cost_on_table(ct, MAX_TRAIT_LEVEL)).toBe(420)
    expect(get_cost_on_table(ct, MAX_TRAIT_LEVEL + 1)).toBeUndefined()
    expect(get_cost_on_table(ct, 99)).toBeUndefined()
  })

  it('charges the first level for an unset value, as lodash 3 did', () => {
    // `_.take(ct, undefined)` defaults n to 1, not 0. Preserved deliberately --
    // see the note on get_cost_on_table.
    expect(get_cost_on_table(get_cost_table(7), undefined)).toBe(7)
  })

  it('treats a stored null as unset, not as zero', () => {
    /*
     * A regression pin for a defect an adversarial audit caught in this port.
     *
     * lodash 3's `take` guards with a LOOSE `n == null` (lodash.js:5391), so
     * `null` takes ONE row exactly as `undefined` does. Verified against the
     * vendored copy: `_.chain([3,6,9,12,15]).take(null).sum().value()` is 3.
     *
     * The first version of this port tested `=== undefined`, sending a stored
     * `null` to `Math.max(0, null)` === 0 and pricing the trait at 0. Zero is
     * finite, so `update_trait`'s refusal never fires and the trait saves FREE.
     * That is the `wta_rites` / `ctdbs_backgrounds` defect class exactly. The
     * Werewolf and Changeling engines both handled `null`; only this one did not.
     */
    expect(get_cost_on_table(get_cost_table(7), null)).toBe(7)
    expect(get_cost_on_table(get_cost_table(3), null)).toBe(3)
    // An explicit zero is still genuinely zero rows.
    expect(get_cost_on_table(get_cost_table(7), 0)).toBe(0)
  })

  it('prices generation with a discounted first dot', () => {
    const ct = get_generation_cost_table()
    expect(ct[0]).toBe(1)
    expect(ct[1]).toBe(4)
    expect(ct[19]).toBe(40)
    expect(get_cost_on_table(ct, 1)).toBe(1)
    expect(get_cost_on_table(ct, 2)).toBe(5)
    expect(get_cost_on_table(ct, 3)).toBe(11)
  })
})

describe('get_trait_cost_on_table', () => {
  it('subtracts the free portion', () => {
    const ct = get_cost_table(2)
    expect(get_trait_cost_on_table(ct, trait({ value: 3 }))).toBe(12)
    expect(get_trait_cost_on_table(ct, trait({ value: 3, free_value: 1 }))).toBe(10)
    expect(get_trait_cost_on_table(ct, trait({ value: 3, free_value: 3 }))).toBe(0)
  })

  it('refuses rather than returning a number when the level is off the table', () => {
    // The source produced NaN here (`undefined - 0`); both NaN and undefined
    // fail Character.update_trait's `_.isFinite` guard, and neither is 0.
    const cost = get_trait_cost_on_table(get_cost_table(2), trait({ value: 21 }))
    expect(cost).toBeUndefined()
    expect(cost).not.toBe(0)
  })
})

describe('in-clan disciplines', () => {
  it('reads the matching clan row, holes and all', () => {
    expect(clan_rule_disciplines(BRUJAH, CLAN_RULES)).toEqual([
      'Celerity',
      'Potence',
      'Presence',
    ])
    // A row that leaves slots blank keeps the holes; the old views filtered
    // them with `_.without(…, undefined)` themselves.
    expect(clan_rule_disciplines(character({ clan: 'Caitiff' }), CLAN_RULES)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(clan_rule_disciplines(character({ clan: 'Nosferatu' }), CLAN_RULES)).toEqual([])
  })

  it('adds extra_in_clan_disciplines to the clan list', () => {
    const c = character({ clan: 'Brujah', extra_in_clan_disciplines: ['Auspex'] })
    expect(get_in_clan_disciplines(c, CLAN_RULES)).toEqual([
      'Celerity',
      'Potence',
      'Presence',
      'Auspex',
    ])
    expect(discipline_is_in_clan(c, trait({ name: 'Auspex' }), CLAN_RULES)).toBe(true)
  })

  it('matches a specialized name by its base name', () => {
    expect(
      discipline_is_in_clan(BRUJAH, trait({ name: 'Celerity: Fleetness' }), CLAN_RULES),
    ).toBe(true)
    expect(discipline_is_in_clan(BRUJAH, trait({ name: 'Auspex' }), CLAN_RULES)).toBe(false)
  })
})

describe('calculate_trait_cost', () => {
  it('prices flat-rate categories off the modified value', () => {
    expect(calculate_trait_cost(BRUJAH, trait({ category: 'attributes', value: 4 }), CLAN_RULES)).toBe(12)
    expect(
      calculate_trait_cost(
        BRUJAH,
        trait({ category: 'attributes', value: 4, free_value: 1 }),
        CLAN_RULES,
      ),
    ).toBe(9)
    expect(calculate_trait_cost(BRUJAH, trait({ category: 'humanity', value: 2 }), CLAN_RULES)).toBe(20)
    expect(calculate_trait_cost(BRUJAH, trait({ category: 'paths', value: 2 }), CLAN_RULES)).toBe(20)
    expect(calculate_trait_cost(BRUJAH, trait({ category: 'merits', value: 3 }), CLAN_RULES)).toBe(3)
    // Flaws pay experience back.
    expect(calculate_trait_cost(BRUJAH, trait({ category: 'flaws', value: 2 }), CLAN_RULES)).toBe(-2)
    expect(calculate_trait_cost(BRUJAH, trait({ category: 'rituals', value: 3 }), CLAN_RULES)).toBe(6)
  })

  it('prices in-clan disciplines at 3 per level and out-of-clan by generation', () => {
    const inClan = trait({ category: 'disciplines', name: 'Celerity', value: 3 })
    expect(calculate_trait_cost(BRUJAH, inClan, CLAN_RULES)).toBe(18)

    const oocTrait = trait({ category: 'disciplines', name: 'Auspex', value: 2 })
    // generation < 5 buys at 4 per level, 5+ at 5 per level.
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 4 }), oocTrait, CLAN_RULES)).toBe(12)
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 5 }), oocTrait, CLAN_RULES)).toBe(15)
  })

  it('gives generation 1 the cheaper skill and background tables', () => {
    const skill = trait({ category: 'skills', name: 'Academics', value: 3 })
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 1 }), skill, CLAN_RULES)).toBe(6)
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 4 }), skill, CLAN_RULES)).toBe(12)

    const background = trait({ category: 'backgrounds', name: 'Resources', value: 3 })
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 1 }), background, CLAN_RULES)).toBe(6)
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 4 }), background, CLAN_RULES)).toBe(12)
  })

  it('prices the Generation background off its own table', () => {
    const generation = trait({ category: 'backgrounds', name: 'Generation', value: 3 })
    expect(calculate_trait_cost(BRUJAH, generation, CLAN_RULES)).toBe(11)
  })

  it('prices techniques, elder and luminary disciplines out of reach when unearned', () => {
    const technique = trait({ category: 'techniques', name: 'Bump', value: 1 })
    expect(calculate_trait_cost(character({ generation: 2 }), technique, CLAN_RULES)).toBe(12)
    expect(calculate_trait_cost(character({ generation: 3 }), technique, CLAN_RULES)).toBe(20)
    // The prohibitive default is a rule, not a placeholder: generation 4+ simply
    // cannot afford a technique.
    expect(calculate_trait_cost(character({ generation: 4 }), technique, CLAN_RULES)).toBe(9999)

    const elderInClan = trait({ category: 'elder_disciplines', name: 'Celerity', value: 1 })
    const elderOoc = trait({ category: 'elder_disciplines', name: 'Auspex', value: 1 })
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 3 }), elderInClan, CLAN_RULES)).toBe(18)
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 2 }), elderInClan, CLAN_RULES)).toBe(99999)
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 3 }), elderOoc, CLAN_RULES)).toBe(24)
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 5 }), elderOoc, CLAN_RULES)).toBe(30)
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 2 }), elderOoc, CLAN_RULES)).toBe(99999)

    const luminaryInClan = trait({ category: 'luminary_disciplines', name: 'Celerity', value: 1 })
    const luminaryOoc = trait({ category: 'luminary_disciplines', name: 'Auspex', value: 1 })
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 5 }), luminaryInClan, CLAN_RULES)).toBe(24)
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 4 }), luminaryInClan, CLAN_RULES)).toBe(99999)
    expect(calculate_trait_cost(character({ clan: 'Brujah', generation: 5 }), luminaryOoc, CLAN_RULES)).toBe(99999)
  })

  it('returns 0 for a FREE_CATEGORIES member', () => {
    expect(FREE_CATEGORIES).toContain('status_traits')
    expect(is_free_category('status_traits')).toBe(true)
    for (const category of FREE_CATEGORIES) {
      expect(calculate_trait_cost(BRUJAH, trait({ category, name: 'Whatever', value: 3 }), CLAN_RULES)).toBe(0)
    }
    // Even with no value at all: the free branch returns a literal 0 and must
    // not be turned into a refusal by an early return on the missing value.
    expect(calculate_trait_cost(BRUJAH, trait({ category: 'status_traits' }), CLAN_RULES)).toBe(0)
  })

  it('returns undefined -- not 0 -- for a category with no rule', () => {
    // These two names are not arbitrary. They are the categories that were
    // silently free before the FREE_CATEGORIES allowlist existed, and neither
    // belongs to this venue at all.
    for (const category of ['wta_rites', 'ctdbs_backgrounds', 'not_a_category']) {
      const cost = calculate_trait_cost(BRUJAH, trait({ category, value: 3 }), CLAN_RULES)
      expect(cost).toBeUndefined()
      expect(cost).not.toBe(0)
      // This is the shape Character.update_trait refuses on.
      expect(Number.isFinite(cost as number)).toBe(false)
    }
  })

  it('refuses a level past the top of the table instead of under-charging', () => {
    const cost = calculate_trait_cost(
      BRUJAH,
      trait({ category: 'skills', name: 'Academics', value: MAX_TRAIT_LEVEL + 1 }),
      CLAN_RULES,
    )
    expect(cost).toBeUndefined()
  })

  it('does not price an unset value as free', () => {
    // The source produced NaN here; NaN and undefined are both refused by
    // `_.isFinite`, and neither is 0.
    const cost = calculate_trait_cost(BRUJAH, trait({ category: 'attributes' }), CLAN_RULES)
    expect(Number.isFinite(cost as number)).toBe(false)
    expect(cost).not.toBe(0)
  })
})

describe('createVampireCosts', () => {
  it('reads the clan rules through the accessor on every call', () => {
    // The binding must stay lazy: the rule table is fetched asynchronously at
    // startup, and an engine that captured the array would price every
    // discipline out-of-clan forever.
    let rules: ClanRules = []
    const costs = createVampireCosts(() => rules)
    const celerity = trait({ category: 'disciplines', name: 'Celerity', value: 3 })

    // Before the fetch lands: out-of-clan, so at generation 4 the table is 4
    // per level -- 4 + 8 + 12 for three dots, rather than the in-clan 18.
    expect(costs.calculate_trait_cost(BRUJAH, celerity)).toBe(24)

    rules = CLAN_RULES
    expect(costs.discipline_is_in_clan(BRUJAH, celerity)).toBe(true)
    expect(costs.calculate_trait_cost(BRUJAH, celerity)).toBe(18)
    expect(costs.get_in_clan_disciplines(BRUJAH)).toEqual(['Celerity', 'Potence', 'Presence'])
  })
})
