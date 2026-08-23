/**
 * The ported domain, published under the AMD paths the E2E suite already names.
 *
 * `runInApp` (`e2e/helpers/jqm-helpers.js:390`) is how every character in every
 * test is built. It loads modules by path and calls their statics:
 *
 *     runInApp(page, ['app/models/Vampire'], 'return mods[0].create(arg.name)', {name})
 *
 * Eighteen call sites do this — ten in `helpers/characters.js`, one in
 * `helpers/descriptions.js`, and six across the lifecycle and traits specs.
 * Keeping the KEYS identical means none of them needs editing; only the lookup
 * inside the helper changed, and it branches on which app answered.
 *
 * The facades below are thin. Their job is to present the venue statics the way
 * `Vampire.js` / `Werewolf.js` / `ChangelingBetaSlice.js` presented them —
 * `Model.create(name)` and `Model.get_character(id, categories)` — over a domain
 * layer that models venues as strategies rather than as three classes. Nothing
 * here contains behaviour of its own; if a test needs something these do not
 * expose, the right move is to add it here rather than to reach past it.
 */
import { get_character, characterFor, type Character, type CharacterCache } from '@/domain/Character'
import { getLatestPatronage } from '@/domain/Patronage'
import { ALL_VENUES, venueFor, type VenueKey, type VenueStrategy } from '@/domain/venues'
import { registerTestModules } from '@/testing/app-api'
import Papa from 'papaparse'
import Parse from '@/parse'
import lodash from 'lodash'

/**
 * The collaborators `venue.create` needs.
 *
 * `Model.create` was a static reaching for module singletons; the strategy takes
 * them as parameters so the creation sequence is testable without a server.
 */
function createDeps() {
  return {
    get_latest_patronage: (user: Parse.User) => getLatestPatronage(user),
    get_character: (id: string) => get_character(id) as unknown as Promise<never>,
    progress: (text: string) => {
      // `Vampire.js:371` fell back to this whenever jQuery Mobile was absent,
      // which in the Vue client is always.
      console.log('Progress: ' + text)
    },
  }
}


/**
 * A native promise wearing Parse 1.5's `done` / `fail` / `always`.
 *
 * The spec files chain those onto whatever the app hands back --
 * `Vampire.create_test_character(n).then(...).fail(...)` is a real line in
 * `character-sheet.spec.js`. They are Parse 1.5's promise API, which
 * `parse-compat` restores for the Backbone client and which the Vue client
 * deliberately does not have: the application uses native promises throughout.
 *
 * So the shim lives HERE, on the test surface only, where it costs the
 * application nothing and saves editing assertions in 21 spec files. The
 * semantics are transcribed from `parse-1.5.0.js:4176-4184`:
 *
 *     done(cb)   = then(cb)
 *     fail(cb)   = then(null, cb)
 *     always(cb) = then(cb, cb)
 *
 * `always` is the one that matters: it maps a rejection to a FULFILMENT, which
 * is what made the old promise queues impossible to wedge. Every derived
 * promise is wrapped again so a chain keeps working to its end.
 */
type CompatPromise<T> = Promise<T> & {
  done<R>(cb: (value: T) => R): CompatPromise<Awaited<R>>
  fail<R>(cb: (error: unknown) => R): CompatPromise<T | Awaited<R>>
  always<R>(cb: (valueOrError: unknown) => R): CompatPromise<Awaited<R>>
}

function withParseCompat<T>(promise: Promise<T>): CompatPromise<T> {
  const compat = promise as CompatPromise<T>
  compat.done = (cb) => withParseCompat(promise.then(cb)) as never
  compat.fail = (cb) => withParseCompat(promise.then(undefined, cb)) as never
  compat.always = (cb) => withParseCompat(promise.then(cb, cb)) as never
  /*
   * `then` is overridden so a derived promise carries the methods too --
   * otherwise `create().then(...).fail(...)` finds `fail` missing on the result
   * of `then`, which is exactly how this surfaced.
   */
  const nativeThen = promise.then.bind(promise)
  compat.then = ((onFulfilled?: never, onRejected?: never) =>
    withParseCompat(nativeThen(onFulfilled, onRejected))) as never
  return compat
}

