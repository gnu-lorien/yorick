<script setup lang="ts">
/**
 * The login form -- a port of `LoginView.js` and the `#login-template` block at
 * `public/index.html:788`.
 *
 * Two behaviours are preserved deliberately:
 *
 * 1. **Promises, not `{success, error}` callbacks.** Parse SDK 3.0 removed
 *    those, and under parse@8 the third argument became an options bag, so
 *    `success` was silently ignored: the credentials were accepted, the session
 *    was created, and the redirect never ran. The form just sat there, with
 *    nothing thrown and nothing logged.
 *
 * 2. **A full page reload on success.** `LoginView.js:62` does
 *    `location.reload()` rather than navigating, and that is not laziness --
 *    the app has no other way to re-render everything that depends on who is
 *    signed in. Keeping it means a signed-out visitor who deep-linked to a
 *    character still lands on that character, because the guard left their
 *    original hash in the address bar.
 *
 * Facebook login is not ported; the `#login-with-facebook` button is gone with
 * it. That was the owner's call, and the button was already non-functional --
 * `loadall.js` stopped calling `hello.init()` because it threw under parse@8
 * and aborted the whole bootstrap.
 */
import { ref } from 'vue'
import { JqmPage } from '@/components/jqm'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function logIn() {
  error.value = ''
  busy.value = true
  try {
    await auth.logIn(username.value, password.value)
    window.location.reload()
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
    busy.value = false
  }
}
</script>

<template>
  <JqmPage id="login" title="Log In">
    <div class="login">
      <img class="max-yorick-sizing" src="/yorick_256.png" alt="Yorick" />
      <p>
        Welcome to Yorick, a character management system for
        <a href="http://www.undergroundtheater.org/">Underground Theater</a>.
      </p>
      <form class="login-form" @submit.prevent="logIn">
        <h2>Log In</h2>
        <div v-if="error" class="error">{{ error }}</div>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input id="login-username" v-model="username" type="text" placeholder="Username" />
        </div>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input id="login-password" v-model="password" type="password" placeholder="Password" />
        </div>
        <button class="ui-btn ui-shadow ui-corner-all" :disabled="busy">
          Log in with Username and Password
        </button>
      </form>
      <div><a href="#signup">Need an account? Sign up!</a></div>
      <div><a href="#reset">Forgot your password?</a></div>
      <div><a href="#about">About Yorick</a></div>
    </div>
  </JqmPage>
</template>
