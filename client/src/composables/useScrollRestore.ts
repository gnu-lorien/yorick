/**
 * Put a page back where the reader left it.
 *
 * The creation wizard and the character sheet are long, and both are worked
 * through by taking short side trips: pick a skill, unpick a background, change
 * a clan. Each of those is a route of its own, so coming back means rendering
 * the page again -- and without this, at the top. Picking a rank-4 skill halfway
 * down the wizard threw the reader back to the start of the form, every time.
 *
 * The Backbone app did this with `backToTop`: a route on its way OUT stashed
 * `document.documentElement.scrollTop` on the memoised view, and the route
 * coming back armed a one-shot `pagechange` handler that called
 * `$.mobile.silentScroll`. Same idea here, with two differences that come from
 * having one component per route rather than one memoised view per screen:
 *
 *  - The position is remembered by ROUTE PATH, not on a view object. Paths
 *    include the character id, so two characters' sheets cannot restore each
 *    other's position -- which the old shared-view approach could not express.
 *  - `rememberScroll` is called once, from the router's own guard, rather than
 *    written out by hand in each departing route handler. That is what makes it
 *    impossible to add a new side trip and forget the stash, which is precisely
 *    how the old version ended up with routes that saved to the wrong object.
 *
 * A position is CONSUMED when it is used, so it can restore a return trip and
 * never a fresh visit made much later.
 */
import { nextTick, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'

/** Route path -> the scroll offset the reader was at when they left it. */
const positions = new Map<string, number>()

/** Every scroll position this page has, in the order the document defines. */
function currentScroll(): number {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
}

/**
 * Stash where the reader is, against the path they are leaving.
 *
 * Called from `router.beforeEach`, which runs while the outgoing page is still
 * on screen -- so the scroll offset it reads is still that page's.
 */
export function rememberScroll(path: string): void {
  if (typeof window === 'undefined') return
  positions.set(path, currentScroll())
}

/**
 * Restore this page's position once it has something to scroll.
 *
 * `ready` is the page's own "my data is in hand" signal, and waiting for it is
 * not optional: until the content renders the document is one viewport tall,
 * and scrolling to 900px on a 700px document silently lands at the bottom --
 * or, more often, at 0. `nextTick` then covers the render itself.
 */
export function useScrollRestore(ready: Ref<unknown>): void {
  const route = useRoute()
  // Captured at setup: by the time the watcher fires, `route` may already be
  // reporting the NEXT navigation, and this page's key would be the wrong one.
  const key = route.fullPath

  watch(
    ready,
    async (value) => {
      if (!value) return
      const top = positions.get(key)
      if (top === undefined || top === 0) return
      positions.delete(key)
      await nextTick()
      window.scrollTo(0, top)
    },
    { immediate: true },
  )
}
