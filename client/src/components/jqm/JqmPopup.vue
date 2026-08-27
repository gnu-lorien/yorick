<script setup lang="ts">
/**
 * A jQuery Mobile popup.
 *
 * jQM's popup was a jQuery plugin driven by imperative `.popup("open")` /
 * `.popup("close")` calls scattered through the views, plus a screen overlay
 * appended to the page. Here it is a plain `v-model:open` component; the
 * classes and the `ui-popup-screen` overlay are jQM's so the appearance and any
 * CSS keying off them are unchanged.
 *
 * Escape and a click on the overlay dismiss it, which is what jQM's
 * `data-dismissible` default did.
 */
withDefaults(defineProps<{ open: boolean; id?: string; theme?: string; overlayTheme?: string; dismissible?: boolean; corners?: boolean }>(), {
  theme: 'a',
  overlayTheme: 'a',
  dismissible: true,
  corners: true,
})

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

function close() {
  emit('update:open', false)
}
</script>

<template>
  <teleport to="body">
    <div
      v-if="open"
      class="ui-popup-screen ui-overlay-shadow in"
      :class="[`ui-overlay-${overlayTheme}`]"
      @click="dismissible && close()"
    ></div>
    <div v-if="open" class="ui-popup-container ui-popup-active">
      <div
        :id="id"
        data-role="popup"
        class="ui-popup ui-overlay-shadow"
        :class="[`ui-body-${theme}`, corners ? 'ui-corner-all' : '']"
        role="dialog"
        @keydown.esc="dismissible && close()"
      >
        <slot :close="close" />
      </div>
    </div>
  </teleport>
</template>
