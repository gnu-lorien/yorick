<script setup lang="ts">
/**
 * Leave Troupe -- `#character-pick-troupe-to-leave`.
 *
 * One of the three "pick a troupe" screens the router built out of
 * `TroupesListView` by handing it a link template and a query narrower
 * (`mobileRouter.js:1893`). `TroupeList.vue` is that view; this page supplies
 * the two arguments.
 *
 * The narrower is the whole difference between them, and it comes from the
 * character's OWN membership rather than any server-side rule:
 * `get_troupe_ids()` reads the `troupes` relation the character already carries,
 * so the character has to be loaded before the list can be queried at all.
 * Only troupes the character is IN can be left.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import TroupeList from '@/components/TroupeList.vue'
import { useBackHref } from '@/composables/useBackHref'
import { fetchTroupeList, type Troupe } from '@/domain/Troupe'
import { get_character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const cid = computed(() => route.params.cid as string)

useBackHref(() => `#character?${cid.value}`)

const troupes = shallowRef<Troupe[]>([])
/** False until the character AND the narrowed list are both in hand. */
const loaded = ref(false)

function hrefFor(troupeId: string) {
  return `#character/${cid.value}/troupe/${troupeId}/leave`
}

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const character = await get_character(cid.value)
      const ids = [...character.get_troupe_ids()]
      troupes.value = await fetchTroupeList((query) => {
        query.containedIn('objectId', ids)
      })
    })
  } catch (error) {
    await reportErrorOn("Couldn't list that character's troupes")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="character-pick-troupe-to-leave" title="Leave Troupe" :ready="loaded">
    <div role="troupe-list">
      <TroupeList :troupes="troupes" :href-for="hrefFor" filter-id="character-pick-troupe-to-leave-filter" />
    </div>
  </JqmPage>
</template>
