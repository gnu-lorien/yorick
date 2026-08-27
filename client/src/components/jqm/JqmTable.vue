<script setup lang="ts">
/**
 * A `data-role="table"` reflow table.
 *
 * Six of these exist, all in the approval and history screens.
 *
 * Reflow mode is mostly CSS, but not entirely: jQuery Mobile also injected
 * `<b class="ui-table-cell-label">A</b>` into every `<td>`, which is what
 * labels each cell once the table stacks on a narrow screen. Four E2E helpers
 * know about it -- `logs.js`, `xp.js`, `lifecycle.js` and `approvals.js` all
 * strip the repeated column name back out before reading a cell -- so omitting
 * it would leave those tables unreadable on a phone while the tests carried on
 * passing.
 *
 * Callers pass their column headings so the labels can be emitted; a table
 * that passes none renders without them, exactly as an unenhanced table did.
 * `data-priority` / columntoggle is not used anywhere in this app, so no
 * toggle UI is reproduced.
 */
import { provide, toRef } from 'vue'

const props = withDefaults(
  defineProps<{ mode?: 'reflow' | 'columntoggle'; columns?: string[] }>(),
  { mode: 'reflow', columns: () => [] },
)

/** Read by `JqmTd` so each cell can carry its own column label. */
provide('jqmTableColumns', toRef(props, 'columns'))
</script>

<template>
  <table data-role="table" class="ui-table" :class="`ui-table-${mode}`">
    <slot />
  </table>
</template>
