<script setup lang="ts">
/**
 * A troupe's roster -- `#troupe-characters-all`.
 *
 * A port of `mobileRouter.js:troupecharacters` (`:2000`) over
 * `get_troupe_characters` (`:1266`) and `CharactersListView`.
 *
 * ## The relation is on the character, not on the troupe
 *
 * `q.equalTo("troupes", troupe)` queries the CHARACTER table for rows whose
 * `troupes` relation contains this troupe. Asking `troupe.relation("characters")`
 * instead counts zero no matter how many members there are -- the join is only
 * stored in one direction (`database_seed/_Join troupes Vampire.json`), and
 * `helpers/troupes.js:waitForMembership` documents the same trap from the
 * test side.
 *
 * ## `owner` is deliberately NOT included
 *
 * parse-server deletes an unreadable pointer only when it was asked to EXPAND
 * it, so including `owner` made a private owner's character arrive with the key
 * missing entirely -- and `has("owner")` below reads a missing owner as
 * ARCHIVED, so the character silently vanished from the roster. Without the
 * include the raw pointer survives and the test means what it says. The display
 * names are put back by `usersStore.hydrate`, which must run BEFORE the rows are
 * handed to the list, because it writes through `_finishFetch`.
 *
 * The `:type` segment is in the route and was ignored by the handler; every
 * link in the app passes `all`. Ignored here too rather than invented.
 *
 * `sortbycreated` was set on the array for `devuser` only and then read by
 * nothing -- a debugging leftover. Not reproduced.
 *
 * The filter box is `#troupes-characters-filter`, plural "troupes", which does
 * not match the page id it lives in (`index.html:406`). It is a typo, it is
 * what the suite types into, and renaming it would break nothing visibly and
 * everything invisibly.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import CharacterList from '@/components/CharacterList.vue'
import { useBackHref } from '@/composables/useBackHref'
import { reportErrorOn } from '@/domain/errors'
import { troupeQuery } from '@/domain/Troupe'
import { CharacterObject } from '@/parse/classes'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

const route = useRoute()
const ui = useUiStore()
const usersStore = useUsersStore()

const troupeId = computed(() => route.params.id as string)

useBackHref(() => `#troupe/${troupeId.value}`)

const characters = shallowRef<Parse.Object[]>([])
/** False until the roster is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

function hrefFor(characterId: string) {
  return `#troupe/${troupeId.value}/character/${characterId}`
}

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const troupe = await troupeQuery().include('portrait').get(troupeId.value)

      const found: Parse.Object[] = []
      const query = new Parse.Query(CharacterObject)
      query.equalTo('troupes', troupe)
      query.include('portrait')
      await query.each((character) => {
        // A character with no owner has been archived; it stays on the roster
        // in the database and off it here.
        if (character.has('owner')) found.push(character)
      })

      await usersStore.hydrate(found, 'owner')
      characters.value = found
    })
  } catch (error) {
    await reportErrorOn("Couldn't list that troupe's characters")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="troupe-characters-all" title="Troupe Characters" :ready="loaded">
    <CharacterList
      :characters="characters"
      :href-for="hrefFor"
      filter
      filter-id="troupes-characters-filter"
    />
  </JqmPage>
</template>
