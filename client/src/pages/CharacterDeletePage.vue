<script setup lang="ts">
/**
 * Archive a character -- `#character-delete`.
 *
 * A port of `CharacterDeleteView.js` and the `#characterDeleteView` template at
 * `public/index.html:1073`.
 *
 * The page says "delete" throughout and the method is `archive()`. That is not a
 * mismatch to tidy up: nothing here destroys the row, because the audit log is
 * deliberately immutable and a storyteller must still be able to see what a
 * player did. The wording is what the user has always seen and the E2E suite
 * clicks `button.delete-character` by name.
 *
 * Whatever `archive()` resolves or rejects with, the user is sent back to their
 * character list -- the original chained the navigation through `.always()`, so
 * a failure left them on the list rather than on a dead page.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
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
const name = computed(() => (character.value?.get('name') as string) ?? '')

onMounted(async () => {
  try {
    character.value = await ui.runWork(() => get_character(cid.value))
  } catch (error) {
    await reportErrorOn("Couldn't open the character")(error).catch(() => {})
  }
})

async function archive() {
  const c = character.value
  if (!c) return
  try {
    await ui.runWork(() => c.archive())
  } catch (error) {
    await reportErrorOn("Couldn't archive the character")(error).catch(() => {})
  } finally {
    window.location.hash = '#characters?all'
  }
}
</script>

<template>
  <JqmPage id="character-delete" title="Delete Character">
    <template v-if="character">
      <h1>Are you sure you want to delete {{ name }}?</h1>
      <button class="delete-character ui-btn ui-shadow ui-corner-all" @click="archive">
        Delete {{ name }}
      </button>
    </template>
  </JqmPage>
</template>
