<script setup lang="ts">
/**
 * `#character/:cid/troupe/:tid/leave` -- remove a character from a troupe.
 *
 * An action route. Its sibling `join` is NOT one: joining renders the troupe
 * page afterwards, leaving goes back to the character. That asymmetry is the
 * source's (`mobileRouter.js:1982` against `:1957`) and it makes sense -- after
 * leaving, the troupe page would be showing a troupe this character is no
 * longer in.
 *
 * The redirect is in an `always()`: it happens whether the leave succeeded or
 * failed, which is why `helpers/troupes.js:leaveTroupe` polls the roster rather
 * than trusting the navigation.
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { get_character } from '@/domain/Character'
import { troupeQuery } from '@/domain/Troupe'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const cid = computed(() => route.params.cid as string)
const tid = computed(() => route.params.tid as string)

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const character = await get_character(cid.value)
      const troupe = await troupeQuery().get(tid.value)
      await character.leave_troupe(troupe)
    })
  } catch (error) {
    await reportErrorOn("Couldn't leave that troupe")(error).catch(() => {})
  } finally {
    window.location.hash = `#character?${cid.value}`
  }
})
</script>

<template><div /></template>
