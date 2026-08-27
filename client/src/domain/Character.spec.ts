/**
 * Character model tests.
 *
 * Scope: the parts of `@/domain/Character` that can be exercised without a
 * server -- the serialising queue, the `Parse.Promise.when` replacement, the ACL
 * rule and its ordering guard, and the derived reads. The write paths
 * (`update_trait`, `remove_trait`, `unpick_from_creation`) all end in a network
 * round trip and belong to the Playwright suite, which already asserts their
 * behaviour end to end.
 *
 * The ACL tests are the ones worth having here. `get_me_acl` is the difference
 * between a character its storytellers can read and one they cannot, the failure
 * is silent on the server, and the only thing standing between the two is that
 * `troupe_ids` has been read first.
 */
import { describe, expect, it } from 'vitest'

import Parse from '@/parse'
import { CharacterObject, SimpleTraitObject } from '@/parse/classes'
import { characterFor, settle_all, WriteQueue, type Character } from '@/domain/Character'

function newCharacter(): Character {
  return characterFor(new CharacterObject())
}

function trait(attributes: Record<string, unknown>): SimpleTraitObject {
  const t = new SimpleTraitObject()
  t.set(attributes)
  return t
}

/**
 * A stand-in for the `troupes` relation, so membership can be "read" without a
 * server. `parent` has to be present: `initialize_troupe_membership` rebuilds
 * the relation from the character when the parent is missing, which is the
 * repair for `get_transformed` having nulled it.
 */
function fakeTroupeRelation(character: Character, ids: readonly string[]): unknown {
  return {
    parent: character,
    targetClassName: 'Troupe',
    query: () => ({
      each: async (callback: (troupe: { id: string }) => void) => {
        for (const id of ids) callback({ id })
      },
    }),
  }
}

describe('WriteQueue', () => {
  it('runs tasks in order, one at a time', async () => {
    const q = new WriteQueue()
    const order: string[] = []

    const a = q.always(async () => {
      order.push('a:start')
      await Promise.resolve()
      order.push('a:end')
    })
    const b = q.always(() => {
      order.push('b')
    })

    await Promise.all([a, b])
    expect(order).toEqual(['a:start', 'a:end', 'b'])
  })

  it('does NOT wedge when a task rejects -- `.always` is `then(cb, cb)`', async () => {
    const q = new WriteQueue()

    const failed = q.always(() => {
      throw new Error('boom')
    })
    await expect(failed).rejects.toThrow('boom')

    // The whole reason the source used `.always` rather than `.then`: one failed
    // save must not stop every write that follows it for the rest of the session.
    await expect(q.always(() => 'still working')).resolves.toBe('still working')
  })

  it('propagates a rejection through `.then`, which `.always` swallows', async () => {
    const q = new WriteQueue()
    let ran = false

    void q.always(() => {
      throw new Error('boom')
    }).catch(() => undefined)
    const skipped = q.then(() => {
      ran = true
    })

    await expect(skipped).rejects.toThrow('boom')
    expect(ran).toBe(false)
  })

  it('adopts a promise built off to the side as the new tail', async () => {
    const q = new WriteQueue()
    const order: string[] = []

    const gate = Promise.resolve().then(() => {
      order.push('gate')
    })
    q.adopt(gate)
    await q.always(() => {
      order.push('after')
    })

    expect(order).toEqual(['gate', 'after'])
  })

  it('idle() resolves after a failure rather than rejecting', async () => {
    const q = new WriteQueue()
    void q.always(() => {
      throw new Error('boom')
    }).catch(() => undefined)
    await expect(q.idle()).resolves.toBeUndefined()
  })
})

