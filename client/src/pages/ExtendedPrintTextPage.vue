<script setup lang="ts">
/**
 * The extra text printed with a character sheet -- `#extended-print-text`.
 *
 * One of the three routes over `CharacterLongTextView` (`mobileRouter.js:781`).
 * The editor itself is `LongTextEditor.vue`; this page supplies the category and
 * its two labels, and loads the text before rendering.
 *
 * This one is not private notes: whatever is here is appended to the printed
 * sheet, which is the document a storyteller reads at an event.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import LongTextEditor from '@/components/LongTextEditor.vue'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const cid = computed(() => route.params.cid as string)

useBackHref(() => `#character?${cid.value}`)

const CATEGORY = 'extended_print_text'
const PRETTY = 'Extended Print Text'
const DESCRIPTION = 'Additional text to display with your printed character sheet.'

const character = shallowRef<Character | null>(null)
/** False until the text is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      /*
       * `"all"` and then `fetch_long_text`, as the handler did. The default
       * `{update: false}` serves `_ltCache` once populated, which is what makes
       * navigating away and back render the saved text with no server round
       * trip -- `update_long_text` primes that cache on save.
       */
      const c = await get_character(cid.value, 'all')
      await c.fetch_long_text(CATEGORY)
      character.value = c
    })
  } catch (error) {
    await reportErrorOn("Couldn't open that text")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="extended-print-text" title="Additional Printed Text" :content="false" :ready="loaded">
    <LongTextEditor
      v-if="character"
      :character="character"
      :category="CATEGORY"
      :pretty="PRETTY"
      :description="DESCRIPTION"
    />
  </JqmPage>
</template>
