/**
 * The router, and the two-way bridge between it and `window.location.hash`.
 *
 * Vue Router runs on an in-memory history over the internal paths in
 * `routes.ts`; this module keeps the address bar showing the Backbone-format
 * hash the app has always used. See `backbone-hash.ts` for why the two cannot
 * be the same string.
 *
 * It also carries the auth gate that `mobileRouter.js` applied per handler.
 * There, `enforce_logged_in` (:1483) and `enforce_admin` (:1546) were called by
 * hand at the top of each handler, which is why the gating was inconsistent --
 * `#administration` itself, the front door listing all thirteen destinations,
 * checked nothing. Here it is one `beforeEach` reading `meta.gate`, so a route
 * cannot be added without stating its gate.
 */
import { createRouter, createMemoryHistory, type Router, type RouteLocationNormalized } from 'vue-router'
import { routes, type YorickRouteMeta } from './routes'
import { extraRoutes } from './extra-routes'
import { compilePattern, formatPattern, hashToPath, normaliseHash, type HashPattern } from './backbone-hash'
import { useAuthStore } from '@/stores/auth'
import { promiseFailReport, reportError } from '@/domain/errors'
import { rememberScroll } from '@/composables/useScrollRestore'
import Parse from '@/parse'

/** Compiled patterns, in route-table order, which is Backbone's match order. */
const allRoutes = [...routes, ...extraRoutes]

/*
 * Only the generated table takes part in hash matching. `login` and the
 * catch-all have no Backbone pattern, so they are reachable by name from a
 * guard but never by URL -- which is what keeps a signed-out visitor's original
 * hash in the address bar while the login form is showing.
 */
const compiled: { pattern: HashPattern; name: string }[] = routes.map((r) => ({
  pattern: compilePattern((r.meta as unknown as YorickRouteMeta).pattern),
  name: String(r.name),
}))

const byName = new Map(compiled.map((c) => [c.name, c.pattern]))

export const router: Router = createRouter({
  history: createMemoryHistory(),
  routes: allRoutes,
})

/**
 * The hash a resolved route should display.
 *
 * Rendered from the route's own Backbone pattern and its params, so
 * `#character/abc/log/0/25` and `#characters?all` both come out exactly as the
 * old app wrote them.
 */
export function hashForRoute(route: RouteLocationNormalized): string {
  const pattern = byName.get(String(route.name))
  if (!pattern) return ''
  return formatPattern(pattern, route.params as Record<string, unknown>)
}

/** Where a Backbone-format hash should take the router. */
export function pathForHash(hash: string): string | null {
  const match = hashToPath(
    compiled.map((c) => c.pattern),
    hash,
  )
  return match ? match.path : null
}

/*
 * Guard: the auth gate.
 *
 * `#login` was a page in `index.html` that `enforce_logged_in` swapped to
 * WITHOUT changing the hash, so a signed-out visitor deep-linking to a
 * character saw the login form with their original URL intact and, after
 * signing in, a reload took them where they meant to go. That behaviour is
 * preserved: the guard routes to the login page while `suppressHashWrite`
 * leaves the address bar alone.
 */
let suppressHashWrite = false

