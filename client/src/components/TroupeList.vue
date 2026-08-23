<script setup lang="ts">
/**
 * A filterable list of troupes -- a port of `TroupesListView.js` and
 * `templates/troupes-list.html`.
 *
 * One view served four pages in the original, re-pointed between navigations by
 * `register(base_url, filter)`: the troupes directory, and the three
 * "pick a troupe to show / join / leave" screens. It stays one component here,
 * parameterised the same two ways -- where a row links to, and which troupes to
 * fetch.
 *
 * `base_url` was an underscore template string (`#troupe/<%= troupe_id %>`)
 * rendered on click, with `href="#"` on the anchor and a `preventDefault`
 * handler doing the navigation. Here it is a function and the anchor carries a
 * real `href`, which behaves identically to a click and additionally makes the
 * rows middle-clickable and copyable.
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
import { computed, onMounted, ref, shallowRef } from 'vue'
import { JqmListview } from '@/components/jqm'
import Parse from '@/parse'
import { reportError } from '@/domain/errors'

const props = withDefaults(
  defineProps<{
    /** Where a row links to, given the troupe's id. */
    hrefFor?: (troupeId: string) => string
    /** Narrows the query, as `register`'s `filter` argument did. */
    narrow?: (query: Parse.Query) => void
    /** The search box's id, from `data-input` in the original template. */
    filterId?: string
  }>(),
  { hrefFor: (id: string) => `#troupe/${id}/characters/all`, filterId: 'troupes-list-filter' },
)

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
const troupes = shallowRef<Parse.Object[]>([])
const loading = ref(false)

/**
 * The field list is preserved exactly, not widened.
 *
 * This query runs for every user who opens the directory, so selecting more
 * would hand every player the full contents of every troupe record.
 */
const SELECTED_FIELDS = ['id', 'name', 'portrait', 'shortdescription', 'location', 'staffemail']

const rows = computed(() =>
  troupes.value.map((t) => {
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
      thumb: (t as unknown as { get_thumbnail_sync?: (n: number) => string }).get_thumbnail_sync?.(128),
      // What the filter box matches against: the same text the row shows.
      filterText: [name, location, shortdescription, staffemail].filter(Boolean).join(' '),
    }
  }),
)

onMounted(async () => {
  loading.value = true
  try {
    const incoming: Parse.Object[] = []
    const query = new Parse.Query('Troupe')
    query.select(...SELECTED_FIELDS)
    query.include('portrait')
    props.narrow?.(query)
    // `each` rather than `find`: it pages the whole class with no limit, which
    // is what the original relied on to list every troupe.
    await query.each((t) => {
      incoming.push(t)
    })
    troupes.value = incoming
  } catch (error) {
    await reportError(error, 'listing troupes').catch(() => {})
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <JqmListview filter :filter-id="filterId" v-slot="{ query }">
    <li v-for="row in rows" :key="row.id" v-show="!query || row.filterText.toLowerCase().includes(query.toLowerCase())" class="ul-li-has-thumb">
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
