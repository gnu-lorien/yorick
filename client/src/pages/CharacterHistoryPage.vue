<script setup lang="ts">
/**
 * The history timeline -- `#character-history`.
 *
 * A port of `CharacterHistoryView.js` and the two templates
 * `character-history-view.html` / `character-history-selected-view.html`.
 *
 * A slider walks the recorded changes, and the sheet below re-renders as the
 * character stood at that point. Three regions, all preserved by id because the
 * E2E suite reads them: `#history-main` (the slider), `#history-viewing` (the
 * change being applied, and the one being reversed), `#history-sheet` (the
 * rewound printable sheet).
 *
 * ## Which changes get replayed
 *
 * `takeRightWhile(model.id != selectedId)` then reversed -- that is, every
 * change NEWER than the selected one, oldest-first, so `get_transformed` can
 * undo them in order. Selecting the newest change therefore applies nothing and
 * shows the character as it stands.
 *
 * ## The hidden inputs are not decoration
 *
 * `#history-changes-<i>` carries each change's object id, and the original read
 * the selected one straight out of the DOM. They are kept because
 * `e2e/helpers/lifecycle.js` reads them to map a slider position to a change,
 * and because `input[name=historyChangePicker]` is documented there as the only
 * stable way to address this slider.
 *
 * `c.transform_description = []` on the rewound character is deliberate: the
 * timeline shows the character AT a point, not a diff, so the print helpers must
 * not decorate it with red and green markers. The approval screen is the one
 * that wants those.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage, JqmSlider, JqmTable, JqmTd } from '@/components/jqm'
import PrintSheet from '@/components/print/PrintSheet.vue'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

/** The same twelve columns the character log shows. */
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
const logs = shallowRef<Parse.Object[]>([])
const picked = ref(0)
const rewound = shallowRef<Parse.Object | null>(null)

/**
 * False until this page's data is in hand.
 *
 * `JqmPage` renders no content while it is false, which is what stops
 * `waitForActivePage` reporting the page settled before its list exists. See
 * the note in `JqmPage.vue`.
 */
const loaded = ref(false)

onMounted(async () => {
  try {
    // One `runWork` for the whole load; see the note in SimpletextNewPage.
    await ui.runWork(async () => {
      const c = await get_character(cid.value, 'all')
      character.value = c
      logs.value = (await c.experience.get_recorded_changes()) as unknown as Parse.Object[]
      // Open at the newest change, which is the character as it stands.
      picked.value = Math.max(0, logs.value.length - 1)
      applyPicked()
    })
  } catch (error) {
    await reportErrorOn("Couldn't open the character history")(error).catch(() => {})
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
})

watch(picked, applyPicked)

function applyPicked() {
  const c = character.value
  if (!c) return
  const selectedId = logs.value[picked.value]?.id
  /*
   * Every change NEWER than the selected one, NEWEST FIRST.
   *
   * `takeRightWhile(changes, m => m.id != selectedId).reverse()`: the recorded
   * changes are ascending, `takeRightWhile` returns the newest run still
   * ascending, and the `.reverse()` is what hands them over newest-first --
   * which is the order `get_transformed` undoes them in, and the only order
   * that works.
   *
   * Undoing an update means writing its `old_value` back. Two edits to the same
   * trait, 5 -> 6 -> 7, undone newest-first give 6 then 5; undone oldest-first
   * they give 5 then 6, and the sheet ends up showing a value the character
   * never had at that point in its history. Measured exactly that: a
   * pre-raise snapshot read Physical 6 where it should read 5.
   */
  const toApply: Parse.Object[] = []
  for (let i = logs.value.length - 1; i >= 0; i--) {
    const log = logs.value[i]
    if (!log || log.id === selectedId) break
    toApply.push(log)
  }
  const transformed = c.experience.get_transformed(toApply as never)
  // Show the character AT this point, not a diff.
  ;(transformed as unknown as { transform_description: unknown[] }).transform_description = []
  rewound.value = transformed as unknown as Parse.Object
}

const maxIndex = computed(() => Math.max(0, logs.value.length - 1))

/** The change being reversed, when the slider is not at the newest. */
const reversedLog = computed(() => {
  if (picked.value === maxIndex.value) return null
  trackAll()
  return logs.value[Math.min(picked.value + 1, maxIndex.value)] ?? null
})

const appliedLog = computed(() => {
  trackAll()
  return logs.value[picked.value] ?? null
})

/** A recorded `0` renders as `0`, never as an empty cell. */
function formatEntry(log: Parse.Object | null, entry: string): string {
  if (!log) return ''
  const value = log.has(entry) ? log.get(entry) : (log as unknown as Record<string, unknown>)[entry]
  if (value === undefined || value === null) return ''
  if (value instanceof Date) {
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
  <JqmPage id="character-history" title="Character History" :ready="loaded">
    <div id="history-main">
      <p>
        <label for="slider">Point in time:</label>
        <JqmSlider
          id="slider"
          v-model="picked"
          name="historyChangePicker"
          :min="0"
          :max="maxIndex"
        />
        <input
          v-for="(log, i) in logs"
          :id="`history-changes-${i}`"
          :key="log.id ?? i"
          type="hidden"
          :value="log.id"
        />
      </p>
    </div>

    <div id="history-viewing">
      <template v-if="reversedLog">
        <span>Reversed Change</span>
        <JqmTable id="table-column-toggle" class="ui-responsive table-stroke" :columns="[...HEADERS]">
          <thead>
            <tr>
              <th v-for="(h, i) in HEADERS" :key="h" :data-priority="i + 1">{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <JqmTd v-for="(h, j) in HEADERS" :key="h" :index="j">
                {{ formatEntry(reversedLog, h) }}
              </JqmTd>
            </tr>
          </tbody>
        </JqmTable>
      </template>

      <span>Most Recent Change Applied</span>
      <JqmTable id="table-column-toggle" class="ui-responsive table-stroke" :columns="[...HEADERS]">
        <thead>
          <tr>
            <th v-for="(h, i) in HEADERS" :key="h" :data-priority="i + 1">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <JqmTd v-for="(h, j) in HEADERS" :key="h" :index="j">
              {{ formatEntry(appliedLog, h) }}
            </JqmTd>
          </tr>
        </tbody>
      </JqmTable>
    </div>

    <div id="history-sheet">
      <PrintSheet v-if="rewound" :character="rewound" />
    </div>
  </JqmPage>
</template>
