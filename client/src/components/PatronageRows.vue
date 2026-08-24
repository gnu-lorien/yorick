<script setup lang="ts">
/**
 * The patronage rows, in either of the two shapes the app renders them.
 *
 * A port of `templates/patronage-list-item.html` and
 * `patronage-list-item-csv.html`, which differ only in punctuation -- the same
 * five fields, once as a linked list row and once as a comma-separated line.
 *
 * ## The "CSV export" is not an export
 *
 * `#administration/patronagescsv` renders CSV text into `<li>` elements for the
 * administrator to select and copy. There is no Blob, no download link, and no
 * header row -- reproduced as-is, because a real download is a product change
 * and the sandbox a published artifact runs in blocks page-initiated downloads
 * anyway.
 *
 * ## "User object missing"
 *
 * The owner is a pointer that no patronage query includes, for the same reason
 * character queries do not include theirs: parse-server DELETES an unreadable
 * pointer when asked to expand it. The display fields are filled in from the
 * user registry instead, and a row whose owner cannot be resolved says so
 * rather than rendering a blank. That message is the tell that a hydrate was
 * missed, which is why it is worth keeping visible.
 */
import { computed } from 'vue'
import { expirationStatus, type Patronage } from '@/domain/Patronage'
import { useUsersStore } from '@/stores/users'
import { trackAll } from '@/parse/reactivity'

const props = defineProps<{
  patronages: readonly Patronage[]
  /** Where a row links to. Absent renders the CSV shape instead. */
  hrefFor?: (patronageId: string) => string
}>()

const usersStore = useUsersStore()

/** `moment(d).format('MM/DD/YYYY')`. */
function formatDate(value: unknown): string {
  const date = value instanceof Date ? value : value ? new Date(value as string) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`
}

const rows = computed(() => {
  trackAll()
  return props.patronages.map((p) => {
    const owner = p.get('owner') as { id?: string } | undefined
    const ownerId = owner?.id ?? ''
    const user = ownerId ? usersStore.get(ownerId) : undefined
    return {
      id: p.id as string,
      ownerId,
      username: (user?.get('username') as string) ?? '',
      realname: (user?.get('realname') as string) ?? '',
      resolved: !!user,
      paidOn: formatDate(p.get('paidOn')),
      expiresOn: formatDate(p.get('expiresOn')),
      status: expirationStatus(p),
    }
  })
})
</script>

<template>
  <template v-for="row in rows" :key="row.id">
    <li v-if="hrefFor">
      <a :href="hrefFor(row.id)" class="ui-btn ui-btn-icon-right ui-icon-carat-r">
        <h2 v-if="row.resolved">{{ row.ownerId }} {{ row.username }} {{ row.realname }}</h2>
        <h2 v-else>{{ row.ownerId }} User object missing</h2>
        <p>paidOn: {{ row.paidOn }}</p>
        <p>expiresOn: {{ row.expiresOn }}</p>
        <p>{{ row.status }}</p>
      </a>
    </li>
    <li v-else>
      <template v-if="row.resolved">
        "{{ row.ownerId }}","{{ row.username }}","{{ row.realname }}",
      </template>
      <template v-else>"","","",</template>
      "{{ row.paidOn }}", "{{ row.expiresOn }}", "{{ row.status }}"
    </li>
  </template>
</template>
