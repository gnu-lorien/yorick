/**
 * Load every patronage, with its owner's display fields filled in.
 *
 * Shared by the patronages list and its CSV twin, which differ only in how they
 * render the same data.
 *
 * The owner pointers are primed through the user registry rather than included
 * in the query: parse-server DELETES an unreadable pointer when asked to expand
 * it, so `include("owner")` would make a private owner's patronage arrive with
 * the key missing outright. Priming must finish BEFORE the rows are shown --
 * `_finishFetch` fires no change event of its own.
 */
import { ref, shallowRef } from 'vue'
import { fetchPatronages, sortPatronages, type Patronage } from '@/domain/Patronage'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

export function usePatronages(context: string) {
  const ui = useUiStore()
  const usersStore = useUsersStore()

  const patronages = shallowRef<Patronage[]>([])
  /** False until the rows are in hand; see the note in `JqmPage.vue`. */
  const loaded = ref(false)

  async function load() {
    try {
      await ui.runWork(async () => {
        const found = await fetchPatronages()
        const ownerIds = found
          .map((p) => (p.get('owner') as { id?: string } | undefined)?.id)
          .filter((id): id is string => !!id)
        await usersStore.prime(ownerIds)
        patronages.value = sortPatronages(found)
      })
    } catch (error) {
      await reportErrorOn(context)(error).catch(() => {})
    } finally {
      loaded.value = true
    }
  }

  return { patronages, loaded, load }
}
