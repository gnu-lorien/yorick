<script setup lang="ts">
/**
 * A `data-role="controlgroup"`: buttons welded into one bar.
 *
 * jQuery Mobile put `ui-first-child` / `ui-last-child` on the first and last
 * button to round the ends of the bar and restore the outer border, applying
 * them by walking the children after every render. `styles/jqm-structural.css`
 * restates those rules against `:first-child` / `:last-child`, so a group whose
 * membership changes reactively stays correct with no refresh call.
 */
withDefaults(defineProps<{ horizontal?: boolean; mini?: boolean }>(), { horizontal: false, mini: false })
</script>

<template>
  <div
    class="ui-controlgroup"
    :class="[horizontal ? 'ui-controlgroup-horizontal' : 'ui-controlgroup-vertical', mini ? 'ui-mini' : '', 'ui-corner-all']"
  >
    <div class="ui-controlgroup-controls">
      <slot />
    </div>
  </div>
</template>
