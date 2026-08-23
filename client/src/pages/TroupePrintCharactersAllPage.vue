<script setup lang="ts">
/**
 * Every selected character's sheet, one after another --
 * `#troupe-print-characters-all`.
 *
 * A port of the `CollectionView` at the foot of `CharactersPrintView.js`, which
 * rendered one `CharacterPrintView` per character with `no_print_settings_form`
 * set and the troupe's shared print options passed down.
 *
 * `:type` decides where the rows come from, and the two cases are genuinely
 * different:
 *
 *  - `selected` prints what the select-to-print screen was showing. That was
 *    read straight off the other view's live collection; here it is the id list
 *    that screen published to `useTroupePrintStore`. If nobody has been through
 *    it -- a bookmark, a reload -- the store holds `null` and this falls back to
 *    the whole troupe, which is what the source did when its memoised view did
 *    not exist yet.
 *  - anything else prints the whole troupe.
 *
 * There is no `window.print()` here and never has been. "Print" is the browser's
 * own command; what makes the output usable is `css/printable_sheet.css`, which
 * is written entirely against jQuery Mobile class names. `force-printing-page-break`
 * on each sheet is what puts one character per page.
 *
 * The font size is applied as an inline percentage, exactly as `match_font_size`
 * did, so it scales the sheet rather than any one element.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import PrintSheet from '@/components/print/PrintSheet.vue'
import { useBackHref } from '@/composables/useBackHref'
import { reportErrorOn } from '@/domain/errors'
import { fetchTroupeSummaryCharacters } from '@/domain/TroupeSummary'
import type { Character } from '@/domain/Character'
import { useTroupePrintStore } from '@/stores/troupePrint'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

const route = useRoute()
const ui = useUiStore()
const usersStore = useUsersStore()
const printOptions = useTroupePrintStore()

const troupeId = computed(() => route.params.id as string)
const type = computed(() => route.params.type as string)

useBackHref(() =>
  type.value === 'selected'
    ? `#troupe/${troupeId.value}/characters/selecttoprint/all`
    : `#troupe/${troupeId.value}`,
)

const characters = shallowRef<Character[]>([])
/** False until the sheets are in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

onMounted(async () => {
  try {
    const found = await ui.runWork(
      () => fetchTroupeSummaryCharacters(troupeId.value),
      'Fetching all characters',
    )
    await usersStore.hydrate(found, 'owner')

    const selected = printOptions.selectedIds
    characters.value =
      type.value === 'selected' && selected !== null
        ? found.filter((character) => selected.includes(character.id as string))
        : found
  } catch (error) {
    await reportErrorOn("Couldn't print that troupe's characters")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage
    id="troupe-print-characters-all"
    title="Print Troupe Characters"
    :content="false"
    :ready="loaded"
  >
    <div :style="{ fontSize: printOptions.fontSize + '%' }">
      <PrintSheet
        v-for="character in characters"
        :key="character.id"
        :character="character"
        :exclude-extended="printOptions.excludeExtended"
      />
    </div>
  </JqmPage>
</template>
