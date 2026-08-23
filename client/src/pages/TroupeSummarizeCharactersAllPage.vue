<script setup lang="ts">
/**
 * The troupe summary -- `#troupe-summarize-characters-all`.
 *
 * A port of `CharactersSummarizeListView.js`, its three row templates
 * (`character-summarize-list-item*.html`) and
 * `mobileRouter.js:get_troupe_summarize_characters` (`:1307`).
 *
 * This is the screen a storyteller uses to answer "who in my troupe has what",
 * and it is really a small report builder: five controls narrow the roster and
 * choose one of three renderings of the same rows.
 *
 * Two routes render it: a troupe's roster, and
 * `#administration/characters/summarize` over every character in the database.
 * The admin one is a single query gated on `exists("owner")` and fetches no
 * long text, because it never prints -- see `fetchAllSummaryCharacters`.
 *
 * ## The two queries, and why they are not one
 *
 * Werewolves are fetched by `type == "Werewolf"` with Werewolf's trait columns
 * included; everyone else by `type != "Werewolf"` with Vampire's. That is the
 * source's split and it is preserved, including its consequence: a Changeling
 * arrives through the second query and therefore carries VAMPIRE's include
 * list. It works because the categories the summary can select on are shared,
 * and it is why the category dropdown offers Vampire and Werewolf groups only
 * -- Changeling's own categories were never added to it.
 *
 * Neither query includes `owner`, for the reason recorded on every other
 * character query in this app: parse-server deletes an unreadable pointer only
 * when asked to EXPAND it, so the include makes a private owner's character
 * arrive with the key missing, and a missing `owner` means ARCHIVED. The names
 * come back via `usersStore.hydrate` before the rows are rendered.
 *
 * ## Neither CSV rendering emits a header row
 *
 * Both CSV templates emit only data lines. `troupes.spec.js:144` asserts that as
 * measured reality rather than asserting a header the application has never
 * produced. Adding one would be a change in behaviour, not a fix.
 *
 * ## `columnNames` and the grouped CSV
 *
 * The grouped variant lines every character's traits up under a shared column
 * order, so a spreadsheet gets one column per trait name rather than
 * name/value pairs in arbitrary positions. The order is every distinct trait
 * name present in the CURRENT roster for the selected category, sorted -- so it
 * changes when the category does, which is what the source recomputed on every
 * filter change.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmCheckbox, JqmPage, JqmSearchInput, JqmSelect, vJqmListview } from '@/components/jqm'
import CharacterSummary from '@/components/CharacterSummary.vue'
import { useBackHref } from '@/composables/useBackHref'
import { reportErrorOn } from '@/domain/errors'
import {
  ANTECEDENCE_OPTIONS,
  RESULT_TYPE_OPTIONS,
  SUMMARY_CATEGORY_GROUPS,
  fetchAllSummaryCharacters,
  fetchTroupeSummaryCharacters,
  matchesSummaryFilter,
  summaryCategoryName,
  traitsIn,
} from '@/domain/TroupeSummary'
import type { Character } from '@/domain/Character'
import { trackAll } from '@/parse/reactivity'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

const route = useRoute()
const ui = useUiStore()
const usersStore = useUsersStore()

const troupeId = computed(() => route.params.id as string)
/** `#administration/characters/summarize` renders this page over every character. */
const isAdminListing = computed(() => route.meta.handler === 'administration_characters_summarize')

useBackHref(() => (isAdminListing.value ? '#administration' : `#troupe/${troupeId.value}`))

const characters = shallowRef<Character[]>([])
/** False until the roster is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

/* --------------------------------------------------------------------- *
 * The filter form -- `filterOptions`, a `Backbone.Model` in the source.
 * --------------------------------------------------------------------- */

const category = ref('attributes')
const antecedence = ref('PC')
const resulttype = ref('onlycat')
const playable = ref(true)
const format = ref<'pretty' | 'csv' | 'csvtraitgrouping'>('pretty')

const CATEGORY_GROUPS = SUMMARY_CATEGORY_GROUPS

const FORMAT_OPTIONS = [
  { label: 'Pretty', value: 'pretty' },
  { label: 'CSV', value: 'csv' },
  { label: 'CSV with Trait Grouping', value: 'csvtraitgrouping' },
]

/** The selected category's pretty name -- the heading a pretty row prints. */
const categoryName = computed(() => summaryCategoryName(category.value))

/* --------------------------------------------------------------------- *
 * The filter itself -- `newfilter` in `filterwith`.
 * --------------------------------------------------------------------- */

function traitsOf(character: Parse.Object): Parse.Object[] {
  return traitsIn(character, category.value)
}

const filterValues = computed(() => ({
  category: category.value,
  antecedence: antecedence.value,
  resulttype: resulttype.value,
  playable: playable.value,
}))

const visible = computed(() => {
  trackAll()
  return characters.value.filter((character) => matchesSummaryFilter(character, filterValues.value))
})

/** Every distinct trait name in the visible rows, sorted. `getColumnNames`. */
const columnNames = computed(() => {
  trackAll()
  const names = new Set<string>()
  for (const character of characters.value) {
    for (const trait of traitsOf(character)) {
      const name = trait.get('name') as string | undefined
      if (name !== undefined) names.add(name)
    }
  }
  return [...names].sort()
})

/* --------------------------------------------------------------------- *
 * The three renderings.
 * --------------------------------------------------------------------- */

