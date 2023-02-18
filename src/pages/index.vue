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
  <div class="login">
    <img class="max-yorick-sizing" src="yorick_256.png">
    <p>
      Welcome to Yorick, a character management system for <a href="http://www.undergroundtheater.org/">Underground Theater</a>.
    </p>
    <form class="login-form">
      <h2>Log In</h2>
      <div class="error" style="display:none" />
      <input id="login-username" type="text" placeholder="Username">
      <input id="login-password" type="password" placeholder="Password">
      <button>Log in with Username and Password</button>
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
