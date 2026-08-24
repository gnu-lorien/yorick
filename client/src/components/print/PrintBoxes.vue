<script setup lang="ts">
/**
 * A row of empty boxes with a heading -- the `print/total.html` template.
 *
 * Rage, Harano, Wyrm Taint, Seethe Traits and Willpower are all this shape: a
 * heading, then `total` empty squares with a non-breaking space after every
 * `split` of them so a storyteller can count in groups at a glance.
 *
 * The boxes are Font Awesome glyphs (`fa fa-square-o`), not characters, because
 * the printed sheet is filled in by hand and needs a box big enough to tick.
 */
withDefaults(defineProps<{ name?: string; total: number; split?: number }>(), { split: 5 })
</script>

<template>
  <div>
    <h4 v-if="name" class="ui-bar ui-bar-a ui-corner-all">{{ name }}</h4>
    <template v-for="i in Math.max(0, total)" :key="i">
      <i class="fa fa-square-o"></i>
      <template v-if="split > 0 && i % split === 0">&nbsp;</template>
    </template>
  </div>
</template>
