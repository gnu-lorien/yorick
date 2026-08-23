/**
 * State the header Back button's destination for this page.
 *
 * The Backbone app called `set_back_button(url)` as the first or second
 * statement of nearly every route handler. Doing it from the page component is
 * the same idea in the place that actually knows the answer, and it resets to
 * the front page when the page goes away, so a page that forgets to state one
 * cannot inherit the previous page's.
 *
 * ## The reset has to know whether it still owns the value
 *
 * Vue runs the incoming page's `setup()` BEFORE it unmounts the outgoing one.
 * A bare `onUnmounted(() => { ui.backHref = '#' })` therefore fires *after* the
 * new page has already stated its own destination, and overwrites it -- so the
 * Back button read `#` and went to the front page from almost everywhere.
 * `#characternew` is where it is most obvious, because "back" there means the
 * character list and landing on Player Options instead is plainly wrong, but it
 * affected every page that followed another one.
 *
 * The token is what fixes it: a page only clears the value if nothing has
 * claimed it since. The counter lives in module scope rather than in the store
 * because it is bookkeeping about who wrote last, not application state.
 */
import { onUnmounted, watchEffect, type Ref } from 'vue'
import { useUiStore } from '@/stores/ui'

let sequence = 0
let owner = 0

export function useBackHref(href: string | Ref<string> | (() => string)): void {
  const ui = useUiStore()
  const token = ++sequence

  watchEffect(() => {
    owner = token
    ui.backHref = typeof href === 'function' ? href() : typeof href === 'string' ? href : href.value
  })

  onUnmounted(() => {
    if (owner !== token) return
    owner = 0
    ui.backHref = '#'
  })
}
