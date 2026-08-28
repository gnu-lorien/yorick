<script setup lang="ts">
/**
 * One collapsible group of the character sheet.
 *
 * Seven of these replace the old wall of tiles. A native `<details>` rather
 * than a scripted accordion, for three reasons that all matter here: it works
 * before Vue hydrates, its contents stay in the DOM while closed -- which is
 * what lets `character-sheet.spec.js` assert `toBeAttached()` on links inside a
 * closed group -- and the browser gives keyboard and screen-reader behaviour
 * for free.
 *
 * `open` is one-way: it seeds the initial state and emits when the user toggles.
 * Binding it both ways would fight the browser, which owns the element's state.
 */
defineProps<{
  title: string
  /** Right-aligned summary, e.g. "18 traits · 4 categories". */
  tally?: string
  open?: boolean
  /**
   * DOM id, so the rail can scroll to this section. Not a route: the rail
   * jumps with `scrollIntoView`, never with an `href="#..."`, which this app
   * would treat as navigation.
   */
  sectionId?: string
}>()

const emit = defineEmits<{ (e: 'toggle', open: boolean): void }>()

function onToggle(event: Event) {
  emit('toggle', (event.target as HTMLDetailsElement).open)
}
</script>

<template>
  <details :id="sectionId" class="sr-section" :open="open" @toggle="onToggle">
    <summary>
      <span class="sr-glyph" aria-hidden="true">▶</span>
      <span class="sr-section-title sr-display">{{ title }}</span>
      <span v-if="tally" class="sr-tally">{{ tally }}</span>
    </summary>
    <div class="sr-section-body">
      <slot />
    </div>
  </details>
</template>
