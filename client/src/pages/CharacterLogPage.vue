<script setup lang="ts">
/**
 * The character's change log -- `#character-log`.
 *
 * A port of `CharacterLogView.js` and the `#characterLogView` template at
 * `public/index.html:861`. Every row is a `VampireChange` written by a server
 * trigger; the client never creates one. The log is deliberately immutable --
 * if a player cheats, the backend must hold a record nobody can change.
 *
 * ## Paging lives in the URL
 *
 * `#character/:cid/log/:start/:changeBy`. Previous and Next change the hash and
 * the route reloads, so a page of the log is linkable and the browser's own
 * Back works through it.
 *
 * The original had a subtle defect here that the URL-as-state approach removes
 * by construction. Two registrations could be in flight at once -- a reload
 * replays the loaded hash and an explicit navigation adds a second -- and the
 * STALE one could win: observed live as `start=0` then `start=20` 9ms apart,
 * with the hash reading `/log/0/10` throughout, so the table showed page 2
 * under a page-0 URL and Next paged from 20. The fix there was to re-read the
 * hash and drop any registration that disagreed with it. Here the hash is the
 * only source of `start`, so there is nothing to disagree with.
 *
 * ## `format_entry`, and why `has` is checked before `get`
 *
 * A recorded `0` must not render as an empty cell. `log.get(entry) || ''` would
 * blank every zero cost and every zero value in the audit trail, which is
 * exactly where a storyteller looks to see that something was set to nothing.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage, JqmTable, JqmTd } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { logQueryFor, type VampireChange } from '@/domain/VampireChange'
import { reportErrorOn } from '@/domain/errors'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

/** The columns, in order. The E2E helpers read these rows positionally. */
const HEADERS = [
  'createdAt',
  'category',
  'name',
  'type',
  'old_value',
  'value',
  'old_free_value',
  'free_value',
  'old_cost',
  'cost',
  'old_text',
  'new_text',
] as const

const cid = computed(() => route.params.cid as string)
const start = computed(() => {
  const parsed = Number.parseInt(String(route.params.start), 10)
  return Number.isFinite(parsed) ? parsed : 0
})
const changeBy = computed(() => {
  const parsed = Number.parseInt(String(route.params.changeBy), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
})

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
const logs = shallowRef<VampireChange[]>([])

/**
 * False until this page's data is in hand.
 *
 * `JqmPage` renders no content while it is false, which is what stops
 * `waitForActivePage` reporting the page settled before its list exists. See
 * the note in `JqmPage.vue`.
 */
const loaded = ref(false)

const name = computed(() => {
  const c = character.value
  if (!c) return ''
  trackAll()
  return (c.get('name') as string) ?? ''
})

async function load() {
  try {
    const c = character.value ?? (await get_character(cid.value, 'all'))
    character.value = c
    logs.value = await ui.runWork(() => logQueryFor(c, start.value, changeBy.value).find())
  } catch (error) {
    await reportErrorOn("Couldn't open the character log")(error).catch(() => {})
    window.location.hash = '#characters?all'
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
}

onMounted(load)
// The component is keyed on the route, so this only fires for a same-route
// param change; it is here so paging cannot silently show a stale page.
watch([start, changeBy], load)

const previousHref = computed(
  () => `#character/${cid.value}/log/${Math.max(0, start.value - changeBy.value)}/10`,
)
const nextHref = computed(
  () => `#character/${cid.value}/log/${start.value + changeBy.value}/10`,
)

/** A recorded `0` renders as `0`, never as an empty cell. */
function formatEntry(log: VampireChange, entry: string): string {
  const value = log.has(entry)
    ? log.get(entry)
    : (log as unknown as Record<string, unknown>)[entry]
  if (value === undefined || value === null) return ''
  if (value instanceof Date) {
    // `moment(v).format('lll')` -- e.g. "Aug 22, 2026 6:30 PM".
    return value.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  return String(value)
}
</script>

<template>
  <JqmPage id="character-log" title="Character Log" :ready="loaded">
    <h1>{{ name }}</h1>
    <a class="previous ui-btn ui-btn-icon-left" :href="previousHref">Previous</a>
    <a class="next ui-btn ui-btn-icon-left" :href="nextHref">Next</a>

    <JqmTable id="table-column-toggle" class="ui-responsive table-stroke" :columns="[...HEADERS]">
      <thead>
        <tr>
          <th v-for="(h, i) in HEADERS" :key="h" :data-priority="i + 1">{{ h }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(log, i) in logs" :key="log.id ?? i">
          <JqmTd v-for="(h, j) in HEADERS" :key="h" :index="j">{{ formatEntry(log, h) }}</JqmTd>
        </tr>
      </tbody>
    </JqmTable>
  </JqmPage>
</template>
