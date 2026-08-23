/**
 * Chrome-level UI state: the loading spinner, the header title, and the global
 * error popup.
 *
 * jQuery Mobile owned all three imperatively -- `$.mobile.loading("show")` and
 * `("hide")` calls appear over a hundred times across the old router and views,
 * each one a place where an early return could strand the spinner on screen.
 * A counter replaces them: `beginWork`/`endWork` nest correctly, so overlapping
 * requests cannot hide a spinner another request still needs, and `runWork`
 * makes the pairing impossible to get wrong.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const pending = ref(0)
  const loaderText = ref('')
  const title = ref('Yorick')
  const errorMessage = ref('')

  /**
   * Where the header's Back button goes.
   *
   * `set_back_button(url)` (`mobileRouter.js:406`) rewrote the single global
   * `#header-back-button` href at the top of nearly every route handler, so
   * "back" meant a destination the route chose, not browser history. That
   * distinction matters after a redirect: several handlers report an error and
   * then send the user somewhere, and `history.back()` would return them to the
   * page that just refused them.
   *
   * A page states its own destination with `useBackHref()`; the default is the
   * front page, which is what handlers that set nothing effectively had.
   */
  const backHref = ref('#')

  const loading = computed(() => pending.value > 0)

  function beginWork(text = '') {
    pending.value++
    if (text) loaderText.value = text
  }

  function endWork() {
    pending.value = Math.max(0, pending.value - 1)
    if (pending.value === 0) loaderText.value = ''
  }

  /** Run an async task with the spinner up, releasing it however it ends. */
  async function runWork<T>(task: () => Promise<T>, text = ''): Promise<T> {
    beginWork(text)
    try {
      return await task()
    } finally {
      endWork()
    }
  }

  function reportError(message: string) {
    errorMessage.value = message
  }

  function clearError() {
    errorMessage.value = ''
  }

  return {
    pending,
    loading,
    loaderText,
    title,
    backHref,
    errorMessage,
    beginWork,
    endWork,
    runWork,
    reportError,
    clearError,
  }
})
