<script setup lang="ts">
/**
 * Pick a core text attribute -- `#simpletext-new`.
 *
 * A port of `SimpleTextNewView.js` and the `#simpletextcategoryDescriptionItems`
 * template at `public/index.html:735`. This is where a clan, an archetype, a
 * sect, a tribe or a Kith is chosen: one value, from a list of descriptions.
 *
 * Two routes render it, differing only in where they return to:
 * `#simpletext/:category/:target/:cid/pick` goes back to the character sheet,
 * and `#charactercreate/simpletext/...` goes back to the creation wizard.
 *
 * ## Nothing renders until the options are loaded
 *
 * `waitForActivePage` in the E2E helpers waits for the active page's
 * `div[role="main"]` to STOP BEING EMPTY -- it exists precisely because the old
 * views re-rendered their regions asynchronously after the page became active.
 * A page that renders chrome (a filter box, a heading) before its data arrives
 * satisfies that check early, and the caller reads an empty list.
 *
 * So this renders nothing at all until the fetch resolves. The loading spinner
 * is not enough on its own: `waitForJqmLoader` treats a MISSING `.ui-loader` as
 * clear, and Vue applies the spinner to the DOM a tick after the work starts.
 *
 * ## The picker is not always allowed to succeed
 *
 * `update_text` can refuse, and the refusal is real rather than defensive: R22's
 * Kith transaction rejects a Kith whose granted Arts would exceed the Art pool.
 * The original left the picker sitting there with the spinner turning and
 * nothing said; the refusal is surfaced here and the user stays on the list,
 * which is the only screen where they can choose differently.
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
import { clearError, reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

/** The Description category to list, e.g. `clans`. */
const category = computed(() => route.params.category as string)
/** The character attribute to write, e.g. `clan`. */
const target = computed(() => route.params.target as string)
const cid = computed(() => route.params.cid as string)

const duringCreation = computed(() => route.meta.handler === 'charactercreatepicksimpletext')
const returnTo = computed(() =>
  duringCreation.value ? `#charactercreate/${cid.value}` : `#character?${cid.value}`,
)

useBackHref(returnTo)

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
/** False until the options are in hand; see the note at the top. */
const loaded = ref(false)

/*
 * ONE `runWork` around the whole load, not one per step.
 *
 * The loading spinner is a reference count: two sequential `runWork` calls drop
 * it to zero in between, and the E2E suite's `waitForJqmLoader` treats a clear
 * loader as "this page has settled". It then reads a list that is still being
 * fetched and sees nothing. The original showed the spinner for the whole route
 * handler; so does this.
 */
onMounted(async () => {
  try {
    await ui.runWork(async () => {
      character.value = await get_character(cid.value, [category.value])
      descriptions.value = await fetchDescriptions(descriptionQueryForCategory(category.value))
    })
  } catch (error) {
    await reportErrorOn("Couldn't list the available options")(error).catch(() => {})
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
})

const rows = computed(() =>
  descriptions.value.map((d) => ({ id: d.id as string, name: (d.get('name') as string) ?? '' })),
)

async function choose(name: string) {
  const c = character.value
  if (!c) return
  try {
    await ui.runWork(() => c.update_text(target.value, name))
    clearError()
    window.location.hash = returnTo.value
  } catch (error) {
    // Stay on the picker: a refusal here is a rule the user can satisfy by
    // choosing something else.
    await reportErrorOn(`Couldn't set ${target.value}`)(error).catch(() => {})
  }
}
</script>

<template>
  <JqmPage id="simpletext-new" title="New Simple Text">
    <JqmListview v-if="loaded" inset filter v-slot="{ query }">
      <li
        v-for="row in rows"
        v-show="!query || row.name.toLowerCase().includes(query.toLowerCase())"
        :key="row.id"
      >
        <a
          :name="row.name"
          href="#"
          class="ui-btn ui-btn-icon-right ui-icon-carat-r simpletext"
          @click.prevent="choose(row.name)"
          >{{ row.name }}</a
        >
      </li>
    </JqmListview>
  </JqmPage>
</template>
