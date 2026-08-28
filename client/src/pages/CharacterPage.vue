<script setup lang="ts">
/**
 * The character sheet -- `#character`.
 *
 * A port of `CharacterView.js` and the `#characterView` template at
 * `public/index.html:221-389`. This is the app's hub: almost every other screen
 * is reached from a tile on it.
 *
 * Three routes render it, differing only in where Back goes --
 * `show_character_helper(id, back_url)` (`mobileRouter.js:851`) is the shared
 * body and its two callers pass a troupe roster or the admin listing instead of
 * the player's own list. The route's `handler` in `meta` says which one this is.
 *
 * The page id stays `character` for all three, because that is what the E2E
 * suite's `activePageId` reads and what `waitForActivePage('#character')` waits
 * for. `#insertheader` keeps its id for the same reason.
 *
 * The sheet is almost entirely links: what it renders that is not a link is the
 * XP summary at the top, and which trait categories exist -- both of which come
 * from the venue, so a Werewolf sheet lists Gifts where a Vampire lists
 * Disciplines without this file knowing either word.
 *
 * ## The 2026-08-27 redesign
 *
 * The original rendered every one of those links as a `SheetTile`: a grid cell
 * holding an inset listview holding one anchor, repeated about fifty-nine
 * times, none of which showed a value. Reading your own character meant opening
 * twenty-nine screens to find out what was in them.
 *
 * This version keeps every destination and every href, and changes how you
 * reach them:
 *
 *   - **Counts inline.** `character.get(category)` is a pointer column on the
 *     row, so its `.length` is known the moment the row is read. Every category
 *     shows how much it holds without a single extra request.
 *   - **Seven sections, not fifty-nine tiles.** Native `<details>`, so the
 *     links inside a closed section are still in the DOM -- which is what lets
 *     `character-sheet.spec.js` assert `toBeAttached()` on them.
 *   - **A filter** across every destination, and a rail that jumps to sections.
 *
 * Trait NAMES and VALUES do need hydration, and that is deferred to the moment
 * a section is opened. See `hydrateCategories`.
 *
 * Design record and the approved mockup:
 * `~/.gstack/projects/gnu-lorien-yorick/designs/character-sheet-20260827/`.
 */
