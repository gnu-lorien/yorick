<script setup lang="ts">
/**
 * Every patronage -- `#administration-patronages-view`.
 *
 * A port of `PatronagesView.js` and `index.html:973`.
 *
 * Patronage rows are world-readable by design: patron status has to be publicly
 * verifiable, and a test asserts that positively. This screen is admin-gated
 * because it lists them all with owner identities attached, which is a different
 * thing from a patron proving their own status.
 */
import { onMounted } from 'vue'
import { JqmPage } from '@/components/jqm'
import PatronageRows from '@/components/PatronageRows.vue'
import { useBackHref } from '@/composables/useBackHref'
import { usePatronages } from '@/composables/usePatronages'

useBackHref('#administration')

const { patronages, loaded, load } = usePatronages("Couldn't list the patronages")
onMounted(load)
</script>

<template>
  <JqmPage id="administration-patronages-view" title="Patronages" :ready="loaded">
    <ul>
      <li><a href="#administration/patronages/new">Add New Patronage</a></li>
    </ul>
    <form class="ui-filterable">
      <input id="patronages-filter" data-type="search" />
    </form>
    <ul
      id="administration-patronages-view-list"
      data-role="listview"
      data-inset="true"
      class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
    >
      <PatronageRows :patronages="patronages" :href-for="(id) => `#administration/patronage/${id}`" />
    </ul>
  </JqmPage>
</template>
