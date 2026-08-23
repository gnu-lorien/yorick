<script setup lang="ts">
/**
 * Request a password-reset email -- a port of `PasswordReset.js`.
 *
 * ## A deliberate deviation, and why
 *
 * The original cannot work as written, and this is the one place in the port
 * where behaviour is deliberately NOT reproduced:
 *
 *     Parse.User.requestPasswordReset(email, function () {...}, function (error) {...})
 *       .always(function () {...})
 *
 * Parse SDK 3.0 removed the `{success, error}` callback pair; under parse@8 the
 * second argument is an options bag, so both functions are ignored, and the
 * returned value is a native promise with no `.always`, so the chained call
 * raises `TypeError: .always is not a function` before the request is even
 * awaited. This is the same defect that was found and fixed in `LoginView.js`
 * -- the comment there records it -- and it was never fixed here.
 *
 * Porting that faithfully would mean porting a crash, so this uses promises.
 * The user-visible behaviour is what the original was written to produce: the
 * button reports "Password Reset Email Sent" on success and the server's own
 * message on failure.
 *
 * Whether the email actually arrives is a deployment question, not a code one:
 * `index.js` picks the adapter named by `MAIL_ADAPTER_MODULE` and otherwise
 * falls back to `cloud/MemoryEmailAdapter.js`, which captures mail in memory
 * and sends nothing. The reset link's address comes from `publicServerURL`.
 *
 * Backform is not ported. It generated this two-field form from a `fields`
 * array; two fields of plain markup is smaller than the generator, and
 * Backform's own quirk -- controls copy their DOM value into the model only on
 * `change`, which is why `fillBackformInput` in the E2E helpers dispatches one
 * by hand -- disappears with it.
 */
import { ref } from 'vue'
import { JqmPage } from '@/components/jqm'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

const email = ref('')
const status = ref<'idle' | 'success' | 'error'>('idle')
const message = ref('')
const busy = ref(false)

async function requestReset() {
  busy.value = true
  status.value = 'idle'
  message.value = ''
  try {
    await ui.runWork(() => Parse.User.requestPasswordReset(email.value))
    status.value = 'success'
    message.value = 'Password Reset Email Sent'
  } catch (e) {
    status.value = 'error'
    message.value = (e as Error)?.message || String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <JqmPage id="user-reset-password" title="Reset Password">
    <form class="profile-form" @submit.prevent="requestReset">
      <label for="email">Email Address for the Account</label>
      <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
        <input id="email" v-model="email" type="email" name="email" />
      </div>
      <button
        id="reset"
        type="submit"
        class="ui-btn ui-shadow ui-corner-all reset-user-password"
        :disabled="busy"
      >
        Reset Password
      </button>
      <p v-if="message" :class="status === 'error' ? 'error' : 'success'">{{ message }}</p>
    </form>
  </JqmPage>
</template>