import { computed, nextTick, onMounted, reactive, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import {
  SheetMasthead,
  SheetRail,
  SheetRow,
  SheetSection,
  SheetToolbar,
  type RailGroup,
} from '@/components/sheet'
import { useBackHref } from '@/composables/useBackHref'
import { useScrollRestore } from '@/composables/useScrollRestore'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

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

/** `character?:id` names its parameter `id`; the troupe route names it `cid`. */
const characterId = computed(
  () => (route.params.cid as string | undefined) ?? (route.params.id as string),
)

/**
 * Where Back goes, per `show_character_helper`'s three callers.
 */
const backHref = computed(() => {
  const handler = route.meta.handler as string
  if (handler === 'troupe_character') return `#troupe/${route.params.id}/characters/all`
  if (handler === 'administration_character') return '#administration/characters/all'
  return '#characters?all'
})

useBackHref(backHref)

// Return to where the reader was before they took a side trip to pick, unpick
// or change something. See `useScrollRestore`.
useScrollRestore(character)

onMounted(async () => {
  try {
    character.value = await ui.runWork(() => get_character(characterId.value))
  } catch (error) {
    await reportErrorOn("Couldn't open the character")(error).catch(() => {})
    // The original sent the user back where they came from on failure, rather
    // than leaving them on an empty sheet.
    window.location.hash = backHref.value
  }
})

const beingCreated = computed(() => {
  const c = character.value
  if (!c) return false
  trackAll()
  return c.is_being_created()
})

/* ------------------------------------------------------------------ counts */

/**
 * How many traits a category holds.
 *
 * Free. The pointer array is a column on the character row, so it is populated
 * by the initial read; only the pointed-at objects are unfetched. `.length`
 * never costs a request, which is why every count on this page can be shown
 * eagerly while the names behind them are loaded on demand.
 */
function countOf(category: string): number {
  const c = character.value
  if (!c) return 0
  trackAll()
  return ((c.get(category) as Parse.Object[] | undefined) ?? []).filter(Boolean).length
}

/**
 * A few of the traits in a category, as `Name xValue`, or '' when they have
 * not been hydrated yet.
 *
 * An unfetched pointer has an id and nothing else, so `get('name')` is
 * undefined and the row simply shows its count until `hydrateCategories` has
 * run for its section.
 */
function detailOf(category: string): string {
  const c = character.value
  if (!c) return ''
  trackAll()
  const traits = ((c.get(category) as Parse.Object[] | undefined) ?? []).filter(Boolean)
  const named = traits
    .filter((t) => t.get('name') !== undefined)
    .map((t) => {
      const value = t.get('value')
      return value === undefined || value === null ? String(t.get('name')) : `${t.get('name')} x${value}`
    })
  if (named.length === 0) return ''
  return named.length > 3 ? `${named.slice(0, 3).join(' · ')} …` : named.join(' · ')
}

/**
 * Fetch the trait objects for some categories.
 *
 * Deliberately NOT `get_character(id, categories, cache)`, even though that is
 * the function built for this. Its later stages re-run
 * `ensure_creation_rules_exist`, which WRITES -- it seeds the creation record
 * and adds the "Character Creation XP" notation. Calling it every time someone
 * opens an accordion would issue those writes over and over. This does the one
 * stage that is wanted, and is the same `fetchAllIfNeeded` call that function
 * makes at `Character.ts:2311`.
 */
const hydrating = reactive<Record<string, boolean>>({})

async function hydrateCategories(key: string, categories: readonly string[]) {
  const c = character.value
  if (!c || hydrating[key]) return
  const pointers = categories
    .flatMap((category) => (c.get(category) as Parse.Object[] | undefined) ?? [])
    // A pointer that never got an objectId cannot be fetched and would throw.
    .filter((trait): trait is Parse.Object => !!trait && !!trait.id)
  if (pointers.length === 0) return
  hydrating[key] = true
  try {
    await Parse.Object.fetchAllIfNeeded(pointers)
  } catch (error) {
    // A failed hydrate costs the detail line, nothing else: the counts and
    // every link on the row are already right. Report it and move on rather
    // than tearing down a sheet that is otherwise usable. The flag is cleared
    // so that closing and reopening the section tries again -- the usual cause
    // is a dropped connection at a venue, which the next tap may well survive.
    hydrating[key] = false
    await reportErrorOn("Couldn't load those traits")(error).catch(() => {})
  }
}

/* ------------------------------------------------------------------ groups */

/**
 * The trait categories, grouped under their headings.
 *
 * `all_simpletrait_categories()` returns `[name, description, heading]` triples
 * in display order, and the template emitted a heading bar whenever the third
 * element changed from the previous row. Grouping them here says the same thing
 * without a mutable `heading` variable carried across a loop.
 */
const traitGroups = computed(() => {
  const c = character.value
  if (!c) return []
  trackAll()
  const groups: {
    heading: string
    categories: { category: string; description: string }[]
  }[] = []
  for (const entry of c.venue.ALL_SIMPLETRAIT_CATEGORIES) {
    const [category, description, heading] = entry as unknown as [string, string, string]
    const last = groups[groups.length - 1]
    if (!last || last.heading !== heading) {
      groups.push({ heading, categories: [{ category, description }] })
    } else {
      last.categories.push({ category, description })
    }
  }
  return groups
})

/**
 * The core text attributes -- clan, sect, archetype and the rest.
 *
 * Shown only once creation is complete, as in the original: during creation the
 * wizard owns them.
 */
const textAttributes = computed(() => {
  const c = character.value
  if (!c || beingCreated.value) return []
  trackAll()
  return c.venue.TEXT_ATTRIBUTES.map((name) => ({
    name,
    /*
     * `st[0].toUpperCase() + st.substr(1)`, and NOT the venue's pretty name.
     *
     * The two templates disagree on purpose. The creation wizard labels these
     * with `TEXT_ATTRIBUTES_PRETTY_NAMES` (`character-create-view.html:9`); the
     * sheet capitalises the attribute name itself (`index.html:317`). For five
     * of Vampire's six the two agree, which is what makes the difference easy
     * to miss -- the sixth is `antecedence`, whose pretty name is the whole
     * question "Primary, Secondary, or NPC".
     */
    upper: name.charAt(0).toUpperCase() + name.slice(1),
    value: (c.get(name) as string) || '',
  }))
})

/** Every destination that is not a trait category, in its section. */
const fixedSections = computed(() => {
  const c = character.value
  if (!c) return []
  const id = c.id
  return [
    {
      heading: 'Progression',
      rows: [
        { label: 'History', href: `#character/${id}/history/0` },
        { label: 'Experience Points', href: `#character/${id}/experience/0/10` },
        { label: 'Costs', href: `#character/${id}/costs` },
        { label: 'Log', href: `#character/${id}/log/0/10` },
      ],
    },
    {
      heading: 'Troupes',
      rows: [
        { label: 'Show My Troupes', href: `#character/${id}/troupes` },
        { label: 'Join Troupe', href: `#character/${id}/troupes/join` },
        { label: 'Leave Troupe', href: `#character/${id}/troupes/leave` },
      ],
    },
    {
      heading: 'Final Death',
      rows: [{ label: 'Delete Character', href: `#character/${id}/delete` }],
    },
  ]
})

/** The ten actions that were the first tile block. */
const quickActions = computed(() => {
  const c = character.value
  if (!c) return []
  const id = c.id
  return [
    { label: 'Show Latest', href: `#character/${id}/print`, key: true },
    { label: 'Show Approved', href: `#character/${id}/approved` },
    { label: 'Show Approval', href: `#character/${id}/approval` },
    { label: 'Character Portrait', href: `#character/${id}/portrait` },
    { label: 'Print Latest', href: `#character/${id}/print` },
    { label: 'Print Approved', href: `#character/${id}/approved` },
    { label: 'Rename', href: `#character/${id}/rename` },
    { label: 'Extended Print Text', href: `#character/${id}/extendedprinttext` },
    { label: 'Background', href: `#character/${id}/backgroundlt` },
    { label: 'Notes', href: `#character/${id}/noteslt` },
  ]
})

/* ------------------------------------------------------------------ filter */

const filter = ref('')

/**
 * Every destination on the sheet as one flat list.
 *
 * This is what the filter searches and what the toolbar counts. Built from the
 * same sources the sections render from, so a destination cannot appear in one
 * and not the other.
 */
const allDestinations = computed(() => {
  const c = character.value
  if (!c) return []
  const out: { label: string; href: string; value?: number | null; detail?: string }[] = []
  for (const action of quickActions.value) out.push({ label: action.label, href: action.href })
  for (const group of traitGroups.value) {
    for (const entry of group.categories) {
      out.push({
        label: entry.description,
        href: `#simpletraits/${entry.category}/${c.id}/all`,
        value: countOf(entry.category),
        detail: detailOf(entry.category),
      })
    }
  }
  for (const st of textAttributes.value) {
    out.push({
      label: st.value ? `Repick ${st.upper}` : `Pick ${st.upper}`,
      href: `#simpletext/${st.name}s/${st.name}/${c.id}/pick`,
    })
  }
  for (const section of fixedSections.value) {
    for (const row of section.rows) out.push({ label: row.label, href: row.href })
  }
  return out
})

const filtered = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  if (!needle) return []
  return allDestinations.value.filter((d) => d.label.toLowerCase().includes(needle))
})

