<script setup lang="ts">
/**
 * The jQuery Mobile loading spinner.
 *
 * ## `ui-loading` on `<html>` is what makes it visible
 *
 * The vendored stylesheet says `.ui-loader { display: none }` and shows it only
 * under `.ui-loading .ui-loader` -- a class jQuery Mobile's `$.mobile.loading`
 * put on the `<html>` element, and which nothing in a JS-free port would ever
 * add. Rendering this component with `v-if` alone therefore produced an element
 * that was in the DOM and permanently `display: none`.
 *
 * That is not only a missing spinner. `waitForJqmLoader` in the E2E helpers
 * treats `display: none` as "no work in flight", so with the class absent EVERY
 * one of the suite's waits returned immediately and the tests raced the app.
 * Measured on troupe creation: the helper read the troupe directory while the
 * form was still saving, got an empty list, and the form's own redirect then
 * landed on top of the page the helper was waiting for.
 *
 * The class is toggled here rather than in `App.vue` so that the element and
 * the rule that reveals it cannot drift apart.
 */
import { onUnmounted, watch } from 'vue'

const props = defineProps<{ active: boolean; text?: string }>()

watch(
  () => props.active,
  (on) => {
    document.documentElement.classList.toggle('ui-loading', on)
  },
  { immediate: true },
)

// A page torn down mid-request must not strand the class on `<html>`.
onUnmounted(() => {
  document.documentElement.classList.remove('ui-loading')
})
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
