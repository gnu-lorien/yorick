<script setup lang="ts">
/**
 * What every trait cost -- `#character-costs`.
 *
 * A port of `CharacterCostsView.js` and the `#characterCostsView` template at
 * `public/index.html:763`.
 *
 * Small, and more important than it looks: this is the only screen in the app
 * that shows the price of each individual trait, which makes it the detection
 * surface for a mispriced or silently-free category. `wta_rites` and
 * `ctdbs_backgrounds` were free for an unknown length of time, and they would
 * have shown up here as a column of zeroes long before they showed up as a
 * wrong balance.
 *
 * So an unpriceable trait is rendered as `unknown`, never as 0. That is the
 * whole point of the cost engines returning `undefined` rather than falling
 * through to a zero, and rendering it as a number here would undo it.
 *
 * The generation warning is not decoration either: a vampire's trait prices
 * depend on generation, so a sheet without one is showing guesses.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character, type TraitCostEntry } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { trackAll } from '@/parse/reactivity'
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
const costs = ref<TraitCostEntry[]>([])

/**
 * False until this page's data is in hand.
 *
 * `JqmPage` renders no content while it is false, which is what stops
 * `waitForActivePage` reporting the page settled before its list exists. See
 * the note in `JqmPage.vue`.
 */
const loaded = ref(false)

const name = computed(() => {
  const c = character.value
  if (!c) return ''
  trackAll()
  return (c.get('name') as string) ?? ''
})

/**
 * Whether a venue term is set, so the prices can be trusted.
 *
 * Vampires have generation, werewolves rank, changelings seeming; the venue
 * answers for whichever applies.
 */
const hasVenueTerm = computed(() => {
  const c = character.value
  if (!c) return true
  trackAll()
  return c.venue.has_venue_term(c as never)
})

onMounted(async () => {
  try {
    // One `runWork` for the whole load; see the note in SimpletextNewPage.
    await ui.runWork(async () => {
      const c = await get_character(cid.value, 'all')
      character.value = c
      costs.value = Object.values(await c.calculate_total_cost())
    })
  } catch (error) {
    await reportErrorOn("Couldn't work out this character's costs")(error).catch(() => {})
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="character-costs" title="Character Costs" :ready="loaded">
    <h1>{{ name }}</h1>

    <p v-if="!hasVenueTerm">Warning: Values are just a guess without a generation set</p>

    <ul>
      <li v-for="(cost, i) in costs" :key="i">
        {{ cost.trait.get('name') }}:
        <!-- `undefined` means no cost rule covers this trait. Say so. -->
        {{ cost.cost === undefined ? 'unknown' : cost.cost }}
      </li>
    </ul>
  </JqmPage>
</template>
