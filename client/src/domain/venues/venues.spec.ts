/**
 * Regression pins for the three venue strategies.
 *
 * Every number and string here is read off
 * `public/scripts/app/models/{Vampire,Werewolf,ChangelingBetaSlice}.js`, not off
 * what the rules "ought" to be. The creation seeds in particular are the pins
 * that matter most: one wrong counter hands a player free traits or refuses ones
 * they are owed, and nothing downstream would notice.
 *
 * The Kith transaction gets its own section because both of its invariants exist
 * because of a measured failure (R22, R23), and because both are easy to
 * "simplify" back into the bug.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Parse from '@/parse'

import { venueFor, venueForCharacter, ALL_VENUES } from '@/domain/venues'
import { vampireVenue } from '@/domain/venues/vampire'
import { werewolfVenue } from '@/domain/venues/werewolf'
import { changelingVenue } from '@/domain/venues/changeling'
import * as common from '@/domain/venues/common'
import { alwaysOf } from '@/domain/venues/types'
import type { TraitQueue, VenueCharacter, VenueTrait } from '@/domain/venues/types'

/* ------------------------------------------------------------------ fakes */

/** A `SimpleTrait` with the mixin's `get_base_name` -- the name before ": ". */
class FakeTrait extends Parse.Object {
  constructor(attributes: Record<string, unknown>) {
    super('SimpleTrait', attributes as never)
  }
  get_base_name(): string {
    const name = String(this.get('name') ?? '')
    const at = name.indexOf(': ')
    return at === -1 ? name : name.slice(0, at)
  }
}

function trait(attributes: Record<string, unknown>): VenueTrait {
  return new FakeTrait(attributes) as unknown as VenueTrait
}

/**
 * The serialising write queue, implemented the way `Character` must implement
 * it: `always` is `then(cb, cb)` so a rejection cannot WEDGE the chain, and
 * `.finally()` is never used because it re-throws.
 *
 * `always` makes its own result the tail even when that result is rejected --
 * `self._updateTraitWrapper = self._updateTraitWrapper.always(fn)` -- because
 * that is what the source does and what makes `update_text`'s `adopt` of a
 * non-rejecting view necessary rather than decorative.
 */
function makeQueue(): TraitQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    get tail() {
      return tail
    },
    always<T>(work: () => T | PromiseLike<T>): Promise<T> {
      const next = alwaysOf(tail, work)
      tail = next
      return next
    },
    then<T>(work: () => T | PromiseLike<T>): Promise<T> {
      const next = tail.then(work)
      tail = next
      return next
    },
    adopt(p: Promise<unknown>) {
      tail = p
    },
  }
}

interface FakeCharacterLog {
  saves: number
  updated: Array<[string, number, string, number | undefined]>
  unpicked: Array<[string, string | undefined, number]>
  base_update_text: Array<[string, string]>
  base_unpick_text: string[]
  order: string[]
}

/** A stand-in for the `Character` port -- only what the venues actually call. */
function makeCharacter(attributes: Record<string, unknown>): {
  character: VenueCharacter
  log: FakeCharacterLog
} {
  const log: FakeCharacterLog = {
    saves: 0,
    updated: [],
    unpicked: [],
    base_update_text: [],
    base_unpick_text: [],
    order: [],
  }
  const queue = makeQueue()
  const object = new Parse.Object('Vampire', attributes as never)
  const character = object as unknown as Record<string, unknown> as VenueCharacter & {
    [k: string]: unknown
  }

  Object.assign(character, {
    traitQueue: queue,
    progress: () => undefined,
    get_sum_creation_categories: () => [],
    save: () => {
      log.saves++
      log.order.push('save')
      return Promise.resolve(character)
    },
    update_trait: (
      name: string,
      value: number,
      category: string,
      free_value: number | undefined,
    ) =>
      queue.always(() => {
        log.updated.push([name, value, category, free_value])
        log.order.push('update_trait:' + name)
      }),
    unpick_from_creation: (category: string, id: string | undefined, index: number) =>
      queue.always(() => {
        log.unpicked.push([category, id, index])
        log.order.push('unpick:' + category)
      }),
    add_experience_notation: () => Promise.resolve(undefined),
    base_update_text: (target: string, value: string) => {
      log.base_update_text.push([target, value])
      log.order.push('base_update_text')
      return Promise.resolve(character)
    },
    base_unpick_text: (target: string) => {
      log.base_unpick_text.push(target)
      log.order.push('base_unpick_text')
      return Promise.resolve(character)
    },
  })

  return { character: character as VenueCharacter, log }
}

