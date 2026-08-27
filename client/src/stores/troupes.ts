/**
 * Every troupe, cached once.
 *
 * Replaces `helpers/TroupeWreqr.js` -- the `troupe` Wreqr radio channel. Like
 * the role channel it was a singleton collection with `get` and `all` handlers.
 *
 * The query's `select` list is preserved exactly. It is not an optimisation
 * detail: this runs for every user on the front page, and widening it would
 * hand every player the full contents of every troupe record.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import Parse from '@/parse'

const SELECTED_FIELDS = ['id', 'name', 'portrait', 'shortdescription', 'location', 'staffemail']

export const useTroupesStore = defineStore('troupes', () => {
  const troupes = shallowRef<Parse.Object[]>([])
  const revision = ref(0)
  const loading = ref(false)

  const all = computed(() => {
    void revision.value
    return troupes.value
  })

  function get(id: string | undefined): Parse.Object | undefined {
    void revision.value
    if (!id) return undefined
    return troupes.value.find((t) => t.id === id)
  }

  async function loadTroupes(): Promise<void> {
    loading.value = true
    try {
      const incoming: Parse.Object[] = []
      const query = new Parse.Query('Troupe')
      query.select(...SELECTED_FIELDS)
      query.include('portrait')
      // `each` rather than `find`: it pages through the whole class without a
      // limit, which is what the original relied on.
      await query.each((t) => {
        incoming.push(t)
      })
      troupes.value = incoming
      revision.value++
    } finally {
      loading.value = false
    }
  }

  function reset(): void {
    troupes.value = []
    revision.value++
  }

  return { troupes, all, get, loading, loadTroupes, reset, revision }
})
