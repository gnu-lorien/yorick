<script setup lang="ts">
/**
 * The approval screen -- `#character-approval`.
 *
 * A port of `CharacterApprovalView.js` and its four templates. Five regions, and
 * none of them is the table a reader would expect:
 *
 *  - `#approval-changes` -- TWO sliders bounding a range of recorded changes:
 *    `#sliderbaserange` (left) and `#slider` (right). Both default to the whole
 *    history. One hidden `#history-changes-<i>` per change carries its id.
 *  - `#approval-approvals` -- a THIRD slider, `#approval-slider`, whose max is
 *    the number of approvals and whose default is that same number: the "about
 *    to make a new approval" slot. One hidden `#approval-changes-<i>` per
 *    approval.
 *  - `#approval-edit` -- at the max slot, either an approve button or the
 *    literal text `No unapproved changes`; on an existing approval, a one-row
 *    table.
 *  - `#approval-viewing` -- the change rows in the selected range.
 *  - `#approval-sheet` -- a nested printable sheet of the character as it stood.
 *
 * ## Approving is one row, not a batch
 *
 * `approve_change` writes exactly ONE `VampireApproval`, pointing at
 * `recorded_changes[right]`. The button says "Approve changes up to N" because
 * an approval at N implies everything below it; the row itself names one change.
 *
 * The server genuinely refuses some approvals -- a player approving their own
 * character, an approver with no Storyteller role for that troupe -- and those
 * refusals must reach the screen rather than being swallowed.
 *
 * ## The diff
 *
 * The sheet is rendered from `get_transformed`, rewound to the right-hand
 * change, and decorated with a `transform_description` covering only the
 * selected window. Traits REMOVED in that window are re-added to the rewound
 * character marked `is_deleted`, so the sheet can show them struck through --
 * without that, a removal would simply be absent and read as though it had never
 * been there.
 *
 * The ids in this page are the whole reason `e2e/helpers/approvals.js` can drive
 * it, so every one of them is preserved.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage, JqmSlider, JqmTable, JqmTd } from '@/components/jqm'
import PrintSheet from '@/components/print/PrintSheet.vue'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { clearError, reportErrorOn } from '@/domain/errors'
import { ApprovalObject } from '@/parse/classes'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

/** The change-row columns, in order; the helpers read them positionally. */
const CHANGE_HEADERS = [
  'id',
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

const APPROVAL_HEADERS = ['createdAt', 'approved', 'change', 'approver', 'owner'] as const

const cid = computed(() => route.params.cid as string)
useBackHref(() => `#character?${cid.value}`)

const character = shallowRef<Character | null>(null)
const logs = shallowRef<Parse.Object[]>([])
const approvals = shallowRef<Parse.Object[]>([])
const rewound = shallowRef<Parse.Object | null>(null)
const transformDescription = shallowRef<unknown[]>([])

const left = ref(0)
const right = ref(0)
/** Defaults to `approvals.length` -- the "about to approve" slot. */
const approvalIndex = ref(0)

/** False until the history is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

const maxChangeIndex = computed(() => Math.max(0, logs.value.length - 1))

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const c = await get_character(cid.value, 'all')
      character.value = c
      logs.value = (await c.experience.get_recorded_changes()) as unknown as Parse.Object[]
      approvals.value = (await c.experience.get_approvals()) as unknown as Parse.Object[]
      approvalIndex.value = approvals.value.length
      updateWindowForApproval(approvals.value.length)
      applyWindow()
    })
  } catch (error) {
    await reportErrorOn("Couldn't open the approval view")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})

/**
 * Which range of changes an approval covers.
 *
 * The right bound is the change that approval points at; the left bound is one
 * past the change the PREVIOUS approval pointed at, so the window is what this
 * approval added. At the "new approval" slot both default to the whole history.
 */
function updateWindowForApproval(index: number) {
  const rows = logs.value
  let nextLeft = 0
  let nextRight = Math.max(0, rows.length - 1)

  const approval = approvals.value[index]
  if (approval) {
    const changeId = (approval.get('change') as { id?: string } | undefined)?.id
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]?.id === changeId) {
        nextRight = i
        break
      }
    }
  }

  if (index > 0) {
    const previous = approvals.value[index - 1]
    const previousChangeId = (previous?.get('change') as { id?: string } | undefined)?.id
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]?.id === previousChangeId) {
        nextLeft = i + 1
        break
      }
    }
  }

  left.value = nextLeft
  right.value = nextRight
}

