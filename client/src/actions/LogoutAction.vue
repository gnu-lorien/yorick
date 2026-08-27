<script setup lang="ts">
/**
 * `#logout` — sign out, then restart the app.
 *
 * A port of `mobileRouter.js:326-333`. An action route: it renders nothing and
 * ends in a navigation, which is why it has no page of its own.
 *
 * The full reload is preserved deliberately. It looks heavy-handed for an SPA,
 * but it is the app's only way to be certain no store, no cached character and
 * no memoised view still holds a record the signed-out user could see — the
 * original relied on it for exactly that, since every view was cached on the
 * router instance and nothing tore them down.
 *
 * `hello('facebook').logout()` is dropped with the rest of the Facebook
 * integration. It was already dead: `loadall.js` stopped initialising the SDK
 * because it threw under parse@8, so this call was reaching for a global that
 * had never been configured — and it only survived because the original
 * chained it through `.always()`, which swallowed the failure.
 */
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRolesStore } from '@/stores/roles'
import { useTroupesStore } from '@/stores/troupes'

const auth = useAuthStore()
const roles = useRolesStore()
const troupes = useTroupesStore()

onMounted(async () => {
  try {
    await auth.logOut()
  } catch {
    // `logOut` failing must not leave the user stuck on a blank action route.
    // The original swallowed this too, and the reload below clears the session
    // from memory regardless of whether the server acknowledged it.
  }
  roles.reset()
  troupes.reset()
  window.location.hash = ''
  window.location.reload()
})
</script>

<template><div /></template>
