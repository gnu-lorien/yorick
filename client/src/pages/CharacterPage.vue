<script setup lang="ts">
/**
 * The character sheet -- `#character`.
 *
 * A port of `CharacterView.js` and the `#characterView` template at
 * `public/index.html:221-389`. This is the app's hub: almost every other screen
 * is reached from a tile on it.
 *
 * Three routes render it, differing only in where Back goes --
 * `show_character_helper(id, back_url)` (`mobileRouter.js:851`) is the shared
 * body and its two callers pass a troupe roster or the admin listing instead of
 * the player's own list. The route's `handler` in `meta` says which one this is.
 *
 * The page id stays `character` for all three, because that is what the E2E
 * suite's `activePageId` reads and what `waitForActivePage('#character')` waits
 * for. `#insertheader` keeps its id for the same reason.
 *
 * The sheet is almost entirely links: what it renders that is not a link is the
 * XP summary at the top, and which trait categories exist -- both of which come
 * from the venue, so a Werewolf sheet lists Gifts where a Vampire lists
 * Disciplines without this file knowing either word.
 */
import { computed, onMounted, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmListItem, JqmListview, JqmPage } from '@/components/jqm'
import CharacterSummary from '@/components/CharacterSummary.vue'
import SheetTile from '@/components/SheetTile.vue'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

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

/** `character?:id` names its parameter `id`; the troupe route names it `cid`. */
const characterId = computed(
  () => (route.params.cid as string | undefined) ?? (route.params.id as string),
)

/**
 * Where Back goes, per `show_character_helper`'s three callers.
 */
const backHref = computed(() => {
  const handler = route.meta.handler as string
  if (handler === 'troupe_character') return `#troupe/${route.params.id}/characters/all`
  if (handler === 'administration_character') return '#administration/characters/all'
  return '#characters?all'
})

useBackHref(backHref)

onMounted(async () => {
  try {
    character.value = await ui.runWork(() => get_character(characterId.value))
  } catch (error) {
    await reportErrorOn("Couldn't open the character")(error).catch(() => {})
    // The original sent the user back where they came from on failure, rather
    // than leaving them on an empty sheet.
    window.location.hash = backHref.value
  }
})

/*
 * `trackAll`, not `track(character)`.
 *
 * The sheet reads a graph, not a record: the XP summary comes off the character
 * but the category tiles are driven by its traits, and editing a trait on
 * another screen must be reflected when the user comes back. A per-object
 * subscription would miss a change two pointers away -- which is the exact
 * failure that ended the previous attempt at this migration.
 */
const xp = computed(() => {
  const c = character.value
  if (!c) return null
  trackAll()
  return {
    earned: c.get('experience_earned') as number | undefined,
    spent: c.get('experience_spent') as number | undefined,
    // The ledger is reached through `character.experience`; see Character.ts.
    available: c.experience.experience_available(),
  }
})

const beingCreated = computed(() => {
  const c = character.value
  if (!c) return false
  trackAll()
  return c.is_being_created()
})

/**
 * The trait categories, grouped under their headings.
 *
 * `all_simpletrait_categories()` returns `[name, description, heading]` triples
 * in display order, and the template emitted a heading bar whenever the third
 * element changed from the previous row. Grouping them here says the same thing
 * without a mutable `heading` variable carried across a loop.
 */
const traitGroups = computed(() => {
  const c = character.value
  if (!c) return []
  trackAll()
  const groups: { heading: string; categories: { category: string; description: string }[] }[] = []
  for (const entry of c.venue.ALL_SIMPLETRAIT_CATEGORIES) {
    const [category, description, heading] = entry as unknown as [string, string, string]
    const last = groups[groups.length - 1]
    if (!last || last.heading !== heading) {
      groups.push({ heading, categories: [{ category, description }] })
    } else {
      last.categories.push({ category, description })
    }
  }
  return groups
})

/**
 * The core text attributes -- clan, sect, archetype and the rest.
 *
 * Shown only once creation is complete, as in the original: during creation the
 * wizard owns them.
 */
const textAttributes = computed(() => {
  const c = character.value
  if (!c || beingCreated.value) return []
  trackAll()
  return c.venue.TEXT_ATTRIBUTES.map((name) => ({
    name,
    /*
     * `st[0].toUpperCase() + st.substr(1)`, and NOT the venue's pretty name.
     *
     * The two templates disagree on purpose. The creation wizard labels these
     * with `TEXT_ATTRIBUTES_PRETTY_NAMES` (`character-create-view.html:9`); the
     * sheet capitalises the attribute name itself (`index.html:317`). For five
     * of Vampire's six the two agree, which is what makes the difference easy
     * to miss -- the sixth is `antecedence`, whose pretty name is the whole
     * question "Primary, Secondary, or NPC".
     */
    upper: name.charAt(0).toUpperCase() + name.slice(1),
    value: (c.get(name) as string) || '',
  }))
})
</script>

