<script setup lang="ts">
/**
 * The character-creation wizard -- `#character-create`.
 *
 * A port of `CharacterCreateViewNew.js` and the thirteen templates in
 * `templates/create/`. Ten regions in a fixed order
 * (`CharacterCreateViewNew.js:413-454`): the XP note, the core text
 * attributes, then seven creation pools, then Complete.
 *
 * Only the fifth pool differs by creature type -- Disciplines for a Vampire,
 * Gifts for a Werewolf, Arts for a Changeling -- and several pools use a
 * venue-prefixed category (`wta_backgrounds`, `ctdbs_merits`). Both come from
 * the table below rather than from three copies of the layout.
 *
 * ## Creation picks are free, and that is the point
 *
 * A pick sets `free_value = rating`, so the trait's cost `(value - free_value) *
 * rate` is zero and no XP is spent. The pool counter is what limits them. That
 * is also why the limit matters so much: a pool that does not decrement hands
 * out unlimited free traits through the normal UI, and the result is written
 * into the immutable audit log by server triggers.
 */
import { computed, onMounted, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage, vJqmListview } from '@/components/jqm'
import CreationPool from '@/components/create/CreationPool.vue'
import { useBackHref } from '@/composables/useBackHref'
import { useScrollRestore } from '@/composables/useScrollRestore'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { venueOf } from '@/parse/classes'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const cid = computed(() => route.params.cid as string)
useBackHref(() => `#character?${cid.value}`)

/*
 * `shallowRef`, never `ref`.
 *
 * A `Parse.Object` must not be deep-proxied: `ref()` walks the object, hands
 * the SDK proxies where it expects its own instances, and UNWRAPS any nested
 * ref it finds -- which is how the XP ledger's `notations` (a `ShallowRef` on
 * `CharacterExperience`) silently became a plain array in one place and an
 * empty table in another. `@/parse/reactivity` is what makes mutations visible;
 * the ref only has to hold the reference.
 */
const character = shallowRef<Character | null>(null)
// Return to where the reader was before they took a side trip to pick, unpick
// or change something. See `useScrollRestore`.
useScrollRestore(character)

onMounted(async () => {
  try {
    character.value = await ui.runWork(() => get_character(cid.value, 'all'))
  } catch (error) {
    await reportErrorOn("Couldn't open character creation")(error).catch(() => {})
  }
})

const creation = computed(() => {
  const c = character.value
  if (!c) return null
  trackAll()
  return (c.get('creation') as Parse.Object | undefined) ?? null
})

const venue = computed(() => {
  const c = character.value
  if (!c) return 'Vampire' as const
  trackAll()
  return venueOf(c.get('type'))
})

const initialXp = computed(() => creation.value?.get('initial_xp') ?? 0)
const name = computed(() => {
  const c = character.value
  if (!c) return ''
  trackAll()
  return (c.get('name') as string) ?? ''
})

/** `[low..high]` walked downward, which is the order the templates render. */
function descending(high: number, low: number): number[] {
  const out: number[] = []
  for (let i = high; i >= low; i--) out.push(i)
  return out
}

/**
 * The venue-prefixed name of a shared pool.
 *
 * `getDescriptionCategory` in the original, repeated once per step. Backgrounds,
 * merits and flaws are prefixed; skills, attributes and focuses are not.
 */
function categoryFor(base: 'backgrounds' | 'merits' | 'flaws'): string {
  if (venue.value === 'Werewolf') return `wta_${base}`
  if (venue.value === 'ChangelingBetaSlice') return `ctdbs_${base}`
  return base
}

const FOCUSES = [
  { pretty: 'Physical', category: 'focus_physicals' },
  { pretty: 'Social', category: 'focus_socials' },
  { pretty: 'Mental', category: 'focus_mentals' },
] as const

/** The fifth pool: the one step that is genuinely per-venue. */
const fifthPool = computed(() => {
  if (venue.value === 'Werewolf') {
    return {
      heading: 'Gifts',
      category: 'wta_gifts',
      ratings: descending(2, 1),
      pickLabel: (i: number) => `Pick affinity gifts at rating ${i}`,
    }
  }
  if (venue.value === 'ChangelingBetaSlice') {
    return {
      heading: 'Arts',
      category: 'ctdbs_arts',
      ratings: descending(2, 1),
      pickLabel: (i: number) => `Pick Art at rating ${i}`,
    }
  }
  return {
    heading: 'Disciplines',
    category: 'disciplines',
    ratings: descending(2, 1),
    pickLabel: (i: number) => `Pick in clan discipline at rating ${i}`,
  }
})

/**
 * The core text attributes, paired with their headings.
 *
 * `TEXT_ATTRIBUTES` and `TEXT_ATTRIBUTES_PRETTY_NAMES` are two positionally
 * aligned arrays, which is how the original stored them and how
 * `create/simpletexts.html` zipped them. A pretty name may be a FUNCTION of the
 * character -- "Faction" is a hook someone left half-built, and it was carried
 * over rather than flattened -- so each one is called when it is callable.
 */