/* --------------------------------------------------------- the data itself */

describe('venue identity', () => {
  it('routes an absent type to Vampire -- the load-bearing trap', () => {
    const { character } = makeCharacter({})
    expect(venueForCharacter(character)).toBe(vampireVenue)
  })

  it('routes null and unrecognised types to Vampire rather than throwing', () => {
    for (const type of [null, '', 'Mummy', 42]) {
      const { character } = makeCharacter({ type })
      expect(venueForCharacter(character)).toBe(vampireVenue)
    }
  })

  it('routes the two types that were written to the column', () => {
    expect(venueForCharacter(makeCharacter({ type: 'Werewolf' }).character)).toBe(werewolfVenue)
    expect(
      venueForCharacter(makeCharacter({ type: 'ChangelingBetaSlice' }).character),
    ).toBe(changelingVenue)
  })

  it('venueFor is total over the three keys', () => {
    expect(venueFor('Vampire')).toBe(vampireVenue)
    expect(venueFor('Werewolf')).toBe(werewolfVenue)
    expect(venueFor('ChangelingBetaSlice')).toBe(changelingVenue)
    expect(ALL_VENUES).toHaveLength(3)
  })

  it('exposes the two source-shaped accessors Character calls', () => {
    // `get_sum_creation_categories` is the source's own method (Vampire.js:62);
    // `creation_pick_categories` is `listCategories` in
    // `fetch_all_creation_elements`. Both must agree with the data constants.
    for (const venue of ALL_VENUES) {
      expect(venue.get_sum_creation_categories()).toEqual(venue.SUM_CREATION_CATEGORIES)
      expect(venue.creation_pick_categories()).toEqual(venue.CREATION_LIST_CATEGORIES)
    }
    expect(werewolfVenue.get_sum_creation_categories()).toEqual(['wta_merits', 'wta_flaws'])
    expect(changelingVenue.get_sum_creation_categories()).toEqual([
      'ctdbs_merits',
      'ctdbs_flaws',
    ])
  })

  it('writes no type column for Vampire, and the exact literal for the others', () => {
    // Vampire rows predate the column. Writing "Vampire" into new rows only
    // would split one creature into two spellings.
    expect(vampireVenue.TYPE_ATTRIBUTE).toBeUndefined()
    expect(werewolfVenue.TYPE_ATTRIBUTE).toBe('Werewolf')
    expect(changelingVenue.TYPE_ATTRIBUTE).toBe('ChangelingBetaSlice')
  })
})

