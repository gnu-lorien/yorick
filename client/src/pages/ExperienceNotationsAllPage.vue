<script setup lang="ts">
/**
 * The XP ledger -- `#experience-notations-all`.
 *
 * A port of `CharacterExperienceView.js` and the `#experienceNotationsAllView`
 * template at `public/index.html:530`. This is where a storyteller awards and
 * charges experience, and where the running balance every other screen shows is
 * actually produced.
 *
 * ## The two-row table, which is a contract
 *
 * Each notation renders as TWO `<tr>`s, and the cell positions are load-bearing
 * because `e2e/helpers/xp.js` reads them positionally: `deltaCells[9]` is the
 * running Available, and `valueCells[1, 3, 5, 7]` are date, reason, earned and
 * spent. The first row carries this notation's own deltas and its running
 * balance; the second carries the editable values, each preceded by its edit
 * button. The empty cells between them are what line the two rows up.
 *
 * ## Where the save happens, and where it must NOT
 *
 * Editing `entered` or an `alteration_*` deliberately does NOT save the row.
 * Setting them runs the propagation, which re-sorts the ledger and saves every
 * row whose running balance moved -- this one included. Saving here as well
 * raced that batch: this row still carried its PRE-propagation earned/spent, so
 * whichever write landed last decided the balance. It was benign until the audit
 * hook added a round trip to the notation save and tipped the ordering.
 *
 * `reason` is the exception. It does not enter the arithmetic, so nothing
 * propagates and the row has to be saved explicitly.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage, JqmPopup, JqmTable, JqmTd } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const HEADERS = ['entered', 'reason', 'alteration_earned', 'alteration_spent', 'available'] as const
const PRETTY = ['Date', 'Reason', 'Earned?', 'Spent?', 'Available'] as const
const EDITABLE = new Set(['entered', 'reason', 'alteration_earned', 'alteration_spent'])

const cid = computed(() => route.params.cid as string)
const start = computed(() => {
  const n = Number.parseInt(String(route.params.start), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
})
const changeBy = computed(() => {
  const n = Number.parseInt(String(route.params.changeBy), 10)
  return Number.isFinite(n) && n > 0 ? n : 10
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
/** Bumped after every mutation so the computed table re-reads the ledger. */
const revision = ref(0)

type Row = {
  key: string
  notationId: string
  entered: string
  reason: string
  earned: number
  spent: number
  alterationEarned: number
  alterationSpent: number
  running: number
}