const textAttributes = computed(() => {
  const c = character.value
  if (!c) return []
  trackAll()
  const pretty = c.venue.TEXT_ATTRIBUTES_PRETTY_NAMES
  return c.venue.TEXT_ATTRIBUTES.map((name, i) => {
    const heading = pretty[i]
    const label =
      typeof heading === 'function'
        ? (heading as (ch: unknown) => string)(c)
        : ((heading as string) ?? name.charAt(0).toUpperCase() + name.slice(1))
    return { name, label, value: (c.get(name) as string) || '' }
  })
})

const attributesRatings = descending(8, 1)
const skillsRatings = descending(4, 1)
const backgroundsRatings = descending(3, 1)
const focusRatings = descending(2, 1)
/** Merits and flaws run 1 down to 0 -- a zero-rated pick is a real slot. */
const meritFlawRatings = descending(1, 0)
</script>

<template>
  <JqmPage id="character-create" title="Create Character" :content="false">
    <div role="main" class="ui-content force-printing-page-break">
      <template v-if="character && creation">
        <div id="ccv-description">
          <p>You have {{ initialXp }} initial XP to spend</p>
          <p>Remaining steps for {{ name }}</p>
        </div>

        <div id="ccv-simpletext">
          <ul
            v-jqm-listview
            v-for="st in textAttributes"
            :key="st.name"
            data-role="listview"
            data-inset="true"
            class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
          >
            <template v-if="st.value">
              <li data-role="list-divider" class="ui-li-divider ui-bar-inherit">
                {{ st.label }}
                <p>{{ st.value }}</p>
              </li>
              <li>
                <a :href="`#charactercreate/simpletext/${st.name}s/${st.name}/${cid}/pick`">Repick {{ st.label }}</a>
              </li>
              <li data-icon="delete">
                <a :href="`#charactercreate/simpletext/${st.name}s/${st.name}/${cid}/unpick`">Unpick {{ st.label }}</a>
              </li>
            </template>
          <!--
            The link text is on ONE line, deliberately.

            The original template rendered `<a href="...">Pick <%= ust %></a>`
            with no surrounding whitespace, and the E2E suite matches it with an
            ANCHORED regex -- `filter({ hasText: /^Pick Clan$/ })`. Playwright
            does not trim for a regex, so a prettier multi-line body makes the
            text `"
  Pick Clan
"` and the assertion fails on a screen that is
            visibly correct.
          -->
            <li v-else>
              <a :href="`#charactercreate/simpletext/${st.name}s/${st.name}/${cid}/pick`">Pick {{ st.label }}</a>
            </li>
          </ul>
        </div>

        <div id="ccv-next-one">
          <CreationPool
            :character-id="cid"
            :creation="creation"
            heading="Attributes"
            category="attributes"
            :ratings="attributesRatings"
            :pick-label="(i) => `Pick attribute at rating ${i}`"
          />
        </div>

        <div id="ccv-next-two">
          <CreationPool
            v-for="focus in FOCUSES"
            :key="focus.category"
            :character-id="cid"
            :creation="creation"
            :heading="`${focus.pretty} Focus`"
            :category="focus.category"
            :ratings="focusRatings"
            :pick-label="() => `Pick ${focus.pretty} Focus`"
            :show-value="false"
          />
        </div>

        <div id="ccv-next-three">
          <CreationPool
            :character-id="cid"
            :creation="creation"
            heading="Skills"
            category="skills"
            :ratings="skillsRatings"
            :pick-label="(i) => `Pick skill at rating ${i}`"
          />
        </div>

        <div id="ccv-next-four">
          <CreationPool
            :character-id="cid"
            :creation="creation"
            heading="Backgrounds"
            :category="categoryFor('backgrounds')"
            :ratings="backgroundsRatings"
            :pick-label="(i) => `Pick a background at rating ${i}`"
          />
        </div>

        <div id="ccv-next-five">
          <CreationPool
            :character-id="cid"
            :creation="creation"
            :heading="fifthPool.heading"
            :category="fifthPool.category"
            :ratings="fifthPool.ratings"
            :pick-label="fifthPool.pickLabel"
          />
        </div>

        <div id="ccv-next-six">
          <CreationPool
            :character-id="cid"
            :creation="creation"
            heading="Merits"
            :category="categoryFor('merits')"
            :ratings="meritFlawRatings"
            :pick-label="() => 'Pick merit'"
          />
        </div>

        <div id="ccv-next-seven">
          <CreationPool
            :character-id="cid"
            :creation="creation"
            heading="Flaws"
            :category="categoryFor('flaws')"
            :ratings="meritFlawRatings"
            :pick-label="() => 'Pick flaw'"
          />
        </div>

        <div id="ccv-next-eight">
          <a :href="`#charactercreate/complete/${cid}`" class="ui-btn">
            Complete Character Creation!
          </a>
        </div>
      </template>
    </div>
  </JqmPage>
</template>
