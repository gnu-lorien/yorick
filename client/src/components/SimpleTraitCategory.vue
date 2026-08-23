<script setup lang="ts">
/**
 * The traits in one category -- `#simpletraitcategory-all`.
 *
 * A port of `SimpleTraitCategoryView.js` and the `#simpleTraitCategoryView`
 * template at `public/index.html:451`.
 *
 * A short screen: an "Add New" link and one row per trait, each labelled
 * `<name> x<value>`. That label format is load-bearing -- the E2E helpers parse
 * it to read a trait's value off the listing rather than opening it.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { useScrollRestore } from '@/composables/useScrollRestore'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const category = computed(() => route.params.category as string)
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

/**
 * False until this page's data is in hand.
 *
 * `JqmPage` renders no content while it is false, which is what stops
 * `waitForActivePage` reporting the page settled before its list exists. See
 * the note in `JqmPage.vue`.
 */
const loaded = ref(false)

// Return to where the reader was before adding, changing or specialising a
// trait -- this list is long and every one of those is a route of its own.
useScrollRestore(loaded)

onMounted(async () => {
  try {
    character.value = await ui.runWork(() => get_character(cid.value, [category.value]))
  } catch (error) {
    await reportErrorOn("Couldn't open that trait category")(error).catch(() => {})
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
})

/**
 * The traits in this category.
 *
 * `trackAll` because a trait edited on the change screen is a different object
 * from the character, and coming back here must show the new value.
 */
const traits = computed(() => {
  const c = character.value
  if (!c) return []
  trackAll()
  return ((c.get(category.value) as Parse.Object[] | undefined) ?? []).filter(Boolean)
})
</script>

<template>
  <JqmPage id="simpletraitcategory-all" title="SimpleTraitCategoryAll" :ready="loaded">
    <ul>
      <li>
        <a :href="`#simpletraits/${category}/${cid}/new`">Add New {{ category }}</a>
      </li>
    </ul>
    <ul>
      <li v-for="trait in traits" :key="trait.id">
        <a
          :href="`#simpletrait/${category}/${cid}/${trait.id}`"
          class="ui-btn ui-btn-icon-right ui-icon-carat-r"
        >
          {{ trait.get('name') }} x{{ trait.get('value') }}
        </a>
      </li>
    </ul>
  </JqmPage>
</template>
