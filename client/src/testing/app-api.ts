/**
 * `window.__yorickApi` — the deliberate test surface.
 *
 * The Playwright suite does two things no ordinary user does, and both used to
 * work by reaching straight into the app's internals:
 *
 * 1. **Re-dispatch the current route.** `navigateToHash` sets
 *    `window.location.hash`, but when the hash is already the wanted one no
 *    `hashchange` fires and the route never re-runs. The legacy helper solved
 *    that with `window.require(['backbone'], (B) => B.history.loadUrl(h))`.
 *    `reload(hash)` is the replacement.
 *
 * 2. **Build fixtures out of the domain model.** `runInApp` loads AMD modules
 *    by path and calls their statics — `Vampire.create(name)`,
 *    `character.fetch_all_creation_elements()`, `get_in_clan_disciplines()`.
 *    Eighteen call sites across the helpers and five spec files do this, and it
 *    is how every character in every test is created. `modules` publishes the
 *    ported equivalents under the SAME AMD paths, so those call sites need no
 *    edit at all.
 *
 * Exposing this is a considered decision, not a leak. The alternative is
 * rewriting fixture setup for 451 tests as REST calls, which would mean the
 * migration's only oracle is itself newly written and unverified — the one
 * thing a migration cannot afford. The surface is additive, is used by nothing
 * in the application, and costs a few hundred bytes.
 *
 * `window.Parse` is set separately in `main.ts`; 216 uses across 27 spec files
 * depend on it, and it is also the only debugging tool this app has ever had.
 *
 * ## `window.require`
 *
 * Eight places in the suite call `require([...], fn)` DIRECTLY inside
 * `page.evaluate`, rather than going through `runInApp` -- so branching inside
 * that one helper is not enough. A minimal AMD `require` is installed over the
 * same module map, which makes every one of those sites work unedited. It
 * resolves only from the map: an unknown path is an error naming the path,
 * because the alternative is `mods[0]` arriving as `undefined` and failing
 * somewhere else entirely.
 */
import type { Router } from 'vue-router'
import { normaliseHash } from '@/router/backbone-hash'
import { pathForHash } from '@/router'

/** Bumped to force the router outlet to rebuild a component in place. */
let remountKey = 0
const listeners = new Set<() => void>()

export function currentRemountKey(): number {
  return remountKey
}

export function onRemount(fn: () => void): void {
  listeners.add(fn)
}

/**
 * The module map, keyed by the AMD paths the E2E suite already names.
 *
 * Filled by `registerTestModules` as the domain layer loads, rather than
 * imported here, so that this file does not pull the whole domain into the
 * entry chunk for every user in order to serve a test harness.
 */
const modules: Record<string, unknown> = {}

export function registerTestModules(entries: Record<string, unknown>): void {
  Object.assign(modules, entries)
}

export interface YorickTestApi {
  /** Re-run the current route, even when the hash has not changed. */
  reload(hash?: string): Promise<void>
  /** Ported domain modules, keyed by their old AMD paths. */
  modules: Record<string, unknown>
  /** The router, for tests that need to inspect resolution directly. */
  router: Router
}

/**
 * A minimal AMD `require` over the module map.
 *
 * Signature matches RequireJS's `require(deps, onSuccess, onError)`, which is
 * the only form the suite uses. Synchronous, because everything it can resolve
 * is already loaded -- there is no loader here and nothing to wait for.
 */
function amdRequire(
  deps: string[],
  onSuccess?: (...mods: unknown[]) => void,
  onError?: (error: Error) => void,
): void {
  const missing = deps.filter((d) => !(d in modules))
  if (missing.length) {
    const error = new Error('the Vue client publishes no test module for: ' + missing.join(', '))
    if (onError) {
      onError(error)
      return
    }
    throw error
  }
  onSuccess?.(...deps.map((d) => modules[d]))
}

export function installTestApi(router: Router): void {
  const api: YorickTestApi = {
    async reload(hash?: string) {
      /*
       * Dispatch the hash the CALLER asked for, never `router.currentRoute`.
       *
       * `hashchange` is delivered asynchronously, so between an in-app
       * `window.location.hash = "#character?X"` and the router acting on it
       * there is a window where `location.hash` already reads the new value
       * while `router.currentRoute` still holds the old one. `navigateToHash`
       * lands exactly in that window: it sees the hash already matching, takes
       * the "no hashchange will fire" branch, and calls this.
       *
       * Re-dispatching `currentRoute` there re-ran the route the app had just
       * navigated AWAY from -- for `#charactercreate/complete/:cid` that meant
       * completing creation a second time -- and then that route's own
       * `window.location.hash = ...` was a no-op, because the hash already held
       * the wanted value. The router stayed on an action route that renders
       * nothing, and the app was left with no active page at all.
       *
       * Resolving the requested hash here makes the call independent of whether
       * the pending `hashchange` has been delivered yet.
       */
      const wantedPath =
        hash === undefined ? null : pathForHash(normaliseHash(hash))

      if (hash !== undefined) {
        const wanted = hash.startsWith('#') ? hash : '#' + hash
        if (window.location.hash !== wanted) window.location.hash = wanted
      }

      // Force the component to be torn down and rebuilt, which is what
      // `Backbone.history.loadUrl` amounted to for a handler that re-fetched
      // and re-rendered.
      remountKey++
      for (const fn of listeners) fn()
      await router
        .replace(
          wantedPath !== null
            ? ({ path: wantedPath, force: true } as never)
            : ({
                path: router.currentRoute.value.path,
                query: router.currentRoute.value.query,
                force: true,
              } as never),
        )
        .catch(() => {
          // A redundant navigation is not an error worth surfacing to a test.
        })
    },
    modules,
    router,
  }

  ;(window as unknown as { __yorickApi: YorickTestApi }).__yorickApi = api
  ;(window as unknown as { require: typeof amdRequire }).require = amdRequire
}
