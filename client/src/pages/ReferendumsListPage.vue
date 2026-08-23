<script setup lang="ts">
/**
 * The referendums list -- `#referendums-list`.
 *
 * A port of `ReferendumsListView.js` and `templates/referendums-list.html`.
 * Two routes render it: `#referendums`, where a member votes, and
 * `#administration/referendums`, where an administrator opens one to see every
 * caster's ballot. The rows link to different places accordingly.
 *
 * R36: neither admin referendum route had a gate, and the detail one shows every
 * caster's ballot. The route table marks both `gate: 'admin'` now.
 *
 * The template's field names read oddly for a referendum -- `location`,
 * `shortdescription`, `staffemail` -- because it was copied from the troupes
 * list and never renamed. Kept as-is: they are the columns the rows actually
 * render, and `REFERENDUM_LIST_FIELDS` is what the query selects.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmListview, JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import {
  fetchReferendumList,
  getReferendumThumbnailSync,
  type Referendum,
} from '@/domain/Referendum'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const isAdminListing = computed(() => route.meta.handler === 'administration_referendums')

useBackHref(() => (isAdminListing.value ? '#administration' : '#'))

const referendums = shallowRef<Referendum[]>([])
/** False until the list is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

const rows = computed(() =>
  referendums.value.map((r) => {
    const name = (r.get('name') as string) ?? ''
    const location = (r.get('location') as string) ?? ''
    const shortdescription = (r.get('shortdescription') as string) ?? ''
    const staffemail = ((r.get('staffemail') as string) ?? '').trim()
    return {
      id: r.id as string,
      name,
      location,
      shortdescription,
      staffemail,
      thumb: getReferendumThumbnailSync(r, 128),
      href: isAdminListing.value ? `#administration/referendum/${r.id}` : `#referendum/${r.id}`,
      filterText: [name, location, shortdescription, staffemail]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }
  }),
)

onMounted(async () => {
  try {
    referendums.value = await ui.runWork(() => fetchReferendumList())
  } catch (error) {
    await reportErrorOn("Couldn't list the referendums")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="referendums-list" title="Referendums" :ready="loaded">
    <div role="referendums-list">
      <JqmListview filter filter-id="referendums-list-filter" v-slot="{ query }">
        <li
          v-for="row in rows"
          v-show="!query || row.filterText.includes(query.toLowerCase())"
          :key="row.id"
          class="ul-li-has-thumb"
        >
          <a
            :name="row.name"
            :backendId="row.id"
            :href="row.href"
            class="ui-btn ui-btn-icon-right ui-icon-carat-r referendum-listing"
          >
            <img :src="row.thumb" class="referendum-link-portrait" alt="" />
            <h2>{{ row.name }}<span v-if="row.location"> ({{ row.location }})</span></h2>
            <p>{{ row.shortdescription }}</p>
            <p v-if="row.staffemail">{{ row.staffemail }}</p>
          </a>
        </li>
      </JqmListview>
    </div>
  </JqmPage>
</template>
