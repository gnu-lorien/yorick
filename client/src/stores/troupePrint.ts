/**
 * The troupe print settings, and what the print page is about to print.
 *
 * `mobileRouter.js:get_troupe_print_options` (`:2038`) memoised a single
 * `Backbone.Model` on the router instance and handed the SAME object to the
 * select-to-print view and the print view, so changing the font size on one
 * screen changed it on the other. That shared object is this store.
 *
 * ## Why the selection lives here too
 *
 * `#print-shown` navigates to `#troupe/:id/characters/print/selected`, and the
 * print route then reached back into the select view for
 * `get_filtered()` -- the rows that were on screen when the button was pressed.
 * There is no server-side notion of "selected": the selection IS the filter
 * state of the page you just left.
 *
 * With one view per route that reach-back is not available, so the select page
 * publishes the ids it is showing and the print page reads them. `selectedIds`
 * being `null` means "nobody has been through the select screen", which is the
 * case the source handled by falling back to fetching the whole troupe -- and
 * that fallback is what `print/all` uses too.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTroupePrintStore = defineStore('troupePrint', () => {
  /** Percent, applied as a CSS `font-size` on the sheet. */
  const fontSize = ref(100)
  const excludeExtended = ref(false)

  /** The rows the select-to-print screen last showed, or null if it has not run. */
  const selectedIds = ref<string[] | null>(null)

  function publishSelection(ids: readonly string[]) {
    selectedIds.value = [...ids]
  }

  return { fontSize, excludeExtended, selectedIds, publishSelection }
})