describe('settle_all -- the Parse.Promise.when replacement', () => {
  it('resolves with the values in input order', async () => {
    await expect(settle_all<unknown>([Promise.resolve(1), 2, Promise.resolve(3)])).resolves.toEqual([
      1, 2, 3,
    ])
  })

  it('waits for every input to SETTLE, not just until the first failure', async () => {
    let secondFinished = false
    const first = Promise.reject(new Error('first'))
    const second = new Promise((resolve) =>
      setTimeout(() => {
        secondFinished = true
        resolve('ok')
      }, 5),
    )

    await expect(settle_all<unknown>([first, second])).rejects.toBeInstanceOf(Array)
    expect(secondFinished).toBe(true)
  })

  it('rejects with an array indexed to the inputs, holding values and errors', async () => {
    const boom = new Error('boom')
    try {
      await settle_all<unknown>([Promise.resolve('kept'), Promise.reject(boom)])
      throw new Error('should have rejected')
    } catch (errors) {
      expect(Array.isArray(errors)).toBe(true)
      expect(errors).toEqual(['kept', boom])
    }
  })
})

describe('get_me_acl', () => {
  it('refuses to build an ACL before troupe membership has been read', () => {
    const character = newCharacter()
    expect(character.has_troupe_membership()).toBe(false)
    // Answering `[]` here is what wrote characters their own storytellers could
    // not see, with nothing anywhere reporting it.
    expect(() => character.get_me_acl()).toThrow(/initialize_troupe_membership/)
    expect(() => character.get_troupe_ids()).toThrow(/initialize_troupe_membership/)
  })

  it('grants the owner, Administrator, and LST_/AST_ for every troupe', async () => {
    const character = newCharacter()
    character.set('owner', Parse.User.createWithoutData('owner1'))
    character.troupes = fakeTroupeRelation(character, ['T1', 'T2']) as never

    await character.initialize_troupe_membership()
    expect(character.get_troupe_ids()).toEqual(['T1', 'T2'])

    const acl = character.get_me_acl()
    expect(acl.getPublicReadAccess()).toBe(false)
    expect(acl.getPublicWriteAccess()).toBe(false)
    expect(acl.getReadAccess('owner1')).toBe(true)
    expect(acl.getWriteAccess('owner1')).toBe(true)
    expect(acl.getRoleReadAccess('Administrator')).toBe(true)
    expect(acl.getRoleWriteAccess('Administrator')).toBe(true)
    for (const id of ['T1', 'T2']) {
      expect(acl.getRoleReadAccess('LST_' + id)).toBe(true)
      expect(acl.getRoleWriteAccess('LST_' + id)).toBe(true)
      expect(acl.getRoleReadAccess('AST_' + id)).toBe(true)
      expect(acl.getRoleWriteAccess('AST_' + id)).toBe(true)
    }
  })

  it('falls back to the current user only when the owner attribute is ABSENT', async () => {
    // The absent-owner branch exists so a character created before its owner
    // pointer is set still gets an ACL. It is also why the character query must
    // NOT `include("owner")`: parse-server drops the pointer for a private
    // owner, this branch then reads it as "no owner", and opening someone
    // else's sheet rewrites its ACL to the viewer.
    const character = newCharacter()
    character.troupes = fakeTroupeRelation(character, []) as never
    await character.initialize_troupe_membership()

    expect(character.get('owner')).toBeUndefined()
    // No current user in a test process, and `setReadAccess(null)` throws --
    // the same failure the old client had. Asserting the throw pins the branch
    // without pretending a session exists.
    expect(() => character.get_me_acl()).toThrow()
  })

  it('set_cached_acl stores the ACL as JSON on the character', async () => {
    const character = newCharacter()
    character.set('owner', Parse.User.createWithoutData('owner1'))
    character.troupes = fakeTroupeRelation(character, ['T9']) as never
    await character.initialize_troupe_membership()

    character.set_cached_acl()
    const cached = JSON.parse(character.get('acl_to_json') as string)
    expect(cached.owner1).toEqual({ read: true, write: true })
    expect(cached['role:LST_T9']).toEqual({ read: true, write: true })
  })
})