describe('creation pool seeds', () => {
  it('Vampire: skills 4/3/2/1 = 1/2/3/4, backgrounds 3/2/1 = 1/1/1, disciplines 2/1 = 1/2', () => {
    const s = vampireVenue.CREATION_SEED
    expect(s.skills_4_remaining).toBe(1)
    expect(s.skills_3_remaining).toBe(2)
    expect(s.skills_2_remaining).toBe(3)
    expect(s.skills_1_remaining).toBe(4)
    expect(s.backgrounds_3_remaining).toBe(1)
    expect(s.backgrounds_2_remaining).toBe(1)
    expect(s.backgrounds_1_remaining).toBe(1)
    expect(s.disciplines_2_remaining).toBe(1)
    expect(s.disciplines_1_remaining).toBe(2)
    expect(s.attributes_7_remaining).toBe(1)
    expect(s.attributes_5_remaining).toBe(1)
    expect(s.attributes_3_remaining).toBe(1)
    expect(s.focus_mentals_1_remaining).toBe(1)
    expect(s.focus_socials_1_remaining).toBe(1)
    expect(s.focus_physicals_1_remaining).toBe(1)
    expect(s.merits_0_remaining).toBe(7)
    expect(s.flaws_0_remaining).toBe(7)
    expect(s.initial_xp).toBe(30)
  })

  it('Werewolf: wta_backgrounds 3/2/1, wta_gifts_1 = 3, and NO discipline pool', () => {
    const s = werewolfVenue.CREATION_SEED
    expect(s.wta_backgrounds_3_remaining).toBe(1)
    expect(s.wta_backgrounds_2_remaining).toBe(1)
    expect(s.wta_backgrounds_1_remaining).toBe(1)
    expect(s.wta_gifts_1_remaining).toBe(3)
    expect(s.wta_merits_0_remaining).toBe(7)
    expect(s.wta_flaws_0_remaining).toBe(7)
    expect(s.initial_xp).toBe(30)
    expect(s.disciplines_2_remaining).toBeUndefined()
    expect(s.disciplines_1_remaining).toBeUndefined()
  })

  it('Changeling: ctdbs_backgrounds 3/2/1, ctdbs_arts_1 = 3, and NO discipline pool', () => {
    const s = changelingVenue.CREATION_SEED
    expect(s.ctdbs_backgrounds_3_remaining).toBe(1)
    expect(s.ctdbs_backgrounds_2_remaining).toBe(1)
    expect(s.ctdbs_backgrounds_1_remaining).toBe(1)
    expect(s.ctdbs_arts_1_remaining).toBe(3)
    expect(s.ctdbs_merits_0_remaining).toBe(7)
    expect(s.ctdbs_flaws_0_remaining).toBe(7)
    expect(s.initial_xp).toBe(30)
    expect(s.disciplines_1_remaining).toBeUndefined()
  })

  it('every venue seeds the same skills, attributes and focus pools', () => {
    for (const venue of ALL_VENUES) {
      const s = venue.CREATION_SEED
      expect([s.skills_4_remaining, s.skills_3_remaining, s.skills_2_remaining, s.skills_1_remaining])
        .toEqual([1, 2, 3, 4])
      expect([s.attributes_7_remaining, s.attributes_5_remaining, s.attributes_3_remaining])
        .toEqual([1, 1, 1])
      expect(s.completed).toBe(false)
      // `clan: false` is a wizard step flag, carried even by the two venues
      // that have no clans.
      expect(s.clan).toBe(false)
    }
  })
})

describe('starting traits', () => {
  it('Vampire starts with Humanity 5/5 and the common health and Willpower', () => {
    expect(vampireVenue.STARTING_TRAITS).toEqual([
      { name: 'Humanity', value: 5, category: 'paths', free_value: 5 },
      { name: 'Healthy', value: 3, category: 'health_levels', free_value: 3 },
      { name: 'Injured', value: 3, category: 'health_levels', free_value: 3 },
      { name: 'Incapacitated', value: 3, category: 'health_levels', free_value: 3 },
      { name: 'Willpower', value: 6, category: 'willpower_sources', free_value: 6 },
    ])
  })

  it('Werewolf Gnosis is value 10 free_value 6 -- the one pair that differs', () => {
    const gnosis = werewolfVenue.STARTING_TRAITS.find((t) => t.name === 'Gnosis')
    expect(gnosis).toEqual({
      name: 'Gnosis',
      value: 10,
      category: 'wta_gnosis_sources',
      free_value: 6,
    })
  })

  it('Changeling has no venue-specific starting trait', () => {
    expect(changelingVenue.STARTING_TRAITS.map((t) => t.name)).toEqual([
      'Healthy',
      'Injured',
      'Incapacitated',
      'Willpower',
    ])
  })

  it('every venue grants three health levels at 3/3 and Willpower at 6/6', () => {
    for (const venue of ALL_VENUES) {
      const health = venue.STARTING_TRAITS.filter((t) => t.category === 'health_levels')
      expect(health).toHaveLength(3)
      expect(health.every((t) => t.value === 3 && t.free_value === 3)).toBe(true)
      const willpower = venue.STARTING_TRAITS.find((t) => t.category === 'willpower_sources')
      expect(willpower).toMatchObject({ name: 'Willpower', value: 6, free_value: 6 })
    }
  })
})

describe('max_trait_value', () => {
  it('caps skills at 10 and everything else at 20', () => {
    for (const venue of ALL_VENUES) {
      expect(venue.max_trait_value(trait({ category: 'skills' }))).toBe(10)
      expect(venue.max_trait_value(trait({ category: 'attributes' }))).toBe(20)
      expect(venue.max_trait_value(trait({ category: undefined }))).toBe(20)
    }
  })
})

