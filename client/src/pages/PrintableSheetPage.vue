<script setup lang="ts">
/**
 * The printable character sheet -- `#printable-sheet`.
 *
 * A port of `CharacterPrintView.js` as reached from `#character/:cid/print`.
 * The layout is `PrintSheet.vue` and the per-venue contents are
 * `printRegions.ts`; this page loads the character and hands it over.
 *
 * There is no `window.print()` anywhere in this application and never has been.
 * "Print" means the browser's own command, and what makes the result a usable
 * sheet is `css/printable_sheet.css` -- 86 lines of `@media print` written
 * entirely against jQuery Mobile class names (`.ui-page-active`, `.ui-bar`,
 * `.ui-content`, `.ui-navbar`, `.slidedown`). Keeping that stylesheet working
 * is why this migration reproduces jQuery Mobile's markup rather than replacing
 * it: port the view faithfully and drop the classes, and the sheet would render
 * correctly on screen and print with the navigation bar across the page.
 */
import { computed, onMounted, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import PrintSheet from '@/components/print/PrintSheet.vue'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const cid = computed(() => route.params.cid as string)
useBackHref(() => `#character?${cid.value}`)

/*
 * `shallowRef`, never `ref`.
 *
 * A `Parse.Object` must not be deep-proxied: `ref()` walks the object, hands
 * the SDK proxies where it expects its own instances, and UNWRAPS any nested
 * ref it finds -- which is how the XP ledger's `notations` (a `ShallowRef` on
 * `CharacterExperience`) silently became a plain array in one place and an
 * empty table in another. `@/parse/reactivity` is what makes mutations visible;
 * the ref only has to hold the reference.
 */
const character = shallowRef<Character | null>(null)

onMounted(async () => {
  try {
    // `"all"` -- every trait category. The sheet prints the whole character, so
    // anything left unfetched renders as an empty section rather than as an
    // error, which is the worst kind of wrong on a document someone signs.
    character.value = await ui.runWork(async () => {
      const c = await get_character(cid.value, 'all')
      // The sheet prints this and nothing else would load it.
      await c.fetch_long_text('extended_print_text')
      return c
    })
  } catch (error) {
    await reportErrorOn("Couldn't open the printable sheet")(error).catch(() => {})
  }
})
</script>

<template>
  <JqmPage id="printable-sheet" title="Printable Sheet" :content="false">
    <PrintSheet v-if="character" :character="character" />
  </JqmPage>
</template>
