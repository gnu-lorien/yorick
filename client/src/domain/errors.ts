/**
 * Shared error reporting.
 *
 * The port of `public/scripts/app/helpers/ReportError.js` and
 * `helpers/PromiseFailReport.js`.
 *
 * The application's long-standing habit is to swallow its own failures -- a
 * bare `.fail(console.log)`, or no failure handler at all -- so a save that
 * 404s looks exactly like a save that worked. `PromiseFailReport` logs and
 * reports to TrackJS, but it renders nothing: a user cannot tell success from
 * failure, and neither can a developer reading the screen.
 *
 * This module is the one place that puts a failure *where the user is looking*.
 * It drives an inline `.error` banner rendered into the active page by
 * `components/GlobalErrorRegion.vue`.
 *
 * Following the navigation matters. Several failure handlers surface the error
 * and then redirect (`SimpleTraitSpecializationView.save_clicked` and the
 * router's `admin_route_failed` are two), so a banner pinned to the page the
 * user is leaving would never be read. The banner therefore follows exactly one
 * page change -- the one the failure itself triggers -- and is then cleared by
 * the next navigation the user makes, or by clicking it.
 *
 * ## What changed in the port
 *
 * The jQuery version owned its own DOM: it built the `<div>`, appended it to
 * `<body>`, and moved it between jQuery Mobile pages with `.detach()`. Here the
 * module owns only the STATE -- the message and the phase -- and the component
 * renders it. `attachSeq` is how the state layer says "re-attach now" without
 * knowing anything about the DOM.
 *
 * The other change is what "a page change" means. jQuery Mobile fired both
 * `pagecontainershow` and a bubbling `pageshow` for one transition, so the
 * original keyed off the page ELEMENT rather than the event count. Vue Router
 * has the same hazard in a different shape: a `beforeEach` guard that redirects
 * aborts the first navigation and starts a second, and `afterEach` runs for
 * BOTH. Keying off the route actually showing -- and ignoring the failed
 * navigation -- is the same defence, for the same reason: one navigation must
 * not count twice and clear a banner the user was meant to read.
 */
import type { Router } from 'vue-router'
import { computed, ref, type ComputedRef } from 'vue'
import Parse from '@/parse'

/** The id the banner element carries. Six E2E assertions locate it by this. */
export const REGION_ID = 'global-error-region'

/**
 * Where we are in the "follow the redirect" dance:
 *   'idle'   - nothing showing
 *   'follow' - showing, and the next page change should carry it along
 *   'settle' - showing on its final page; the next page change clears it
 */
export type ErrorPhase = 'idle' | 'follow' | 'settle'

const phase = ref<ErrorPhase>('idle')
const message = ref('')

/**
 * Bumped every time the banner should be (re)attached to the active page. The
 * stand-in for the original's `$region.detach()` / `prepend()`: the component
 * watches this and moves itself, so nothing here touches the DOM.
 */
const attachSeq = ref(0)

/**
 * The page the banner is currently rendered onto, as a route identity.
 *
 * The original held the page ELEMENT (`showing_on`). A route's `fullPath` is
 * the honest equivalent here, because exactly one page component is mounted at
 * a time and the route is what decides which.
 */
let showingOn: string | null = null

/** Read-only views for the component. */
export const bannerMessage: ComputedRef<string> = computed(() => message.value)
export const bannerPhase: ComputedRef<ErrorPhase> = computed(() => phase.value)
export const bannerAttachSeq: ComputedRef<number> = computed(() => attachSeq.value)

/**
 * TrackJS, which is loaded from a CDN in `index.html` and may simply not be
 * there. Declared -- not read off `window` -- deliberately: reading a bare
 * identifier that was never defined throws a `ReferenceError`, and both of the
 * ported functions have `try`/`catch` blocks written around exactly that. See
 * `promiseFailReport` for the one place where that throw is not swallowed.
 */
declare const trackJs: { console: { error: (...args: unknown[]) => void } } | undefined

/**
 * The message to show for whatever was thrown, rejected, or passed in.
 *
 * `error` is a `Parse.Error`, an exception, an array of either, or a string.
 */
