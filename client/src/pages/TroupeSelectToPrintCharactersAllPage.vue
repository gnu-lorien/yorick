<script setup lang="ts">
/**
 * Choose which of a troupe's characters to print --
 * `#troupe-select-to-print-characters-all`.
 *
 * A port of `CharactersSelectToPrintView.js` and `forms/PrintSettingsForm.js`.
 *
 * ## There is nothing to tick
 *
 * The name says "select", and there is no per-character checkbox anywhere on
 * this screen -- `troupes.spec.js:146` asserts their absence. Selection means
 * the FILTER: whatever the four controls leave on screen is what "Print Shown"
 * prints. So excluding one character is done by giving it an antecedence the
 * filter rejects, which is exactly what `troupes.spec.js:147` does.
 *
 * It shares its filter with `#troupe-summarize-characters-all` -- the two views
 * carried byte-identical copies of the predicate -- but not its format control:
 * a CSV rendering of rows you are about to print as sheets would mean nothing.
 *
 * ## How the selection reaches the print page
 *
 * `#print-shown` navigates to `#troupe/:id/characters/print/selected`, and the
 * print route used to reach back into this view's live `get_filtered()`. With
 * one view per route there is nothing to reach back into, so the visible ids
 * are published to `useTroupePrintStore` -- which is also where the shared font
 * size and "exclude extended" live, because the router memoised one
 * `Backbone.Model` and handed it to both screens.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import CharacterSummary from '@/components/CharacterSummary.vue'
import { useBackHref } from '@/composables/useBackHref'
import { reportErrorOn } from '@/domain/errors'
import {
  ANTECEDENCE_OPTIONS,
  RESULT_TYPE_OPTIONS,
  SUMMARY_CATEGORY_GROUPS,
  fetchTroupeSummaryCharacters,
  matchesSummaryFilter,
  summaryCategoryName,
  traitsIn,
} from '@/domain/TroupeSummary'
import type { Character } from '@/domain/Character'
import { trackAll } from '@/parse/reactivity'
import type Parse from '@/parse'
import { useTroupePrintStore } from '@/stores/troupePrint'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

const route = useRoute()
const ui = useUiStore()
const usersStore = useUsersStore()
const printOptions = useTroupePrintStore()

const troupeId = computed(() => route.params.id as string)

useBackHref(() => `#troupe/${troupeId.value}`)

const characters = shallowRef<Character[]>([])
/** False until the roster is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

const category = ref('attributes')
const antecedence = ref('PC')
const resulttype = ref('onlycat')
const playable = ref(true)

/** Percent. `forms/PrintSettingsForm.js`, 50 through 150 in tens. */
const FONT_SIZES = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]

const categoryName = computed(() => summaryCategoryName(category.value))

function traitsOf(character: Parse.Object): Parse.Object[] {
  return traitsIn(character, category.value)
}

const visible = computed(() => {
  trackAll()
  const filter = {
    category: category.value,
    antecedence: antecedence.value,
    resulttype: resulttype.value,
    playable: playable.value,
  }
  return characters.value.filter((character) => matchesSummaryFilter(character, filter))
})

// Publish on every change, not only on the button press: the print route can be
// reached by a bookmark or a back button, and the last thing shown here is what
// "selected" has always meant.
watch(
  visible,
  (rows) => printOptions.publishSelection(rows.map((c) => c.id as string)),
  { immediate: true },
)

onMounted(async () => {
  try {
    const found = await ui.runWork(
      () => fetchTroupeSummaryCharacters(troupeId.value),
      'Fetching all characters',
    )
    await usersStore.hydrate(found, 'owner')
    characters.value = found
  } catch (error) {
    await reportErrorOn("Couldn't list that troupe's characters to print")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})

function printShown() {
  window.location.hash = `#troupe/${troupeId.value}/characters/print/selected`
}
</script>

<template>
  <JqmPage
    id="troupe-select-to-print-characters-all"
    title="Troupe Characters"
    :ready="loaded"
  >
    <div id="sections">
      <form @submit.prevent>
        <label for="selecttoprint-category">Category</label>
        <div class="ui-select">
          <div class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
            <span>{{ categoryName }}</span>
            <select id="selecttoprint-category" v-model="category" name="category">
              <optgroup
                v-for="group in SUMMARY_CATEGORY_GROUPS"
                :key="group.label"
                :label="group.label"
              >
                <option v-for="entry in group.options" :key="entry[0]" :value="entry[0]">
                  {{ entry[1] }}
                </option>
              </optgroup>
            </select>
          </div>
        </div>

        <label for="selecttoprint-antecedence">NPC, PC, Primary, or Secondary</label>
        <div class="ui-select">
          <div class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
            <span>{{ ANTECEDENCE_OPTIONS.find((o) => o.value === antecedence)?.label }}</span>
            <select id="selecttoprint-antecedence" v-model="antecedence" name="antecedence">
              <option v-for="o in ANTECEDENCE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </div>
        </div>

        <label for="selecttoprint-resulttype">Which sort of results to show?</label>
        <div class="ui-select">
          <div class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
            <span>{{ RESULT_TYPE_OPTIONS.find((o) => o.value === resulttype)?.label }}</span>
            <select id="selecttoprint-resulttype" v-model="resulttype" name="resulttype">
              <option v-for="o in RESULT_TYPE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </div>
        </div>

        <label for="selecttoprint-playable">
          <input
            id="selecttoprint-playable"
            v-model="playable"
            type="checkbox"
            name="playable"
          />
          Only show playable characters
        </label>
      </form>
    </div>

    <div id="print-options">
      <form @submit.prevent>
        <label for="selecttoprint-font-size">Font Size</label>
        <div class="ui-select">
          <div class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
            <span>{{ printOptions.fontSize }}%</span>
            <select id="selecttoprint-font-size" v-model="printOptions.fontSize" name="font_size">
              <option v-for="size in FONT_SIZES" :key="size" :value="size">{{ size }}%</option>
            </select>
          </div>
        </div>

        <label for="selecttoprint-exclude-extended">
          <input
            id="selecttoprint-exclude-extended"
            v-model="printOptions.excludeExtended"
            type="checkbox"
            name="exclude_extended"
          />
          Exclude Extended Print Text
        </label>
      </form>
    </div>

    <button id="print-shown" class="ui-btn ui-shadow ui-corner-all" @click="printShown">
      Print Shown
    </button>

    <div id="troupe-select-to-print-characters-list">
      <ul
        data-role="listview"
        data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
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
      </ul>
    </div>
  </JqmPage>
</template>
