<script setup lang="ts">
/**
 * The character as last APPROVED -- `#character/:cid/approved`.
 *
 * A port of `mobileRouter.js:character_show_approved` (`:508`), which is one
 * route that renders one of two pages: `#printable-sheet` when there is an
 * approved version, and `#character-print-no-approval` when there is not. The
 * page id is what the E2E suite reads to tell those apart, so both are here and
 * the component name is the one the route table already had.
 *
 * ## What "as last approved" means
 *
 * The sheet is not stored. `get_transformed_last_approved` replays the
 * character BACKWARDS: it takes every recorded change made after the last
 * approved one and undoes it, newest first. The result is a clone, so nothing
 * here can write to the live character -- which matters, because this screen is
 * the one a storyteller reads when deciding whether a change was sanctioned.
 *
 * `null` means never approved, and that is a different thing from "no changes":
 * the source returns `Parse.Promise.as(null)` when the approvals list is empty,
 * and this renders the no-approval page for it.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import PrintSheet from '@/components/print/PrintSheet.vue'
import { useBackHref } from '@/composables/useBackHref'
import { get_character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import type Parse from '@/parse'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const cid = computed(() => route.params.cid as string)
useBackHref(() => `#character?${cid.value}`)

const approved = shallowRef<Parse.Object | null>(null)
/** False until the replay has run; see the note in `JqmPage.vue`. */
const loaded = ref(false)

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const c = await get_character(cid.value, 'all')
      // The sheet prints it and nothing else would load it.
      await c.fetch_long_text('extended_print_text')
      approved.value = (await c.experience.get_transformed_last_approved()) as Parse.Object | null
    })
  } catch (error) {
    await reportErrorOn("Couldn't show the approved character")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage
    v-if="loaded && approved"
    id="printable-sheet"
    title="Printable Sheet"
    :content="false"
  >
    <PrintSheet :character="approved" />
  </JqmPage>
  <JqmPage v-else id="character-print-no-approval" title="Print Approval" :ready="loaded">
    <p>No approved versions of your character</p>
  </JqmPage>
</template>
