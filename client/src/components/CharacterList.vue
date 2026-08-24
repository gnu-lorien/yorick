<script setup lang="ts">
/**
 * A list of characters -- a port of `CharactersListView.js` and
 * `templates/character-list-item.html`.
 *
 * Reused by four screens in the original, parameterised by `click_url`: the
 * player's own characters, a troupe's roster, the admin listing, and the
 * troupe pick screens. `click_url` was an underscore template string
 * (`#character?<%= character_id %>`) rendered on click by a delegated handler;
 * here it is a function and the row carries a real `href`, which behaves the
 * same and additionally makes rows middle-clickable.
 *
 * ## Selectors the E2E suite depends on
 *
 * `a.character-list-item`, its `backendId` attribute, and
 * `img.character-link-portrait`. `backendId` is a non-standard attribute the
 * template invented to carry the object id, and it is how the suite finds a
 * specific character in a list. Preserved verbatim, lowercase matching included.
 *
 * The original debounced its re-render at 150ms because a Backbone collection
 * fired one `add` per row as `q.each` paged through. There is nothing to
 * debounce here: the array is assigned once, when the query finishes.
 */
import { computed } from 'vue'
import Parse from '@/parse'
import { track } from '@/parse/reactivity'
import { JqmListview } from '@/components/jqm'
import CharacterSummary from '@/components/CharacterSummary.vue'

const props = withDefaults(
  defineProps<{
    characters: readonly Parse.Object[]
    /** See `CharacterSummary`: off for a player's own roster, on elsewhere. */
    showOwner?: boolean
    /** Where a row links to, given the character's id. */
    hrefFor?: (characterId: string) => string
    /** Reproduces `data-filter="true"` on the list. */
    filter?: boolean
    filterId?: string
  }>(),
  { hrefFor: (id: string) => `#character?${id}`, filter: false },
)

/** The text a filter box matches against: what the row actually shows. */
function filterTextFor(character: Parse.Object): string {
  const c = track(character)
  const fields = [
    'name',
    'clan',
    'sect',
    'archetype',
    'antecedence',
    'faction',
    'title',
    'wta_tribe',
    'wta_breed',
    'wta_auspice',
    'wta_faction',
    'wta_camp',
    'ctdbs_kith',
    'ctdbs_fealty_court',
    'ctdbs_kith_group_type',
    'ctdbs_noble_house',
  ]
  return fields
    .map((f) => (c.get(f) as string) || '')
    .filter(Boolean)
    .join(' ')
}

const rows = computed(() =>
  props.characters.map((character) => ({
    character,
    id: character.id as string,
    filterText: filterTextFor(character),
  })),
)
</script>

<template>
  <JqmListview :inset="true" :filter="filter" :filter-id="filterId" v-slot="{ query }">
    <li
      v-for="row in rows"
      v-show="!query || row.filterText.toLowerCase().includes(query.toLowerCase())"
      :key="row.id"
      class="ui-li-has-thumb"
    >
      <a
        :href="hrefFor(row.id)"
        :backendId="row.id"
        class="ui-btn ui-btn-icon-right ui-icon-carat-r character-list-item"
      >
        <CharacterSummary :character="row.character" :portrait-link="false" :show-owner="showOwner" />
      </a>
    </li>
  </JqmListview>
</template>
