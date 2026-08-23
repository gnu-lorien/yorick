<script setup lang="ts">
/**
 * A character's background or notes -- `#long-text`.
 *
 * Two of the three routes over `CharacterLongTextView` (`mobileRouter.js:803`
 * and `:827`) render this one page id. The editor is `LongTextEditor.vue`.
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

/**
 * Two routes, one page id, and the category decides everything.
 *
 * `mobileRouter.js` memoised ONE view across both (`self.clt = self.clt || ...`)
 * and re-ran `setup()` on every visit, so the label, the help text and the
 * value all swapped correctly between them. `long-texts.spec.js:284` asserts
 * exactly that, because the same memoisation pattern DID strand other views in
 * this app. Here the component is keyed on the route, so the question does not
 * arise.
 */
const CATEGORIES: Record<string, { category: string; pretty: string; description: string }> = {
  character_background_long_text: {
    category: 'background',
    pretty: 'Background',
    description: 'History and backstory for your character.',
  },
  character_notes_long_text: {
    category: 'notes',
    pretty: 'Notes',
    description: "Notes about your character's interactions and progression",
  },
}

const spec = computed(
  () =>
    CATEGORIES[route.meta.handler as string] ?? {
      category: 'background',
      pretty: 'Background',
      description: '',
    },
)
const CATEGORY = computed(() => spec.value.category)
const PRETTY = computed(() => spec.value.pretty)
const DESCRIPTION = computed(() => spec.value.description)

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
      await c.fetch_long_text(CATEGORY.value)
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
  <JqmPage id="long-text" title="Long Text" :content="false" :ready="loaded">
    <LongTextEditor
      v-if="character"
      :character="character"
      :category="CATEGORY"
      :pretty="PRETTY"
      :description="DESCRIPTION"
    />
  </JqmPage>
</template>
