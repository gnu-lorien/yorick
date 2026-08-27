<script setup lang="ts">
/**
 * The identifying lines for one character: portrait, name, and the handful of
 * text attributes that say what it is.
 *
 * The same block appears twice in the Backbone app, in two templates that had
 * drifted apart only in their wrapper:
 * `templates/single-character-list-item.html` (the header of the character
 * sheet) and `templates/character-list-item.html` (a row in a list). The body
 * is identical, so it is one component here and the wrapper is the caller's.
 *
 * Which lines are shown depends on the creature type, and the three branches are
 * reproduced exactly -- including which fields share a line, which line is
 * conditional, and the fact that a Vampire is the `else`. `type` absent means
 * Vampire; see `venueOf`.
 *
 * ## The owner line, and why it is written this way
 *
 * `owner` is a pointer that is deliberately NOT `include`d by any character
 * query. Including it made parse-server delete the pointer outright for a
 * private owner, and `Character#get_me_acl` reads a missing owner as "no owner"
 * and grants the CURRENT user read and write -- so merely opening someone
 * else's sheet rewrote its ACL to the viewer.
 *
 * Without the include the pointer survives but carries no data, so
 * `owner.get('username')` is undefined and this renders nothing. That is what
 * the original did too. An ABSENT owner is a different thing entirely: it means
 * the account was deleted, and the sheet says so.
 */
import { computed } from 'vue'
import Parse from '@/parse'
import { track } from '@/parse/reactivity'
import { venueOf } from '@/parse/classes'

const props = defineProps<{
  character: Parse.Object
  /** Portrait size to request, matching the template's `get_thumbnail_sync(128)`. */
  thumbSize?: number
  /**
   * Whether the portrait is its own link to the portrait editor.
   *
   * True on the character sheet, where the whole block stands alone. False in a
   * list, where the block already sits inside the row's anchor and a nested
   * `<a>` is invalid HTML that browsers recover from unpredictably -- the
   * original's two templates differ on exactly this line.
   */
  portraitLink?: boolean
  /**
   * Whether to name the owner.
   *
   * A player's own roster must NOT: every row has the same owner, so the line
   * is redundant and it crowds the row. A list that is mostly other people's
   * characters -- the administration roster, a troupe's -- must, because there
   * the owner is the point.
   *
   * Stated rather than inferred. The Backbone app got the same result by
   * accident: nothing hydrated the pointer on a personal roster, so the line
   * rendered empty. Leaving it to whether a pointer happens to be hydrated is
   * how a display decision becomes a side effect of an unrelated fetch, which
   * is exactly what went wrong once already.
   */
  showOwner?: boolean
}>()

const attr = (name: string) => (track(props.character).get(name) as string | undefined) ?? ''

const venue = computed(() => venueOf(track(props.character).get('type')))

const name = computed(() => attr('name'))

const thumbnail = computed(() => {
  const c = track(props.character) as unknown as { get_thumbnail_sync?: (n: number) => string }
  return c.get_thumbnail_sync?.(props.thumbSize ?? 128)
})

/**
 * The venue-specific lines, in the order and grouping the templates used.
 * A line whose parts are all empty is dropped, which is what the `if` wrappers
 * around some of them did.
 */
const lines = computed<string[]>(() => {
  const join = (...parts: string[]) => parts.filter(Boolean).join(' ')
  const out: string[] = []

  if (venue.value === 'Werewolf') {
    if (attr('wta_tribe') || attr('wta_breed') || attr('wta_auspice')) {
      out.push(join(attr('wta_tribe'), attr('wta_breed'), attr('wta_auspice')))
    }
    out.push(join(attr('wta_faction'), attr('archetype'), attr('wta_camp')))
    out.push(attr('antecedence'))
  } else if (venue.value === 'ChangelingBetaSlice') {
    if (attr('ctdbs_kith') || attr('ctdbs_fealty_court') || attr('archetype')) {
      out.push(join(attr('ctdbs_kith'), attr('ctdbs_fealty_court'), attr('archetype')))
    }
    out.push(join(attr('ctdbs_kith_group_type'), attr('ctdbs_noble_house')))
    out.push(attr('antecedence'))
  } else {
    out.push(join(attr('sect'), attr('archetype'), attr('clan')))
    if (attr('antecedence') || attr('faction') || attr('title')) {
      out.push(join(attr('antecedence'), attr('faction'), attr('title')))
    }
  }

  /*
   * The unconditional lines above can still come out empty -- the original
   * emitted `<p>  </p>` in that case. Dropping them is the one cosmetic
   * difference here, and it removes blank rows rather than adding anything.
   */
  return out.filter((line) => line.length > 0)
})

/** `undefined` = owner present but unreadable; `null` = no owner at all. */
const ownerLine = computed<string | null | undefined>(() => {
  const c = track(props.character)
  if (!c.has('owner')) return null
  const owner = c.get('owner') as Parse.User | undefined
  const username = owner?.get('username') as string | undefined
  if (!username) return undefined
  const realname = (owner?.get('realname') as string) || ''
  const email = (owner?.get('email') as string) || ''
  return [realname, email, username].filter(Boolean).join(' ')
})
</script>

<template>
  <a v-if="thumbnail && portraitLink !== false" :href="`#character/${character.id}/portrait`">
    <img :src="thumbnail" class="character-link-portrait" alt="" />
  </a>
  <img v-else-if="thumbnail" :src="thumbnail" class="character-link-portrait" alt="" />
  <h2>{{ name }}</h2>
  <p v-for="(line, i) in lines" :key="i">{{ line }}</p>
  <template v-if="showOwner !== false">
    <p v-if="ownerLine === null">DELETED</p>
    <p v-else-if="ownerLine">{{ ownerLine }}</p>
  </template>
</template>
