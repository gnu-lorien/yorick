/**
 * Regression pins for the experience ledger.
 *
 * Every expected number in here was worked out by hand from
 * `public/scripts/app/models/Character.js`, not from what the totals "ought" to
 * be. That distinction is the point of the file: the XP balance is a STORED
 * column with no server-side recalculation and no reconciliation job behind it,
 * so a port that computes a running total differently does not fail -- it
 * rewrites every character's balance on their next edit, silently, permanently.
 *
 * Four of these tests pin behaviour that is wrong on purpose. They are marked
 * QUIRK and each one says what the source does and why it is not being fixed
 * here. A change that makes one of them fail is not necessarily a regression --
 * but it IS a change to what live characters are worth, and it needs to be made
 * deliberately, with the data migration that goes with it.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  CharacterExperience,
  FauxSimpleTrait,
  compare_approvals,
  compare_experience_notations,
  experience_available,
  get_transformed,
  propagate_experience_notation_change,
  type ApprovalLike,
  type ExperienceNotationLike,
  type Saveable,
  type VampireChangeLike,
  type XpCharacter,
} from '@/domain/CharacterExperience'

/* ------------------------------------------------------------------ *
 * Test doubles
 *
 * Structural stand-ins rather than `Parse.Object`s: the ledger arithmetic takes
 * structural interfaces, so nothing here needs an initialised SDK or a server.
 * ------------------------------------------------------------------ */

class FakeNotation implements ExperienceNotationLike {
  id: string | undefined
  readonly attributes: Record<string, unknown>
  destroyed = false

  constructor(attributes: Record<string, unknown> = {}, id?: string) {
    this.attributes = { ...attributes }
    this.id = id
  }

  get(attribute: string): any {
    return this.attributes[attribute]
  }

  set(attribute: string, value: unknown): this {
    this.attributes[attribute] = value
    return this
  }

  save(): Promise<unknown> {
    return Promise.resolve(this)
  }

  destroy(): Promise<unknown> {
    this.destroyed = true
    return Promise.resolve(this)
  }
}

class FakeCharacter implements XpCharacter {
  id: string | undefined = 'char1'
  readonly attributes: Record<string, unknown> = {}
  troupes: { parent: unknown } | null | undefined
  _ltCache: Record<string, unknown> | undefined
  transform_description: never[] | undefined

  get(attribute: string): any {
    return this.attributes[attribute]
  }

  set(attribute: string, value: unknown): this {
    this.attributes[attribute] = value
    return this
  }

  save(): Promise<unknown> {
    return Promise.resolve(this)
  }

  /**
   * Parse's `clone()` is a SHALLOW copy: a new object with the same attribute
   * values, sharing every referenced object. This double is shallow for the
   * same reason -- `get_transformed` depends on the sharing.
   */
  clone(): FakeCharacter {
    const copy = new FakeCharacter()
    copy.id = this.id
    Object.assign(copy.attributes, this.attributes)
    copy.troupes = this.troupes
    return copy
  }
}

/** A day in 2020, so ordering by `entered` is easy to read in the expectations. */
function day(n: number): Date {
  return new Date(Date.UTC(2020, 0, n))
}

interface Row {
  day: number
  earned?: number
  spent?: number
  id?: string
}

/**
 * Build a ledger newest-first with its running totals already correct, the way
 * a fetch from the server would deliver it.
 */
function ledger(rows: readonly Row[]): FakeNotation[] {
  const oldestFirst = rows.slice().sort((a, b) => a.day - b.day)
  let earned = 0
  let spent = 0
  const built: FakeNotation[] = []
  for (const row of oldestFirst) {
    earned += row.earned ?? 0
    spent += row.spent ?? 0
    built.push(
      new FakeNotation(
        {
          entered: day(row.day),
          reason: `day ${row.day}`,
          alteration_earned: row.earned ?? 0,
          alteration_spent: row.spent ?? 0,
          earned,
          spent,
        },
        row.id ?? `en${row.day}`,
      ),
    )
  }
  return built.reverse()
}

function totals(notations: readonly ExperienceNotationLike[]): Array<[number, number]> {
  return notations.map((en) => [en.get('earned'), en.get('spent')])
}

