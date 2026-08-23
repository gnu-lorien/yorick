<script setup lang="ts">
/**
 * One tile of the character sheet's link grid.
 *
 * The sheet is built out of about thirty repetitions of the same six lines --
 * a grid cell holding an inset listview holding a single linked item. The
 * markup is reproduced exactly, including the redundant explicit classes the
 * template wrote out alongside `data-role="listview"` (jQuery Mobile would have
 * added them anyway; the template's author evidently did not trust it to).
 */
withDefaults(defineProps<{ href: string; block?: 'a' | 'b' | 'c' | 'd' }>(), { block: 'b' })

import { vJqmListview } from '@/components/jqm'
</script>

<template>
  <div :class="`ui-block-${block}`">
    <ul
      v-jqm-listview
      data-role="listview"
      data-inset="true"
      class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
    >
      <li><a :href="href"><slot /></a></li>
    </ul>
  </div>
</template>
