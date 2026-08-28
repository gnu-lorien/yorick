<script setup lang="ts">
/**
 * The bar under the masthead: the rail toggle and the filter.
 *
 * The filter is the answer to this sheet's oldest problem. A character has
 * around sixty destinations on one screen, and before this the only way to
 * reach one was to recognise its tile among fifty-eight identical others.
 * Typing "spec" now reaches every Specialization category at once, across the
 * groups they are scattered over.
 *
 * `type="button"` on the toggle is not incidental: this control renders inside
 * pages that also contain forms, and a bare `<button>` defaults to
 * `type="submit"`.
 */
defineProps<{
  /** Current filter text. */
  modelValue: string
  /** How many destinations this sheet has, for the placeholder and the count. */
  total: number
  /** Categories and traits summary, right-aligned. Hidden on mobile. */
  summary?: string
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'toggle-rail'): void
}>()
</script>

<template>
  <div class="sr-toolbar">
    <button
      type="button"
      class="sr-rail-toggle"
      aria-label="Toggle sheet navigation"
      @click="$emit('toggle-rail')"
    >
      <span aria-hidden="true">☰</span>
      <span class="sr-rail-toggle-label">Sheet</span>
    </button>

    <div class="sr-search">
      <span class="sr-search-icon" aria-hidden="true">⌕</span>
      <input
        type="search"
        :value="modelValue"
        :placeholder="`Filter ${total} destinations`"
        aria-label="Filter character sheet destinations"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div v-if="summary" class="sr-toolbar-count">{{ summary }}</div>
  </div>
</template>
