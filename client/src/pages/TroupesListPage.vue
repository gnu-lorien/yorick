<script setup lang="ts">
/**
 * The troupes directory -- `#troupes`.
 *
 * `index.html:161-168` is a "Create Troupe" link above a `div[role=troupe-list]`
 * that `TroupesListView` filled. The list itself is `TroupeList.vue`, shared
 * with the three pick-a-troupe screens.
 *
 * `#troupes-list` as the page id is load-bearing: the E2E helpers scope their
 * row queries to it (`#troupes-list a.troupe-listing`, `#troupes-list
 * img.troupe-link-portrait`), which is what keeps a directory row apart from a
 * pick-screen row rendered by the same component.
 *
 * The page settles only once the directory is in hand. The router awaited
 * `register()` before `changePage` (`mobileRouter.js:2213`) for the same
 * reason: without it, a reader arriving straight after a troupe was created saw
 * an empty directory and concluded there were none.
 */
import { onMounted, ref, shallowRef } from 'vue'
import { JqmPage } from '@/components/jqm'
import TroupeList from '@/components/TroupeList.vue'
import { useBackHref } from '@/composables/useBackHref'
import { fetchTroupeList, type Troupe } from '@/domain/Troupe'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

useBackHref('#')

const troupes = shallowRef<Troupe[]>([])
/** False until the directory is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

onMounted(async () => {
  try {
    troupes.value = await ui.runWork(() => fetchTroupeList())
  } catch (error) {
    await reportErrorOn("Couldn't list the troupes")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="troupes-list" title="Troupes" :ready="loaded">
    <ul>
      <li><a href="#troupe/new">Create Troupe</a></li>
    </ul>
    <div role="troupe-list">
      <TroupeList :troupes="troupes" />
    </div>
  </JqmPage>
</template>
