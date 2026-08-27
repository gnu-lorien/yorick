<script setup lang="ts">
/**
 * Spend one creation pick -- `#character-create-simpletrait-new`.
 *
 * A port of `CharacterCreateSimpleTraitNewView.js`, reached from
 * `#charactercreate/simpletraits/:category/:cid/pick/:i`.
 *
 * Unlike the ordinary trait picker, this one does NOT open the trait editor. It
 * writes the trait immediately and returns to the wizard, because the value is
 * already decided: the rating in the URL.
 *
 * ## The one place the creation-pool limit is enforced
 *
 * `mobileRouter.js:610-624` is the ENTIRE enforcement in the system --
 * `cloud/main.js` has no equivalent. The wizard stops rendering a pick link once
 * a pool is exhausted, but that is presentational: before this check existed, a
 * hand-typed URL walked the counter past zero and corrupted the character. The
 * corruption is silent, arrives through the normal UI, and is written into the
 * immutable audit log by server triggers.
 *
 * So the check lives here, before anything is written, and refuses out loud.
 *
 * ## Cost versus free value
 *
 * `free_value` is the rating, which is what makes the pick free:
 * `(value - free_value) * rate` is zero. `value` is the rating too, EXCEPT for
 * descriptions that carry their own -- merits and flaws, where the description's
 * value is the trait's cost and the pick is taken at rating 0.
 *
 * ## Which options are offered
 *
 * By default, anything the character does not already have. Two categories
 * narrow it further, and both matter for correctness rather than convenience:
 * in-clan disciplines only, for a vampire's discipline picks; and affinity
 * gifts at value 1 only, for a werewolf's.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmListview, JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import {
  descriptionQueryForCategory,
  fetchDescriptions,
  type Description,
} from '@/domain/Description'
import { reportErrorOn } from '@/domain/errors'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const category = computed(() => route.params.category as string)
const cid = computed(() => route.params.cid as string)
const rating = computed(() => Number.parseInt(String(route.params.i), 10) || 0)

useBackHref(() => `#charactercreate/${cid.value}`)

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
const descriptions = shallowRef<Description[]>([])
const refusal = ref('')

/**
 * False until this page's data is in hand.
 *
 * `JqmPage` renders no content while it is false, which is what stops
 * `waitForActivePage` reporting the page settled before its list exists. See
 * the note in `JqmPage.vue`.
 */
const loaded = ref(false)

/** Descriptions that can be taken more than once, one per specialization. */
const requiresSpecialization = computed(
  () =>
    new Set(
      descriptions.value
        .filter((d) => d.get('requirement') === 'requires_specialization')
        .map((d) => d.get('name') as string),
    ),
)

/** Names already on the character, minus the ones that allow repeats. */
const takenNames = computed(() => {
  const c = character.value
  if (!c) return new Set<string>()
  trackAll()
  const traits = (c.get(category.value) as Parse.Object[] | undefined) ?? []
  const names = traits.filter(Boolean).map((t) => t.get('name') as string)
  return new Set(names.filter((n) => !requiresSpecialization.value.has(n)))
})