const filtering = computed(() => filter.value.trim().length > 0)

/**
 * "93 traits · 29 categories", for the toolbar.
 *
 * Both numbers are free, for the reason given on `countOf`.
 */
const summary = computed(() => {
  const groups = traitGroups.value
  if (groups.length === 0) return ''
  let categories = 0
  let traits = 0
  for (const group of groups) {
    for (const entry of group.categories) {
      categories += 1
      traits += countOf(entry.category)
    }
  }
  return `${traits} traits · ${categories} categories`
})

/* -------------------------------------------------------------------- rail */

const railGroups = computed<RailGroup[]>(() => {
  const c = character.value
  if (!c) return []
  const id = c.id
  const sheet = traitGroups.value.map((group) => ({
    label: group.heading,
    jump: sectionIdFor(group.heading),
    count: group.categories.reduce((sum, entry) => sum + countOf(entry.category), 0),
  }))
  return [
    { heading: 'Sheet', entries: sheet },
    {
      heading: 'Character',
      entries: [
        ...(textAttributes.value.length
          ? [{ label: 'Information', jump: sectionIdFor('Information'), count: null }]
          : []),
        { label: 'Background', href: `#character/${id}/backgroundlt`, count: null },
        { label: 'Notes', href: `#character/${id}/noteslt`, count: null },
        { label: 'Portrait', href: `#character/${id}/portrait`, count: null },
        { label: 'Approval', href: `#character/${id}/approval`, count: null },
      ],
    },
    {
      heading: 'Progression',
      entries: [
        { label: 'History', href: `#character/${id}/history/0`, count: null },
        { label: 'Experience Points', href: `#character/${id}/experience/0/10`, count: null },
        { label: 'Costs', href: `#character/${id}/costs`, count: null },
        { label: 'Log', href: `#character/${id}/log/0/10`, count: null },
      ],
    },
    {
      heading: 'Output',
      entries: [
        { label: 'Print Latest', href: `#character/${id}/print`, count: null },
        { label: 'Extended Print Text', href: `#character/${id}/extendedprinttext`, count: null },
      ],
    },
  ]
})

/*
 * Sections start closed. That is the point of them: seven headings instead of
 * fifty-nine tiles. Every link inside stays in the DOM regardless, so
 * `toBeAttached()` assertions do not care, and opening one is what triggers
 * hydration of the trait names behind it.
 */
const openSections = reactive<Record<string, boolean>>({})
const navToggled = ref(false)

function sectionIdFor(heading: string): string {
  return `sr-sec-${heading.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`
}

function onSectionToggle(heading: string, categories: readonly string[], open: boolean) {
  openSections[heading] = open
  if (open) void hydrateCategories(heading, categories)
}

