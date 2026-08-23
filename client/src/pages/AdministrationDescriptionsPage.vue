<script setup lang="ts">
/**
 * The bulk data editor -- `#administration-descriptions`.
 *
 * A port of `EditRules.js` and `DescriptionsView.js`. SIX routes render this one
 * page: the Descriptions admin and the five game-rule classes. That sharing is
 * in the original -- one memoised view re-pointed at a different class between
 * navigations -- and it is preserved, because `activePageId` is how the E2E
 * suite knows where it is and 22 tests assert this page id.
 *
 * ## It is a CSV import/export, not a form
 *
 * There is no add-row UI. The textarea IS both the rendered table and the edit
 * form: the class is read, serialised to CSV, and dropped in; an administrator
 * hand-edits it and submits; each row is resolved against its identity columns
 * and updated or created. This is the app's only bulk-import path and the only
 * way the licensed game reference data gets loaded or corrected.
 *
 * Rebuilding it as a "proper" form would destroy the workflow, which is why it
 * is reproduced rather than improved.
 *
 * ## Identity columns, and the bug they fix
 *
 * The row lookup used to be `.equalTo("category", d.category).equalTo("name",
 * d.name)` for EVERY class. `bnsmetv1_ClanRule` rows carry neither -- all 42
 * seeded rows have only `clan` -- so that query resolved to "category does not
 * exist AND name does not exist", which every row matches, and `.first()`
 * returned whichever row Parse's default ordering put first REGARDLESS of which
 * clan the submitted row was about. There was no way through this UI to choose
 * which row an edit targeted, and a create could never find the row it had just
 * made.
 *
 * A row with no usable identity is a NEW row, not a licence to overwrite an
 * arbitrary existing one.
 *
 * ## Why the column types are sampled
 *
 * Everything arrives from the textarea as a string, and sending a string to a
 * Number column is a 400. Parse Server's schema endpoint needs the master key,
 * so it is not reachable from the browser; sampling live rows is. Columns no
 * sampled row has a value for stay strings, exactly as before.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import Papa from 'papaparse'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { reportError, reportErrorOn } from '@/domain/errors'
import { RULE_CLASS_NAMES } from '@/parse/classes'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

useBackHref('#administration')

/** Which class this route edits. */
const CLASS_FOR_HANDLER: Record<string, string> = {
  administration_descriptions: 'Description',
  administration_bnsmetv1_clan_rules: RULE_CLASS_NAMES.clan,
  administration_bnsmetv1_elder_discipline_rules: RULE_CLASS_NAMES.elderDiscipline,
  administration_bnsmetv1_technique_rules: RULE_CLASS_NAMES.technique,
  administration_bnsmetv1_ritual_rules: RULE_CLASS_NAMES.ritual,
  administration_bnsctdbs_kith_rules: RULE_CLASS_NAMES.kith,
}

/** The columns that actually identify a row, per class. */
const IDENTITY_COLUMNS: Record<string, string[]> = {
  [RULE_CLASS_NAMES.clan]: ['clan'],
  [RULE_CLASS_NAMES.kith]: ['category', 'name'],
  [RULE_CLASS_NAMES.elderDiscipline]: ['name'],
  [RULE_CLASS_NAMES.technique]: ['name'],
  [RULE_CLASS_NAMES.ritual]: ['name'],
  Description: ['category', 'name'],
}

const className = computed(() => CLASS_FOR_HANDLER[route.meta.handler as string] ?? 'Description')
const identityColumns = computed(() => IDENTITY_COLUMNS[className.value] ?? ['category', 'name'])

const categories = shallowRef<string[]>([])
const category = ref('All')
const csv = ref('Nothing here yet')
const message = ref('')
/** False until the class has been read; see the note in `JqmPage.vue`. */
const loaded = ref(false)

/** Column name -> type, learned from rows that already exist. */
const fieldTypes = shallowRef<Record<string, 'number' | 'boolean' | 'string'>>({})

function typeOf(value: unknown): 'number' | 'boolean' | 'string' | undefined {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  return undefined
}

async function learnFieldTypes() {
  const rows = await new Parse.Query(className.value).limit(200).find()
  const learned: Record<string, 'number' | 'boolean' | 'string'> = {}
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.attributes as Record<string, unknown>)) {
      if (learned[key]) continue
      const t = typeOf(value)
      if (t) learned[key] = t
    }
  }
  fieldTypes.value = learned
}

