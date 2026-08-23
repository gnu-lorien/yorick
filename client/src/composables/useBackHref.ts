/**
 * State the header Back button's destination for this page.
 *
 * The Backbone app called `set_back_button(url)` as the first or second
 * statement of nearly every route handler. Doing it from the page component is
 * the same idea in the place that actually knows the answer, and it resets to
 * the front page when the page goes away, so a page that forgets to state one
 * cannot inherit the previous page's.
 */
import { onUnmounted, watchEffect, type Ref } from 'vue'
import { useUiStore } from '@/stores/ui'

export function useBackHref(href: string | Ref<string> | (() => string)): void {
  const ui = useUiStore()

  watchEffect(() => {
    ui.backHref = typeof href === 'function' ? href() : typeof href === 'string' ? href : href.value
  })

  onUnmounted(() => {
    ui.backHref = '#'
  })
}
