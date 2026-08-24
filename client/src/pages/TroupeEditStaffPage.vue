<script setup lang="ts">
/**
 * Give one user one troupe role -- `#troupe-edit-staff`.
 *
 * A port of `TroupeEditStaffView.js`. Reached only from the user picker at
 * `#troupe/:id/staff/add`, which is why it doubles as the "change someone's
 * role" screen: `#troupe-staff`'s rows are plain text, not links, so re-picking
 * an existing staff member here IS the edit path. The select is pre-set to
 * whichever role they already hold, so opening and saving unchanged is a no-op.
 *
 * ## Read membership from `_Role`, never from a role's `users` relation
 *
 * The source documents this at length and the reason is worth keeping in front
 * of whoever edits this next. Counting each title's `_User` relation is a
 * `_User` find, which is closed now -- but before it was closed it did not
 * fail: a `count()` of rows the caller cannot read returns 0, which reads as
 * "not in this role". The form then showed "Not on Staff" for a real
 * storyteller, and saving it unchanged sent `roles_to_remove` for all three
 * titles and STRIPPED THEM OF EVERY ROLE. Silent, and destructive.
 *
 * Asking `_Role` (world-readable) which of the three named roles contains this
 * user is the same question, of a class the caller can actually read.
 *
 * The title order is fixed rather than resolution-ordered: a user holding two
 * roles in one troupe used to get whichever the promises happened to settle
 * first.
 *
 * ## Submitting always leaves for the troupe
 *
 * `.always(...)` in the source: the redirect fires whether the Cloud call
 * succeeded or failed, which is why `helpers/troupes.js:addStaff` verifies the
 * roster rather than trusting the navigation. Preserved -- a test that stopped
 * seeing the redirect on failure would start passing for the wrong reason.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { TROUPE_TITLE_OPTIONS, troupeQuery, type Troupe } from '@/domain/Troupe'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

const route = useRoute()
const ui = useUiStore()
const usersStore = useUsersStore()

const troupeId = computed(() => route.params.id as string)
const userId = computed(() => route.params.uid as string)

useBackHref(() => `#troupe/${troupeId.value}`)

/** The select's options, in the source's order. `None` is the fourth. */
const ROLE_OPTIONS = [
  { label: 'Lead Storyteller', value: 'LST' },
  { label: 'Assistant Storyteller', value: 'AST' },
  { label: 'Narrator', value: 'Narrator' },
  { label: 'Not on Staff', value: 'None' },
] as const

const troupe = shallowRef<Troupe | null>(null)
const user = shallowRef<Parse.User | null>(null)
const role = ref<string>('None')
/** False until the troupe, the user and the held role are all in hand. */
const loaded = ref(false)

const username = computed(() => (user.value?.get('username') as string) ?? '')
const realname = computed(() => (user.value?.get('realname') as string) ?? '')

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const found = await troupeQuery().include('portrait').get(troupeId.value)
      troupe.value = found

      await usersStore.prime([userId.value])
      user.value = usersStore.get(userId.value) ?? null

      const names = TROUPE_TITLE_OPTIONS.map((title) => title + '_' + found.id)
      const query = new Parse.Query(Parse.Role)
      query.containedIn('name', names)
      // A pointer is enough for `equalTo`; the store's user is one either way.
      query.equalTo('users', Parse.User.createWithoutData(userId.value))
      const held = (await query.find()).map((r) => String(r.get('name')).split('_')[0])

      role.value = TROUPE_TITLE_OPTIONS.find((title) => held.includes(title)) ?? 'None'
    })
  } catch (error) {
    // The source logged and left the form up, including for the array-shaped
    // rejection `Parse.Promise.when` produced.
    const list = Array.isArray(error) ? error : [error]
    for (const e of list) console.log('Something failed' + (e as Error)?.message)
  } finally {
    loaded.value = true
  }
})

async function submit() {
  const t = troupe.value
  if (!t) return

  /*
   * `_.xor(title_options, roles_to_add)`: everything the user is NOT being
   * given is explicitly removed, so this one call also strips a role they held
   * before. Picking "Not on Staff" removes all three.
   */
  const rolesToAdd = role.value === 'None' ? [] : [role.value]
  const rolesToRemove = TROUPE_TITLE_OPTIONS.filter((title) => !rolesToAdd.includes(title))

  try {
    await ui.runWork(() =>
      Parse.Cloud.run('change_troupe_staff', {
        troupe_id: t.id,
        user_to_change_id: userId.value,
        roles_to_add: rolesToAdd,
        roles_to_remove: rolesToRemove,
      }),
    )
  } catch (error) {
    console.log('Something failed' + (error as Error)?.message)
  } finally {
    window.location.hash = `#troupe/${t.id}`
  }
}
</script>

<template>
  <JqmPage id="troupe-edit-staff" title="Edit Staff" :ready="loaded">
    <form id="troupe-edit-staff-form" @submit.prevent="submit">
      <label for="troupe-edit-staff-username">Username</label>
      <!-- Backform's `uneditable-input`: the value, rendered, not an input. -->
      <div id="troupe-edit-staff-username" class="uneditable-input">{{ username }}</div>

      <label for="troupe-edit-staff-realname">Name</label>
      <div id="troupe-edit-staff-realname" class="uneditable-input">{{ realname }}</div>

      <label for="troupe-edit-staff-role">Role</label>
      <div class="ui-select">
        <div class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
          <span>{{ ROLE_OPTIONS.find((o) => o.value === role)?.label }}</span>
          <select id="troupe-edit-staff-role" v-model="role" name="role">
            <option v-for="option in ROLE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
      </div>

      <!-- Backform's `spacer`. -->
      <div class="ui-block-a"></div>

      <button type="submit" class="ui-btn ui-shadow ui-corner-all">Save</button>
    </form>
  </JqmPage>
</template>