/** One venue, wearing the shape `Model` had in the AMD app. */
function venueFacade(venue: VenueStrategy) {
  return {
    /** `Model.create(name)`. */
    create(name: string): CompatPromise<Character> {
      return withParseCompat(
        venue.create(name, createDeps() as never) as unknown as Promise<Character>,
      )
    },

    /**
     * `Model.create_test_character(nameappend)` (`Vampire.js:427`).
     *
     * A fixture helper that shipped in the application bundle. The name shape is
     * reproduced exactly -- `karmacharactertest<append><random>` -- because the
     * suite's sweep helpers find and destroy their fixtures by that prefix, and
     * a character that does not match it survives teardown and contaminates the
     * next run.
     */
    create_test_character(nameappend?: string): CompatPromise<Character> {
      const name =
        'karmacharactertest' + (nameappend ?? '') + Math.random().toString(36).slice(2)
      return this.create(name)
    },

    /** `Model.get_character(id, categories, cache)`. */
    get_character(
      id: string,
      categories?: string | readonly string[],
      cache?: CharacterCache,
    ): CompatPromise<Character> {
      return withParseCompat(get_character(id, categories, cache))
    },

    /** The strategy itself, for a test that wants a category list or a cost. */
    venue,

    /** `Model.all_simpletrait_categories()`. */
    all_simpletrait_categories() {
      return venue.ALL_SIMPLETRAIT_CATEGORIES
    },

    /** `Model.all_text_attributes()`. */
    all_text_attributes() {
      return venue.TEXT_ATTRIBUTES
    },

    /** Wrap an already-fetched row as a character of this venue. */
    characterFor,
  }
}

const VENUE_MODULE_PATHS: Record<string, VenueKey> = {
  'app/models/Vampire': 'Vampire',
  'app/models/Werewolf': 'Werewolf',
  'app/models/ChangelingBetaSlice': 'ChangelingBetaSlice',
}

/**
 * Publish the map. Called from the app bootstrap.
 *
 * Registering unconditionally rather than behind a flag is deliberate: a flag
 * would be one more thing that can differ between the build a developer tests
 * and the build the suite runs, and this costs a few hundred bytes.
 */
export function installTestModules(): void {
  const modules: Record<string, unknown> = {}

  for (const [path, key] of Object.entries(VENUE_MODULE_PATHS)) {
    modules[path] = venueFacade(venueFor(key))
  }

  /*
   * `app/views/CharacterExperienceView` has one `runInApp` call site, which
   * reaches it for the XP ledger rather than for anything the view renders.
   * The ledger now lives in the domain layer, so the path resolves there.
   */
  modules['app/views/CharacterExperienceView'] = {
    get_character: (id: string) => withParseCompat(get_character(id, 'all')),
  }

  modules['app/domain/venues'] = { ALL_VENUES, venueFor }
  modules['parse'] = Parse
  /*
   * `papaparse`, because `helpers/descriptions.js:readBulkEditorRows` parses
   * the bulk editor's textarea with the APP's copy rather than one of its own.
   * That is deliberate on the suite's part: "what the table shows" is then read
   * exactly the way the app produces it, with the same options and the same
   * edge cases, instead of through a second parser that might disagree.
   */
  modules['papaparse'] = Papa
  modules['underscore'] = lodash
  modules['lodash'] = lodash

  /*
   * `window._`, for the same reason as `window.Parse` and `window.require`.
   *
   * Several specs evaluate lodash inside the page -- `_.map(c.all_simpletrait_categories(), ...)`
   * in `lifecycle-werewolf.spec.js:619`, `_.each` and `_.isUndefined` in
   * `helpers/characters.js` -- because the legacy app aliased `underscore` to a
   * vendored lodash and RequireJS left it on the global.
   *
   * NOTE: that vendored copy is lodash 3.10.0 and this is lodash 4. The removed
   * and renamed functions are listed in `@/domain/print`; a spec reaching for
   * `_.pluck` or `_.select` here will get `undefined is not a function` rather
   * than a wrong answer, which is the failure mode to prefer.
   */
  ;(window as unknown as { _: typeof lodash })._ = lodash

  /*
   * `backbone`, for `navigateToHash`'s same-hash fallback.
   *
   * The helper now prefers `__yorickApi.reload`, but a spec that reaches for
   * `Backbone.history.loadUrl` directly still gets the behaviour it wanted:
   * re-dispatch the current route.
   */
  modules['backbone'] = {
    history: {
      loadUrl(hash?: string) {
        const api = (window as unknown as { __yorickApi?: { reload(h?: string): Promise<void> } })
          .__yorickApi
        return api?.reload(hash)
      },
    },
  }

  registerTestModules(modules)
}