/** `_.sortBy(traits, "attributes.name")` -- by trait name. */
function sortedTraits(character: Parse.Object): Parse.Object[] {
  return [...traitsOf(character)].sort((l, r) =>
    String(l.get('name')).localeCompare(String(r.get('name'))),
  )
}

/** One CSV field, quoted, with embedded quotes doubled. */
function field(value: unknown): string {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"'
}

/** The owner columns, or the right number of empty ones. */
function ownerFields(character: Parse.Object, withMassmail: boolean): string[] {
  if (!character.has('owner')) return withMassmail ? ['""', '""', '""', '""'] : ['""', '""', '""']
  const owner = character.get('owner') as Parse.User | undefined
  if (!owner?.get('username')) return []
  const parts = [field(owner.get('realname')), field(owner.get('email')), field(owner.get('username'))]
  if (withMassmail) parts.push(field(owner.get('massmailauthorization')))
  return parts
}

function csvRow(character: Character): string {
  const parts = [
    field(character.get('name')),
    field(character.get('sect')),
    field(character.get('archetype')),
    field(character.get('clan')),
    field(character.get('antecedence')),
    field(character.get('faction')),
    field(character.get('title')),
    ...ownerFields(character, true),
    field(character.status()),
  ]
  for (const trait of sortedTraits(character)) {
    parts.push(field(trait.get('name')), field(trait.get('value')))
  }
  return parts.join(',') + ','
}

function csvGroupedRow(character: Character): string {
  const parts = [
    field(character.get('name')),
    field(character.get('sect')),
    field(character.get('archetype')),
    field(character.get('clan')),
    field(character.get('antecedence')),
    field(character.get('faction')),
    field(character.get('title')),
    ...ownerFields(character, false),
    field(character.status()),
  ]
  const traits = traitsOf(character)
  if (traits.length !== 0) {
    const byName = new Map(traits.map((t) => [String(t.get('name')), t]))
    for (const name of columnNames.value) {
      const trait = byName.get(name)
      parts.push(field(trait?.get('name')), field(trait?.get('value')))
    }
  }
  return parts.join(',') + ','
}

const csvRows = computed(() => {
  trackAll()
  const render = format.value === 'csvtraitgrouping' ? csvGroupedRow : csvRow
  return visible.value.map((character) => ({ id: character.id as string, text: render(character) }))
})

/* --------------------------------------------------------------------- *
 * Loading.
 * --------------------------------------------------------------------- */

onMounted(async () => {
  try {
    const found = await ui.runWork(
      () =>
        isAdminListing.value
          ? fetchAllSummaryCharacters()
          : fetchTroupeSummaryCharacters(troupeId.value),
      'Fetching all characters',
    )
    // Before the rows are shown, never after: `hydrate` writes through
    // `_finishFetch`, which fires no change event of its own.
    await usersStore.hydrate(found, 'owner')
    characters.value = found
  } catch (error) {
    await reportErrorOn("Couldn't summarize that troupe's characters")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="troupe-summarize-characters-all" title="Troupe Characters" :ready="loaded">
    <div id="sections">
      <form @submit.prevent>
        <label for="summarize-category">Category</label>
        <JqmSelect id="summarize-category" v-model="category" name="category">
              <optgroup v-for="group in CATEGORY_GROUPS" :key="group.label" :label="group.label">
                <option v-for="entry in group.options" :key="entry[0]" :value="entry[0]">
                  {{ entry[1] }}
                </option>
              </optgroup>
            </JqmSelect>

        <label for="summarize-antecedence">NPC, PC, Primary, or Secondary</label>
        <JqmSelect id="summarize-antecedence" v-model="antecedence" name="antecedence">
              <option v-for="o in ANTECEDENCE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </JqmSelect>

        <label for="summarize-resulttype">Which sort of results to show?</label>
        <JqmSelect id="summarize-resulttype" v-model="resulttype" name="resulttype">
              <option v-for="o in RESULT_TYPE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </JqmSelect>

        <JqmCheckbox id="summarize-playable" v-model="playable" name="playable">
          Only show playable characters
        </JqmCheckbox>

        <label for="summarize-format">Format</label>
        <JqmSelect
          id="summarize-format"
          v-model="format"
          name="format"
        >
          <option v-for="o in FORMAT_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </JqmSelect>
      </form>
    </div>

    <form class="ui-filterable">
      <JqmSearchInput id="troupes-summarize-characters-filter" />
    </form>

    <div id="troupe-summarize-characters-list">
      <ul
        v-jqm-listview
        data-role="listview"
        data-inset="true"
        data-filter="true"
        data-input="#troupes-summarize-characters-filter"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <template v-if="format === 'pretty'">
          <li v-for="character in visible" :key="character.id" class="ul-li-has-thumb">
            <a
              href="#"
              :backendId="character.id"
              class="ui-btn ui-btn-icon-right ui-icon-carat-r character-list-item"
            >
              <CharacterSummary :character="character" :portrait-link="false" />
              <p>Patronage: {{ character.status() }}</p>
              <template v-if="traitsOf(character).length !== 0">
                <h2>{{ categoryName }}</h2>
                <ul>
                  <li v-for="trait in traitsOf(character)" :key="trait.id">
                    {{ trait.get('name') }} x{{ trait.get('value') }}
                  </li>
                </ul>
              </template>
            </a>
          </li>
        </template>
        <template v-else>
          <li v-for="row in csvRows" :key="row.id">{{ row.text }}</li>
        </template>
      </ul>
    </div>
  </JqmPage>
</template>