router.beforeEach(async (to, from) => {
  const meta = to.meta as unknown as YorickRouteMeta
  const auth = useAuthStore()

  /*
   * Stash where the reader is before the page changes under them.
   *
   * This guard runs while the OUTGOING page is still on screen, which is the
   * only moment its scroll offset can be read. Doing it here rather than in
   * each departing route is what stops a new side trip from silently forgetting
   * to. `useScrollRestore` puts it back.
   */
  if (from.fullPath && from.fullPath !== to.fullPath) rememberScroll(from.fullPath)

  /*
   * `get_character` ran BEFORE `changePage`, so a character the caller cannot
   * read never brought the page up at all. Reproduced as a guard rather than as
   * an empty screen, because an empty approval screen and a refused one look
   * the same to a reader and mean very different things.
   *
   * The fetch is not wasted: `get_character` is what the page itself calls a
   * moment later, and the SDK answers the second call from the same session.
   */
  if (meta.requiresReadableCharacter) {
    const cid = to.params.cid
    if (typeof cid === 'string' && cid) {
      try {
        const { get_character } = await import('@/domain/Character')
        await get_character(cid)
      } catch (error) {
        promiseFailReport(error)
        return false
      }
    }
  }

  if (meta.gate === 'none') return true

  if (!auth.isLoggedIn) {
    suppressHashWrite = true
    return { name: 'login', replace: true }
  }

  /*
   * Refresh the administrator flag before an admin gate decides anything.
   * The store rate-limits this to once every five minutes, matching the
   * router's own `lastadminchecktime` check, so ordinary navigation does not
   * add a role query per page.
   */
  if (meta.gate === 'admin') {
    try {
      await auth.refreshAdminStatus()
    } catch {
      // A failed role check must not strand the user on a blank screen; fall
      // through to the flag we already have.
    }
    if (!auth.isAdmin) {
      /*
       * The BANNER, not the popup.
       *
       * `enforce_admin` rejected with a `Parse.Error(OPERATION_FORBIDDEN, ...)`
       * and `admin_route_failed` handed it to `ReportError`, which is the
       * inline `#global-error-region` -- the thing that survives the redirect
       * and is still on screen when the user lands on the home page.
       * `access-control.spec.js:381` reads exactly that region.
       *
       * The UI store's `reportError` is a different mechanism (a modal popup)
       * used by screens that report an error and stay put. A refusal that
       * navigates has to use the one that follows the navigation.
       */
      void reportError(
        new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'Administrator access is required for that page.',
        ),
      ).catch(() => {})
      return { name: 'home', replace: true }
    }
  }

  /*
   * The bare `if (is_ad) { ... }` gate, with no `else`.
   *
   * Aborting the navigation is what "the handler did nothing" means here: the
   * page the user was already on stays mounted and on screen, no banner
   * appears, and the address bar keeps whatever they typed. Redirecting home
   * instead would be a friendlier app and a different one.
   */
  if (meta.gate === 'admin-silent') {
    try {
      await auth.refreshAdminStatus()
    } catch {
      // As above: fall through to the flag we already have.
    }
    if (!auth.isAdmin) return false
  }

  return true
})

/**
 * Guard: a new screen starts at the top.
 *
 * `$.mobile.changePage` scrolled to the top of the incoming page, and losing
 * that is not neutral -- the browser keeps the outgoing page's offset, so
 * opening the trait picker from halfway down the creation wizard rendered the
 * picker already scrolled past its own first options. Measured at 938px into a
 * list whose first entry was at 0.
 *
 * This runs BEFORE the incoming component is created, so a page that restores a
 * remembered position (`useScrollRestore`) still wins: its restore is driven by
 * data arriving, which is strictly later.
 */
router.afterEach(() => {
  window.scrollTo(0, 0)
})

/** Guard: keep the address bar in the Backbone format after every navigation. */
router.afterEach((to) => {
  if (suppressHashWrite) {
    suppressHashWrite = false
    return
  }
  const hash = hashForRoute(to)
  const wanted = hash ? '#' + hash : ''
  if (window.location.hash !== wanted) {
    writingHash = true
    // `replaceState` rather than assigning `location.hash`, so a route change
    // the router initiated does not push a second history entry on top of the
    // one Vue Router already recorded.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + wanted)
    writingHash = false
  }
})

/** Set while this module is the one writing the hash, to ignore the echo. */
let writingHash = false

/**
 * Drive the router from the address bar.
 *
 * This is the entry point the E2E suite uses for all 256 of its navigations --
 * `navigateToHash` assigns `window.location.hash` and waits -- and it is how
 * every in-app `window.location.hash = ...` in the ported views will work too,
 * so the old navigation idiom keeps working unchanged.
 */
export function startHashSync(): void {
  const go = () => {
    if (writingHash) return
    const hash = normaliseHash(window.location.hash)
    const path = pathForHash(hash)
    if (path === null) {
      // Backbone silently ignored an unmatched hash. Doing the same keeps a
      // stale bookmark from blanking the screen.
      return
    }
    if (router.currentRoute.value.fullPath !== path) void router.push(path)
  }

  window.addEventListener('hashchange', go)
  go()
}
