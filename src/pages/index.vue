<script setup lang="ts">
defineOptions({
  name: 'IndexPage',
})
const user = useUserStore()
const name = $ref(user.savedName)

const router = useRouter()
const go = () => {
  if (name)
    router.push(`/hi/${encodeURIComponent(name)}`)
}

const { t } = useI18n()
</script>

<template>
  <div class="login form-signin w-100 m-auto">
    <form class="login-form">
      <img class="max-yorick-sizing" src="yorick_256.png">
      <p>
        Welcome to Yorick, a character management system.
      </p>
      <h2 class="h3 mb-3 fw-normal">
        Log In
      </h2>
      <div class="error" style="display:none" />
      <div class="form-floating">
        <input id="login-username" type="text" class="form-control" placeholder="Username">
        <label for="login-username">Username</label>
      </div>
      <div class="form-floating">
        <input id="login-password" type="password" class="form-control" placeholder="Password">
        <label for="login-password">Password</label>
      </div>
      <button class="w-100 btn btn-lg btn-primary">
        Log in with Username and Password
      </button>
    </form>
    <div>
      <a href="#signup">Need an account? Sign up!</a>
    </div>
    <div>
      <a href="#reset">Forgot your password?</a>
    </div>
    <div>
      <a href="#about">About Yorick</a>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: home
</route>
