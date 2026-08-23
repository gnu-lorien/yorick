<script setup lang="ts">
/**
 * A jQuery Mobile listview.
 *
 * 64 of the app's templates use one, making this the most-reused widget in the
 * codebase. jQuery Mobile's enhancement added the corner-rounding classes
 * (`ui-first-child` / `ui-last-child`) by walking the children after render and
 * had to be told to redo it with `.listview("refresh")` whenever the list
 * changed -- a call that appears throughout the old views and is a frequent
 * source of "the list rendered but looks wrong" bugs.
 *
 * That enhancement is `v-jqm-listview` here -- see `enhanceListview.ts` for why
 * it has to be a directive rather than markup, and for the rules it applies. It
 * re-runs on every update, so a list that changes reactively is always correct
 * and there is no refresh call to forget.
 *
 * The corner rounding in particular is not optional: jQM's stylesheet contains
 * no `:first-child` selectors at all, so without `ui-first-child` /
 * `ui-last-child` an inset list has square corners.
 *
 * `filter` reproduces `data-filter="true"`: jQM injected a search box above the
 * list and hid non-matching `<li>`s. Twelve templates ask for it.
 */
import { computed, provide, ref } from 'vue'
import JqmSearchInput from './JqmSearchInput.vue'
import { vJqmListview } from './enhanceListview'

const props = withDefaults(
  defineProps<{
    inset?: boolean
    filter?: boolean
    /**
     * The search box's id.
     *
     * jQuery Mobile let a list point at an input elsewhere on the page with
     * `data-input="#troupes-list-filter"`, and several templates name one. The
     * id is kept because it is what a user's muscle memory and any external
     * label point at.
     */
    filterId?: string
    filterPlaceholder?: string
    theme?: string
  }>(),
  { inset: false, filter: false, filterPlaceholder: 'Filter items...' },
)

const query = ref('')
provide('jqmListFilter', query)

const classes = computed(() => [
  'ui-listview',
  props.inset ? 'ui-listview-inset ui-corner-all ui-shadow' : '',
])
</script>

<template>
  <form v-if="filter" class="ui-filterable" role="search" @submit.prevent>
    <JqmSearchInput :id="filterId" v-model="query" :placeholder="filterPlaceholder" />
  </form>
  <ul v-jqm-listview :class="classes" data-role="listview">
    <slot :query="query" />
  </ul>
</template>
