<script setup lang="ts">
/**
 * The signed-in member's own profile -- `#user-settings-profile`.
 *
 * A port of `UserSettingsProfileView.js` and
 * `templates/user-settings-profile.html`. Four regions: the profile form, the
 * PayPal donate button with the member's patronages, and the roles they hold.
 * Every region id is preserved because the E2E suite reads them.
 *
 * Unlike the administration user screen, the fields here are EDITABLE: this is
 * the member's own `_User` row, which they can write.
 *
 * ## The PayPal button is the money loop
 *
 * This form is the only place real money touches the app, and it is a complete
 * loop worth naming because nothing else in the codebase describes it:
 *
 *   PayPal hosted button (`custom` = this user's objectId)
 *     -> PayPal posts to `/deez` (index.js)
 *     -> a `PaymentPaypal` row is written
 *     -> its afterSave mints a `Patronage` with an `expiresOn`
 *     -> `get_my_patronage_status` reads it
 *     -> the referendum ballot refuses to render options for a non-patron.
 *
 * So donating is what buys a vote. Porting this page without the button would
 * silently kill the project's revenue; porting the referendum page without the
 * patronage gate would hand every user a ballot.
 *
 * The button posts directly to PayPal as a plain HTML form, exactly as before.
 * The hosted button id is the production one, and `custom` carries the objectId
 * that `/deez` uses to attribute the payment -- get that wrong and a donation
 * lands with no owner.
 *
 * ## No Facebook region
 *
 * The template has a "Facebook" section between Profile and Patronage. Facebook
 * login was deleted, not migrated -- the owner's call -- so the section is gone
 * with it rather than rendered empty.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { JqmCheckbox, JqmPage } from '@/components/jqm'
import PatronageRows from '@/components/PatronageRows.vue'
import { useBackHref } from '@/composables/useBackHref'
import { patronageQuery, sortPatronages, type Patronage } from '@/domain/Patronage'
import { reportErrorOn } from '@/domain/errors'
import Parse from '@/parse'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

const ui = useUiStore()
const auth = useAuthStore()
const usersStore = useUsersStore()

useBackHref('#')

/** The production hosted button. The sandbox one is C3TQYLTCFHW5J. */
const PAYPAL_HOSTED_BUTTON_ID = 'N54QYTKNK9GUL'

