<script setup lang="ts">
/**
 * One patronage, new or existing -- `#administration-patronage-view`.
 *
 * A port of `PatronageView.js`. Three routes render it:
 * `#administration/patronage/:id` edits an existing record, and
 * `#administration/patronages/new` (optionally `/:userid`) creates one with the
 * owner pre-selected.
 *
 * ## This form mints access, which is why the ACL is stamped here
 *
 * A `Patronage` with a future `expiresOn` is what makes someone a patron, and
 * being a patron is what lets them vote in a referendum. So this screen hands
 * out the franchise. The record is stamped world-readable and
 * Administrator-write on every save -- an administrator granting one must not
 * be able to leave it writable by the person it benefits.
 *
 * ## Dates are `MM/DD/YYYY` text, not `<input type="date">`
 *
 * Backform's `datepicker` control is a text input driven by
 * bootstrap-datepicker, and the E2E suite types `MM/DD/YYYY` into it
 * (`admin-patronage.spec.js:247`). A native date input rejects that outright.
 * The picker widget itself is not reproduced: it is a calendar popup over a
 * field that already accepts typing, and the field is what carries the value.
 *
 * ## Delete exists, and it did not used to
 *
 * There was no way to remove a patronage anywhere in this application -- no
 * button, no row control, no route -- so a record created by mistake could only
 * be removed with direct database access. The button renders for an existing
 * record only, because the "new" route reuses this view with an unsaved model.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { listUsers, type IdentityUser } from '@/domain/cloud'
import { clearError, reportErrorOn } from '@/domain/errors'
import { patronageQuery, type Patronage } from '@/domain/Patronage'
import { PatronageObject } from '@/parse/classes'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const patronageId = computed(() => route.params.id as string | undefined)
const presetOwnerId = computed(() => route.params.userid as string | undefined)
const isNew = computed(() => route.meta.handler === 'administration_patronage_new')

useBackHref('#administration/patronages')

const patronage = shallowRef<Patronage | null>(null)
const users = shallowRef<IdentityUser[]>([])
/** False until the record and the owner list are in hand. */
const loaded = ref(false)

const owner = ref('')
const paidOn = ref('')
const expiresOn = ref('')
const status = ref<'' | 'success' | 'error'>('')
const message = ref('')

/** `moment(d).format('MM/DD/YYYY')`. */
function formatDate(value: unknown): string {
  if (!(value instanceof Date)) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(value.getMonth() + 1)}/${pad(value.getDate())}/${value.getFullYear()}`
}

/** `moment(text, 'MM/DD/YYYY').toDate()`, or an Invalid Date. */
function parseDate(text: string): Date {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim())
  if (!match) return new Date(Number.NaN)
  return new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]))
}

/**
 * The owner options, with "Invalid" first.
 *
 * `unshift({label: "Invalid", value: ""})` is the source's, and it is what an
 * unowned patronage displays as rather than showing a blank select.
 *
 * The source's label was `username realname email`. There is no `email` here
 * and there must not be: `IdentityAttributes` mirrors what the server will
 * release, parse-server withholds `email` from every non-master read on its
 * own, and the Cloud functions that build these users read under the master key
 * -- so putting it back would be an expansion of what the app exposes dressed
 * up as a migration. See the note on `IdentityAttributes` in `@/domain/cloud`.
 */
const ownerOptions = computed(() => [
  { label: 'Invalid', value: '' },
  ...users.value.map((u) => ({
    label: `${u.get('username') ?? ''} ${u.get('realname') ?? ''}`.trim(),
    value: u.id as string,
  })),
])

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const [found, listed] = await Promise.all([
        isNew.value
          ? Promise.resolve(new PatronageObject() as Patronage)
          : patronageQuery().get(patronageId.value as string),
        listUsers(),
      ])
      patronage.value = found
      users.value = listed.users

      const existingOwner = found.get('owner') as { id?: string } | undefined
      owner.value = existingOwner?.id ?? presetOwnerId.value ?? ''
      paidOn.value = formatDate(found.get('paidOn'))
      expiresOn.value = formatDate(found.get('expiresOn'))
    })
  } catch (error) {
    await reportErrorOn("Couldn't open that patronage")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})

async function submit() {
  const p = patronage.value
  if (!p) return
  status.value = ''
  message.value = ''
  try {
    await ui.runWork(async () => {
      p.set('paidOn', parseDate(paidOn.value))
      p.set('expiresOn', parseDate(expiresOn.value))
      p.set('owner', Parse.User.createWithoutData(owner.value))

      const acl = new Parse.ACL()
      acl.setPublicReadAccess(true)
      acl.setPublicWriteAccess(false)
      acl.setRoleReadAccess('Administrator', true)
      acl.setRoleWriteAccess('Administrator', true)
      p.setACL(acl)

      await p.save()
    })
    status.value = 'success'
    message.value = 'Save completed'
  } catch (error) {
    // The source put the failure on the OWNER field's error, not the button's.
    status.value = 'error'
    message.value = (error as Error)?.message ?? String(error)
  }
}

async function remove() {
  const p = patronage.value
  if (!p || isNew.value || !p.id) return
  try {
    await ui.runWork(() => p.destroy())
    clearError()
    window.location.hash = '#administration/patronages'
  } catch (error) {
    await reportErrorOn("Couldn't delete this patronage")(error).catch(() => {})
  }
}
</script>

<template>
  <JqmPage id="administration-patronage-view" title="Patronage" :ready="loaded">
    <!-- Backform's markup; see the note in `CharacterRenamePage.vue`. -->
    <form class="backform form-horizontal" @submit.prevent="submit">
      <div class="form-group owner">
        <label class="control-label" for="patronage-owner">Owner</label>
        <div class="controls">
          <select id="patronage-owner" v-model="owner" class="form-control" name="owner">
            <option v-for="option in ownerOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
      </div>

      <div class="form-group paidOn">
        <label class="control-label" for="patronage-paid-on">Paid on</label>
        <div class="controls">
          <input
            id="patronage-paid-on"
            v-model="paidOn"
            class="form-control"
            type="text"
            name="paidOn"
          />
        </div>
      </div>

      <div class="form-group expiresOn">
        <label class="control-label" for="patronage-expires-on">Expires on</label>
        <div class="controls">
          <input
            id="patronage-expires-on"
            v-model="expiresOn"
            class="form-control"
            type="text"
            name="expiresOn"
          />
        </div>
      </div>

      <div class="form-group submit">
        <label class="control-label">&nbsp;</label>
        <div class="controls">
          <button type="submit" name="submit" class="btn">Save Changes</button>
          <span
            class="status"
            :class="status === 'error' ? 'text-danger' : status === 'success' ? 'text-success' : ''"
            >{{ message }}</span
          >
        </div>
      </div>

      <button
        v-if="!isNew && patronage?.id"
        type="button"
        class="patronage-delete ui-btn ui-btn-b ui-icon-delete ui-btn-icon-left"
        @click="remove"
      >
        Delete Patronage
      </button>
    </form>
  </JqmPage>
</template>
