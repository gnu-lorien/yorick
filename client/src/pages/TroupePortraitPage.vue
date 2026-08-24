<script setup lang="ts">
/**
 * Upload a troupe portrait -- `#troupe-portrait`.
 *
 * A port of `TroupePortraitView.js` and the `#troupePortraitView` template at
 * `public/index.html:1033`. The character version of this screen is
 * `CharacterPortraitPage.vue`, and the two differ in exactly two ways worth
 * naming.
 *
 * **The ACL is fixed, not derived.** A `TroupePortrait` is world-readable and
 * writable by the `LST` role -- the GENERIC role, with no troupe suffix, so any
 * lead storyteller anywhere can replace any troupe's portrait. That is what the
 * source writes and it is preserved; narrowing it to `LST_<troupeId>` would be a
 * permission change, not a port.
 *
 * **`beforeSave` on the server does the real work.** `cloud/main.js` fetches the
 * uploaded file BACK over HTTP from `publicServerURL`, crops it and writes the
 * derived thumbnails with the master key. If that address is wrong the fetch
 * fails and the save is refused outright, leaving an abandoned file nothing
 * cleans up. A portrait upload failing with an opaque error is almost always
 * that rather than this page.
 *
 * The 1 MB check shows an error and then uploads anyway -- the source has no
 * `return` after the message. Reproduced here for the same reason as on the
 * character page: changing what the app accepts is a product decision.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { reportErrorOn } from '@/domain/errors'
import { troupeQuery, type Troupe } from '@/domain/Troupe'
import Parse from '@/parse'
import { track } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const troupeId = computed(() => route.params.id as string)
useBackHref(() => `#troupe/${troupeId.value}`)

const troupe = shallowRef<Troupe | null>(null)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
/** False until the troupe is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

const name = computed(() => (troupe.value ? (track(troupe.value).get('name') as string) : ''))

const portraitUrl = computed(() => {
  const t = troupe.value
  if (!t) return undefined
  track(t)
  const portrait = t.get('portrait') as Parse.Object | undefined
  return (portrait?.get('original') as Parse.File | undefined)?.url()
})

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const found = await troupeQuery().get(troupeId.value)
      // The original fetched the portrait pointer before rendering, so the
      // existing image shows rather than a broken one.
      const portrait = found.get('portrait') as Parse.Object | undefined
      if (portrait) await portrait.fetch()
      troupe.value = found
    })
  } catch (err) {
    await reportErrorOn("Couldn't open that troupe")(err).catch(() => {})
  } finally {
    loaded.value = true
  }
})

async function upload() {
  const t = troupe.value
  const file = fileInput.value?.files?.[0]
  if (!t || !file) return

  error.value = ''
  const extension = file.name.split('.').pop() ?? ''

  if (file.size > 1000000) {
    // No `return` -- see the note at the top of this file. The upload proceeds.
    error.value = 'Picture too large. Limit is 1MB'
  }

  try {
    await ui.runWork(async () => {
      const parseFile = new Parse.File('portrait' + extension, file)
      const saved = await parseFile.save()

      const acl = new Parse.ACL()
      acl.setPublicReadAccess(true)
      acl.setPublicWriteAccess(false)
      acl.setRoleReadAccess('LST', true)
      acl.setRoleWriteAccess('LST', true)

      const portrait =
        (t.get('portrait') as Parse.Object | undefined) ?? new Parse.Object('TroupePortrait')
      portrait.setACL(acl)
      portrait.set('original', saved)
      const savedPortrait = await portrait.save()

      t.set('portrait', savedPortrait)
      await t.save()
    })
    error.value = ''
  } catch (err) {
    error.value = (err as Error)?.message ?? String(err)
    console.log(error.value)
  }
}
</script>

<template>
  <JqmPage id="troupe-portrait" title="Profile" :ready="loaded">
    <template v-if="troupe">
      <h1>{{ name }}</h1>
      <img v-if="portraitUrl" :src="portraitUrl" alt="" />
      <form class="portrait-form" @submit.prevent="upload">
        <div v-show="error" class="error">{{ error }}</div>
        <label for="troupe-input-portrait">Portrait</label>
        <input id="troupe-input-portrait" ref="fileInput" type="file" name="input-portrait" />
        <button
          type="submit"
          class="ui-shadow ui-btn ui-corner-all ui-icon-action ui-btn-icon-right update"
        >
          Upload
        </button>
      </form>
    </template>
  </JqmPage>
</template>
