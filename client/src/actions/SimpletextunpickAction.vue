<script setup lang="ts">
/**
 * `#simpletext/:category/:target/:cid/unpick` -- clear a core text attribute.
 *
 * An action route: it does the work and returns to the character sheet.
 *
 * `unpick_text` is not merely a `set(target, undefined)`. For a Changeling Kith
 * it also releases the Arts that Kith granted, which is the other half of the
 * R22/R23 transaction -- so this goes through the model rather than writing the
 * attribute directly.
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { get_character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const category = computed(() => route.params.category as string)
const target = computed(() => route.params.target as string)
const cid = computed(() => route.params.cid as string)

onMounted(async () => {
  try {
    const c = await ui.runWork(() => get_character(cid.value, [category.value]))
    await ui.runWork(() => c.unpick_text(target.value))
  } catch (error) {
    await reportErrorOn(`Couldn't clear that choice`)(error).catch(() => {})
  } finally {
    window.location.hash = `#character?${cid.value}`
  }
})
</script>

<template><div /></template>
