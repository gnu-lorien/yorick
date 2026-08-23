<script setup lang="ts">
/**
 * A jQuery Mobile collapsible.
 *
 * The character sheet is built almost entirely out of these -- one per trait
 * category -- so their open/closed state is what the sheet's whole shape is.
 *
 * The markup is transcribed from what jQuery Mobile actually produced, read
 * back out of the running legacy app after `enhanceWithin()`:
 *
 *     <div class="ui-collapsible ui-collapsible-inset ui-corner-all
 *                 ui-collapsible-themed-content ui-collapsible-collapsed">
 *       <h3 class="ui-collapsible-heading ui-collapsible-heading-collapsed">
 *         <a class="ui-collapsible-heading-toggle ui-btn ui-icon-plus
 *                   ui-btn-icon-left ui-btn-inherit">Head
 *           <span class="ui-collapsible-heading-status"> click to expand contents</span>
 *         </a>
 *       </h3>
 *       <div class="ui-collapsible-content ui-body-inherit ui-collapsible-content-collapsed"
 *            aria-hidden="true">…</div>
 *     </div>
 *
 * `ui-collapsible-themed-content` and `ui-body-inherit` are load-bearing --
 * they are what give the content area its background and what the
 * listview edge rules key off -- and the status span is what a screen reader
 * announces, so all three are reproduced rather than approximated.
 */
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ heading?: string; collapsed?: boolean; inset?: boolean; theme?: string }>(),
  { collapsed: true, inset: true },
)

const open = ref(!props.collapsed)
watch(
  () => props.collapsed,
  (c) => { open.value = !c },
)
</script>

<template>
  <div
    class="ui-collapsible ui-collapsible-themed-content"
    :class="[open ? '' : 'ui-collapsible-collapsed', inset ? 'ui-collapsible-inset ui-corner-all' : '']"
  >
    <h3 class="ui-collapsible-heading" :class="open ? '' : 'ui-collapsible-heading-collapsed'">
      <a
        href="#"
        class="ui-collapsible-heading-toggle ui-btn ui-btn-icon-left ui-btn-inherit"
        :class="open ? 'ui-icon-minus' : 'ui-icon-plus'"
        @click.prevent="open = !open"
      >
        <slot name="heading">{{ heading }}</slot>
        <span class="ui-collapsible-heading-status">
          {{ open ? ' click to collapse contents' : ' click to expand contents' }}
        </span>
      </a>
    </h3>
    <div
      class="ui-collapsible-content ui-body-inherit"
      :class="open ? '' : 'ui-collapsible-content-collapsed'"
      :aria-hidden="!open"
    >
      <slot />
    </div>
  </div>
</template>