/** A `CharacterExperience` wired to doubles, with the batch saves recorded. */
function ledgerUnderTest(rows: readonly Row[]) {
  const character = new FakeCharacter()
  const batches: Saveable[][] = []
  const experience = new CharacterExperience(character, {
    createNotation: (attributes) => new FakeNotation(attributes),
    saveAll: (objects) => {
      batches.push(objects.slice())
      return Promise.resolve()
    },
  })
  const notations = ledger(rows)
  experience.seed_experience_notations(notations)
  // Seeding does not touch the character's stored columns; a real character
  // arrives from the server already holding the totals its ledger implies.
  const newest = notations[0]
  character.set('experience_earned', newest ? newest.get('earned') : 0)
  character.set('experience_spent', newest ? newest.get('spent') : 0)
  return { character, experience, notations, batches }
}

/* ------------------------------------------------------------------ *
 * Comparators
 * ------------------------------------------------------------------ */

describe('comparators', () => {
  it('sorts the ledger newest-entered first', () => {
    const rows = ledger([{ day: 1 }, { day: 5 }, { day: 3 }])
    expect(rows.map((en) => en.get('reason'))).toEqual(['day 5', 'day 3', 'day 1'])

    // And the comparator alone, since every re-sort in the module uses it
    // directly rather than relying on the array already being ordered.
    const shuffled = [rows[2], rows[0], rows[1]] as FakeNotation[]
    expect(shuffled.sort(compare_experience_notations).map((en) => en.get('reason'))).toEqual([
      'day 5',
      'day 3',
      'day 1',
    ])
  })

  it('sorts approvals ASCENDING by createdAt, so the last is the newest', () => {
    // The source spells this by swapping the operands, which reads descending
    // and is not. `get_transformed_last_approved` takes `.last()` and means
    // "the most recent approval", so the direction is load-bearing.
    const approval = (n: number): ApprovalLike => ({
      id: `a${n}`,
      createdAt: day(n),
      get: () => undefined,
    })
    const sorted = [approval(3), approval(1), approval(2)].sort(compare_approvals)
    expect(sorted.map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
    expect(sorted[sorted.length - 1]?.id).toBe('a3')
  })
})

/* ------------------------------------------------------------------ *
 * The running-balance recompute
 * ------------------------------------------------------------------ */

describe('propagate_experience_notation_change', () => {
  it('recomputes the whole ledger from the bottom and copies the newest row onto the character', () => {
    const character = new FakeCharacter()
    const notations = ledger([
      { day: 1, earned: 30 },
      { day: 3, earned: 10 },
      { day: 5, earned: 2, spent: 3 },
    ])
    // Scramble the stored totals: the recompute must derive them from the
    // alterations, not trust what is already there.
    for (const en of notations) {
      en.set('earned', -999)
      en.set('spent', -999)
    }

    const altered = propagate_experience_notation_change(
      character,
      notations,
      notations.length - 1,
      () => new FakeNotation({ alteration_earned: 0, alteration_spent: 0, earned: 0, spent: 0 }),
    )

    // Newest-first: day 5 sums itself and everything below it.
    expect(totals(notations)).toEqual([
      [42, 3],
      [40, 0],
      [30, 0],
    ])
    expect(character.get('experience_earned')).toBe(42)
    expect(character.get('experience_spent')).toBe(3)
    expect(experience_available(character)).toBe(39)

    // Everything touched, in the source's order. `reduceRight` walks the
    // newest-first window from its END, so rows are pushed OLDEST first, and
    // the character goes on last. `Parse.Object.saveAll` gets exactly this
    // array; the order decides nothing on the wire but is pinned because a
    // reversal here would mean the reduce ran the other way round.
    expect(altered).toEqual([notations[2], notations[1], notations[0], character])
  })

  it('seeds from the row below the window and leaves rows above it alone', () => {
    const character = new FakeCharacter()
    const notations = ledger([
      { day: 1, earned: 30 },
      { day: 3, earned: 10 },
      { day: 5, earned: 2, spent: 3 },
    ])
    // Only recompute [0..1]; row 2 is the seed and must not be rewritten.
    notations[2]?.set('earned', 100)

    propagate_experience_notation_change(
      character,
      notations,
      1,
      () => new FakeNotation({ earned: 0, spent: 0 }),
    )

    expect(totals(notations)).toEqual([
      [112, 3],
      [110, 0],
      [100, 0],
    ])
    expect(character.get('experience_earned')).toBe(112)
  })

  it('falls back to a zero seed when the window reaches the bottom of an empty ledger', () => {
    // What removing the last notation leaves behind.
    const character = new FakeCharacter()
    const altered = propagate_experience_notation_change(
      character,
      [],
      0,
      () => new FakeNotation({ earned: 0, spent: 0 }),
    )
    expect(character.get('experience_earned')).toBe(0)
    expect(character.get('experience_spent')).toBe(0)
    expect(altered).toEqual([character])
  })
})

/* ------------------------------------------------------------------ *
 * Inserting a notation
 * ------------------------------------------------------------------ */

describe('inserting a notation', () => {
  it('recomputes only the rows above the insertion point', () => {
    // Insert day 2 into [day 5, day 3, day 1] -- it lands at index 2, and the
    // window [0..2] covers it and everything newer, seeded from day 1.
    const character = new FakeCharacter()
    const existing = ledger([
      { day: 1, earned: 30 },
      { day: 3, earned: 10 },
      { day: 5, earned: 2, spent: 3 },
    ])
    const inserted = new FakeNotation({
      entered: day(2),
      reason: 'day 2',
      alteration_earned: 5,
      alteration_spent: 1,
      earned: 0,
      spent: 0,
    })
    const notations = existing.concat([inserted]).sort(compare_experience_notations)
    expect(notations.map((en) => en.get('reason'))).toEqual(['day 5', 'day 3', 'day 2', 'day 1'])

    propagate_experience_notation_change(
      character,
      notations,
      notations.indexOf(inserted),
      () => new FakeNotation({ earned: 0, spent: 0 }),
    )

    expect(totals(notations)).toEqual([
      [47, 4],
      [45, 1],
      [35, 1],
      [30, 0],
    ])
    expect(character.get('experience_earned')).toBe(47)
    expect(character.get('experience_spent')).toBe(4)
  })

  it('add_experience_notation puts a fresh award at the top and totals it correctly', async () => {
    const { character, experience, batches } = ledgerUnderTest([
      { day: 1, earned: 30 },
      { day: 5, earned: 2 },
    ])

    const mutation = await experience.add_experience_notation({
      reason: 'Session 3',
      alteration_earned: 6,
    })

    expect(experience.notations.value.length).toBe(3)
    expect(mutation.index).toBe(0)
    expect(mutation.model.get('reason')).toBe('Session 3')
    expect(mutation.model.get('earned')).toBe(38)
    expect(character.get('experience_earned')).toBe(38)
    expect(character.get('experience_spent')).toBe(0)
    // One batch: the new row plus the character.
    expect(batches.length).toBe(1)
    expect(batches[0]).toEqual([mutation.model, character])
  })

  it('QUIRK: a BACKDATED award is totalled as if it were the newest row', async () => {
    /*
     * `add_experience_notation` "finds" the new row's index with
     *
     *     if (ens._byCid[model.cid]) { index = i; break; }
     *
     * -- a test every member of the collection satisfies, so the loop always
     * returns 0. The source is correct only because a notation entered "now"
     * sorts to the top of a newest-first ledger.
     *
     * Backdate it and the window becomes the wrong one row: index 0 is
     * recomputed against the freshly inserted row, whose `earned`/`spent` are
     * still the `_default_experience_notation` zeroes, so the character's
     * balance collapses to the top row's own alteration.
     *
     * This is reproduced, not fixed. Fixing the search changes the recompute
     * window, and a different window is a different stored balance on every
     * live character that has ever had a notation backdated.
     */
    const { character, experience } = ledgerUnderTest([
      { day: 1, earned: 30 },
      { day: 5, earned: 2 },
    ])
    expect(character.get('experience_earned')).toBe(32)

    const mutation = await experience.add_experience_notation({
      entered: day(3),
      reason: 'Backdated',
      alteration_earned: 7,
    })

    // The row went into the ledger in the right place...
    expect(experience.notations.value.map((en) => en.get('reason'))).toEqual([
      'day 5',
      'Backdated',
      'day 1',
    ])
    // ...but the index reported, and used for the recompute, is 0 regardless,
    // and `model` is therefore the row that was already at the top rather than
    // the one just added.
    expect(mutation.index).toBe(0)
    expect(mutation.model.get('reason')).toBe('day 5')
    // Balance recomputed as "day 5's alteration on top of a zero-valued row".
    expect(character.get('experience_earned')).toBe(2)
  })
})

/* ------------------------------------------------------------------ *
 * Editing `entered`
 * ------------------------------------------------------------------ */

describe('editing entered so a row moves', () => {
  it('re-sorts and recomputes every row the notation passed on its way OLDER', async () => {
    // [A day7 +1, B day5 +2, C day3 +4, D day1 +8] -> move A to day 0.
    const { character, experience, notations, batches } = ledgerUnderTest([
      { day: 1, earned: 8, id: 'D' },
      { day: 3, earned: 4, id: 'C' },
      { day: 5, earned: 2, id: 'B' },
      { day: 7, earned: 1, id: 'A' },
    ])
    expect(notations.map((en) => en.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(character.get('experience_earned')).toBe(15)

    const a = notations[0] as FakeNotation
    await experience.set_experience_notation_attributes(a, { entered: day(0) })

    expect(experience.notations.value.map((en) => en.id)).toEqual(['B', 'C', 'D', 'A'])
    // A is now the oldest row: 1. D: 8 + 1. C: 4 + 9. B: 2 + 13.
    expect(totals(experience.notations.value)).toEqual([
      [15, 0],
      [13, 0],
      [9, 0],
      [1, 0],
    ])
    // The total is unchanged -- reordering the ledger cannot change the sum --
    // but every intermediate row moved, and every one of them was saved.
    expect(character.get('experience_earned')).toBe(15)
    expect(batches.length).toBe(1)
    expect(batches[0]?.length).toBe(5)
  })

  it('widens the window to the OLD index when a notation moves NEWER', async () => {
    /*
     * `_propagate_experience_notation_change` recomputes `[0..index]` seeded
     * from `index + 1`, which only covers the rows a notation passed when it
     * moves OLDER -- those sit inside the window. Moving NEWER leaves the rows
     * it passed BELOW the new index, outside the window, still counting it,
     * and the moved row is then recomputed on top of one of them, so its
     * earned and spent land in the totals twice. Capturing `previous_index`
     * before the re-sort and widening to the further of the two is what covers
     * both directions.
     */
    const { character, experience, notations } = ledgerUnderTest([
      { day: 1, earned: 30, id: 'oldest' },
      { day: 3, earned: 10, id: 'middle' },
      { day: 5, earned: 2, spent: 3, id: 'newest' },
    ])

    const oldest = notations[2] as FakeNotation
    expect(experience.notations.value.indexOf(oldest)).toBe(2)
    await experience.set_experience_notation_attributes(oldest, { entered: day(9) })

    expect(experience.notations.value.map((en) => en.id)).toEqual(['oldest', 'newest', 'middle'])
    // middle: 10. newest: 2 + 10 earned, 3 spent. oldest: 30 + 12.
    expect(totals(experience.notations.value)).toEqual([
      [42, 3],
      [12, 3],
      [10, 0],
    ])
    // Without the widening, "middle" would still be carrying the moved row's
    // 30 and the character would read 72.
    expect(character.get('experience_earned')).toBe(42)
    expect(character.get('experience_spent')).toBe(3)
  })

  it('recomputes when an alteration changes to a non-zero value', async () => {
    const { character, experience, notations } = ledgerUnderTest([
      { day: 1, earned: 30 },
      { day: 5, earned: 2 },
    ])
    const oldest = notations[1] as FakeNotation

    await experience.set_experience_notation_attributes(oldest, { alteration_earned: 40 })

    expect(totals(experience.notations.value)).toEqual([
      [42, 0],
      [40, 0],
    ])
    expect(character.get('experience_earned')).toBe(42)
  })

  it('editing an alteration down to ZERO propagates, because the hash is a presence map', async () => {
    /*
     * A regression test for a bug this port introduced and an adversarial audit
     * caught.
     *
     * `Character.js:582` is
     *
     *     if (c.alteration_earned || c.alteration_spent) { changed = true; }
     *
     * and it is tempting to read `c` as a map of NEW VALUES, in which case `0`
     * is falsy and zeroing an alteration would propagate nothing. The first
     * version of this file read it that way and pinned the resulting behaviour
     * as a deliberate quirk.
     *
     * It is not what the SDK does. `parse-1.5.0.js:5338` is literally
     * `options.changes[attr] = true` -- a PRESENCE map -- guarded by an
     * `isRealChange` test at `:5326-5331`. So the condition fires for any real
     * change, a change to `0` included.
     *
     * The distinction is not academic. `CharacterExperienceView.js:143` sets the
     * attribute and deliberately does NOT call `en.save()`, because the
     * propagation is what writes the row. Under the wrong reading, a storyteller
     * correcting an XP award down to 0 would see the field show 0, nothing would
     * be saved, and the correction would vanish on the next reload while the
     * character kept spending against the old balance.
     */
    const { character, experience, notations, batches } = ledgerUnderTest([
      { day: 1, earned: 30 },
      { day: 5, earned: 2 },
    ])
    const newest = notations[0] as FakeNotation

    await experience.set_experience_notation_attributes(newest, { alteration_earned: 0 })

    // The row is rewritten and every row in the window recomputed...
    expect(batches.length).toBeGreaterThan(0)
    expect(newest.get('alteration_earned')).toBe(0)
    expect(newest.get('earned')).toBe(30)
    // ...and the character's stored balance follows.
    expect(character.get('experience_earned')).toBe(30)
  })

  it('re-confirming an UNCHANGED value propagates nothing', async () => {
    /*
     * The other half of the presence map: `isRealChange` compares with
     * `_.isEqual` before recording anything, so setting an attribute to the
     * value it already holds is not a change and fires no propagation.
     *
     * `entered` is the case that matters -- it is a `Date`, and two Dates with
     * the same time are never `===`. Without the deep comparison, opening the
     * date popup and confirming the same date would issue a redundant `saveAll`
     * of the whole recompute window every time.
     */
    const { experience, notations, batches } = ledgerUnderTest([
      { day: 1, earned: 30 },
      { day: 5, earned: 2 },
    ])
    const newest = notations[0] as FakeNotation
    const sameDate = new Date((newest.get('entered') as Date).getTime())
    const sameEarned = newest.get('alteration_earned') as number

    const result = await experience.set_experience_notation_attributes(newest, {
      entered: sameDate,
      alteration_earned: sameEarned,
    })

    expect(result).toEqual([])
    expect(batches).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Removing a notation
 * ------------------------------------------------------------------ */

describe('remove_experience_notation', () => {
  it('recomputes from the removed row upward and destroys the row', async () => {
    const { character, experience, notations, batches } = ledgerUnderTest([
      { day: 1, earned: 8, id: 'D' },
      { day: 3, earned: 4, id: 'C' },
      { day: 5, earned: 2, id: 'B' },
      { day: 7, earned: 1, id: 'A' },
    ])
    const b = notations[1] as FakeNotation

    const mutation = await experience.remove_experience_notation(b)

    expect(mutation.index).toBe(1)
    expect(b.destroyed).toBe(true)
    expect(experience.notations.value.map((en) => en.id)).toEqual(['A', 'C', 'D'])
    // D: 8. C: 4 + 8. A: 1 + 12.
    expect(totals(experience.notations.value)).toEqual([
      [13, 0],
      [12, 0],
      [8, 0],
    ])
    expect(character.get('experience_earned')).toBe(13)
    expect(batches.length).toBe(1)
  })

  it('still saves the recomputed rows when the destroy fails', async () => {
    /*
     * `Parse.Promise.when(destroy, saveAll)` waits for BOTH to settle and
     * rejects with an array of errors indexed to the inputs. `Promise.all`
     * would abandon the batch save the moment the destroy rejected, which is
     * how the stored balances and the ledger end up disagreeing.
     */
    const character = new FakeCharacter()
    const batches: Saveable[][] = []
    const experience = new CharacterExperience(character, {
      createNotation: (attributes) => new FakeNotation(attributes),
      saveAll: (objects) => {
        batches.push(objects.slice())
        return Promise.resolve()
      },
    })
    const notations = ledger([
      { day: 1, earned: 30 },
      { day: 5, earned: 2 },
    ])
    experience.seed_experience_notations(notations)
    const doomed = notations[0] as FakeNotation
    doomed.destroy = () => Promise.reject(new Error('offline'))

    const errors = await experience.remove_experience_notation(doomed).then(
      () => undefined,
      (e: unknown) => e,
    )

    expect(Array.isArray(errors)).toBe(true)
    // Indexed to the inputs: the destroy failed, the save did not.
    expect((errors as unknown[])[0]).toBeInstanceOf(Error)
    expect((errors as unknown[])[1]).toBeUndefined()
    expect(batches.length).toBe(1)
  })
})

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

describe('the serialising queues', () => {
  it('runs adds one at a time, and a failed add does not wedge the next one', async () => {
    const character = new FakeCharacter()
    let inFlight = 0
    let maxInFlight = 0
    let failNext = true
    const experience = new CharacterExperience(character, {
      createNotation: (attributes) => new FakeNotation(attributes),
      saveAll: async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        inFlight -= 1
        if (failNext) {
          failNext = false
          throw new Error('save failed')
        }
      },
    })
    experience.seed_experience_notations([])

    const first = experience.add_experience_notation({ alteration_earned: 5 }).catch(() => 'failed')
    const second = experience.add_experience_notation({ alteration_earned: 7 })

    expect(await first).toBe('failed')
    // `always` is `then(cb, cb)`: the rejection became a fulfillment, so the
    // queue kept moving. `.finally()` here would have wedged it forever.
    const mutation = await second
    expect(mutation.index).toBe(0)
    expect(maxInFlight).toBe(1)
  })
})

/* ------------------------------------------------------------------ *
 * experience_available
 * ------------------------------------------------------------------ */

describe('experience_available', () => {
  it('is the difference of the two stored columns', () => {
    const character = new FakeCharacter()
    character.set('experience_earned', 42)
    character.set('experience_spent', 17)
    expect(experience_available(character)).toBe(25)
  })

  it('is NaN, not 0, on a character with no XP columns yet', () => {
    // `?? 0` here would render as a real balance of zero and hide the fact that
    // the row has never been through a propagation. Left as the source has it.
    expect(experience_available(new FakeCharacter())).toBeNaN()
  })
})

/* ------------------------------------------------------------------ *
 * get_transformed
 * ------------------------------------------------------------------ */

function change(attributes: Record<string, unknown>, id?: string): VampireChangeLike {
  return {
    id: id ?? 'vc1',
    get: (attribute: string) => attributes[attribute],
  }
}

describe('get_transformed', () => {
  it('undoes define, remove and update rows and records a description of each', () => {
    const character = new FakeCharacter()
    const brawl = { get: (a: string) => ({ name: 'Brawl', value: 3 })[a as 'name' | 'value'] }
    const guile = { get: (a: string) => ({ name: 'Guile', value: 1 })[a as 'name' | 'value'] }
    character.set('skills', [brawl, guile])

    const c = get_transformed(character, [
      // Undoing a define un-creates the trait.
      change({ category: 'skills', type: 'define', name: 'Guile', value: 1 }, 'v1'),
      // Undoing a remove puts a faux trait back.
      change(
        { category: 'skills', type: 'remove', name: 'Dodge', value: 2, cost: 4 },
        'v2',
      ),
      // Undoing an update swaps the live trait for one carrying the old values.
      change(
        { category: 'skills', type: 'update', name: 'Brawl', old_value: 2, value: 3 },
        'v3',
      ),
    ])

    const skills = c.get('skills') as Array<{ get(a: string): unknown }>
    const names = skills.map((t) => t.get('name'))
    expect(names).toEqual(['Dodge', 'Brawl'])
    // The Brawl in the result is the faux one, holding `old_value`.
    expect(skills[1]?.get('value')).toBe(2)
    // The original is untouched: `get_transformed` builds an alternate sheet.
    expect((character.get('skills') as unknown[]).length).toBe(2)

    expect(c.transform_description.map((d) => d.type)).toEqual(['define', 'removed', 'changed'])
    expect(c.transform_description[0]?.fake).toBeUndefined()
    expect(c.transform_description[1]?.fake).toBeInstanceOf(FauxSimpleTrait)
  })

  it('replays core rows onto attributes and skips experience rows entirely', () => {
    const character = new FakeCharacter()
    character.set('name', 'Renamed')
    character.set('sect', 'Camarilla')

    const c = get_transformed(character, [
      change({ category: 'core', type: 'core_update', name: 'name', old_text: 'Original' }, 'v1'),
      change({ category: 'core', type: 'core_define', name: 'sect' }, 'v2'),
      // An `experience` row is neither a trait nor a text attribute. Replaying
      // one manufactures a FauxSimpleTrait in a category no venue has, and the
      // approval view never finishes rendering. `_recorded_changes_query`
      // filters these out; this is the belt to that pair of braces.
      change({ category: 'experience', type: 'update', name: 'whatever' }, 'v3'),
    ])

    expect(c.get('name')).toBe('Original')
    expect(c.get('sect')).toBeUndefined()
    expect(c.transform_description.map((d) => d.type)).toEqual(['update', 'define'])
    expect(character.get('name')).toBe('Renamed')
  })

  it('QUIRK: an update for a trait the sheet no longer has pushes undefined into the category', () => {
    /*
     * `_.xor(c.get(category), [current, trait])` with `current === undefined`
     * puts `undefined` into the array, because it appears in exactly one of the
     * two lists. Every later pass over that category then hits the
     * "now a name is undefined" branch. Reproduced, not fixed.
     */
    const character = new FakeCharacter()
    character.set('skills', [])
    const c = get_transformed(character, [
      change({ category: 'skills', type: 'update', name: 'Missing', old_value: 1 }, 'v1'),
    ])
    const skills = c.get('skills') as unknown[]
    expect(skills.length).toBe(2)
    expect(skills[0]).toBeUndefined()
    expect(skills[1]).toBeInstanceOf(FauxSimpleTrait)
  })

  it('nulls the ORIGINAL character troupe relation and shares its long-text cache', () => {
    /*
     * Parse's `clone()` does not deep-copy a relation, so the clone points at
     * the same relation object, whose `parent` still says "the original". The
     * source's repair is to null the parent on the ORIGINAL and let
     * `Character.initialize_troupe_membership` re-adopt it on its next run
     * (`else if (_.isNull(self.troupes.parent))`). Removing either half breaks
     * the other, so both are pinned here.
     */
    const character = new FakeCharacter()
    const relation = { parent: character as unknown }
    character.troupes = relation
    character._ltCache = { history: 'cached' }

    const c = get_transformed(character, [])

    expect(character.troupes?.parent).toBeNull()
    // `_ltCache` is shared by REFERENCE, so a long text fetched through the
    // rewound sheet lands on the original. Load-bearing for the print view.
    expect(c._ltCache).toBe(character._ltCache)
  })

  it('leaves the relation alone when troupe membership has never been initialised', () => {
    // `mustFixBrokenRelation` is `!_.isUndefined(this.troupes)`: before
    // `initialize_troupe_membership` has run there is no relation to break.
    const character = new FakeCharacter()
    expect(() => get_transformed(character, [])).not.toThrow()
    expect(character.troupes).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ *
 * FauxSimpleTrait
 * ------------------------------------------------------------------ */

describe('FauxSimpleTrait', () => {
  it('splits a specialization off the base name, as SimpleTraitMixin did', () => {
    const trait = new FauxSimpleTrait({ name: 'Crafts: Blacksmithing' })
    expect(trait.get_base_name()).toBe('Crafts')
    expect(trait.get_specialization()).toBe('Blacksmithing')
    expect(trait.has_specialization()).toBe(true)
    trait.set_specialization(undefined)
    expect(trait.get('name')).toBe('Crafts')
  })

  it('has a local id standing in for Backbone cid, since there is no cid here', () => {
    const a = new FauxSimpleTrait({ name: 'A' })
    const b = new FauxSimpleTrait({ name: 'B' })
    expect(a.linkId()).not.toBe(b.linkId())
    expect(a.id).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ *
 * Propagation hooks
 * ------------------------------------------------------------------ */

describe('propagation hooks', () => {
  it('replaces the begin/finish triggers the jQuery Mobile spinner listened to', async () => {
    const character = new FakeCharacter()
    const onPropagationBegin = vi.fn()
    const onPropagationFinish = vi.fn()
    const experience = new CharacterExperience(character, {
      createNotation: (attributes) => new FakeNotation(attributes),
      saveAll: () => Promise.resolve(),
      onPropagationBegin,
      onPropagationFinish,
    })
    experience.seed_experience_notations([])

    await experience.add_experience_notation({ alteration_earned: 3 })

    expect(onPropagationBegin).toHaveBeenCalledTimes(1)
    expect(onPropagationFinish).toHaveBeenCalledTimes(1)
  })
})