describe('calculate_trait_to_spend', () => {
  it('is new_cost minus the old cost, with an absent old cost meaning zero', () => {
    expect(common.calculate_trait_to_spend(9, trait({ cost: 4 }))).toBe(5)
    expect(common.calculate_trait_to_spend(9, trait({}))).toBe(9)
    expect(common.calculate_trait_to_spend(9, trait({ cost: 0 }))).toBe(9)
  })

  it('refuses rather than zeroing when no cost rule exists', () => {
    // The source produced NaN here (`undefined - 0`); `update_trait` gates on
    // `_.isFinite`, which rejects NaN and undefined alike.
    expect(common.calculate_trait_to_spend(undefined, trait({ cost: 4 }))).toBeUndefined()
  })
})

describe('sum_trait_values -- lodash 3 _.sum, not a reduce', () => {
  it('adds the values of the picks', () => {
    expect(common.sum_trait_values([trait({ value: 3 }), trait({ value: 4 })])).toBe(7)
  })

  it('counts an unfetched or valueless pick as ZERO, not as NaN', () => {
    // lodash 3's arraySum is `result += +entry || 0` (lodash.js:1514). A pointer
    // that was never fetched has no value and simply did not count towards the 7.
    expect(common.sum_trait_values([trait({ value: 3 }), trait({})])).toBe(3)
    expect(common.sum_trait_values([trait({ value: 'nonsense' })])).toBe(0)
    expect(common.sum_trait_values([undefined, null, trait({ value: 2 })])).toBe(2)
  })

  it('treats an unset pool as empty', () => {
    expect(common.sum_trait_values(undefined)).toBe(0)
    expect(common.sum_trait_values(null)).toBe(0)
  })
})

/* --------------------------------------------- the creation-rules bookkeeping */

describe('update_creation_rules_for_changed_trait', () => {
  let creation: Parse.Object

  beforeEach(() => {
    creation = new Parse.Object('VampireCreation', {
      completed: false,
      skills_3_remaining: 2,
      merits_0_remaining: 7,
    } as never)
    vi.spyOn(Parse.Object, 'fetchAllIfNeeded').mockImplementation(
      (list: unknown[]) => Promise.resolve(list) as never,
    )
  })

  function characterWithCreation() {
    return makeCharacter({ creation }).character
  }

  it('short-circuits a non-merit category with no free value', async () => {
    const character = characterWithCreation()
    await vampireVenue.update_creation_rules_for_changed_trait(
      character,
      'skills',
      trait({ name: 'Athletics', value: 3 }),
      0,
    )
    expect(creation.get('skills_3_remaining')).toBe(2)
    expect(creation.get('skills_0_picks')).toBeUndefined()
  })

  it('does NOT short-circuit merits at free value 0 -- merits_0 is a real pool', () => {
    // The merit/flaw test comes before the `!freeValue` test for exactly this
    // reason: `merits_0_remaining` is a pool with a rating of zero.
    expect(vampireVenue.SUM_CREATION_CATEGORIES).toEqual(['merits', 'flaws'])
  })

  it('books a rating pool by decrementing the counter and recording the pick', async () => {
    const character = characterWithCreation()
    const st = trait({ name: 'Athletics', value: 3 })
    await vampireVenue.update_creation_rules_for_changed_trait(character, 'skills', st, 3)
    expect(creation.get('skills_3_remaining')).toBe(1)
    expect(creation.get('skills_3_picks')).toHaveLength(1)
  })

  it('books merits as 7 - sum(values), which is DIFFERENT arithmetic', async () => {
    const character = characterWithCreation()
    await vampireVenue.update_creation_rules_for_changed_trait(
      character,
      'merits',
      trait({ name: 'Ambidextrous', value: 2 }),
      0,
    )
    expect(creation.get('merits_0_remaining')).toBe(5)
    await vampireVenue.update_creation_rules_for_changed_trait(
      character,
      'merits',
      trait({ name: 'Lucky', value: 3 }),
      0,
    )
    // 7 - (2 + 3), not 5 - 1: a merit pool tracks POINTS, a rating pool tracks
    // PICKS.
    expect(creation.get('merits_0_remaining')).toBe(2)
  })

  it('books nothing for a category outside the venue allowlist', async () => {
    const character = characterWithCreation()
    await vampireVenue.update_creation_rules_for_changed_trait(
      character,
      'rituals',
      trait({ name: 'Something', value: 1 }),
      1,
    )
    expect(creation.get('rituals_1_picks')).toBeUndefined()
  })

  it('R22: books nothing once creation is completed', async () => {
    creation.set('completed', true)
    const character = characterWithCreation()
    await changelingVenue.update_creation_rules_for_changed_trait(
      character,
      'ctdbs_arts',
      trait({ name: 'Primal', value: 1 }),
      1,
    )
    // Writing to these after the wizard finished only produced meaningless
    // negatives -- a post-creation Kith change drove ctdbs_arts_1_remaining to
    // -3, which then read as an overspend that never happened.
    expect(creation.get('ctdbs_arts_1_picks')).toBeUndefined()
    expect(creation.get('ctdbs_arts_1_remaining')).toBeUndefined()
  })

  it('uses each venue own column names, not Vampire ones', async () => {
    const character = characterWithCreation()
    await werewolfVenue.update_creation_rules_for_changed_trait(
      character,
      'wta_gifts',
      trait({ name: 'Sense Wyrm', value: 1 }),
      1,
    )
    expect(creation.get('wta_gifts_1_picks')).toHaveLength(1)
    expect(creation.get('wta_gifts_1_remaining')).toBe(-1)
  })
})

