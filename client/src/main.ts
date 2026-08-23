/**
 * Application bootstrap.
 *
 * The replacement for `public/scripts/app.js` (the RequireJS config) and
 * `public/scripts/app/loadall.js` (the runtime bootstrap) together. RequireJS
 * is gone: Vite resolves modules, so there is no `paths` table, no `shim`
 * block, and no `bust=` cache-busting query -- content hashes in the built
 * filenames do that job properly.
 *
 * The load order that mattered in `loadall.js` still matters and is preserved:
 * Parse must be initialised before anything queries it, and the global clan
 * rules must be fetched once at startup because views read them synchronously.
 */
import { createApp } from 'vue'
import '@/styles/jqm-structural.css'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { initParse } from '@/parse'
import { installCharacterMethods } from '@/domain/Character'
import { router, startHashSync } from '@/router'
import { installTestApi } from '@/testing/app-api'
import { installTestModules } from '@/testing/modules'

const Parse = initParse()

/*
 * The SDK on `window`, for two reasons.
 *
 * The E2E suite's `waitForAppReady` polls for `window.Parse.applicationId` to
 * know the app has finished booting, and the browser console is the only
 * debugging tool this app has ever had -- `Parse.User.current()` at a prompt is
 * how you find out what the app thinks is going on. Under RequireJS the SDK was
 * global as a side effect of how the bundle loaded; here it is deliberate.
 */
;(window as unknown as { Parse: typeof Parse }).Parse = Parse

/*
 * Install the character behaviour before anything can query a character.
 *
 * `Parse.Object.extend("Vampire", instance_methods)` is what put these methods
 * on every character row in the Backbone app, and it ran when the venue module
 * loaded. Here they live on `CharacterObject.prototype` and installation is an
 * explicit call, which for a long time only `get_character` made -- so a page
 * that ran its OWN `Parse.Query` got rows with no model behaviour on them.
 *
 * That failed intermittently rather than always, which is the worst way for it
 * to fail: the install is global and permanent, so as soon as anything in the
 * session had called `get_character` every later query looked fine. It only
 * showed up on a cold load that went straight to such a page -- the troupe
 * summary right after a re-login, where it read `o.get_long_text is not a
 * function` and rendered an empty roster.
 *
 * Installing at bootstrap makes a character row a character, always.
 */
installCharacterMethods()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

/*
 * A readiness flag for the E2E harness.
 *
 * `waitForAppReady` used to test for `window.jQuery.mobile` and
 * `window.require`, neither of which exists any more. This is the honest
 * replacement: it is set once the app has mounted and the router has settled
 * its first navigation, which is the condition those checks were approximating.
 */
/*
 * Drive the router from `window.location.hash`, and write it back after every
 * navigation. This must start after `mount`, so the first route resolves into a
 * mounted app rather than against an empty outlet.
 */
/*
 * The test surface, installed before the first navigation so a harness that is
 * already waiting cannot miss it. See `testing/app-api.ts` for why it exists.
 */
installTestApi(router)
installTestModules()

startHashSync()

router.isReady().then(() => {
  ;(window as unknown as { __yorickReady: boolean }).__yorickReady = true
})