<template>
  <JqmPage id="character" title="Character">
    <template v-if="character">
      <div id="insertheader">
        <CharacterSummary :character="character" />
      </div>

      <div>
        Earned XP: {{ xp?.earned }}<br />
        Spent XP: {{ xp?.spent }}<br />
        Available XP: {{ xp?.available }}<br />
      </div>

      <div class="ui-grid-b ui-responsive">
        <SheetTile block="a" :href="`#character/${character.id}/print`">Show Latest</SheetTile>
        <SheetTile :href="`#character/${character.id}/approved`">Show Approved</SheetTile>
        <SheetTile :href="`#character/${character.id}/approval`">Show Approval</SheetTile>
        <SheetTile :href="`#character/${character.id}/portrait`">Character Portrait</SheetTile>
        <SheetTile :href="`#character/${character.id}/print`">Print Latest</SheetTile>
        <SheetTile :href="`#character/${character.id}/approved`">Print Approved</SheetTile>
        <SheetTile :href="`#character/${character.id}/rename`">Rename</SheetTile>
        <SheetTile :href="`#character/${character.id}/extendedprinttext`">
          Extended Print Text
        </SheetTile>
        <SheetTile :href="`#character/${character.id}/backgroundlt`">Background</SheetTile>
        <SheetTile :href="`#character/${character.id}/noteslt`">Notes</SheetTile>
      </div>

      <JqmListview v-if="beingCreated" inset>
        <JqmListItem :href="`#charactercreate/${character.id}`">Character Creation</JqmListItem>
      </JqmListview>

      <div class="ui-grid-b ui-responsive">
        <template v-for="group in traitGroups" :key="group.heading">
          <h3 class="ui-bar ui-bar-a">{{ group.heading }}</h3>
          <SheetTile
            v-for="entry in group.categories"
            :key="entry.category"
            :href="`#simpletraits/${entry.category}/${character.id}/all`"
          >
            {{ entry.description }}
          </SheetTile>
        </template>

        <template v-if="!beingCreated">
          <h3 class="ui-bar ui-bar-a">Information</h3>
          <div class="ui-grid-b ui-responsive">
            <div v-for="st in textAttributes" :key="st.name" class="ui-block-b">
              <ul
                data-role="listview"
                data-inset="true"
                class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
              >
                <template v-if="st.value">
                  <li data-role="list-divider" class="ui-li-divider ui-bar-inherit">
                    {{ st.upper }}
                    <p>{{ st.value }}</p>
                  </li>
                  <!-- One line each: see the note in CharacterCreatePage.vue. -->
                  <li>
                    <a :href="`#simpletext/${st.name}s/${st.name}/${character.id}/pick`">Repick {{ st.upper }}</a>
                  </li>
                  <li data-icon="delete">
                    <a :href="`#simpletext/${st.name}s/${st.name}/${character.id}/unpick`">Unpick {{ st.upper }}</a>
                  </li>
                </template>
                <li v-else>
                  <a :href="`#simpletext/${st.name}s/${st.name}/${character.id}/pick`">Pick {{ st.upper }}</a>
                </li>
              </ul>
            </div>
          </div>
        </template>
      </div>

      <h3 class="ui-bar ui-bar-a">Progression</h3>
      <div class="ui-grid-b ui-responsive">
        <SheetTile block="a" :href="`#character/${character.id}/history/0`">History</SheetTile>
        <SheetTile :href="`#character/${character.id}/experience/0/10`">
          Experience Points
        </SheetTile>
        <SheetTile :href="`#character/${character.id}/costs`">Costs</SheetTile>
        <SheetTile :href="`#character/${character.id}/log/0/10`">Log</SheetTile>
      </div>

      <h3 class="ui-bar ui-bar-a">Troupes</h3>
      <div class="ui-grid-b ui-responsive">
        <SheetTile block="a" :href="`#character/${character.id}/troupes`">
          Show My Troupes
        </SheetTile>
        <SheetTile :href="`#character/${character.id}/troupes/join`">Join Troupe</SheetTile>
        <SheetTile :href="`#character/${character.id}/troupes/leave`">Leave Troupe</SheetTile>
      </div>

      <h3 class="ui-bar ui-bar-a">Final Death</h3>
      <div class="ui-grid-b ui-responsive">
        <SheetTile block="a" :href="`#character/${character.id}/delete`">Delete Character</SheetTile>
      </div>
    </template>
  </JqmPage>
</template>