/**
 * Expand a section and bring it into view.
 *
 * `scrollIntoView`, never an `href="#..."`: this app routes on the hash, so an
 * in-page anchor would navigate.
 */
async function jumpTo(sectionId: string) {
  navToggled.value = false
  const heading = traitGroups.value.find((g) => sectionIdFor(g.heading) === sectionId)
  if (heading) {
    openSections[heading.heading] = true
    void hydrateCategories(
      heading.heading,
      heading.categories.map((entry) => entry.category),
    )
  }
  await nextTick()
  document.getElementById(sectionId)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
</script>

<template>
  <JqmPage
    id="character"
    title="Character"
    class="sheet-redesign"
    :class="{ 'sr-nav-toggled': navToggled }"
  >
    <template v-if="character">
      <SheetMasthead :character="character" :being-created="beingCreated" />

      <SheetToolbar
        v-model="filter"
        :total="allDestinations.length"
        :summary="summary"
        @toggle-rail="navToggled = !navToggled"
      />

      <div class="sr-scrim" @click="navToggled = false"></div>

      <div class="sr-shell">
        <SheetRail :groups="railGroups" @navigate="navToggled = false" @jump="jumpTo" />

        <div class="sr-content">
          <!-- Filtering replaces the sections: one flat list of every match. -->
          <template v-if="filtering">
            <p class="sr-results-head">
              {{ filtered.length }} of {{ allDestinations.length }} destinations
            </p>
            <SheetRow
              v-for="(d, i) in filtered"
              :key="d.href + i"
              :href="d.href"
              :name="d.label"
              :detail="d.detail"
              :value="d.value ?? null"
            />
            <p v-if="filtered.length === 0" class="sr-empty">
              Nothing on this sheet matches “{{ filter }}”.
            </p>
          </template>

          <template v-else>
            <nav class="sr-quick">
              <a
                v-for="action in quickActions"
                :key="action.label"
                :href="action.href"
                :class="{ 'sr-key': action.key }"
                >{{ action.label }}</a
              >
            </nav>

            <!--
              The creation link. Kept outside the sections and above them: while
              a character is being created this is the only thing on the sheet
              anyone wants, and nine E2E tests reach it by its text.
            -->
            <nav v-if="beingCreated" class="sr-quick">
              <a class="sr-key" :href="`#charactercreate/${character.id}`">Character Creation</a>
            </nav>

            <SheetSection
              v-for="group in traitGroups"
              :key="group.heading"
              :section-id="sectionIdFor(group.heading)"
              :title="group.heading"
              :tally="`${group.categories.reduce((s, e) => s + countOf(e.category), 0)} traits · ${group.categories.length} categories`"
              :open="openSections[group.heading]"
              @toggle="
                (open) =>
                  onSectionToggle(
                    group.heading,
                    group.categories.map((e) => e.category),
                    open,
                  )
              "
            >
              <SheetRow
                v-for="entry in group.categories"
                :key="entry.category"
                :href="`#simpletraits/${entry.category}/${character.id}/all`"
                :name="entry.description"
                :detail="detailOf(entry.category)"
                :value="countOf(entry.category)"
              />
            </SheetSection>

            <SheetSection
              v-if="textAttributes.length"
              :section-id="sectionIdFor('Information')"
              title="Information"
            >
              <div class="sr-info">
                <div v-for="st in textAttributes" :key="st.name" class="sr-info-item">
                  <div class="sr-info-k">{{ st.upper }}</div>
                  <div class="sr-info-v" :class="{ 'sr-unset': !st.value }">
                    {{ st.value || 'not set' }}
                  </div>
                  <!-- One line each: see the note in CharacterCreatePage.vue. -->
                  <div class="sr-info-actions">
                    <template v-if="st.value">
                      <a :href="`#simpletext/${st.name}s/${st.name}/${character.id}/pick`"
                        >Repick {{ st.upper }}</a
                      >
                      <a :href="`#simpletext/${st.name}s/${st.name}/${character.id}/unpick`"
                        >Unpick {{ st.upper }}</a
                      >
                    </template>
                    <a v-else :href="`#simpletext/${st.name}s/${st.name}/${character.id}/pick`"
                      >Pick {{ st.upper }}</a
                    >
                  </div>
                </div>
              </div>
            </SheetSection>

            <SheetSection
              v-for="section in fixedSections"
              :key="section.heading"
              :section-id="sectionIdFor(section.heading)"
              :title="section.heading"
            >
              <SheetRow
                v-for="row in section.rows"
                :key="row.href"
                :href="row.href"
                :name="row.label"
                :value="null"
              />
            </SheetSection>
          </template>
        </div>
      </div>
    </template>
  </JqmPage>
</template>