/** `undefined` for a value that should not be written at all. */
function coerceField(key: string, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  const type = fieldTypes.value[key]
  if (type === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  if (type === 'boolean') {
    const text = String(value).trim().toLowerCase()
    if (text === 'true') return true
    if (text === 'false') return false
    return undefined
  }
  return value
}

async function loadCategories() {
  const query = new Parse.Query(className.value)
  query.select('category')
  const found = new Set<string>()
  await query.each((d) => {
    const c = d.get('category') as string | undefined
    if (c) found.add(c)
  })
  categories.value = Array.from(found).sort()
}

async function loadCsv() {
  const query =
    category.value === 'All'
      ? new Parse.Query(className.value)
      : new Parse.Query(className.value).equalTo('category', category.value)

  const rows: Record<string, unknown>[] = []
  await query.each((d) => {
    const { ACL: _acl, ...rest } = d.attributes as Record<string, unknown>
    rows.push(rest)
  })

  // `_.sortByAll(["category", "order", "name"])`.
  rows.sort((a, b) => {
    for (const key of ['category', 'order', 'name']) {
      const av = a[key]
      const bv = b[key]
      if (av === bv) continue
      // `_.sortByAll` sorts undefined LAST regardless of direction; null is
      // treated the same, because a null cell and an absent one mean the same
      // thing in a CSV round trip.
      if (av === undefined || av === null) return 1
      if (bv === undefined || bv === null) return -1
      return av < bv ? -1 : 1
    }
    return 0
  })

  // Every column any row has, in first-seen order.
  const fields: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!fields.includes(key)) fields.push(key)
  }

  csv.value = Papa.unparse({ fields, data: rows as never })
}

async function load() {
  try {
    await ui.runWork(async () => {
      await learnFieldTypes()
      await loadCategories()
      await loadCsv()
    })
  } catch (error) {
    await reportErrorOn("Couldn't load the rules for that category")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
}

onMounted(load)
// A different rule class is a different route; the component is keyed on it, so
// this only fires when the category select changes.
watch(category, () => {
  void ui.runWork(loadCsv).catch(() => {})
})

async function submit() {
  message.value = ''
  const results = Papa.parse<Record<string, string>>(csv.value, { header: true })
  if (results.errors.length !== 0) {
    await reportError(
      results.errors.map(
        (e) => e.message + (e.row === undefined ? '' : ' (row ' + e.row + ')'),
      ).join('; '),
      'parsing the submitted CSV',
    ).catch(() => {})
    return
  }

  try {
    await ui.runWork(async () => {
      for (const row of results.data) {
        // A row with no usable identity is a NEW row -- never a licence to
        // overwrite an arbitrary existing one.
        let usable = true
        const query = new Parse.Query(className.value)
        for (const column of identityColumns.value) {
          const value = row[column]
          if (value === undefined || value === null || value === '') {
            usable = false
            break
          }
          query.equalTo(column, value)
        }

        const existing = usable ? await query.first() : undefined
        const target = existing ?? new Parse.Object(className.value)

        for (const [key, value] of Object.entries(row)) {
          const coerced = coerceField(key, value)
          if (coerced !== undefined) target.set(key, coerced)
        }
        await target.save()
      }
    })
    message.value = 'Saved'
    await ui.runWork(loadCsv)
  } catch (error) {
    await reportErrorOn("Couldn't save those rules")(error).catch(() => {})
  }
}
</script>

<template>
  <JqmPage id="administration-descriptions" title="Descriptions" :ready="loaded">
    <div id="descriptions-sections">
      <form @submit.prevent>
        <label for="descriptions-category">Category</label>
        <div class="ui-select">
          <div class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
            <span>{{ category }}</span>
            <select id="descriptions-category" v-model="category" name="category">
              <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
              <option value="All">All</option>
            </select>
          </div>
        </div>
      </form>
    </div>

    <div id="administration-descriptions-list">
      <form @submit.prevent="submit">
        <button type="submit" class="ui-btn ui-shadow ui-corner-all">
          Update Changes to Server
        </button>
        <label for="descriptiondata">Descriptions</label>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <textarea id="descriptiondata" v-model="csv" name="descriptiondata" rows="20"></textarea>
        </div>
        <p v-if="message" class="message">{{ message }}</p>
      </form>
    </div>
  </JqmPage>
</template>
