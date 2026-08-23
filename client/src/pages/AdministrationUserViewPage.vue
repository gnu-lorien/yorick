<script setup lang="ts">
/**
 * One user, as an administrator sees them -- `#administration-user-view`.
 *
 * A port of `AdministrationUserView.js`, a five-region layout: reset password,
 * patronages, profile, and the roles they hold. Every region id is preserved
 * (`#reset-password-view`, `#abs-form`, `#patronage-list-region`,
 * `#patronage-new-for-user-button`, `#administration-user-roles-available`)
 * because the E2E suite reads them.
 *
 * ## Administrator is a ROLE, not a checkbox
 *
 * The `admininterface` field on `_User` is a UI cache the browser writes onto
 * the user's own row, and `_User` grants update to `*` -- so a player can set it
 * on themselves. It decides nothing. The authority is membership of the
 * `Administrator` role, which is what this screen reads on open and writes on
 * submit: `role.getUsers().add(user)` or `.remove(user)`, then `role.save()`.
 *
 * The checkbox is therefore seeded from a role COUNT, not from the stored flag.
 *
 * ## Resetting a password without seeing an address
 *
 * R51: this used to read `user.get("email")` and hand it to
 * `Parse.User.requestPasswordReset`. Parse never returns another user's email to
 * a client -- it is private to that user -- so the address was always empty and
 * the call failed with "you must provide an email". An administrator does not
 * need to see the address to reset it; `request_password_reset_for` looks it up
 * under the master key.
 *
 * That is also why the profile fields below are read-only here. The identity
 * projection deliberately withholds `email`, so this screen cannot show or edit
 * one; the only thing an administrator actually changes is the role.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmCheckbox, JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { getUsersById, requestPasswordResetFor, type IdentityUser } from '@/domain/cloud'
import { reportErrorOn } from '@/domain/errors'
import { fetchPatronages, type Patronage } from '@/domain/Patronage'
import PatronageRows from '@/components/PatronageRows.vue'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const userId = computed(() => route.params.id as string)
useBackHref('#administration/users/all')

const user = shallowRef<IdentityUser | null>(null)
const roles = shallowRef<Parse.Role[]>([])
const patronages = shallowRef<Patronage[]>([])

/** Seeded from role membership, not from the cached `admininterface` flag. */
const isAdministrator = ref(false)

const resetMessage = ref('')
const resetBusy = ref(false)
const submitStatus = ref<'idle' | 'success' | 'error'>('idle')
const submitMessage = ref('')

