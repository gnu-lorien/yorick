<script setup lang="ts">
/**
 * A troupe's own page -- `#troupe`.
 *
 * A port of `TroupeView.js`, `templates/troupe.html`,
 * `templates/troupe-staff-list.html` and
 * `templates/troupe-portrait-display.html`.
 *
 * Three routes render it: `#troupe/:id`, and the two character-scoped ones
 * (`#character/:cid/troupe/:tid/show` and `.../join`) that act on membership
 * first and then show the troupe. `.../leave` is NOT one of them: it goes back
 * to the character instead, which is right, because after leaving this page
 * would be showing a troupe the character is no longer in.
 *
 * The character-scoped routes are read-only -- the source constructed the view
 * with no `writable` argument, so `!!undefined` -- and their back button goes to
 * the character, not the directory.
 *
 * ## `writable` is the storyteller flag, not the troupe's ACL
 *
 * `is_st || is_ad` off the current `_User`. It gates the four navigation
 * buttons, the Update button and Add New Staff Member -- but NOT the form
 * fields, which the source left editable for everyone and simply gave no way to
 * submit. Reproduced: a member who opens a troupe can type in the boxes and
 * nothing they type can reach the server, because `save` is only reachable
 * through a button that is not rendered. `troupes.spec.js:747` asserts the
 * buttons' absence, so hiding more than the source hid would fail it.
 *
 * ## Why the staff list keeps its previous content while reloading
 *
 * `TroupeView.render` went to unusual lengths to carry `#troupe-staff` and
 * `#troupe-portrait-display` across a re-render, and the comments there explain
 * why: the regions are filled a round trip after the page goes live, so
 * blanking them first put a troupe on screen with no staff and no sign that
 * more was coming -- for up to 64ms, which is long enough for a test or a
 * person to conclude the troupe has no staff.
 *
 * Vue makes that free. The refs simply keep their last value until the new one
 * arrives, so a region only ever shows the old answer or the new one. The
 * `ready` gate on `JqmPage` closes the same window for the FIRST load, which is
 * what the router's `register()`-then-`changePage` ordering was reaching for.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { getTroupeStaff, troupeQuery, type Troupe, type TroupeStaffMember } from '@/domain/Troupe'
import { reportErrorOn } from '@/domain/errors'
import { get_character } from '@/domain/Character'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const handler = computed(() => route.meta.handler as string)
/** The three character-scoped routes carry `:cid`; `#troupe/:id` does not. */
const cid = computed(() => (route.params.cid as string | undefined) ?? '')
const troupeId = computed(() => (route.params.tid ?? route.params.id) as string)

useBackHref(() => (cid.value ? `#character?${cid.value}` : '#troupes'))

const troupe = shallowRef<Troupe | null>(null)
const staff = shallowRef<TroupeStaffMember[]>([])
const portraitUrl = ref('')
/** False until the troupe itself is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

/** `is_st || is_ad`, off the signed-in user. */
const writable = computed(() => {
  if (cid.value) return false
  const user = Parse.User.current()
  return !!(user?.get('storytellerinterface') || user?.get('admininterface'))
})

/** `forms/TroupeForm.js`, the same eight fields as the new-troupe form. */
const TEXT_FIELDS = [
  { name: 'name', label: 'Name' },
  { name: 'shortname', label: 'Short Name' },
  { name: 'shortdescription', label: 'Short Public Description' },
  { name: 'location', label: 'Location' },
  { name: 'boundaries', label: 'Troupe Boundaries' },
  { name: 'staffemail', label: 'Staff Email Address' },
] as const

const AREA_FIELDS = [
  { name: 'description', label: 'Long Public Description' },
  { name: 'proxypolicy', label: 'Policies for Proxied Characters' },
] as const

const values = ref<Record<string, string>>({})

function loadValues(t: Troupe) {
  const next: Record<string, string> = {}
  for (const field of [...TEXT_FIELDS, ...AREA_FIELDS]) {
    next[field.name] = (t.get(field.name) as string) ?? ''
  }
  values.value = next
}

/**
 * `get_staff()` reaches a Cloud function and is allowed to fail without taking
 * the page down -- `TroupeView.render` swallowed a rejection in either region
 * precisely so `rendered` could not hang. The portrait is the same.
 */
