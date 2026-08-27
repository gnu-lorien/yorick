<script setup lang="ts">
/**
 * Upload a character portrait -- `#character-portrait`.
 *
 * A port of `CharacterPortraitView.js` and the `#characterPortraitView` template
 * at `public/index.html:1013`.
 *
 * ## What happens on the server
 *
 * The upload is only half the story. `cloud/main.js`'s `beforeSave` on
 * `CharacterPortrait` fetches the uploaded file BACK over HTTP from
 * `publicServerURL`, centre-crops it and writes four derived thumbnail files
 * with the master key. If that address is wrong the fetch fails and the save is
 * refused outright -- no portrait at all -- and each attempt leaves an abandoned
 * file in the database that nothing cleans up. A portrait upload failing with an
 * opaque error is almost always that, not this page.
 *
 * ## The ACL, and the deliberate public read
 *
 * The portrait row is stamped with the character's own ACL plus
 * `setPublicReadAccess(true)`. That is intentional -- a portrait is shown on
 * troupe rosters to people who cannot read the character -- and it is why the
 * ACL is built through `acl_for_me()`, which cannot be called before troupe
 * membership has been read.
 *
 * ## A defect reproduced on purpose
 *
 * The 1 MB size check displays an error and then uploads anyway: the original
 * has no `return` after showing the message (`CharacterPortraitView.js:46-48`).
 * Reproduced rather than fixed, because fixing it changes what the app accepts
 * and that is a product decision, not a porting one. It is called out here so
 * the next person does not have to rediscover it.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import Parse from '@/parse'
import { track } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

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
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const name = computed(() => (character.value ? (track(character.value).get('name') as string) : ''))

const portraitUrl = computed(() => {
  const c = character.value
  if (!c) return undefined
  track(c)
  const portrait = c.get('portrait') as Parse.Object | undefined
  return (portrait?.get('original') as Parse.File | undefined)?.url()
})

onMounted(async () => {
  try {
    const c = await ui.runWork(() => get_character(cid.value))
    // The original fetched the portrait pointer before rendering, so the
    // existing image shows rather than a broken one.
    const portrait = c.get('portrait') as Parse.Object | undefined
    if (portrait) await portrait.fetch()
    character.value = c
  } catch (err) {
    await reportErrorOn("Couldn't open the character")(err).catch(() => {})
  }
})

async function upload() {
  const c = character.value
  const file = fileInput.value?.files?.[0]
  if (!c || !file) return

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

      const acl = await c.acl_for_me()
      acl.setPublicReadAccess(true)

      const portrait =
        (c.get('portrait') as Parse.Object | undefined) ?? new Parse.Object('CharacterPortrait')
      portrait.setACL(acl)
      portrait.set('original', saved)
      const savedPortrait = await portrait.save()

      c.set('portrait', savedPortrait)
      await c.save()
    })
    error.value = ''
  } catch (err) {
    error.value = (err as Error)?.message ?? String(err)
    console.log(error.value)
  }
}
</script>

<template>
  <JqmPage id="character-portrait" title="Profile">
    <template v-if="character">
      <h1>{{ name }}</h1>
      <img v-if="portraitUrl" :src="portraitUrl" alt="" />
      <form class="portrait-form" @submit.prevent="upload">
        <div v-if="error" class="error">{{ error }}</div>
        <label for="input-portrait">Portrait</label>
        <input id="input-portrait" ref="fileInput" type="file" name="input-portrait" />
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