function formatDate(value: unknown): string {
  if (!(value instanceof Date)) return value === undefined || value === null ? '' : String(value)
  // `moment(d).format('YYYY-MM-DD')`, which is what the date popup round-trips.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

const allNotations = computed(() => {
  const c = character.value
  if (!c) return []
  void revision.value
  trackAll()
  // `notations` is a `ShallowRef` on the ledger, so `.value` unwraps it.
  //
  // This read was briefly written without `.value`, because holding the
  // character in a deep `ref()` made Vue's `UnwrapRef` type report a plain
  // array -- and at runtime hand back something that was neither. Holding it in
  // a `shallowRef` makes the type honest and the mistake impossible.
  return c.experience.notations.value
})

const total = computed(() => allNotations.value.length)

/**
 * The page the URL asks for.
 *
 * R48: the route's `start`/`changeBy` were accepted and never used, so every
 * page showed the whole ledger. They page for real now.
 */
const rows = computed<Row[]>(() => {
  /*
   * `trackAll()` HERE, not only in `allNotations`.
   *
   * Vue 3.4+ compares a computed's new value against its old one and does not
   * trigger dependents when they are `Object.is`-equal. `allNotations` returns
   * the SAME array reference when a notation's attribute changes -- the array
   * did not move, an object inside it did -- so a computed that depended on it
   * transitively never re-ran.
   *
   * Measured: editing a notation's reason reached the server (`beforeSave`
   * logged the new value) and the table went on showing the old one.
   *
   * The rule this implies: any computed that reads THROUGH a Parse object must
   * subscribe to the mutation counter itself. It cannot inherit the
   * subscription from an upstream computed whose value is stable.
   */
  void revision.value
  trackAll()
  return allNotations.value.slice(start.value, start.value + changeBy.value).map((en, i) => {
    const earned = (en.get('earned') as number) ?? 0
    const spent = (en.get('spent') as number) ?? 0
    return {
      key: (en.id as string) ?? `local-${start.value + i}`,
      notationId: (en.id as string) ?? `local-${start.value + i}`,
      entered: formatDate(en.get('entered')),
      reason: (en.get('reason') as string) ?? '',
      earned,
      spent,
      alterationEarned: (en.get('alteration_earned') as number) ?? 0,
      alterationSpent: (en.get('alteration_spent') as number) ?? 0,
      // "available" is not a stored property -- asking for it rendered a
      // permanently blank cell under a column headed "Available". The running
      // balance is earned minus spent.
      running: earned - spent,
    }
  })
})

const totals = computed(() => {
  const c = character.value
  if (!c) return { earned: 0, spent: 0, available: 0 }
  void revision.value
  trackAll()
  return {
    earned: (c.get('experience_earned') as number) ?? 0,
    spent: (c.get('experience_spent') as number) ?? 0,
    available: c.experience.experience_available(),
  }
})

const showsPaging = computed(() => total.value > changeBy.value)
const previousHref = computed(
  () => `#character/${cid.value}/experience/${Math.max(0, start.value - changeBy.value)}/${changeBy.value}`,
)
const nextHref = computed(
  () => `#character/${cid.value}/experience/${start.value + changeBy.value}/${changeBy.value}`,
)

function notationFor(id: string) {
  return allNotations.value.find((en, i) => ((en.id as string) ?? `local-${i}`) === id)
}

/* ---------------- the three edit popups ---------------- */

const editing = ref<{ kind: 'entered' | 'reason' | 'alteration'; id: string; type?: 'earned' | 'spent' } | null>(null)
const dateInput = ref('')
const reasonInput = ref('')
const alterationInput = ref(0)

/**
 * False until this page's data is in hand.
 *
 * `JqmPage` renders no content while it is false, which is what stops
 * `waitForActivePage` reporting the page settled before its list exists. See
 * the note in `JqmPage.vue`.
 */
const loaded = ref(false)

function openEditor(header: string, id: string) {
  const en = notationFor(id)
  if (!en) return
  if (header === 'entered') {
    dateInput.value = formatDate(en.get('entered'))
    editing.value = { kind: 'entered', id }
  } else if (header === 'reason') {
    reasonInput.value = (en.get('reason') as string) ?? ''
    editing.value = { kind: 'reason', id }
  } else {
    const type = header === 'alteration_earned' ? 'earned' : 'spent'
    alterationInput.value = (en.get(header) as number) ?? 0
    editing.value = { kind: 'alteration', id, type }
  }
}

async function submitEntered() {
  const c = character.value
  const en = editing.value && notationFor(editing.value.id)
  if (!c || !en) return
  const parsed = new Date(dateInput.value + 'T00:00:00')
  if (Number.isNaN(parsed.getTime())) return
  editing.value = null
  // No save: the propagation this triggers writes this row.
  await ui.runWork(() => c.experience.set_experience_notation_attributes(en, { entered: parsed }))
  revision.value++
}

async function submitReason() {
  const en = editing.value && notationFor(editing.value.id)
  if (!en) return
  const text = reasonInput.value
  editing.value = null
  // `reason` does not propagate, so it must be saved explicitly.
  en.set('reason', text)
  await ui.runWork(() => en.save())
  revision.value++
}

async function submitAlteration() {
  const c = character.value
  const state = editing.value
  const en = state && notationFor(state.id)
  if (!c || !en || !state?.type) return
  const parsed = Number.parseInt(String(alterationInput.value), 10)
  const n = Number.isFinite(parsed) ? parsed : 0
  editing.value = null
  await ui.runWork(() =>
    c.experience.set_experience_notation_attributes(en, {
      [state.type === 'earned' ? 'alteration_earned' : 'alteration_spent']: n,
    }),
  )
  revision.value++
}

async function addNotation() {
  const c = character.value
  if (!c) return
  await ui.runWork(() => c.experience.add_experience_notation({ reason: 'Unspecified reason' }))
  revision.value++
}

async function deleteNotation(id: string) {
  const c = character.value
  const en = notationFor(id)
  if (!c || !en) return
  await ui.runWork(() => c.experience.remove_experience_notation(en))
  revision.value++
}

async function load() {
  try {
    // One `runWork` for the whole load; see the note in SimpletextNewPage.
    await ui.runWork(async () => {
      const c = character.value ?? (await get_character(cid.value, 'all'))
      character.value = c
      await c.experience.get_experience_notations()
      revision.value++
    })
  } catch (error) {
    await reportErrorOn("Couldn't open the experience history")(error).catch(() => {})
    window.location.hash = '#characters?all'
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
}

onMounted(load)
watch([start, changeBy], () => {
  revision.value++
})
</script>

<template>
  <JqmPage id="experience-notations-all" title="Experience Notations" :ready="loaded">
    <p>Earned: {{ totals.earned }}</p>
    <p>Spent: {{ totals.spent }}</p>
    <p>Available: {{ totals.available }}</p>
    <button class="add ui-btn ui-btn-icon-plus" @click="addNotation">
      Add New Experience Notation
    </button>

    <template v-if="showsPaging">
      <p>
        Showing {{ total ? start + 1 : 0 }}-{{ Math.min(start + changeBy, total) }} of {{ total }}
      </p>
      <a
        class="previous ui-btn ui-btn-icon-left"
        :class="start <= 0 ? 'ui-state-disabled' : ''"
        :href="previousHref"
        >View Previous</a
      >
      <a
        class="next ui-btn ui-btn-icon-left"
        :class="start + changeBy >= total ? 'ui-state-disabled' : ''"
        :href="nextHref"
        >View Next</a
      >
    </template>

    <JqmTable id="table-column-toggle" class="ui-responsive table-stroke">
      <thead>
        <tr>
          <template v-for="(h, i) in PRETTY" :key="h">
            <th></th>
            <th :data-priority="i + 1">{{ h }}</th>
          </template>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.key">
          <!--
            The delta row. Its cell positions are read by `e2e/helpers/xp.js`:
            index 9 is the running Available.
          -->
          <tr>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>{{ row.earned }}</td>
            <td></td>
            <td>{{ row.spent }}</td>
            <td></td>
            <td>{{ row.running }}</td>
            <td></td>
          </tr>
          <!-- The value row: an edit button then the value, per column. -->
          <tr>
            <template v-for="h in HEADERS" :key="h">
              <td style="padding-right: 0px">
                <a
                  v-if="EDITABLE.has(h)"
                  href="#"
                  class="experience-notation-edit ui-btn ui-icon-edit ui-btn-icon-notext ui-corner-all ui-btn-inline"
                  style="margin: 0px"
                  :header="h"
                  :notation-id="row.notationId"
                  @click.prevent="openEditor(h, row.notationId)"
                  >Edit</a
                >
              </td>
              <td>
                <template v-if="h === 'available'">{{ row.running }}</template>
                <template v-else-if="h === 'entered'">{{ row.entered }}</template>
                <template v-else-if="h === 'reason'">{{ row.reason }}</template>
                <template v-else-if="h === 'alteration_earned'">{{ row.alterationEarned }}</template>
                <template v-else>{{ row.alterationSpent }}</template>
              </td>
            </template>
            <td>
              <a
                href="#"
                class="experience-notation-delete ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all ui-btn-inline"
                :notation-id="row.notationId"
                @click.prevent="deleteNotation(row.notationId)"
                >Delete</a
              >
            </td>
          </tr>
        </template>
      </tbody>
    </JqmTable>

    <JqmPopup
      id="popupEditEntered"
      :open="editing?.kind === 'entered'"
      @update:open="editing = null"
    >
      <form id="edit-entered-popup-form" @submit.prevent="submitEntered">
        <div style="padding: 10px 20px">
          <input id="date-input" v-model="dateInput" type="date" data-inline="true" />
          <button
            type="submit"
            class="ui-btn ui-corner-all ui-shadow ui-btn-b ui-btn-icon-left ui-icon-check"
          >
            Update Date
          </button>
          <input id="date-id" type="hidden" :value="editing?.id" />
        </div>
      </form>
    </JqmPopup>

    <JqmPopup id="popupEditReason" :open="editing?.kind === 'reason'" @update:open="editing = null">
      <form id="edit-reason-popup-form" @submit.prevent="submitReason">
        <div style="padding: 10px 20px">
          <textarea id="reason-input" v-model="reasonInput"></textarea>
          <button
            type="submit"
            class="ui-btn ui-corner-all ui-shadow ui-btn-b ui-btn-icon-left ui-icon-check"
          >
            Update Reason
          </button>
          <input id="reason-id" type="hidden" :value="editing?.id" />
        </div>
      </form>
    </JqmPopup>

    <JqmPopup
      id="alterationpopupEdit"
      :open="editing?.kind === 'alteration'"
      @update:open="editing = null"
    >
      <form id="edit-alteration-popup-form" @submit.prevent="submitAlteration">
        <div style="padding: 10px 20px">
          <input id="alteration-input" v-model.number="alterationInput" type="number" />
          <button
            type="submit"
            class="ui-btn ui-corner-all ui-shadow ui-btn-b ui-btn-icon-left ui-icon-check"
          >
            Update Alteration Value
          </button>
          <input id="alteration-id" type="hidden" :value="editing?.id" />
          <input id="alteration-type" type="hidden" :value="editing?.type" />
        </div>
      </form>
    </JqmPopup>
  </JqmPage>
</template>