export function messageFor(error: unknown): string {
  if (error === undefined || error === null) {
    return 'An unknown error occurred.'
  }
  if (typeof error === 'string') {
    return error
  }
  if (Array.isArray(error)) {
    /*
     * An array reaches here because `Parse.Promise.when` rejected with an
     * ARRAY of errors indexed to its inputs. Native `Promise.all` rejects with
     * a single error instead, so the ported call sites produce this shape far
     * less often -- but callers may still hand us a list, and de-duplicating it
     * is what keeps "Object not found; Object not found; Object not found" from
     * being the whole banner.
     */
    return [...new Set(error.map(messageFor))].join('; ')
  }
  const bag = error as { message?: unknown; error?: unknown }
  if (bag.message) {
    return String(bag.message)
  }
  if (bag.error) {
    return '' + bag.error
  }
  try {
    // `JSON.stringify` answers `undefined` for a function or a symbol, which
    // the original then handed to `.text()`. Falling through to the string
    // coercion is the same message a reader would have got, minus the blank.
    const json = JSON.stringify(error)
    return json === undefined ? String(error) : json
  } catch {
    // A cyclic object, most often. Never let describing an error throw one.
    return String(error)
  }
}

/** The code carried by a `Parse.Error`, when there is one. */
function codeOf(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'number' ? code : undefined
}

/** The route the app is showing, or `null` before the router is installed. */
function currentPageKey(): string | null {
  return installedRouter ? installedRouter.currentRoute.value.fullPath : null
}

/** The original's `attach()`: show the banner on the page named by `key`. */
function attach(key: string | null): void {
  showingOn = key
  attachSeq.value++
}

/**
 * Take the banner down. Also the click handler on the banner itself, and what
 * every successful save calls before redirecting (`ReportError.clear()` appears
 * at six such call sites) so a stale refusal does not follow a later success.
 */
export function clearError(): void {
  phase.value = 'idle'
  message.value = ''
  showingOn = null
}

/** The original's `on_page_change`, driven by the router instead of jQM events. */
function onPageChange(): void {
  if (phase.value === 'idle') return
  const key = currentPageKey()
  if (key === null || key === showingOn) {
    return
  }
  if ('follow' === phase.value) {
    // The redirect the failure itself triggered. Carry the banner to wherever
    // the user actually landed, then wait there.
    phase.value = 'settle'
    attach(key)
    return
  }
  clearError()
}

let installedRouter: Router | null = null
let watchInstalled = false

/**
 * Subscribe the phase machine to navigation.
 *
 * The original bound `pagecontainershow.reporterror` only while a banner was up
 * and unbound it in `clear()`. This registers ONE permanent `afterEach` that
 * returns immediately while the phase is 'idle', which is behaviourally the
 * same and avoids the question of whether a hook added during a navigation runs
 * for that navigation. Idempotent, so the component may call it on every mount.
 */
export function installErrorNavigationWatch(router: Router): void {
  installedRouter = router
  if (watchInstalled) return
  watchInstalled = true
  router.afterEach((_to, _from, failure) => {
    // A guard that redirects aborts the first navigation and starts a second,
    // and `afterEach` runs for both -- the first with a failure, and with
    // `currentRoute` still pointing at the page being left. Skipping it keeps
    // one navigation from counting twice; the `showingOn` comparison in
    // `onPageChange` is the second half of the same defence.
    if (failure) return
    onPageChange()
  })
}

/**
 * Report a failure to the user, and keep the promise chain rejected.
 *
 * `context` names what was being attempted, so the message reads as
 * "Couldn't save the rule: ..." rather than a bare Parse message.
 */