/* --------------------------------------------------- the venue price term */

describe('the venue term that shifts prices', () => {
  it('Vampire generation defaults to 1 and reads the Generation background', () => {
    const withGen = makeCharacter({
      backgrounds: [trait({ name: 'Generation', value: 5 })],
    }).character
    expect(vampireVenue.venue_term(withGen)).toBe(5)
    expect(vampireVenue.has_venue_term(withGen)).toBe(true)

    const without = makeCharacter({}).character
    expect(vampireVenue.raw_venue_term(without)).toBeUndefined()
    expect(vampireVenue.venue_term(without)).toBe(1)
    expect(vampireVenue.has_venue_term(without)).toBe(false)
  })

  it('a stored generation of 0 reads as 1 -- `|| 1`, not `?? 1`', () => {
    const zeroed = makeCharacter({
      backgrounds: [trait({ name: 'Generation', value: 0 })],
    }).character
    expect(vampireVenue.raw_venue_term(zeroed)).toBe(0)
    expect(vampireVenue.venue_term(zeroed)).toBe(1)
    // Present, so `has_` is true even though the value reads as the default.
    expect(vampireVenue.has_venue_term(zeroed)).toBe(true)
  })

  it('matches a specialised background by its BASE name', () => {
    const character = makeCharacter({
      backgrounds: [trait({ name: 'Generation: Something', value: 7 })],
    }).character
    expect(vampireVenue.venue_term(character)).toBe(7)
  })

  it('with two matching backgrounds the LAST one wins', () => {
    const character = makeCharacter({
      backgrounds: [trait({ name: 'Generation', value: 4 }), trait({ name: 'Generation', value: 9 })],
    }).character
    expect(vampireVenue.venue_term(character)).toBe(9)
  })

  it('Werewolf rank defaults to 0 and reads wta_backgrounds', () => {
    const character = makeCharacter({
      type: 'Werewolf',
      wta_backgrounds: [trait({ name: 'Rank', value: 3 })],
    }).character
    expect(werewolfVenue.venue_term(character)).toBe(3)
    expect(werewolfVenue.venue_term(makeCharacter({ type: 'Werewolf' }).character)).toBe(0)
    expect(werewolfVenue.has_venue_term(makeCharacter({ type: 'Werewolf' }).character)).toBe(false)
  })

  it('Changeling seeming defaults to 0 and reads ctdbs_backgrounds', () => {
    const character = makeCharacter({
      type: 'ChangelingBetaSlice',
      ctdbs_backgrounds: [trait({ name: 'Seeming', value: 2 })],
    }).character
    expect(changelingVenue.venue_term(character)).toBe(2)
    expect(changelingVenue.venue_term(makeCharacter({}).character)).toBe(0)
  })

  it('reads each venue own backgrounds column and no other', () => {
    // A werewolf's Rank sits in `wta_backgrounds`; Vampire's reader looks at
    // `backgrounds` and must not find it.
    const character = makeCharacter({
      wta_backgrounds: [trait({ name: 'Rank', value: 3 })],
    }).character
    expect(vampireVenue.raw_venue_term(character)).toBeUndefined()
  })
})

/* ---------------------------------------------------------- Vampire only */

