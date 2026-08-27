/**
 * Which Parse roles the signed-in user holds.
 *
 * Replaces `helpers/RoleWreqr.js`, one of three Backbone.Wreqr *radio channels*
 * the app used for cross-component messaging (`role`, `troupe`, `user`). Each
 * was a module singleton holding a collection plus `get` and `all` request
 * handlers -- a store, written before stores. Pinia is the direct equivalent, so
 * the channel machinery disappears and nothing else changes.
 *
 * The query direction is load-bearing and is preserved verbatim: ask `_Role`
 * which roles contain this user, never ask each role's `_User` relation whether
 * it contains them. A relation query IS a `_User` find, so it is refused
 * outright now that `_User` find is closed -- and it was an N+1 besides, one
 * sub-query per role in the entire system. `_Role` is world-readable, so this
 * reads nothing privileged.
 */
import { defineStore } from 'pinia'
import { computed, shallowRef, ref } from 'vue'
import Parse from '@/parse'

export const useRolesStore = defineStore('roles', () => {
  const roles = shallowRef<Parse.Role[]>([])
  const revision = ref(0)

  /**
   * The user whose roles are loaded.
   *
   * The original short-circuited on `_.eq(self.last_user_id, Parse.User.current().id)`
   * so a second call for the same user was free. Kept: `get_current_roles` is
   * called on every visit to the front page.
   */
  let loadedForUserId: string | undefined

  /** Serialises overlapping calls, as the original's `_updateRoleWrapper` did. */
  let queue: Promise<unknown> = Promise.resolve()

  const all = computed(() => {
    void revision.value
    return roles.value
  })

  function get(id: string): Parse.Role | undefined {
    void revision.value
    return roles.value.find((r) => r.id === id)
  }

  /**
   * The troupe ids this user holds a role in.
   *
   * Troupe roles are named `<title>_<troupeId>` -- `LST_abc`, `AST_abc`,
   * `Narrator_abc` -- so the id is the part after the first underscore. That
   * naming scheme is the whole troupe permission model; `cloud/Troupe.js`
   * writes it and `Character#get_me_acl` reads it.
   */
  const troupeIds = computed(() => {
    void revision.value
    const ids: string[] = []
    for (const role of roles.value) {
      const name = role.get('name') as string | undefined
      if (!name) continue
      const parts = name.split('_')
      if (parts.length > 1 && parts[1]) ids.push(parts[1])
    }
    return ids
  })

  async function loadCurrentRoles(): Promise<void> {
    // Chain onto the queue and swallow a previous failure, matching the
    // original's `.always()`: a rejection must not wedge later calls.
    queue = queue.then(
      () => run(),
      () => run(),
    )
    await queue
  }

  async function run(): Promise<void> {
    const current = Parse.User.current()
    if (!current) return
    if (loadedForUserId === current.id) return
    loadedForUserId = current.id

    const found: Parse.Role[] = []
    const query = new Parse.Query(Parse.Role).equalTo('users', current)
    try {
      await query.each((role) => {
        found.push(role as Parse.Role)
      })
      roles.value = found
      revision.value++
    } catch (error) {
      // The original logged and carried on. A user whose roles cannot be listed
      // still gets a usable app, minus the storyteller shortcuts.
      console.log("Couldn't list this user's roles: " + ((error as Error)?.message ?? String(error)))
      loadedForUserId = undefined
    }
  }

  /** Forget everything, for a sign-out or a user switch. */
  function reset(): void {
    roles.value = []
    loadedForUserId = undefined
    revision.value++
  }

  return { roles, all, get, troupeIds, loadCurrentRoles, reset, revision }
})
