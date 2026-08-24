<script setup lang="ts">
/**
 * `#charactercreate/complete/:cid` -- finish creation.
 *
 * An action route. Once `creation.completed` is true every pool update becomes a
 * no-op (R22: post-creation writes drove the counters negative and read as
 * overspends that never happened), so this is a one-way door.
 *
 * The original had a defect worth recording, because the shape of it recurs.
 * The route guarded its work with `ifCurrent` but navigated OUTSIDE the guard,
 * so a superseded invocation still went to the sheet as though creation had
 * completed -- and in navigating, dispatched another route, superseding
 * whichever invocation was actually going to do the work. Two overlapping
 * completions cancelled each other and the record was never marked. Here the
 * component is torn down when the route changes, so a superseded invocation
 * cannot navigate.
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { get_character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const cid = computed(() => route.params.cid as string)

onMounted(async () => {
  try {
    const c = await ui.runWork(() => get_character(cid.value))
    await ui.runWork(() => c.complete_character_creation())
    window.location.hash = `#character?${cid.value}`
  } catch (error) {
    await reportErrorOn("Couldn't complete character creation")(error).catch(() => {})
    window.location.hash = `#charactercreate/${cid.value}`
  }
})
</script>

<template><div /></template>
