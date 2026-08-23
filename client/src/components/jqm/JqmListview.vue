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
 * Here the rounding is CSS-driven off `:first-child`/`:last-child` where the
 * theme allows and applied by `JqmListItem` otherwise, so a list that changes
 * reactively is always correct with no refresh call anywhere.
 *
 * `filter` reproduces `data-filter="true"`: jQM injected a search box above the
 * list and hid non-matching `<li>`s. Twelve templates ask for it.
 */
import { computed, provide, ref } from 'vue'

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
    <input
      :id="filterId"
      v-model="query"
      type="search"
      data-type="search"
      class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset"
      :placeholder="filterPlaceholder"
    />
  </form>
  <ul :class="classes" data-role="listview">
    <slot :query="query" />
  </ul>
</template>