/** False until the page's data is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

const username = computed(() => (user.value?.get('username') as string) ?? '')
const realname = computed(() => (user.value?.get('realname') as string) ?? '')
const massmail = computed(() => !!user.value?.get('massmailauthorization'))
const acceptedTos = computed(() => !!user.value?.get('acceptedtos'))

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const payload = await getUsersById([userId.value])
      const found = payload.users[0]
      if (!found) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'That account is not available to you.')
      }
      user.value = found

      // Ask `_Role` which roles contain this user, never the other way round: a
      // relation query IS a `_User` find, which is closed, and it was an N+1
      // besides -- one sub-query per role in the entire system.
      const roleQuery = new Parse.Query(Parse.Role).equalTo('users', found)
      const held: Parse.Role[] = []
      await roleQuery.each((role) => {
        held.push(role as Parse.Role)
      })
      roles.value = held
      isAdministrator.value = held.some(
        (r) => r.get('name') === 'Administrator' || r.get('name') === 'SiteAdministrator',
      )

      const all = await fetchPatronages()
      patronages.value = all.filter(
        (p) => (p.get('owner') as { id?: string } | undefined)?.id === userId.value,
      )
    })
  } catch (error) {
    await reportErrorOn("Couldn't open that account")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})

async function submitProfile() {
  const u = user.value
  if (!u) return
  submitStatus.value = 'idle'
  submitMessage.value = ''
  try {
    await ui.runWork(async () => {
      const role = await new Parse.Query(Parse.Role).equalTo('name', 'Administrator').first()
      if (!role) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'There is no Administrator role.')
      }
      if (isAdministrator.value) role.getUsers().add(u as unknown as Parse.User)
      else role.getUsers().remove(u as unknown as Parse.User)
      await role.save()
    })
    submitStatus.value = 'success'
    submitMessage.value = isAdministrator.value
      ? 'Made them an admin!'
      : 'Removed their admin privileges!'
  } catch (error) {
    submitStatus.value = 'error'
    submitMessage.value = (error as Error)?.message ?? String(error)
  }
}

async function resetPassword() {
  const u = user.value
  if (!u || !u.id) return
  resetBusy.value = true
  try {
    await ui.runWork(() => requestPasswordResetFor(u.id as string))
    resetMessage.value = 'Password Reset Email Sent'
  } catch (error) {
    resetMessage.value = (error as Error)?.message ?? String(error)
  } finally {
    resetBusy.value = false
  }
}
</script>

<template>
  <JqmPage id="administration-user-view" title="User View" :ready="loaded">
    <div class="ui-body ui-body-a ui-corner-all">
      <h3>Reset Password</h3>
      <div id="reset-password-view">
        <button class="ui-btn ui-shadow ui-corner-all" :disabled="resetBusy" @click="resetPassword">
          Reset Password
        </button>
        <p class="message">{{ resetMessage }}</p>
      </div>
    </div>

    <hr />

    <div class="ui-body ui-body-a ui-corner-all">
      <h3>Patronage</h3>
      <div id="patronage-new-for-user-button">
        <a class="ui-btn ui-shadow ui-corner-all" :href="`#administration/patronages/new/${userId}`">
          New Patronage
        </a>
      </div>
      <!--
        This user's patronages, filtered in memory.

        The ROUTE did this, not the view: `administration_user` fetched every
        patronage and reset the child collection with
        `_.select(patronages.models, "attributes.owner.id", id)`. The view on its
        own only ever rendered an empty list, which is why reading the view
        alone makes this region look dead.
      -->
      <form class="ui-filterable">
        <input id="patronage-list-filter" data-type="search" />
      </form>
      <div id="patronage-list-region">
        <ul
          id="patronage-list"
          data-role="listview"
          data-inset="true"
          class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
        >
          <PatronageRows
            :patronages="patronages"
            :href-for="(id) => `#administration/patronage/${id}`"
          />
        </ul>
      </div>
    </div>

    <hr />

    <div class="ui-body ui-body-a ui-corner-all">
      <h3>Profile</h3>
      <form id="abs-form" class="backform form-horizontal" @submit.prevent="submitProfile">
        <label>Real Name</label>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input type="text" name="realname" :value="realname" readonly />
        </div>

        <label>User Name</label>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input type="text" name="username" :value="username" readonly />
        </div>

        <JqmCheckbox
          id="massmailauthorization"
          :model-value="massmail"
          name="massmailauthorization"
          disabled
        >
          I authorize Underground Theater to contact me using this email address
        </JqmCheckbox>

        <JqmCheckbox id="acceptedtos" :model-value="acceptedTos" name="acceptedtos" disabled>
          Participation in Underground Theater requires agreeing to the rules and regulations set
          forth by the organization and its board of directors.
        </JqmCheckbox>

        <JqmCheckbox id="admininterface" v-model="isAdministrator" name="admininterface">
          Administrator
        </JqmCheckbox>

        <!--
          Backform's `ButtonControl`: `button[name=submit]` with a sibling
          `span.status` carrying `text-success` / `text-danger`. That is the
          only feedback this form gives -- the submit handler writes the ROLE's
          `users` relation and never touches the user row -- so the message is
          how an administrator knows whether the privilege actually moved.
          `access-control.spec.js:387` reads both the text and the class.
        -->
        <div class="form-group submit">
          <label class="control-label">&nbsp;</label>
          <div class="controls">
            <button id="submit" type="submit" name="submit" class="btn">Update</button>
            <span
              class="status"
              :class="
                submitStatus === 'error'
                  ? 'text-danger'
                  : submitStatus === 'success'
                    ? 'text-success'
                    : ''
              "
              >{{ submitMessage }}</span
            >
          </div>
        </div>
      </form>
    </div>

    <div class="ui-body ui-body-a ui-corner-all">
      <h3>Roles</h3>
      <div id="administration-user-roles-available">
        <div v-for="role in roles" :key="role.id">The one: {{ role.get('name') }}</div>
      </div>
    </div>
  </JqmPage>
</template>
