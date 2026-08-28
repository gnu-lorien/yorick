<script setup lang="ts">
/**
 * The front page -- a port of `PlayerOptionsView.js` and
 * `templates/player_options.html`, plus the `home` route handler
 * (`mobileRouter.js:306-324`).
 *
 * Three things the original did, and what became of each:
 *
 * 1. **The menu.** Five links, with Administration shown only to an
 *    administrator. Unchanged.
 *
 * 2. **The storyteller probe.** The route handler counted the user's Parse
 *    roles and then SAVED `storytellerinterface` onto the `_User` row on every
 *    single visit to this page. That flag drives the footer's three-way grid and
 *    the troupe shortcut below. The write is preserved -- other screens read the
 *    cached flag -- but it now happens through the auth store, and only when the
 *    value actually changes, which is what the original's own
 *    `if (user.get(...) != isstoryteller)` guard intended.
 *
 * 3. **The troupe quick-access list.** A `CompositeView` that cross-references
 *    the user's roles against every troupe: a role is named `<title>_<troupeId>`,
 *    so the ids of the troupes a storyteller runs fall out of their role names.
 *    It is deliberately not built at all for a user who is neither an
 *    administrator nor a storyteller -- the original returned early before even
 *    showing the child view, which is what keeps an ordinary player from
 *    fetching the whole troupe list.
 *
 * The `_updateTroupeWrapper` mutex the original used to serialise recomputation
 * is gone: the cross-reference is a `computed` over two stores, so it cannot
 * race with itself.
 */
import { computed, onMounted, ref } from 'vue'
import { JqmListItem, JqmListview, JqmPage } from '@/components/jqm'
import TroupeList from '@/components/TroupeList.vue'
import { useAuthStore } from '@/stores/auth'
import { useRolesStore } from '@/stores/roles'
import { useTroupesStore } from '@/stores/troupes'

const auth = useAuthStore()
const roles = useRolesStore()
const troupes = useTroupesStore()

/** True while the two background fetches behind the quick-access list run. */
const loadingTroupes = ref(false)

/** Only staff see the shortcut; an ordinary player never fetches troupes. */
const showsQuickAccess = computed(() => auth.isAdmin || auth.isStoryteller)

const menu = computed(() => {
  const items = [
    { href: '#characters?all', label: 'Characters' },
    { href: '#profile', label: 'Profile Settings' },
  ]
  if (auth.isAdmin) items.push({ href: '#administration', label: 'Administration' })
  items.push({ href: '#troupes', label: 'Troupes' })
  items.push({ href: '#referendums', label: 'Referendums' })
  return items
})

/**
 * The troupes this user holds a role in.
 *
 * `roles.troupeIds` splits `LST_abc` into `abc`; a role naming a troupe that no
 * longer exists simply matches nothing, exactly as the original's
 * `if (matching_troupe)` guard arranged.
 */
const myTroupes = computed(() =>
  roles.troupeIds.map((id) => troupes.get(id)).filter((t): t is NonNullable<typeof t> => !!t),
)

onMounted(async () => {
  await auth.refreshStorytellerStatus()
  if (!showsQuickAccess.value) return

  loadingTroupes.value = true
  try {
    // Troupes first, so they are present by the time the roles resolve --
    // the original ordered these two the same way and for the same reason.
    await Promise.allSettled([troupes.loadTroupes(), roles.loadCurrentRoles()])
  } finally {
    loadingTroupes.value = false
  }
})
</script>

<template>
  <JqmPage id="player-options" title="Player Options">
    <JqmListview inset>
      <JqmListItem v-for="item in menu" :key="item.href" :href="item.href">
        {{ item.label }}
      </JqmListItem>
    </JqmListview>

    <div v-if="showsQuickAccess" id="troupe-characters-quick-access">
      <h3>Troupe View All Characters</h3>
      <p v-if="loadingTroupes">Loading Your Troupes...</p>
      <!--
        The same rows as the troupes directory, through the same component.
        `templates/troupe-list-entry.html` is what both render, so a shortcut
        row and a directory row are the same thing -- including the
        `a.troupe-listing` class and the `backendId` the E2E suite finds a
        specific troupe by. No filter box: this is a shortcut to two or three
        troupes, not a directory.
      -->
      <TroupeList :troupes="myTroupes" :filter="false" />
    </div>
  </JqmPage>
</template>
