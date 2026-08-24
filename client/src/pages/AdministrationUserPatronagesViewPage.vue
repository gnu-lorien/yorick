<script setup lang="ts">
/**
 * One user's patronages -- `#administration-user-patronages-view`.
 *
 * A port of `mobileRouter.js:administration_user_patronages` (`:927`), which is
 * `PatronagesView` narrowed to the rows whose `owner` is this user.
 *
 * The narrowing is done in memory, over the same full fetch the all-patronages
 * screen makes, because that is what the source did -- `get_patronages()` then
 * `_.filter`. It is not a query, so it cannot miss a row the caller can read.
 *
 * This page used to be broken for everyone, administrators included: the route
 * pointed `AdministrationUserView` at it, and that view's regions
 * (`#abs-form`, `#patronage-list-region`) only exist inside
 * `#administration-user-view`. Marionette threw on construction, inside a
 * legacy `Parse.Promise` callback that does not catch synchronous throws, so
 * the route died before `changePage` and left the loader stuck. It renders the
 * one thing it is named for.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage, vJqmListview } from '@/components/jqm'
import PatronageRows from '@/components/PatronageRows.vue'
import { useBackHref } from '@/composables/useBackHref'
import { reportErrorOn } from '@/domain/errors'
import { fetchPatronages, type Patronage } from '@/domain/Patronage'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

const route = useRoute()
const ui = useUiStore()
const usersStore = useUsersStore()

const userId = computed(() => route.params.id as string)

useBackHref('#administration/users/all')

const patronages = shallowRef<Patronage[]>([])
const username = ref('')
/** False until the rows are in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

const heading = computed(() =>
  username.value ? `Patronages for ${username.value}` : 'Patronages',
)

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      await usersStore.prime([userId.value])
      username.value = (usersStore.get(userId.value)?.get('username') as string) ?? ''

      const all = await fetchPatronages()
      patronages.value = all.filter(
        (p) => (p.get('owner') as { id?: string } | undefined)?.id === userId.value,
      )
    })
  } catch (error) {
    await reportErrorOn("Couldn't list that user's patronages")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="administration-user-patronages-view" title="Patronages" :ready="loaded">
    <h3 id="administration-user-patronages-heading">{{ heading }}</h3>
    <ul
      v-jqm-listview
      id="administration-user-patronages-list"
      data-role="listview"
      data-inset="true"
      class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
    >
      <PatronageRows
        :patronages="patronages"
        :href-for="(id) => `#administration/patronage/${id}`"
      />
    </ul>
  </JqmPage>
</template>
