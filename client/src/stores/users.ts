/**
 * The user directory, and the thing that replaces `include("owner")`.
 *
 * Replaces `helpers/UserWreqr.js` -- the third and last Wreqr radio channel.
 *
 * ## Why this exists at all
 *
 * parse-server 9 defaults `enforcePrivateUsers` to true, so the browser cannot
 * read another player's `_User` row directly. It has no master key; user lookup
 * goes through the `get_users_by_id` Cloud function.
 *
 * The trap is what happens to an `owner` pointer on a character. parse-server
 * deletes an unreadable pointer only when it was asked to EXPAND it -- so
 * `include("owner")` makes a private owner's character arrive with the key
 * missing outright, and `Character#get_me_acl` reads a missing owner as "no
 * owner" and grants the CURRENT user read and write. Merely opening someone
 * else's sheet rewrote its ACL to the viewer.
 *
 * Dropping the include leaves the raw pointer intact, and `hydrate` puts the
 * display fields back afterwards.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import Parse from '@/parse'
import { getUsersById, MAX_IDENTITY_IDS } from '@/domain/cloud'

/**
 * What an unresolvable owner renders as.
 *
 * Reached only when a hydrate was missed, and it exists so that miss shows up as
 * `(unknown)` rather than as a blank that a CSV export would silently swallow.
 */
const UNRESOLVED_USER = { username: '(unknown)', realname: '', email: '' }

export const useUsersStore = defineStore('users', () => {
  const users = shallowRef<Map<string, Parse.User>>(new Map())
  const revision = ref(0)

  /**
   * Ids the server has already been asked about, whether or not it answered.
   *
   * Caching the MISSES is what stops a roster full of unreadable owners
   * re-asking on every render.
   */
  const asked = new Set<string>()

  /**
   * One user by id.
   *
   * The caller's own row is always readable -- parse-server writes
   * `ACL[objectId] = {read: true, write: true}` even under `enforcePrivateUsers`
   * -- and `Parse.User.current()` already holds it. Answering from there means
   * the profile page needs no directory call at all, which matters because its
   * patronage rows resolve identity through here and would otherwise print
   * "<objectId> User object missing" to every paying member on their own page.
   */
  function get(id: string): Parse.User | undefined {
    void revision.value
    const current = Parse.User.current()
    if (current && current.id === id) return current
    return users.value.get(id)
  }

  const all = computed(() => {
    void revision.value
    return Array.from(users.value.values())
  })

  /**
   * Ask the server about ids the registry has never asked about.
   *
   * Batched at the Cloud function's own cap. Ids that come back withheld are
   * still marked asked, so an unreadable owner costs one request per page load
   * rather than one per render.
   */
  async function prime(ids: readonly (string | undefined | null)[]): Promise<void> {
    const current = Parse.User.current()
    const need = Array.from(new Set(ids.filter((id): id is string => !!id))).filter(
      (id) => !asked.has(id) && !(current && current.id === id),
    )
    if (need.length === 0) return

    const next = new Map(users.value)
    for (let i = 0; i < need.length; i += MAX_IDENTITY_IDS) {
      const batch = need.slice(i, i + MAX_IDENTITY_IDS)
      const payload = await getUsersById(batch)
      for (const user of payload.users) {
        if (user.id) next.set(user.id, user as unknown as Parse.User)
      }
      for (const id of batch) asked.add(id)
    }
    users.value = next
    revision.value++
  }

  /**
   * Fill in the display fields of the `key` pointers on `objects`, IN PLACE.
   *
   * `_finishFetch` is an SDK private and it is used on purpose: it is the exact
   * step `Parse.Object.fromJSON` performs when the SDK itself decodes an
   * included pointer, so this REPRODUCES what the include used to do rather
   * than imitating it. It writes only serverData and objectCache, and creates no
   * pending operations.
   *
   * Do NOT "simplify" it to `.set()`. Measured against the installed SDK, and
   * this is the hinge of the whole design:
   *
   *     _finishFetch -> parent dirty false, unsavedChildren 0
   *     .set()       -> parent dirty false, unsavedChildren 1   <-- the trap
   *
   * `unsavedChildren` collects any DIRTY child that has an id, so a `.set()`
   * here would make the next `character.save()` deep-save the `_User` row and
   * take a 403 -- on a save the user did not make, about a row they cannot
   * write.
   */
  async function hydrate<T extends Parse.Object>(
    objects: readonly T[],
    key: string,
    missing?: Record<string, unknown>,
  ): Promise<readonly T[]> {
    const pointers = objects
      .map((o) => o.get(key) as Parse.User | undefined)
      .filter((p): p is Parse.User => !!p)
    if (pointers.length === 0) return objects

    await prime(pointers.map((p) => p.id))

    for (const pointer of pointers) {
      if (pointer.get('username')) continue
      const known = pointer.id ? get(pointer.id) : undefined
      /*
       * `sessionToken` is omitted because `Parse.User.current().toJSON()`
       * carries it, and the self-answer in `get` above can hand back exactly
       * that object. `ACL` is omitted because it is not a display field and
       * writing it into serverData would misreport what the server holds.
       */
      const source = known
        ? (() => {
            const json = known.toJSON() as Record<string, unknown>
            const { ACL: _acl, sessionToken: _token, ...rest } = json
            return rest
          })()
        : (missing ?? UNRESOLVED_USER)
      ;(pointer as unknown as { _finishFetch: (json: unknown) => void })._finishFetch(source)
    }

    revision.value++
    return objects
  }

  function reset(): void {
    users.value = new Map()
    asked.clear()
    revision.value++
  }

  return { users, all, get, prime, hydrate, reset, revision }
})
