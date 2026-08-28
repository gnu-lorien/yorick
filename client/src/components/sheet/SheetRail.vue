<script setup lang="ts">
/**
 * The sheet's navigation rail: a column on the desktop, a drawer on a phone.
 *
 * One piece of markup serves both. Which one you get is entirely a matter of
 * CSS at the 720px breakpoint (see `styles/sheet-theme.css`), including the
 * meaning of the toggle: above the breakpoint the rail is present and the
 * button collapses it, below it the rail is off-canvas and the button opens
 * it. Both readings are the right behaviour for their width, so one flag
 * drives both.
 *
 * The counts come from `character.get(category).length`. That is free: the
 * trait pointers are a column on the character row, so the array is populated
 * the moment the row is read, long before any trait is hydrated. Reading
 * `.length` costs no request. Reading a trait's `name` would.
 *
 * ## Why some entries are buttons
 *
 * This app routes on the location hash, so every `href="#..."` is a
 * navigation. A trait GROUP is not a destination -- there is no URL for
 * "Disciplines", only for the six categories inside it -- and an `href="#"`
 * anchor to scroll the page would route the app to nowhere. Those entries are
 * therefore buttons that expand and scroll to their section, and only the
 * entries that really are destinations render as links.
 */
import type { RailGroup } from './types'

defineProps<{ groups: RailGroup[] }>()
const emit = defineEmits<{
  (e: 'navigate'): void
  (e: 'jump', section: string): void
}>()
</script>

<template>
  <nav class="sr-rail" aria-label="Character sheet sections">
    <template v-for="group in groups" :key="group.heading">
      <div class="sr-rail-group">{{ group.heading }}</div>
      <template v-for="entry in group.entries" :key="group.heading + entry.label">
        <a v-if="entry.href" :href="entry.href" @click="emit('navigate')">
          <span>{{ entry.label }}</span>
          <span v-if="entry.count !== null && entry.count !== undefined" class="sr-count">{{
            entry.count
          }}</span>
        </a>
        <button v-else type="button" @click="emit('jump', entry.jump ?? entry.label)">
          <span>{{ entry.label }}</span>
          <span v-if="entry.count !== null && entry.count !== undefined" class="sr-count">{{
            entry.count
          }}</span>
        </button>
      </template>
    </template>
  </nav>
</template>
