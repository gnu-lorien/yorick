/**
 * What the object state controller does to UNSAVED edits.
 *
 * `initParse()` calls `Parse.Object.disableSingleInstance()`, which is not a
 * tidy-up: it decides whether two references to the same row share one bag of
 * state or keep their own. Every screen in this app reads rows through
 * `Parse.Query`, and several of them mutate objects in place and save later --
 * `Character.update_trait` builds up a trait over `Character.ts:837-888`, the
 * creation record is edited across `Character.ts:1067-1202`, and
 * `pick_from_creation` writes through `this.set(target, value)` at
 * `Character.ts:1376`. Between the first `set` and the `save` there is a window,
 * sometimes a long one, where a row carries edits that are not on the server.
 *
 * The question these tests answer is what a SECOND reference to that same row --
 * another screen, a pointer on another object, a list still in memory -- sees
 * during that window.
 *
 * Every behavioural test below runs the identical scenario under both
 * controllers and asserts both outcomes. That is deliberate. A test that only
 * pinned the current setting would tell a later reader that something is true
 * without telling them it is a CHOICE, and this choice has already been made
 * twice in this repo in opposite directions: `parse-compat/index.js:123`
 * disables it for the Backbone client, and the npm build defaults it on.
 *
 * These need no server: pending operations live entirely on the client.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import Parse, { initParse } from '@/parse'

beforeAll(() => {
  // The app's real configuration, not the SDK default. Importing the default
  // export alone does NOT configure the SDK -- `initParse` is what does.
  initParse()
})

/**
 * Run `fn` under a chosen state controller, then put the app's setting back.
 *
 * Objects must be built INSIDE `fn`: the state identifier is read when state is
 * first touched, so an object created under one controller does not migrate to
 * the other.
 */
function underSingleInstance<T>(enabled: boolean, fn: () => T): T {
  try {
    if (enabled) Parse.Object.enableSingleInstance()
    else Parse.Object.disableSingleInstance()
    return fn()
  } finally {
    Parse.Object.disableSingleInstance()
  }
}

/** A row as it arrives from the server: fetched, clean, with real data on it. */
function fetched(
  className: string,
  objectId: string,
  fields: Record<string, unknown> = {},
): Parse.Object {
  return Parse.Object.fromJSON({ className, objectId, ...fields }) as Parse.Object
}

/**
 * The two references one row gets when two screens each query for it.
 *
 * This is the ordinary case, not a contrived one -- nothing in the app hands
 * objects from route to route, so a character open on the sheet and the same
 * character in the roster behind it are two decoded copies of one row.
 */
function twoScreensReading(
  className: string,
  objectId: string,
  fields: Record<string, unknown>,
): readonly [Parse.Object, Parse.Object] {
  return [fetched(className, objectId, fields), fetched(className, objectId, fields)] as const
}

/**
 * Hydrate a pointer the way `usersStore.hydrate` does.
 *
 * `_finishFetch` rather than `set`, for the store's own reason
 * (`stores/users.ts:99-144`): it writes serverData and leaves no pending
 * operation, so this reproduces hydration instead of imitating it.
 */
function hydrate(pointer: Parse.Object, username: string): void {
  ;(pointer as unknown as { _finishFetch: (json: unknown) => void })._finishFetch({
    objectId: pointer.id,
    username,
  })
}

