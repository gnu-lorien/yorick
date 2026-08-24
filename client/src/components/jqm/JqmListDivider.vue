<script setup lang="ts">
/**
 * A `data-role="list-divider"` row. 27 templates use one to head a group.
 */
defineProps<{ theme?: string }>()
</script>

<template>
  <li class="ui-li-divider ui-bar-inherit" :class="theme ? `ui-bar-${theme}` : ''">
    <slot />
  </li>
</template>