/** Rewind the character to `right`, and describe the selected window. */
function applyWindow() {
  const c = character.value
  if (!c) return

  const rows = logs.value
  const rightId = rows[right.value]?.id

  const toApply: Parse.Object[] = []
  for (let i = rows.length - 1; i >= 0; i--) {
    const log = rows[i]
    if (!log || log.id === rightId) break
    toApply.unshift(log)
  }
  const transformed = c.experience.get_transformed(toApply as never)

  // A second replay, from one before the LEFT bound, so the description covers
  // the whole selected window rather than just the right-hand change.
  const forDescription: Parse.Object[] = []
  for (let i = rows.length - 1; i >= left.value; i--) {
    const log = rows[i]
    if (log) forDescription.unshift(log)
  }
  const described = c.experience.get_transformed(forDescription as never)
  const describedList =
    ((described as unknown as { transform_description?: unknown[] }).transform_description ?? [])
  const windowSize = right.value + 1 - left.value
  const td = describedList.slice(Math.max(0, describedList.length - windowSize))

  // A trait REMOVED in this window is re-added to the rewound character marked
  // deleted, so the sheet can strike it through. Without this a removal is
  // simply absent and reads as though it had never been there.
  for (const entry of td as { type?: string; category?: string; fake?: Parse.Object }[]) {
    if (entry.type !== 'removed' || !entry.fake || !entry.category) continue
    ;(entry.fake as unknown as { is_deleted: boolean }).is_deleted = true
    const existing = (transformed.get(entry.category) as Parse.Object[] | undefined) ?? []
    if (!existing.includes(entry.fake)) {
      transformed.set(entry.category, [...existing, entry.fake])
    }
  }

  transformDescription.value = td
  rewound.value = transformed as unknown as Parse.Object
}

watch(approvalIndex, (index) => {
  updateWindowForApproval(index)
  applyWindow()
})
watch([left, right], applyWindow)

/** At the max slot there is no existing approval -- this is a new one. */
const atNewApprovalSlot = computed(() => approvalIndex.value > approvals.value.length - 1)

/** True once the newest approval already points at the newest change. */
const noChangesRemaining = computed(() => {
  trackAll()
  const newest = approvals.value[approvals.value.length - 1]
  if (!newest) return false
  const changeId = (newest.get('change') as { id?: string } | undefined)?.id
  return changeId !== undefined && changeId === logs.value[logs.value.length - 1]?.id
})

const selectedApproval = computed(() => approvals.value[approvalIndex.value] ?? null)

const windowRows = computed(() => {
  trackAll()
  return logs.value.slice(left.value, right.value + 1).map((log, i) => ({
    log,
    index: i + left.value,
  }))
})

function formatEntry(log: Parse.Object, entry: string): string {
  const value = log.has(entry) ? log.get(entry) : (log as unknown as Record<string, unknown>)[entry]
  if (value === undefined || value === null) return ''
  if (value instanceof Date) return value.toLocaleString()
  return String(value)
}

/** An approval's cells: a pointer renders as its id, as the original did. */
function formatApproval(approval: Parse.Object, header: string): string {
  const value = approval.has(header)
    ? approval.get(header)
    : (approval as unknown as Record<string, unknown>)[header]
  if (value === undefined || value === null) return ''
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === 'object' && 'id' in (value as object)) {
    return String((value as { id?: string }).id ?? '')
  }
  return String(value)
}

