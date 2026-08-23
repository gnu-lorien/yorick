<script setup lang="ts">
/**
 * `#charactercreate/simpletraits/:category/:cid/unpick/:stid/:i` -- hand a
 * creation pick back.
 *
 * An action route: it does the work and returns to the wizard.
 *
 * `unpick_from_creation` finds the slot by SEARCHING the pick lists rather than
 * trusting the trait's `free_value`, because a free value can be edited after
 * the pick was made. It also saves the creation record BEFORE destroying the
 * trait, so a failure leaves a released slot rather than a destroyed trait whose
 * slot was never returned.
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { get_character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const category = computed(() => route.params.category as string)
const cid = computed(() => route.params.cid as string)
const stid = computed(() => route.params.stid as string)
const rating = computed(() => Number.parseInt(String(route.params.i), 10) || 0)

onMounted(async () => {
  try {
    const c = await ui.runWork(() => get_character(cid.value, [category.value]))
    await ui.runWork(() => c.unpick_from_creation(category.value, stid.value, rating.value))
  } catch (error) {
    await reportErrorOn("Couldn't return that creation pick")(error).catch(() => {})
  } finally {
    window.location.hash = `#charactercreate/${cid.value}`
  }
})
</script>

<template><div /></template>
