<script setup lang="ts">
/**
 * A filterable list of troupes -- a port of `TroupesListView.js` and
 * `templates/troupes-list.html`.
 *
 * One view served four pages in the original, re-pointed between navigations by
 * `register(base_url, filter)`: the troupes directory, and the three
 * "pick a troupe to show / join / leave" screens. It stays one component here,
 * parameterised the same two ways -- where a row links to, and which troupes to
 * show.
 *
 * `base_url` was an underscore template string (`#troupe/<%= troupe_id %>`)
 * rendered on click, with `href="#"` on the anchor and a `preventDefault`
 * handler doing the navigation. Here it is a function and the anchor carries a
 * real `href`, which behaves identically to a click and additionally makes the
 * rows middle-clickable and copyable.
 *
 * ## It is handed its rows; it does not fetch them
 *
 * This component used to query on mount, and that cannot work inside a page
 * that gates its content on `ready`: the slot is not rendered until the page is
 * ready, so a component in the slot never mounts, never fetches, and never
 * reports the result that would ungate the page. The list arrived empty and the
 * page never settled. `fetchTroupeList` in `@/domain/Troupe` is the query, and
 * the page calls it before rendering this. Same trap, same resolution as
 * `UserPicker`.
 *
 * ## Selectors that must not change
 *
 * The E2E suite addresses these rows directly and by attribute:
 * `a.troupe-listing[backendid]` (helpers/troupes.js:46, access-control.spec.js:261,
 * assets-rename-portrait.spec.js:265) and `img.troupe-link-portrait`
 * (helpers/portraits.js:32). `backendId` is a non-standard attribute the
 * template invented to carry the object id; it is preserved verbatim, lowercase
 * matching included, because that is how the suite finds a specific troupe.
 */
import { computed } from 'vue'
import { JqmListview } from '@/components/jqm'
import { getTroupeThumbnailSync, type Troupe } from '@/domain/Troupe'

const props = withDefaults(
  defineProps<{
    /** The troupes to render, already fetched by the page. */
    troupes: readonly Troupe[]
    /** Where a row links to, given the troupe's id. */
    hrefFor?: (troupeId: string) => string
    /** The search box's id, from `data-input` in the original template. */
    filterId?: string
    /**
     * Whether to render the filter box.
     *
     * The directory and the three pick screens have one; the quick-access list
     * on `#player-options` does not -- it is a shortcut to two or three
     * troupes, and `PlayerOptionsView` renders it through a bare CollectionView.
     */
    filter?: boolean
  }>(),
  {
    hrefFor: (id: string) => `#troupe/${id}/characters/all`,
    filterId: 'troupes-list-filter',
    filter: true,
  },
)

const rows = computed(() =>
  props.troupes.map((t) => {
    const name = (t.get('name') as string) || ''
    const location = (t.get('location') as string) || ''
    const shortdescription = (t.get('shortdescription') as string) || ''
    const staffemail = ((t.get('staffemail') as string) || '').trim()
    return {
      id: t.id as string,
      name,
      location,
      shortdescription,
      staffemail,
      thumb: getTroupeThumbnailSync(t, 128),
      // What the filter box matches against: the same text the row shows.
      filterText: [name, location, shortdescription, staffemail].filter(Boolean).join(' '),
    }
  }),
)
</script>

<template>
  <JqmListview :filter="filter" :filter-id="filterId" v-slot="{ query }">
    <li
      v-for="row in rows"
      :key="row.id"
      v-show="!query || row.filterText.toLowerCase().includes(query.toLowerCase())"
      class="ul-li-has-thumb"
    >
      <a
        :name="row.name"
        :backendId="row.id"
        :href="hrefFor(row.id)"
        class="ui-btn ui-btn-icon-right ui-icon-carat-r troupe-listing"
      >
        <img :src="row.thumb" class="troupe-link-portrait" alt="" />
        <h2>{{ row.name }}<span v-if="row.location"> ({{ row.location }})</span></h2>
        <p>{{ row.shortdescription }}</p>
        <p v-if="row.staffemail">{{ row.staffemail }}</p>
      </a>
    </li>
  </JqmListview>
</template>