describe('troupe membership', () => {
  it('throttles a re-read inside the 50 second window and not outside it', async () => {
    const character = newCharacter()
    let reads = 0
    character.troupes = {
      parent: character,
      targetClassName: 'Troupe',
      query: () => ({
        each: async (callback: (troupe: { id: string }) => void) => {
          reads += 1
          callback({ id: 'T1' })
        },
      }),
    } as never

    await character.initialize_troupe_membership()
    expect(reads).toBe(1)
    await character.initialize_troupe_membership(true)
    expect(reads).toBe(1)
    // Unthrottled always re-reads.
    await character.initialize_troupe_membership()
    expect(reads).toBe(2)
  })

  it('forget_troupe_relation drops the handle and the throttle, keeping the ids', async () => {
    const character = newCharacter()
    character.troupes = fakeTroupeRelation(character, ['T1']) as never
    await character.initialize_troupe_membership()

    character.forget_troupe_relation()

    // Exactly what the original's four `delete`s achieved: the relation is
    // rebuilt on the next read, while the ids the ACL is being built from in the
    // same method survive.
    expect(character.troupes).toBeUndefined()
    expect(character.get_troupe_ids()).toEqual(['T1'])
  })
})

describe('categories and trait reads', () => {
  it('ensure_category creates the array only when the attribute is absent', () => {
    const character = newCharacter()
    character.ensure_category('skills')
    expect(character.get('skills')).toEqual([])

    const existing = [trait({ name: 'Academics' })]
    character.set('skills', existing)
    character.ensure_category('skills')
    expect(character.get('skills')).toBe(existing)
  })

  it('get_category_for_fetch drops members that have never been saved', () => {
    const character = newCharacter()
    const saved = trait({ name: 'Saved' })
    saved.id = 'st1'
    const unsaved = trait({ name: 'Unsaved' })
    character.set('skills', [saved, unsaved])

    expect(character.get_category_for_fetch('skills')).toEqual([saved])
  })

  it('get_trait_by_name resolves with a tuple, not two arguments', async () => {
    const character = newCharacter()
    const brawl = trait({ name: 'Brawl' })
    character.set('skills', [trait({ name: 'Academics' }), brawl])

    const [found, self] = await character.get_trait_by_name('skills', 'Brawl')
    expect(found).toBe(brawl)
    expect(self).toBe(character)

    const [missing] = await character.get_trait_by_name('skills', 'Nope')
    expect(missing).toBeUndefined()
  })

  it('get_trait_by_name stringifies the name, as `"" + name` did', async () => {
    const character = newCharacter()
    const five = trait({ name: '5' })
    character.set('skills', [five])

    const [found] = await character.get_trait_by_name('skills', 5)
    expect(found).toBe(five)
  })
})

