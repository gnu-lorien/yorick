<script setup lang="ts">
/**
 * One row of a `JqmListview`.
 *
 * Two shapes, matching what the old templates emit: a plain content row
 * (`ui-li-static`) and a linked row, where jQuery Mobile put the classes on an
 * inner `<a class="ui-btn">` and left the `<li>` bare. `character-list-item.html`
 * is the canonical example of the second, including the `ui-li-has-thumb`
 * modifier for the portrait thumbnail.
 *
 * `filterText` participates in the enclosing listview's `data-filter` search:
 * jQuery Mobile matched against the row's text content, so passing the same
 * text keeps filtering behaviour identical.
 */
import { computed, inject, type Ref } from 'vue'

const props = withDefaults(
  defineProps<{
    href?: string
    icon?: string
    iconpos?: 'left' | 'right' | 'notext'
    thumb?: boolean
    count?: number
    filterText?: string
    theme?: string
  }>(),
  { iconpos: 'right', thumb: false },
)

const query = inject<Ref<string> | null>('jqmListFilter', null)

const visible = computed(() => {
  if (!query || !query.value) return true
  const needle = query.value.toLowerCase()
  return (props.filterText || '').toLowerCase().includes(needle)
})

const liClasses = computed(() => [
  props.thumb ? 'ui-li-has-thumb' : '',
  props.count !== undefined ? 'ui-li-has-count' : '',
  props.href ? '' : 'ui-li-static ui-body-inherit',
])

const anchorClasses = computed(() => [
  'ui-btn',
  props.icon !== undefined || props.iconpos === 'right' ? `ui-btn-icon-${props.iconpos}` : '',
  `ui-icon-${props.icon || 'carat-r'}`,
])
</script>

<template>
  <li v-show="visible" :class="liClasses">
    <a v-if="href" :href="href" :class="anchorClasses">
      <slot />
      <span v-if="count !== undefined" class="ui-li-count ui-btn-corner-all">{{ count }}</span>
    </a>
    <template v-else>
      <slot />
      <span v-if="count !== undefined" class="ui-li-count ui-btn-corner-all">{{ count }}</span>
    </template>
  </li>
</template>
