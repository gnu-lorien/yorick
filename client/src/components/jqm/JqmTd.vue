<script setup lang="ts">
/**
 * One cell of a `JqmTable`, carrying the column label jQuery Mobile injected.
 *
 * In reflow mode the table stacks into one block per row on a narrow screen,
 * and each cell is only identifiable because jQM had put
 * `<b class="ui-table-cell-label">Column</b>` in front of its content. Doing
 * that here declaratively -- rather than mutating the DOM after render, which
 * is what jQM did and what Vue cannot tolerate -- keeps the phone layout and
 * keeps the four E2E helpers that strip the label back out working unchanged.
 *
 * The label comes from the enclosing table's `columns`, indexed by the cell's
 * position, so a page states its headings once.
 */
import { computed, inject, type Ref } from 'vue'

const props = defineProps<{ index: number }>()

const columns = inject<Ref<string[]> | string[]>('jqmTableColumns', [])

const label = computed(() => {
  const list = Array.isArray(columns) ? columns : columns.value
  return list[props.index] ?? ''
})
</script>

<template>
  <!--
    The space after the label is not cosmetic. jQuery Mobile INSERTED the `<b>`
    in front of a text node that already began with the template's own newline
    and indent, so the cell's text content read "Available 39". Vue condenses
    template whitespace away, and four E2E helpers read these cells as
    whitespace-normalised text -- without the space they read "Available39".
  -->
  <td>
    <b v-if="label" class="ui-table-cell-label">{{ label }}</b
    ><template v-if="label">{{ ' ' }}</template><slot />
  </td>
</template>
