<script setup lang="ts">
/**
 * Pick a trait to add -- `#simpletrait-new`.
 *
 * A port of `SimpleTraitNewView.js` and the `simpletrait-new-list.html`
 * template. It lists the descriptions available in a category and, on a pick,
 * navigates to the trait editor with the chosen values in the URL.
 *
 * ## The value a pick starts at
 *
 * A description may carry its own `value` -- Merits and Flaws do, and it is
 * their cost -- and a pick starts there. Anything without one starts at 1.
 *
 * ## `free_value: 0`, and why it is written out
 *
 * This picker has no creation pool: the `/new` route calls it without one, so
 * the free value is always 0 here. Writing `0` rather than leaving it undefined
 * is not tidiness. Parse 1.5's constructor did `set(attributes, {silent: true})`
 * and `_validate` returned early on `options.silent`, so construction never
 * validated and an undefined `free_value` landed as an attribute nothing read.
 * parse@8's constructor DOES validate, and `SimpleTraitMixin.validate` rejects a
 * `free_value` that is present and not finite -- the throw surfaced as "Can't
 * create an invalid Parse Object" from inside a click handler, the hash was
 * never assigned, and the app simply sat on the page it was already showing.
 *
 * ## Not yet ported
 *
 * The Werewolf Gift filter form (`GiftsForm` in the original: affinity, ladder
 * and sort controls, rendered into `#category-filter-rules`). Gifts list
 * unfiltered until it is.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmListview, JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import {
  descriptionQueryForCategory,
  fetchDescriptions,
  type Description,
} from '@/domain/Description'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const category = computed(() => route.params.category as string)
const cid = computed(() => route.params.cid as string)

useBackHref(() => `#simpletraits/${category.value}/${cid.value}/all`)

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
const descriptions = shallowRef<Description[]>([])

/**
 * False until this page's data is in hand.
 *
 * `JqmPage` renders no content while it is false, which is what stops
 * `waitForActivePage` reporting the page settled before its list exists. See
 * the note in `JqmPage.vue`.
 */
const loaded = ref(false)

/**
 * Descriptions that cannot be taken plain -- picking one goes to the
 * specialization screen instead of straight to the editor.
 */
const requiresSpecialization = computed(
  () =>
    new Set(
      descriptions.value
        .filter((d) => d.get('requirement') === 'requires_specialization')
        .map((d) => d.get('name') as string),
    ),
)

const rows = computed(() =>
  descriptions.value.map((d) => {
    const name = (d.get('name') as string) ?? ''
    const rawValue = d.get('value')
    const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== ''
    const value = Number.parseInt(String(rawValue), 10)
    return {
      id: d.id as string,
      name,
      label: hasValue ? `${name} x${rawValue}` : name,
      /** A description with no value of its own starts the trait at 1. */
      pickValue: Number.isFinite(value) && value ? value : 1,
    }
  }),
)

onMounted(async () => {
  try {
    descriptions.value = await ui.runWork(() =>
      fetchDescriptions(descriptionQueryForCategory(category.value)),
    )
  } catch (error) {
    await reportErrorOn("Couldn't list the available options")(error).catch(() => {})
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
})

function hrefFor(row: { name: string; pickValue: number }): string {
  const shape = requiresSpecialization.value.has(row.name) ? 'specialize' : 'spacer'
  const free = 0
  return (
    `#simpletrait/${shape}/${category.value}/${cid.value}/` +
    `${encodeURIComponent(row.name)}/${row.pickValue}/${free}/new`
  )
}
</script>

<template>
  <JqmPage id="simpletrait-new" title="New Simple Trait" :ready="loaded">
    <div>
      <div id="category-filter-rules"></div>
      <JqmListview filter filter-id="filterBasic-input" v-slot="{ query }">
        <li
          v-for="row in rows"
          v-show="!query || row.name.toLowerCase().includes(query.toLowerCase())"
          :key="row.id"
        >
          <a
            :name="row.name"
            :backendId="row.id"
            :href="hrefFor(row)"
            class="ui-btn ui-btn-icon-right ui-icon-carat-r simpletrait"
          >
            {{ row.label }}
          </a>
        </li>
      </JqmListview>
    </div>
  </JqmPage>
</template>