const roles = shallowRef<Parse.Role[]>([])
const patronages = shallowRef<Patronage[]>([])
/** False until the page's data is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

const realname = ref('')
const email = ref('')
const username = ref('')
const massmail = ref(false)
const acceptedTos = ref(false)

const status = ref<'idle' | 'success' | 'error'>('idle')
const message = ref('')
const dirty = ref(false)

const userId = computed(() => Parse.User.current()?.id ?? '')

onMounted(async () => {
  const current = Parse.User.current()
  if (!current) return
  realname.value = (current.get('realname') as string) ?? ''
  email.value = (current.get('email') as string) ?? ''
  username.value = (current.get('username') as string) ?? ''
  massmail.value = !!current.get('massmailauthorization')
  acceptedTos.value = !!current.get('acceptedtos')

  try {
    await ui.runWork(async () => {
      // Ask `_Role` which roles contain this user; a relation query IS a
      // `_User` find, which is closed, and it was an N+1 besides.
      const held: Parse.Role[] = []
      await new Parse.Query(Parse.Role).equalTo('users', current).each((role) => {
        held.push(role as Parse.Role)
      })
      roles.value = held

      const mine = patronageQuery().equalTo('owner', current)
      const found: Patronage[] = []
      await mine.each((p) => {
        found.push(p)
      })
      // The rows print an owner; priming the registry means the member's own
      // name resolves rather than reading "User object missing" on their own
      // page. `Parse.User.current()` answers for themselves at no cost.
      await usersStore.prime(found.map((p) => (p.get('owner') as { id?: string })?.id))
      patronages.value = sortPatronages(found)
    })
  } catch (error) {
    await reportErrorOn("Couldn't load your profile")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})

function touch() {
  dirty.value = true
  if (status.value === 'success') {
    status.value = 'idle'
    message.value = ''
  }
}

async function submit() {
  const current = Parse.User.current()
  if (!current) return
  try {
    await ui.runWork(async () => {
      current.set('realname', realname.value)
      current.set('email', email.value)
      current.set('username', username.value)
      current.set('massmailauthorization', massmail.value)
      current.set('acceptedtos', acceptedTos.value)
      await current.save()
    })
    auth.bump()
    status.value = 'success'
    message.value = 'Successfully Updated'
    dirty.value = false
  } catch (error) {
    status.value = 'error'
    message.value = (error as Error)?.message ?? String(error)
  }
}
</script>

<template>
  <JqmPage id="user-settings-profile" title="Profile" :ready="loaded">
    <div class="ui-body ui-body-a ui-corner-all">
      <h3>Profile</h3>
      <form id="user-settings-profile-abs-form" @submit.prevent="submit">
        <label for="usp-realname">Real Name</label>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input id="usp-realname" v-model="realname" type="text" name="realname" @input="touch" />
        </div>

        <label for="usp-email">Email</label>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input id="usp-email" v-model="email" type="email" name="email" @input="touch" />
        </div>

        <label for="usp-username">User Name</label>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input id="usp-username" v-model="username" type="text" name="username" @input="touch" />
        </div>

        <JqmCheckbox
          id="usp-massmailauthorization"
          v-model="massmail"
          name="massmailauthorization"
          @update:model-value="touch"
        >
          I authorize Underground Theater to contact me using this email address
        </JqmCheckbox>

        <JqmCheckbox
          id="usp-acceptedtos"
          v-model="acceptedTos"
          name="acceptedtos"
          @update:model-value="touch"
        >
          Participation in Underground Theater requires agreeing to the rules and regulations set
          forth by the organization and its board of directors. I agree to adhere to the rules and
          regulations of Underground Theater and its board of directors. I also acknowledge that I
          have read and agree to the rules and procedures set forth in the Patron Handbook.
        </JqmCheckbox>

        <button
          id="submit"
          name="submit"
          type="submit"
          class="ui-btn ui-shadow ui-corner-all"
          :disabled="!dirty"
        >
          Update
        </button>
        <p v-if="message" :class="status === 'error' ? 'error' : 'success'">{{ message }}</p>
      </form>
    </div>

    <hr />

    <div class="ui-body ui-body-a ui-corner-all">
      <h3>Patronage</h3>
      <div id="usp-paypal-button">
        <form action="https://www.paypal.com/cgi-bin/webscr" method="post" target="_top">
          <input type="hidden" name="cmd" value="_s-xclick" />
          <input type="hidden" name="hosted_button_id" :value="PAYPAL_HOSTED_BUTTON_ID" />
          <!-- `custom` is how `/deez` attributes the payment to an account. -->
          <input type="hidden" name="custom" :value="userId" />
          <input
            type="image"
            src="https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif"
            border="0"
            name="submit"
            alt="PayPal - The safer, easier way to pay online!"
          />
          <img
            alt=""
            border="0"
            src="https://www.paypalobjects.com/en_US/i/scr/pixel.gif"
            width="1"
            height="1"
          />
        </form>
      </div>
      <form class="ui-filterable">
        <input id="usp-patronage-list-filter" data-type="search" />
      </form>
      <div id="usp-patronage-list-region">
        <ul
          id="usp-patronage-list"
          data-role="listview"
          data-inset="true"
          class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
        >
          <!--
            R46: these rows used to link to `#profile/<patronageId>`, and no such
            route exists -- the router only defines `patronage/:id`. Every row
            here was a dead link.
          -->
          <PatronageRows :patronages="patronages" :href-for="(id) => `#patronage/${id}`" />
        </ul>
      </div>
    </div>

    <hr />

    <div class="ui-body ui-body-a ui-corner-all">
      <h3>Roles</h3>
      <div id="user-roles-available">
        <div v-for="role in roles" :key="role.id">The one: {{ role.get('name') }}</div>
      </div>
    </div>
  </JqmPage>
</template>
