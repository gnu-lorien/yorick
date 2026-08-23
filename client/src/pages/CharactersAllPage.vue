<script setup lang="ts">
/**
 * The character list -- `#characters-all`.
 *
 * Two routes render it, and they differ in more than a query:
 *
 *  - `#characters?all` (`mobileRouter.js:1464`) lists the signed-in player's own
 *    characters, and rows link to `#character?<id>`.
 *  - `#administration/characters/all` (`:2244`) lists everybody's, is admin
 *    gated, and rows link to `#administration/character/<id>`.
 *
 * The admin listing is two queries, not one, and the split is reproduced rather
 * than unified: `type == "Werewolf"` first, then `type != "Werewolf"` on the
 * same table, which is what puts werewolves at the top of the list. Both require
 * `exists("owner")`, so an orphaned character is not listed.
 *
 * Neither query includes `owner`. parse-server deletes an unreadable pointer
 * only when asked to EXPAND it, so the include would make a private owner's
 * character arrive with the key missing -- and a missing owner means something
 * quite different downstream. The display fields are put back by
 * `usersStore.hydrate`, which must run BEFORE the rows are handed to the list.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import CharacterList from '@/components/CharacterList.vue'
import { useBackHref } from '@/composables/useBackHref'
import { CharacterObject } from '@/parse/classes'
import { reportErrorOn } from '@/domain/errors'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

const route = useRoute()
const ui = useUiStore()
const usersStore = useUsersStore()

const isAdminListing = computed(() => route.meta.handler === 'administration_characters_all')

useBackHref(() => (isAdminListing.value ? '#administration' : '#'))

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
const characters = shallowRef<Parse.Object[]>([])

/**
 * False until this page's data is in hand.
 *
 * `JqmPage` renders no content while it is false, which is what stops
 * `waitForActivePage` reporting the page settled before its list exists. See
 * the note in `JqmPage.vue`.
 */
const loaded = ref(false)

const hrefFor = computed(() =>
  isAdminListing.value
    ? (id: string) => `#administration/character/${id}`
    : (id: string) => `#character?${id}`,
)

/** `get_user_characters` (`mobileRouter.js:1246`). */
async function loadMine(): Promise<Parse.Object[]> {
  const found: Parse.Object[] = []
  const query = new Parse.Query(CharacterObject)
  query.equalTo('owner', Parse.User.current())
  query.include('portrait')
  await query.each((character) => {
    found.push(character)
  })
  return found
}

/** `get_administrator_characters` (`mobileRouter.js:1364`). */
async function loadEveryones(): Promise<Parse.Object[]> {
  const found: Parse.Object[] = []

  const werewolves = new Parse.Query(CharacterObject)
  werewolves.exists('owner')
  werewolves.include('portrait')
  werewolves.equalTo('type', 'Werewolf')
  await werewolves.each((character) => {
    found.push(character)
  })

  const rest = new Parse.Query(CharacterObject)
  rest.exists('owner')
  rest.include('portrait')
  rest.notEqualTo('type', 'Werewolf')
  await rest.each((character) => {
    found.push(character)
  })

  // Before the rows are shown, never after: `hydrate` writes through
  // `_finishFetch`, which fires no change event of its own.
  await usersStore.hydrate(found, 'owner')
  return found
}

onMounted(async () => {
  try {
    characters.value = await ui.runWork(() =>
      isAdminListing.value ? loadEveryones() : loadMine(),
    )
  } catch (error) {
    const context = isAdminListing.value
      ? "Couldn't list every character"
      : "Couldn't list your characters"
    await reportErrorOn(context)(error).catch(() => {})
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="characters-all" title="Characters" :ready="loaded">
    <ul>
      <li><a href="#characternew">Add New Character</a></li>
    </ul>
    <!--
      The owner line is shown on the ADMIN listing and hidden on a player's
      own: every row of your own roster has the same owner, so naming it is
      redundant and crowds the row. See `CharacterSummary`.
    -->
    <CharacterList
      :characters="characters"
      :href-for="hrefFor"
      :show-owner="isAdminListing"
      filter
      filter-id="characters-filter"
    />
  </JqmPage>
</template>