describe('Vampire morality', () => {
  it('is Humanity with no Path merit', () => {
    expect(vampireVenue.morality_merit(makeCharacter({}).character)).toBe('Humanity')
  })

  it('takes everything after the first two words of a "Path of X" merit', () => {
    const character = makeCharacter({
      merits: [trait({ name: 'Path of Blood' })],
    }).character
    expect(vampireVenue.morality_merit(character)).toBe('Blood')
  })

  it('keeps a multi-word path intact', () => {
    const character = makeCharacter({
      merits: [trait({ name: 'Path of the Feral Heart' })],
    }).character
    expect(vampireVenue.morality_merit(character)).toBe('the Feral Heart')
  })

  it('splits on an apostrophe, which is lodash 3 and NOT lodash 4', () => {
    // lodash 4's `words` keeps "Sun's" together as a contraction; lodash 3's
    // reWords does not. The stored morality name differs between the two, so
    // the lodash 3 pattern is reproduced rather than delegated.
    const character = makeCharacter({
      merits: [trait({ name: "Path of the Sun's Glory" })],
    }).character
    expect(vampireVenue.morality_merit(character)).toBe('the Sun s Glory')
  })

  it('splits a hyphenated path', () => {
    const character = makeCharacter({
      merits: [trait({ name: 'Path of Self-Focus' })],
    }).character
    expect(vampireVenue.morality_merit(character)).toBe('Self Focus')
  })

  it('ignores merits that do not start with "Path of", including nameless ones', () => {
    const character = makeCharacter({
      merits: [trait({}), trait({ name: 'Ambidextrous' }), trait({ name: 'Pathological' })],
    }).character
    expect(vampireVenue.morality_merit(character)).toBe('Humanity')
  })

  it('with two Path merits the LAST one wins', () => {
    const character = makeCharacter({
      merits: [trait({ name: 'Path of Blood' }), trait({ name: 'Path of Caine' })],
    }).character
    expect(vampireVenue.morality_merit(character)).toBe('Caine')
  })

  it('morality returns a BLANK trait when there is no paths column at all', () => {
    const m = vampireVenue.morality(makeCharacter({}).character)
    expect(m.get('name')).toBeUndefined()
    expect(m.get('value')).toBeUndefined()
  })

  it('morality returns a stand-in Humanity at 1 when the paths column is empty', () => {
    const m = vampireVenue.morality(makeCharacter({ paths: [] }).character)
    expect(m.get('name')).toBe('Humanity')
    expect(m.get('value')).toBe(1)
  })

  it('morality returns the stored path when there is one', () => {
    const path = trait({ name: 'Path of Caine', value: 4 })
    const m = vampireVenue.morality(makeCharacter({ paths: [path] }).character)
    expect(m).toBe(path)
  })
})

/* --------------------------------------------------------- Werewolf only */

describe('Werewolf affinities', () => {
  it('is tribe, auspice and breed plus the extra affinity links', () => {
    const character = makeCharacter({
      type: 'Werewolf',
      wta_tribe: 'Black Furies',
      wta_auspice: 'Ahroun',
      wta_breed: 'Homid',
      extra_affinity_links: [trait({ name: 'Glass Walkers' })],
    }).character
    expect(werewolfVenue.get_affinities(character)).toEqual([
      'Black Furies',
      'Ahroun',
      'Homid',
      'Glass Walkers',
    ])
  })

  it('drops undefined and ONLY undefined -- a null tribe stays in the list', () => {
    const character = makeCharacter({
      type: 'Werewolf',
      wta_tribe: null,
      wta_auspice: 'Ahroun',
    }).character
    expect(werewolfVenue.get_affinities(character)).toEqual([null, 'Ahroun'])
  })

  it('sums Gnosis the lodash 3 way', () => {
    const character = makeCharacter({
      type: 'Werewolf',
      wta_gnosis_sources: [trait({ value: 6 }), trait({ value: 4 }), trait({})],
    }).character
    expect(werewolfVenue.get_gnosis_total(character)).toBe(10)
  })
})

/* --------------------------------------------- Changeling: the Kith transaction */