const options = computed(() => {
  const c = character.value
  if (!c) return []
  trackAll()

  let items = descriptions.value.filter((d) => !takenNames.value.has(d.get('name') as string))

  if (category.value === 'disciplines') {
    /*
     * `get_in_clan_disciplines` is on the VampireVenue interface, not on the
     * shared `VenueStrategy` -- only one venue has clans. The cast is narrowed
     * by the category we are in: `disciplines` is a Vampire-only pool.
     */
    const venue = c.venue as unknown as {
      get_in_clan_disciplines?: (ch: unknown) => (string | undefined)[]
    }
    const inClan = (venue.get_in_clan_disciplines?.(c) ?? []).filter(
      (name): name is string => typeof name === 'string',
    )
    // An empty rule set means "no restriction" -- the original left the list
    // alone rather than showing nothing.
    if (inClan.length !== 0) {
      items = items.filter((d) => inClan.includes(d.get('name') as string))
    }
  } else if (category.value === 'wta_gifts') {
    // Likewise: `get_affinities` is WerewolfVenue's, and `wta_gifts` is a
    // Werewolf-only pool.
    const venue = c.venue as unknown as { get_affinities?: (ch: unknown) => unknown[] }
    const affinities = (venue.get_affinities?.(c) ?? []).filter(
      (a) => a !== undefined && a !== null,
    )
    if (affinities.length !== 0) {
      items = items.filter((d) =>
        [1, 2, 3].some((i) => affinities.includes(d.get(`affinity_${i}`))),
      )
    }
    // `show_only_value_1`: creation picks a gift at its first level.
    items = items.filter((d) => Number(d.get('value')) === 1)
  }

  return items.map((d) => {
    const name = (d.get('name') as string) ?? ''
    const own = Number.parseInt(String(d.get('value')), 10)
    return {
      id: d.id as string,
      name,
      label: d.get('value') ? `${name} x${d.get('value')}` : name,
      /** The description's own value wins; otherwise the pick's rating. */
      value: Number.isFinite(own) && own ? own : rating.value,
    }
  })
})

onMounted(async () => {
  try {
    // One `runWork` for the whole load; see the note in SimpletextNewPage.
    const refused = await ui.runWork(async () => {
      const c = await get_character(cid.value, [category.value])
      character.value = c

      await c.fetch_all_creation_elements()
      const creation = c.get('creation') as Parse.Object | undefined
      const remaining = creation?.get(`${category.value}_${rating.value}_remaining`)
      if (typeof remaining === 'number' && remaining <= 0) {
        refusal.value = `No creation picks left for ${category.value} at rating ${rating.value}.`
        return true
      }

      descriptions.value = await fetchDescriptions(descriptionQueryForCategory(category.value))
      return false
    })

    if (refused) {
      await reportErrorOn("Couldn't open that pick")(
        new Parse.Error(Parse.Error.VALIDATION_ERROR, refusal.value),
      ).catch(() => {})
      window.location.hash = `#charactercreate/${cid.value}`
      return
    }
  } catch (error) {
    await reportErrorOn("Couldn't open that pick")(error).catch(() => {})
    window.location.hash = `#charactercreate/${cid.value}`
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
})

async function pick(option: { name: string; value: number }) {
  const c = character.value
  if (!c) return
  try {
    const trait = await ui.runWork(() =>
      c.update_trait(option.name, option.value, category.value, rating.value),
    )
    const traitName = (trait as unknown as Parse.Object)?.get?.('name') as string | undefined
    if (traitName && requiresSpecialization.value.has(traitName)) {
      const linkId =
        (trait as unknown as { linkId?: () => string }).linkId?.() ??
        (trait as unknown as Parse.Object).id
      window.location.hash =
        `#charactercreate/simpletraits/${category.value}/${cid.value}/specialize/${linkId}/${rating.value}`
      return
    }
    window.location.hash = `#charactercreate/${cid.value}`
  } catch (error) {
    await reportErrorOn("Couldn't take that pick")(error).catch(() => {})
  }
}
</script>

<template>
  <JqmPage id="character-create-simpletrait-new" title="New Simple Trait" :ready="loaded">
    <p v-if="rating">Pick one for value {{ rating }}</p>
    <JqmListview filter filter-id="filterBasic-input" v-slot="{ query }">
      <li
        v-for="option in options"
        v-show="!query || option.name.toLowerCase().includes(query.toLowerCase())"
        :key="option.id"
      >
        <a
          :name="option.name"
          :backendId="option.id"
          href="#"
          class="ui-btn ui-btn-icon-right ui-icon-carat-r simpletrait"
          @click.prevent="pick(option)"
        >
          {{ option.label }}
        </a>
      </li>
    </JqmListview>
  </JqmPage>
</template>
