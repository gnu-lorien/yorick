<script setup lang="ts">
/**
 * `#charactercreate/simpletext/:category/:target/:cid/unpick` -- clear a core
 * text attribute during creation.
 *
 * The same work as the sheet's unpick route; only the destination differs. Kept
 * as a separate component because the return URL is the whole difference and a
 * shared one would have to be told which it was anyway.
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
    window.location.hash = `#charactercreate/${cid.value}`
  }
})
</script>

<template><div /></template>