async function approveChange() {
  const c = character.value
  const change = logs.value[right.value]
  if (!c || !change) return
  try {
    const approval = await ui.runWork(async () => {
      const a = new ApprovalObject({
        approved: true,
        change,
        approver: Parse.User.current(),
        owner: c,
      })
      return a.save()
    })
    clearError()
    approvals.value = [...approvals.value, approval as unknown as Parse.Object]
    approvalIndex.value = approvals.value.length
    left.value = right.value
    right.value = Math.max(0, logs.value.length - 1)
    applyWindow()
  } catch (error) {
    // `beforeSave("VampireApproval")` genuinely refuses some approvals -- a
    // player approving their own character, an approver with no Storyteller
    // role for the troupe. Those refusals must reach the screen.
    await reportErrorOn("Couldn't approve this change")(error).catch(() => {})
  }
}
</script>

<template>
  <JqmPage id="character-approval" title="Character Approval" :ready="loaded">
    <div id="approval-changes">
      <label for="slider">Changes to Character:</label>
      <div data-role="rangeslider" class="ui-rangeslider">
        <JqmSlider
          id="sliderbaserange"
          v-model="left"
          name="historyBaseRange"
          :min="0"
          :max="maxChangeIndex"
        />
        <JqmSlider
          id="slider"
          v-model="right"
          name="historyChangePicker"
          :min="0"
          :max="maxChangeIndex"
        />
      </div>
      <input
        v-for="(log, i) in logs"
        :id="`history-changes-${i}`"
        :key="log.id ?? i"
        type="hidden"
        :value="log.id"
      />
    </div>

    <div id="approval-approvals">
      <label for="approval-slider">Previous Approvals:</label>
      <JqmSlider
        id="approval-slider"
        v-model="approvalIndex"
        name="approvalChangePicker"
        :min="0"
        :max="approvals.length"
      />
      <input
        v-for="(approval, i) in approvals"
        :id="`approval-changes-${i}`"
        :key="approval.id ?? i"
        type="hidden"
        :value="approval.id"
      />
    </div>

    <div id="approval-edit">
      <template v-if="atNewApprovalSlot">
        <span v-if="noChangesRemaining">No unapproved changes</span>
        <button v-else class="approve-change ui-btn" @click.prevent="approveChange">
          Approve changes up to {{ right }}
        </button>
      </template>
      <JqmTable
        v-else
        id="table-column-toggle"
        class="ui-responsive table-stroke"
        :columns="[...APPROVAL_HEADERS]"
      >
        <thead>
          <tr>
            <th v-for="(h, i) in APPROVAL_HEADERS" :key="h" :data-priority="i + 1">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="selectedApproval">
            <JqmTd v-for="(h, j) in APPROVAL_HEADERS" :key="h" :index="j">
              {{ formatApproval(selectedApproval, h) }}
            </JqmTd>
          </tr>
        </tbody>
      </JqmTable>
    </div>

    <div id="approval-sheet">
      <PrintSheet
        v-if="rewound"
        :character="rewound"
        :transform-description="transformDescription as never"
      />
    </div>

    <div id="approval-viewing">
      <JqmTable class="ui-responsive table-stroke" :columns="['i', ...CHANGE_HEADERS]">
        <thead>
          <tr>
            <th>i</th>
            <th v-for="(h, i) in CHANGE_HEADERS" :key="h" :data-priority="i + 1">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in windowRows" :key="row.log.id ?? row.index">
            <td>{{ row.index }}</td>
            <JqmTd v-for="(h, j) in CHANGE_HEADERS" :key="h" :index="j + 1">
              {{ formatEntry(row.log, h) }}
            </JqmTd>
          </tr>
        </tbody>
      </JqmTable>
    </div>
  </JqmPage>
</template>
