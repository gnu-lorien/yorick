<script setup lang="ts">
/**
 * The sign-up form -- a port of `SignupView.js` and the `#signup-template`
 * block at `public/index.html:816`.
 *
 * Same two behaviours as the login page, for the same reasons: promises rather
 * than the `{success, error}` callbacks Parse SDK 3.0 removed (under parse@8
 * the third argument is an options bag, so `success` was silently ignored and
 * the page never reloaded after a successful signup), and a full reload on
 * success because that is the app's only way to re-render everything that
 * depends on who is signed in.
 *
 * `#signup-with-facebook` is not ported. Facebook login was the owner's call to
 * delete, and the button was already inert -- `loadall.js` stopped calling
 * `hello.init()` because it threw under parse@8 and took the whole bootstrap
 * with it.
 *
 * The route was reachable signed out and bounced an already-authenticated
 * visitor back to the front page; that is a router guard now.
 */
import { onMounted, ref } from 'vue'
import { JqmPage } from '@/components/jqm'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

onMounted(() => {
  if (auth.isLoggedIn) window.location.hash = ''
})

async function signUp() {
  error.value = ''
  busy.value = true
  try {
    await auth.signUp(username.value, password.value)
    window.location.reload()
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
    busy.value = false
  }
}
</script>

<template>
  <JqmPage id="signup" title="Sign Up">
    <div class="signup">
      <img class="max-yorick-sizing" src="/yorick_256.png" alt="Yorick" />
      Sign up for Yorick.
      <form class="signup-form" @submit.prevent="signUp">
        <h2>Sign Up</h2>
        <div v-if="error" class="error">{{ error }}</div>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input id="signup-username" v-model="username" type="text" placeholder="Username" />
        </div>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input
            id="signup-password"
            v-model="password"
            type="password"
            placeholder="Create a Password"
          />
        </div>
        <button class="ui-btn ui-shadow ui-corner-all" :disabled="busy">Sign Up</button>
      </form>
    </div>
  </JqmPage>
</template>
