<script setup lang="ts">
/**
 * The patronages, as text to copy -- `#administration-patronages-view-csv`.
 *
 * A port of `PatronagesCSVView.js`. The same data as the list, rendered as
 * comma-separated lines for an administrator to select and copy into a
 * spreadsheet. It is not a download and never has been -- see the note in
 * `PatronageRows.vue`.
 *
 * The filter box the original pointed at (`#patronages-filter`) lives on the
 * OTHER page, so this list has never actually been filterable. Reproduced.
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
  <JqmPage id="administration-patronages-view-csv" title="Patronages" :ready="loaded">
    <ul
      id="administration-patronages-view-csv-list"
      data-role="listview"
      data-inset="true"
      class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
    >
      <PatronageRows :patronages="patronages" />
    </ul>
  </JqmPage>
</template>