export function reportError(error: unknown, context?: string): Promise<never> {
  if (error && Parse.Error.USERNAME_MISSING === codeOf(error)) {
    // "Not logged in" -- the router's auth gate has already put the user on the
    // login page, which says everything a banner would. `promiseFailReport`
    // skips this code for the same reason.
    return Promise.reject(error)
  }
  const text = messageFor(error)
  const full = context ? context + ': ' + text : text

  console.error('ReportError ' + full, error)
  try {
    trackJs?.console.error('ReportError ' + full)
  } catch {
    // TrackJS is optional; never let reporting an error throw one.
  }

  message.value = full
  attach(currentPageKey())
  phase.value = 'follow'

  /*
   * Keep the chain rejected. A failure handler that returns a plain value
   * resolves the promise, which is exactly how
   * `.fail(PromiseFailReport).fail(hide_the_loader)` ended up never hiding the
   * loader.
   *
   * One difference from `Parse.Promise.error`, which callers have to know
   * about: a native rejected promise that nobody handles logs an
   * "Unhandled promise rejection" to the console. A call site that genuinely
   * ends the chain here should say so with a trailing `.catch(() => {})`
   * rather than dropping the rejection on the floor.
   */
  return Promise.reject(error)
}

/**
 * Handy as a bare rejection handler:
 * `.catch(reportErrorOn("Couldn't save"))`. The port of `ReportError.on`.
 */
export function reportErrorOn(context: string): (error: unknown) => Promise<never> {
  return function (error: unknown) {
    return reportError(error, context)
  }
}

/**
 * The port of `helpers/PromiseFailReport.js`.
 *
 * Logs, reports to TrackJS, and -- for the four session failures below -- signs
 * the user out and reloads. That last part is the only thing that recovers a
 * user whose session token died on the server: every subsequent request fails
 * the same way, and without this they see nothing but errors until they clear
 * site data by hand.
 *
 * Note what it does NOT do: render anything. That is the defect `reportError`
 * exists to fix, and this function is kept as it was for the call sites that
 * only ever wanted logging.
 *
 * Two things here are ported deliberately rather than fixed:
 *
 * - `JSON.stringify` on an `Error` yields `{}`, because `message` is a
 *   non-enumerable own property. So the console lines this writes for a
 *   thrown exception carry no detail at all. `_.has(error, "message")` still
 *   sees it, which is why the branch below is not dead.
 * - The logout is not awaited before the reload, so the reload can cut the
 *   logout request short. That is how it has always run.
 */
function processSingle(error: unknown): void {
  if (error !== null && typeof error === 'object' && Object.prototype.hasOwnProperty.call(error, 'message')) {
    const code = codeOf(error)
    if (Parse.Error.USERNAME_MISSING === code) {
      return
    }
    const text = (error as { message?: unknown }).message
    if (
      Parse.Error.INVALID_LINKED_SESSION === code ||
      Parse.Error.INVALID_SESSION_TOKEN === code ||
      Parse.Error.SESSION_MISSING === code ||
      (typeof text === 'string' && text.startsWith('Facebook auth is invalid for this user'))
    ) {
      // The session token is dead. Nothing else in the app can recover from
      // that, so drop it and start over from the login page.
      void Parse.User.logOut()
      if (typeof window !== 'undefined') window.location.reload()
      return
    }
    logAndTrack(error)
    return
  }
  logAndTrack(error)
}

function logAndTrack(error: unknown): void {
  console.info('Error in promise ' + JSON.stringify(error))
  try {
    trackJs?.console.error('Error in promise', JSON.stringify(error))
  } catch {
    // Unlike `reportError`, this rethrows. When the TrackJS script did not
    // load, `trackJs` is not merely undefined but undeclared, so the line above
    // throws a `ReferenceError` and the failure escapes here as a string. Kept
    // as-is: it is the original's behaviour, and swallowing it would make a
    // site with no TrackJS silently quieter than one with it.
    throw JSON.stringify(error)
  }
}

export function promiseFailReport(error: unknown): void {
  if (Array.isArray(error)) {
    // `Parse.Promise.when` rejected with an array holding one entry per input,
    // successes included -- which is why this has to tell them apart. Native
    // promises do not produce this shape, so it survives only for callers that
    // assemble a list themselves.
    console.log('Error in a multi-promise follows {')
    error.forEach((e: unknown, i: number) => {
      if (e !== null && typeof e === 'object' && Object.prototype.hasOwnProperty.call(e, 'success')) {
        console.log('' + i + ' succeeded at ' + (e as { updatedAt?: unknown }).updatedAt)
      } else {
        processSingle(e)
      }
    })
    console.log('}')
  } else {
    processSingle(error)
  }
}

export default reportError
