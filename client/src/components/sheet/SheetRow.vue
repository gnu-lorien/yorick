<script setup lang="ts">
/**
 * One destination on the character sheet.
 *
 * The replacement for `SheetTile`, which rendered a grid cell holding an inset
 * listview holding a single link -- six lines of jQuery Mobile markup repeated
 * about fifty-nine times, none of which showed a value. A row carries what the
 * tile could not: how many traits the category holds, and a sample of them.
 *
 * `value` is deliberately `number | null`, not `number | undefined`. `null`
 * means "this destination has no count" (Rename, Print, Log) and renders
 * nothing; `0` means "this category is empty", which is worth showing -- it is
 * the difference between a category you have not filled in and one that does
 * not count things.
 */
defineProps<{
  href: string
  name: string
  /** A few of the traits inside, when they have been hydrated. */
  detail?: string
  /** How many traits the category holds, or null when the idea does not apply. */
  value?: number | null
}>()
</script>

<template>
  <a class="sr-row" :href="href">
    <span class="sr-row-name">{{ name }}</span>
    <span v-if="detail" class="sr-row-detail">{{ detail }}</span>
    <span
      v-if="value !== null && value !== undefined"
      class="sr-row-value"
      :class="{ 'sr-none': value === 0 }"
      >{{ value === 0 ? '—' : value }}</span
    >
  </a>
</template>