describe('the Kith transaction', () => {
  /** Two kiths whose affinity sets share one Art -- the R23 case, measured. */
  const KITH_RULES = [
    new Parse.Object('bnsctdbs_KithRule', {
      name: 'Ghillie Dhu',
      art_1: 'Elder-Form',
      art_2: 'Oakenshield',
    } as never),
    new Parse.Object('bnsctdbs_KithRule', {
      name: 'Clurichaun',
      art_1: 'Oakenshield',
      art_2: 'Primal',
    } as never),
    new Parse.Object('bnsctdbs_KithRule', {
      name: 'Three Art Kith',
      art_1: 'A',
      art_2: 'B',
      art_3: 'C',
    } as never),
  ]

  beforeAll(async () => {
    vi.spyOn(Parse.Query.prototype, 'find').mockResolvedValue(KITH_RULES as never)
    await changelingVenue.initialize_costs()
  })

  beforeEach(() => {
    vi.spyOn(Parse.Object, 'fetchAllIfNeeded').mockImplementation(
      (list: unknown[]) => Promise.resolve(list) as never,
    )
  })

  function changeling(attributes: Record<string, unknown>) {
    const creation = new Parse.Object('VampireCreation', {
      completed: false,
      ctdbs_arts_1_remaining: 3,
      ...(attributes.creationOverrides as Record<string, unknown>),
    } as never)
    let saves = 0
    Object.assign(creation, {
      save: () => {
        saves++
        return Promise.resolve(creation)
      },
    })
    const made = makeCharacter({
      type: 'ChangelingBetaSlice',
      creation,
      ...attributes,
    })
    return { ...made, creation, creationSaves: () => saves }
  }

  it('reads a Kith affinity set off the rules', () => {
    const { character } = changeling({ ctdbs_kith: 'Ghillie Dhu' })
    expect(changelingVenue.get_arts_affinities(character)).toEqual(['Elder-Form', 'Oakenshield'])
  })

  it('a non-Kith text edit goes straight to the base implementation, un-queued', async () => {
    const { character, log } = changeling({})
    await changelingVenue.update_text(character, 'archetype', 'Caregiver')
    expect(log.base_update_text).toEqual([['archetype', 'Caregiver']])
    expect(log.unpicked).toHaveLength(0)
    expect(log.updated).toHaveLength(0)
  })

  it('R22: refuses a Kith whose grant exceeds remaining + releasing', async () => {
    const { character } = changeling({
      creationOverrides: { ctdbs_arts_1_remaining: 0 },
    })
    await expect(
      changelingVenue.update_text(character, 'ctdbs_kith', 'Three Art Kith'),
    ).rejects.toThrow(
      'Three Art Kith grants 3 Arts, but only 0 Art picks remain. ' +
        'Unpick an Art before choosing this Kith.',
    )
  })

  it('R22: the refusal message does not pluralise for exactly one pick', async () => {
    const { character } = changeling({
      creationOverrides: { ctdbs_arts_1_remaining: 1 },
    })
    await expect(
      changelingVenue.update_text(character, 'ctdbs_kith', 'Three Art Kith'),
    ).rejects.toThrow('but only 1 Art pick remain.')
  })

  it('R22: counts the outgoing Kith Arts as available, since they are released first', async () => {
    const { character, log } = changeling({
      ctdbs_kith: 'Ghillie Dhu',
      ctdbs_arts: [
        trait({ name: 'Elder-Form', value: 1, free_value: 1 }),
        trait({ name: 'Oakenshield', value: 1, free_value: 1 }),
      ],
      creationOverrides: { ctdbs_arts_1_remaining: 0 },
    })
    // Granting 2, remaining 0, releasing 2 -> allowed.
    await changelingVenue.update_text(character, 'ctdbs_kith', 'Clurichaun')
    expect(log.base_update_text).toEqual([['ctdbs_kith', 'Clurichaun']])
  })

  it('R22: the refusal stops the grant -- nothing is unpicked and nothing granted', async () => {
    const { character, log } = changeling({
      creationOverrides: { ctdbs_arts_1_remaining: 0 },
    })
    await expect(
      changelingVenue.update_text(character, 'ctdbs_kith', 'Three Art Kith'),
    ).rejects.toThrow()
    // The gate is built off to the side of the queue precisely so that a
    // refusal raised after the work was queued cannot fail to stop it.
    expect(log.unpicked).toHaveLength(0)
    expect(log.updated).toHaveLength(0)
    expect(log.base_update_text).toHaveLength(0)
  })

  it('R22: leaves the shared queue usable after a refusal', async () => {
    const { character, log } = changeling({
      creationOverrides: { ctdbs_arts_1_remaining: 0 },
    })
    await expect(
      changelingVenue.update_text(character, 'ctdbs_kith', 'Three Art Kith'),
    ).rejects.toThrow()
    // A rejected tail would make every later operation silently skip its work.
    await changelingVenue.update_text(character, 'archetype', 'Survivor')
    await character.traitQueue.then(() => undefined)
    expect(log.base_update_text).toEqual([['archetype', 'Survivor']])
  })

  it('R23: retains an Art held FOR FREE by both kiths, so it is not re-logged', async () => {
    const { character, log } = changeling({
      ctdbs_kith: 'Ghillie Dhu',
      ctdbs_arts: [
        trait({ name: 'Elder-Form', value: 1, free_value: 1 }),
        trait({ name: 'Oakenshield', value: 1, free_value: 1 }),
      ],
    })
    await changelingVenue.update_text(character, 'ctdbs_kith', 'Clurichaun')
    // Only Elder-Form changes hands; Oakenshield keeps its single original log
    // row rather than being destroyed and re-granted within the same minute.
    expect(log.unpicked).toEqual([['ctdbs_arts', undefined, 1]])
    expect(log.updated).toEqual([['Primal', 1, 'ctdbs_arts', 1]])
  })

  it('R23: does NOT retain an Art the player PAID for -- that grant must convert', async () => {
    const { character, log } = changeling({
      ctdbs_kith: 'Ghillie Dhu',
      ctdbs_arts: [
        trait({ name: 'Elder-Form', value: 1, free_value: 1 }),
        trait({ name: 'Oakenshield', value: 3, free_value: 0 }),
      ],
    })
    await changelingVenue.update_text(character, 'ctdbs_kith', 'Clurichaun')
    expect(log.unpicked).toHaveLength(2)
    expect(log.updated.map((u) => u[0]).sort()).toEqual(['Oakenshield', 'Primal'])
  })

  it('R23: does NOT retain an affinity the player had unpicked by hand', async () => {
    const { character, log } = changeling({
      ctdbs_kith: 'Ghillie Dhu',
      ctdbs_arts: [trait({ name: 'Elder-Form', value: 1, free_value: 1 })],
    })
    await changelingVenue.update_text(character, 'ctdbs_kith', 'Clurichaun')
    // Oakenshield is not held, so the incoming Kith must still grant it.
    expect(log.updated.map((u) => u[0]).sort()).toEqual(['Oakenshield', 'Primal'])
  })

  it('keeps the source ordering: unpick, save, base text, grant, save creation', async () => {
    const { character, log, creationSaves } = changeling({
      ctdbs_kith: 'Ghillie Dhu',
      ctdbs_arts: [
        trait({ name: 'Elder-Form', value: 1, free_value: 1 }),
        trait({ name: 'Oakenshield', value: 1, free_value: 1 }),
      ],
    })
    await changelingVenue.update_text(character, 'ctdbs_kith', 'Clurichaun')
    expect(log.order).toEqual([
      'unpick:ctdbs_arts',
      'save',
      'base_update_text',
      'update_trait:Primal',
    ])
    expect(creationSaves()).toBe(1)
  })

  it('unpick_text releases the Kith Arts as well as clearing the text', async () => {
    const { character, log, creationSaves } = changeling({
      ctdbs_kith: 'Ghillie Dhu',
      ctdbs_arts: [
        trait({ name: 'Elder-Form', value: 1, free_value: 1 }),
        trait({ name: 'Oakenshield', value: 1, free_value: 1 }),
      ],
    })
    const result = await changelingVenue.unpick_text(character, 'ctdbs_kith')
    // Unpicking used to be a bare passthrough: it cleared the text and left the
    // granted Arts and the spent pool slots behind, with no route back.
    expect(log.unpicked).toHaveLength(2)
    expect(log.base_unpick_text).toEqual(['ctdbs_kith'])
    expect(creationSaves()).toBe(1)
    // Callers read `c.id` off this promise to build their redirect.
    expect(result).toBe(character)
  })

  it('unpick_text of any other target is a queued passthrough', async () => {
    const { character, log } = changeling({})
    await changelingVenue.unpick_text(character, 'archetype')
    expect(log.base_unpick_text).toEqual(['archetype'])
    expect(log.unpicked).toHaveLength(0)
  })

  it('unpick_text tolerates a character with no creation row', async () => {
    const { character } = makeCharacter({ type: 'ChangelingBetaSlice' })
    await expect(changelingVenue.unpick_text(character, 'ctdbs_kith')).resolves.toBe(character)
  })
})
