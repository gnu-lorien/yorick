<script setup lang="ts">
/**
 * The top of the character sheet: who this is, and where their XP stands.
 *
 * ## Why `#insertheader` is still here, unchanged
 *
 * This component does NOT re-implement the identity block. It wraps the one
 * `CharacterSummary` already renders and styles that, because two E2E
 * assertions read the exact structure underneath:
 *
 *   - `legacy-bug-regressions.spec.js:1298` asserts `#character #insertheader`
 *     contains the character's name.
 *   - `:1301` takes that element's `firstElementChild` and reads its id and
 *     class -- the character's own objectId and Parse class name. Memoising
 *     the sub-view once froze that wrapper at whichever character was opened
 *     first, so a werewolf's details rendered inside a vampire's id.
 *
 * So the wrapper div, its id, its class and its position as the first child
 * are all load-bearing. The design is applied by styling `h2` and `p` inside
 * `.sr-identity` (see `styles/sheet-theme.css`), not by replacing them.
 *
 * ## The XP labels
 *
 * They render "Earned XP:", "Spent XP:" and "Available XP:" in full because
 * `character-sheet.spec.js:118-120` asserts each is visible by exact string.
 * The uppercase, letter-spaced look comes from `text-transform`, which changes
 * rendering only and leaves the DOM text those assertions read intact.
 */
import { computed } from 'vue'
import CharacterSummary from '@/components/CharacterSummary.vue'
import type { Character } from '@/domain/Character'
import { trackAll } from '@/parse/reactivity'

const props = defineProps<{
  character: Character
  /** True while the creation wizard still owns this character. */
  beingCreated: boolean
}>()

const xp = computed(() => {
  const c = props.character
  trackAll()
  return {
    earned: (c.get('experience_earned') as number | undefined) ?? 0,
    spent: (c.get('experience_spent') as number | undefined) ?? 0,
    available: c.experience.experience_available(),
  }
})

/**
 * The spent/available split, as percentages of what has been earned.
 *
 * Guarded on `earned > 0`: a brand-new character has earned nothing, and
 * `0/0` would put `NaN%` into a style attribute.
 */
const bar = computed(() => {
  const { earned, spent } = xp.value
  if (!earned || earned <= 0) return { spent: '0%', free: '0%' }
  const pct = Math.max(0, Math.min(100, (spent / earned) * 100))
  return { spent: `${pct}%`, free: `${100 - pct}%` }
})

/** The portrait, at masthead size rather than the old 128px thumbnail. */
const portrait = computed(() => {
  const c = props.character as unknown as { get_thumbnail_sync?: (n: number) => string }
  trackAll()
  return c.get_thumbnail_sync?.(512)
})
</script>

<template>
  <header class="sr-masthead">
    <div class="sr-mast-text">
      <!--
        `#insertheader` keeps its id, and the div inside keeps the character's
        own objectId and Parse class name. See the note at the top of this file
        before changing either.
      -->
      <div id="insertheader" class="sr-identity">
        <div :id="character.id" :class="character.className">
          <CharacterSummary :character="character" :portrait-link="false" />
        </div>
      </div>

      <span v-if="beingCreated" class="sr-badge">In Creation</span>

      <div class="sr-xp">
        <div class="sr-xp-nums">
          <span>
            <span class="sr-xp-k">Earned XP:</span>
            <span class="sr-xp-v">{{ xp.earned }}</span>
          </span>
          <span>
            <span class="sr-xp-k">Spent XP:</span>
            <span class="sr-xp-v">{{ xp.spent }}</span>
          </span>
          <span class="sr-xp-avail">
            <span class="sr-xp-k">Available XP:</span>
            <span class="sr-xp-v">{{ xp.available }}</span>
          </span>
        </div>
        <div class="sr-bar" role="presentation">
          <i class="sr-bar-spent" :style="{ width: bar.spent }"></i>
          <i class="sr-bar-free" :style="{ width: bar.free }"></i>
        </div>
        <p v-if="xp.available > 0" class="sr-bar-note">
          {{ xp.available }} XP available to spend
        </p>
      </div>
    </div>

    <a
      v-if="portrait"
      class="sr-portrait"
      :href="`#character/${character.id}/portrait`"
      aria-label="Character portrait"
    >
      <img :src="portrait" alt="" />
    </a>
  </header>
</template>