async function loadRegions(t: Troupe) {
  await Promise.allSettled([
    getTroupeStaff(t).then((users) => {
      staff.value = users
    }),
    (async () => {
      const portrait = t.get('portrait') as Parse.Object | undefined
      if (!portrait) {
        portraitUrl.value = ''
        return
      }
      await portrait.fetch()
      portraitUrl.value = (portrait.get('original') as Parse.File | undefined)?.url() ?? ''
    })(),
  ])
}

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      /*
       * Join first, then show. `character_join_troupe` does its work before
       * rendering, and sends the user back to the character on failure rather
       * than showing a troupe whose roster does not reflect what they asked
       * for. Its sibling `leave` is an action route, not this page -- see
       * `CharacterLeaveTroupeAction.vue` for why the two differ.
       */
      if (handler.value === 'character_join_troupe') {
        const character = await get_character(cid.value)
        const target = await troupeQuery().get(troupeId.value)
        await character.join_troupe(target)
      }

      const found = await troupeQuery().get(troupeId.value)
      troupe.value = found
      loadValues(found)
      await loadRegions(found)
    })
  } catch (error) {
    if (cid.value) {
      window.location.hash = `#character?${cid.value}`
      return
    }
    await reportErrorOn("Couldn't open that troupe")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})

async function submit() {
  const t = troupe.value
  if (!t) return
  try {
    await ui.runWork(async () => {
      for (const [key, value] of Object.entries(values.value)) t.set(key, value)
      await t.save()
      await loadRegions(t)
    })
  } catch (error) {
    // The source's branch: log it and leave for the admin screen.
    console.log('Failed to save troupe ' + (error as Error)?.message)
    window.location.hash = '#administration'
  }
}
</script>

<template>
  <JqmPage id="troupe" title="Troupe" :ready="loaded">
    <div id="troupe-portrait-display">
      <a v-if="troupe" :href="`#troupe/${troupe.id}/portrait`">
        <img v-if="portraitUrl" :src="portraitUrl" alt="" />
        <template v-else>Add Portrait</template>
      </a>
    </div>

    <template v-if="writable && troupe">
      <a class="troupe-view-characters ui-btn" :href="`#troupe/${troupe.id}/characters/all`">View Characters</a>
      <a class="troupe-view-character-relationships ui-btn" :href="`#troupe/${troupe.id}/characters/relationships/network`">View Character Relationships</a>
      <a class="troupe-view-summarize-characters ui-btn" :href="`#troupe/${troupe.id}/characters/summarize/all`">Summarize Characters</a>
      <a class="troupe-view-print-characters ui-btn" :href="`#troupe/${troupe.id}/characters/selecttoprint/all`">Print Characters</a>
    </template>

    <div class="ui-grid-a ui-responsive">
      <div class="ui-block-a">
        <h1>Troupe</h1>
        <form id="troupe-data" @submit.prevent="submit">
          <template v-for="field in TEXT_FIELDS" :key="field.name">
            <label :for="`troupe-data-${field.name}`">{{ field.label }}</label>
            <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
              <input
                :id="`troupe-data-${field.name}`"
                v-model="values[field.name]"
                type="text"
                :name="field.name"
              />
            </div>
          </template>

          <div class="ui-block-a"></div>

          <template v-for="field in AREA_FIELDS" :key="field.name">
            <label :for="`troupe-data-${field.name}`">{{ field.label }}</label>
            <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
              <textarea
                :id="`troupe-data-${field.name}`"
                v-model="values[field.name]"
                :name="field.name"
                rows="5"
              ></textarea>
            </div>
          </template>

          <button v-if="writable" type="submit" class="ui-btn ui-shadow ui-corner-all">Update</button>
        </form>
      </div>

      <div class="ui-block-b">
        <h1>Staff</h1>
        <div id="troupe-staff">
          <ul>
            <li v-for="(user, i) in staff" :key="user.id ?? i">
              {{ user.get('role') }}: {{ user.get('username') }} {{ user.get('email') }}
              {{ user.get('realname') }}
            </li>
          </ul>
        </div>
        <a
          v-if="writable && troupe"
          class="troupe-add-staff ui-btn"
          :href="`#troupe/${troupe.id}/staff/add`"
        >Add New Staff Member</a>
      </div>
    </div>
  </JqmPage>
</template>
