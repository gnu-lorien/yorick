<script setup lang="ts">
/**
 * A jQuery Mobile search box.
 *
 * Transcribed from the enhanced markup in the running legacy app:
 *
 *     <div class="ui-input-search ui-body-inherit ui-corner-all
 *                 ui-shadow-inset ui-input-has-clear">
 *       <input id="characters-filter" data-type="search">
 *       <a href="#" tabindex="-1" aria-hidden="true" title="Clear text"
 *          class="ui-input-clear ui-btn ui-icon-delete ui-btn-icon-notext
 *                 ui-corner-all ui-input-clear-hidden">Clear text</a>
 *     </div>
 *
 * The styling lives entirely on the WRAPPER, not on the input: `ui-input-search`
 * is what draws the rounded inset field and the magnifying glass. Putting those
 * classes on the `<input>` itself -- which is what this used to do -- produces a
 * bare browser text box, because none of jQM's rules match an input carrying
 * them directly.
 *
 * `ui-input-clear-hidden` is toggled by content, not by focus: the clear button
 * appears once there is something to clear. That is jQM's behaviour and it is
 * why the class is bound rather than static.
 *
 * The input keeps its id and `data-type="search"` because the E2E suite and the
 * old `data-input="#some-filter"` wiring both address it that way.
 */
const model = defineModel<string>({ default: '' })

withDefaults(defineProps<{ id?: string; placeholder?: string; name?: string }>(), {
  placeholder: '',
})
</script>

<template>
  <div class="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
    <input :id="id" v-model="model" :name="name" data-type="search" :placeholder="placeholder" />
    <a
      href="#"
      tabindex="-1"
      aria-hidden="true"
      title="Clear text"
      class="ui-input-clear ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all"
      :class="model ? '' : 'ui-input-clear-hidden'"
      @click.prevent="model = ''"
      >Clear text</a
    >
  </div>
</template>