describe('the object state controller and unsaved edits', () => {
  it('is disabled by initParse, so the app runs on per-object state', () => {
    // Pins the app's actual configuration. If this flips, everything below
    // describes the wrong client.
    const [a, b] = twoScreensReading('Vampire', 'cfg1', { name: 'Ancilla' })
    a.set('name', 'edited')
    expect(b.get('name'), 'two references must not share state under initParse()').toBe('Ancilla')
  })

  describe('a screen editing a character while another screen holds it', () => {
    /**
     * An interesting amount of unsaved work: the shape the creation flow and
     * `update_trait` actually produce -- several attributes, a counter, and a
     * list -- none of it saved.
     */
    const editHeavily = (character: Parse.Object): void => {
      character.set('name', 'Renamed In The Editor')
      character.set('experience_earned', 120)
      character.set('experience_spent', 95)
      character.increment('experience_earned', 30)
      character.set('notes', 'draft text the player has not submitted')
      character.addUnique('flags', 'being-edited')
      character.set('approved', false)
    }

    it('does not leak those edits to the other screen (single instance OFF)', () => {
      underSingleInstance(false, () => {
        const [editing, watching] = twoScreensReading('Vampire', 'chr1', {
          name: 'Original Name',
          experience_earned: 100,
          experience_spent: 90,
          approved: true,
        })

        editHeavily(editing)

        expect(editing.get('name')).toBe('Renamed In The Editor')
        expect(editing.get('experience_earned')).toBe(150)

        // The whole point: the other screen still shows the server's answer.
        expect(watching.get('name')).toBe('Original Name')
        expect(watching.get('experience_earned')).toBe(100)
        expect(watching.get('experience_spent')).toBe(90)
        expect(watching.get('approved')).toBe(true)
        expect(watching.get('notes')).toBeUndefined()
        expect(watching.get('flags')).toBeUndefined()
      })
    })

    it('DOES leak all of them (single instance ON)', () => {
      underSingleInstance(true, () => {
        const [editing, watching] = twoScreensReading('Vampire', 'chr2', {
          name: 'Original Name',
          experience_earned: 100,
          experience_spent: 90,
          approved: true,
        })

        editHeavily(editing)

        // Same scenario, opposite result: the untouched screen has silently
        // taken on every unsaved edit made somewhere else.
        expect(watching.get('name')).toBe('Renamed In The Editor')
        expect(watching.get('experience_earned')).toBe(150)
        expect(watching.get('experience_spent')).toBe(95)
        expect(watching.get('approved')).toBe(false)
        expect(watching.get('notes')).toBe('draft text the player has not submitted')
      })
    })
  })

  describe('what the other screen would SAVE', () => {
    /*
     * This is the hazard, not the display difference above.
     *
     * A screen that never edited anything can still call `save()` -- the
     * approval screen, the troupe-join button, anything that writes one field.
     * If unsaved edits from a different screen are sitting on shared state, that
     * save carries them to the server as though the user had made them.
     */
    it('carries nothing but its own edit (single instance OFF)', () => {
      underSingleInstance(false, () => {
        const [editing, approving] = twoScreensReading('Vampire', 'chr3', {
          name: 'Original Name',
          approved: false,
        })

        editing.set('name', 'unsubmitted rename')
        editing.set('notes', 'unsubmitted notes')

        approving.set('approved', true)

        expect(
          approving.dirtyKeys().sort(),
          'the approval save must send only `approved`',
        ).toEqual(['approved'])
      })
    })

    it('would also send the other screen edits (single instance ON)', () => {
      underSingleInstance(true, () => {
        const [editing, approving] = twoScreensReading('Vampire', 'chr4', {
          name: 'Original Name',
          approved: false,
        })

        editing.set('name', 'unsubmitted rename')
        editing.set('notes', 'unsubmitted notes')

        approving.set('approved', true)

        // Three keys, from two screens, in one request the user never made.
        expect(approving.dirtyKeys().sort()).toEqual(['approved', 'name', 'notes'])
      })
    })
  })

  describe('a pointer shared by two parents', () => {
    /*
     * #13's exact shape. `usersStore.hydrate` fills in an owner's display name,
     * and the roster it was asked about is not supposed to be the whole session.
     */
    it('confines hydration to the roster that asked (single instance OFF)', () => {
      underSingleInstance(false, () => {
        const adminRoster = fetched('Vampire', 'chr5', {
          owner: { __type: 'Pointer', className: '_User', objectId: 'user1' },
        })
        const myRoster = fetched('Vampire', 'chr6', {
          owner: { __type: 'Pointer', className: '_User', objectId: 'user1' },
        })

        hydrate(adminRoster.get('owner'), 'thestoryteller')

        expect(adminRoster.get('owner').get('username')).toBe('thestoryteller')
        expect(
          myRoster.get('owner').get('username'),
          'a roster that never hydrated must not acquire the name',
        ).toBeUndefined()
      })
    })

    it('makes hydration global and permanent (single instance ON)', () => {
      underSingleInstance(true, () => {
        const adminRoster = fetched('Vampire', 'chr7', {
          owner: { __type: 'Pointer', className: '_User', objectId: 'user2' },
        })
        const myRoster = fetched('Vampire', 'chr8', {
          owner: { __type: 'Pointer', className: '_User', objectId: 'user2' },
        })

        hydrate(adminRoster.get('owner'), 'thestoryteller')

        // One visit to one screen, and every `_User` pointer in the session now
        // answers with a username for as long as the tab is open.
        expect(myRoster.get('owner').get('username')).toBe('thestoryteller')
      })
    })
  })

  describe('what a save response does to children already fetched', () => {
    /*
     * The trap `docs/runbooks/parse8-migration-handoff.md:257` warns about, and
     * the reason the Backbone client needed a wrap at
     * `public/scripts/lib/parse-compat/events.js:385`:
     *
     *   "a save response's bare pointers would unfetch what you already have"
     *
     * parse-server answers a save with the row's pointer columns as BARE
     * pointers. `_handleSaveResponse` decodes the response into serverData, so
     * those bare pointers replace whatever was in those columns -- and under
     * per-object state the replacement is a brand new empty object rather than
     * another handle on the data already loaded.
     *
     * This is the whole editing flow: save a character, then read its creation
     * record or its traits off the object you just saved.
     */
    const withFetchedChild = (objectId: string): Parse.Object =>
      fetched('Vampire', objectId, {
        name: 'Ancilla',
        creation: {
          __type: 'Object',
          className: 'bnsmetv1_CharacterCreation',
          objectId: 'crt1',
          completed: false,
          remaining_skills: 3,
        },
      })

    /** What parse-server sends back: the pointer column, bare. */
    const saveResponse = {
      updatedAt: '2026-08-23T00:00:00.000Z',
      creation: { __type: 'Pointer', className: 'bnsmetv1_CharacterCreation', objectId: 'crt1' },
    }

    const applySaveResponse = (object: Parse.Object): void =>
      (
        object as unknown as { _handleSaveResponse: (r: unknown, s: number) => void }
      )._handleSaveResponse(saveResponse, 200)

    it('keeps the child fetched (single instance ON)', () => {
      underSingleInstance(true, () => {
        const character = withFetchedChild('sav1')
        expect(character.get('creation').get('remaining_skills')).toBe(3)

        applySaveResponse(character)

        // The bare pointer resolves to the same shared state, so the data the
        // editor is about to read is still there. This is why the port has
        // survived without a re-attach wrap so far.
        expect(character.get('creation').get('remaining_skills')).toBe(3)
      })
    })

    it('unfetches the child (single instance OFF) -- the wrap this port lacks', () => {
      underSingleInstance(false, () => {
        const character = withFetchedChild('sav2')
        expect(character.get('creation').get('remaining_skills')).toBe(3)

        applySaveResponse(character)

        /*
         * If this assertion ever starts failing, a re-attach wrap has been
         * added and this test should be inverted rather than deleted -- the
         * point is to pin WHICH behaviour is in force, because the editing flow
         * reads through exactly this pointer after a save.
         */
        expect(
          character.get('creation').get('remaining_skills'),
          'per-object state drops the fetched child unless the save response is re-attached',
        ).toBeUndefined()
      })
    })
  })

  describe('the cost of per-object state', () => {
    it('means a screen does not see another screen SAVED write either', () => {
      /*
       * Honest counterpart to everything above, and the reason this is a trade
       * rather than a free win: isolation applies to saved data too, so a screen
       * holding an older reference keeps showing the old answer until it
       * refetches.
       *
       * Every route in this client fetches on entry, which is what makes the
       * trade payable. Anything that starts passing objects between routes
       * instead has to answer this test first.
       */
      underSingleInstance(false, () => {
        const [saving, stale] = twoScreensReading('Vampire', 'chr9', { name: 'Original Name' })

        // What the server would send back after a successful save elsewhere.
        hydrate(saving, 'unused')
        saving.set('name', 'Saved Elsewhere')

        expect(saving.get('name')).toBe('Saved Elsewhere')
        expect(stale.get('name'), 'the stale screen must refetch to see this').toBe('Original Name')
      })
    })
  })
})
