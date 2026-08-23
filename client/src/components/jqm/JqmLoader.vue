<script setup lang="ts">
/**
 * The jQuery Mobile loading spinner.
 *
 * `waitForJqmLoader` in the E2E helpers polls for `.ui-loader` and treats it as
 * clear when it is `display:none`, `visibility:hidden`, or has no offsetParent.
 * Rendering it with `v-if` satisfies the third case, so that helper needs no
 * change; the markup and classes are jQuery Mobile's own so the appearance is
 * identical.
 */
defineProps<{ active: boolean; text?: string }>()
</script>

<template>
  <div
    v-if="active"
    class="ui-loader ui-corner-all ui-body-a ui-loader-default"
    :class="{ 'ui-loader-verbose': !!text }"
  >
    <span class="ui-icon-loading"></span>
    <h1 v-if="text">{{ text }}</h1>
  </div>
</template>