describe('derived reads', () => {
  it('get_thumbnail_sync falls back to head_skull.png at every missing step', () => {
    const character = newCharacter()
    expect(character.get_thumbnail_sync(32)).toBe('head_skull.png')

    // An unfetched portrait pointer: the thumb reads as undefined.
    const portrait = new Parse.Object('CharacterPortrait')
    character.set('portrait', portrait)
    expect(character.get_thumbnail_sync(32)).toBe('head_skull.png')

    // `_.result` INVOKES the function it lands on, which is how a Parse.File's
    // `url` becomes a string.
    portrait.set('thumb_32', { url: () => 'https://example.test/thumb.png' })
    expect(character.get_thumbnail_sync(32)).toBe('https://example.test/thumb.png')
  })

  it('health_levels returns the three levels in display order', () => {
    const character = newCharacter()
    character.set('health_levels', [
      trait({ name: 'Incapacitated', value: 1 }),
      trait({ name: 'Healthy', value: 3 }),
    ])

    // Injured is absent from the character and still occupies its slot.
    expect(character.health_levels()).toEqual([
      ['Healthy', 3],
      ['Injured', undefined],
      ['Incapacitated', 1],
    ])
  })

  it('get_willpower_total counts an unfetched source as zero, not as NaN', () => {
    const character = newCharacter()
    expect(character.get_willpower_total()).toBe(0)

    character.set('willpower_sources', [
      trait({ name: 'Willpower', value: 6 }),
      // A pointer that was never fetched -- `_.sum` under lodash 3 added
      // `+undefined || 0`, i.e. nothing. lodash 4's `sumBy` returns NaN here.
      trait({ name: 'Unfetched' }),
      trait({ name: 'Bonus', value: 2 }),
    ])
    expect(character.get_willpower_total()).toBe(8)
  })

  it('get_sorted_skills sorts by name with unnamed traits last', () => {
    const character = newCharacter()
    const unnamed = trait({ value: 1 })
    character.set('skills', [
      trait({ name: 'Occult' }),
      unnamed,
      trait({ name: 'Academics' }),
    ])

    const sorted = character.get_sorted_skills()
    expect(sorted.map((s) => s.get('name'))).toEqual(['Academics', 'Occult', undefined])
    expect(sorted[2]).toBe(unnamed)
    // Non-destructive: the stored array keeps its own order.
    expect((character.get('skills') as Parse.Object[])[0]?.get('name')).toBe('Occult')
  })

  it('get_grouped_skills fills three columns and pads the short ones', () => {
    const character = newCharacter()
    character.set(
      'skills',
      ['A', 'B', 'C', 'D'].map((name) => trait({ name })),
    )

    // ceil(4/3) = 2 per column, so the third column holds nothing.
    expect(
      character.get_grouped_skills().map((row) => row.map((t) => t?.get('name'))),
    ).toEqual([
      ['A', 'C', undefined],
      ['B', 'D', undefined],
    ])
  })

  it('get_grouped_skills still zips exactly three columns for any count', () => {
    // The source built `{0: [], 1: [], 2: []}` and zipped those three whatever
    // `columnCount` said, so a fourth column is computed and then dropped.
    // Preserved; the only caller passes 3.
    const character = newCharacter()
    character.set(
      'skills',
      ['A', 'B', 'C', 'D'].map((name) => trait({ name })),
    )

    const rows = character.get_grouped_skills(undefined, 4)
    expect(rows.every((row) => row.length === 3)).toBe(true)
    expect(rows.flat().filter(Boolean).map((t) => t?.get('name'))).toEqual(['A', 'B', 'C'])
  })
})

describe('long text cache', () => {
  it('has_fetched_long_text distinguishes "never asked" from "server has none"', () => {
    const character = newCharacter()
    expect(character.has_fetched_long_text('background')).toBe(false)
    expect(character.get_fetched_long_text('background')).toBeUndefined()

    character._ltCache.background = null
    expect(character.has_fetched_long_text('background')).toBe(true)
    expect(character.get_fetched_long_text('background')).toBeNull()

    character.free_fetched_long_text('background')
    expect(character.has_fetched_long_text('background')).toBe(false)
  })

  it('the cache is per character and survives being handed to another one', () => {
    const a = newCharacter()
    const b = newCharacter()
    a._ltCache.background = null
    expect(b.has_fetched_long_text('background')).toBe(false)

    // `get_transformed` copies the cache by REFERENCE onto the clone, so a long
    // text fetched through the clone lands on the original. Load-bearing for the
    // print view.
    b._ltCache = a._ltCache
    a._ltCache.notes = null
    expect(b.has_fetched_long_text('notes')).toBe(true)
  })
})

describe('per-instance state', () => {
  it('two references to one row share one write queue', () => {
    const object = new CharacterObject()
    expect(characterFor(object).traitQueue).toBe(characterFor(object).traitQueue)
    expect(characterFor(object).experience).toBe(characterFor(object).experience)
  })

  it('different rows get different queues', () => {
    expect(newCharacter().traitQueue).not.toBe(newCharacter().traitQueue)
  })
})
