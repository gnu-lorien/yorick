<script setup lang="ts">
/**
 * The application shell.
 *
 * This is what `public/index.html` was, minus 59 hidden page divs. jQuery
 * Mobile kept every visited page in the document and toggled `ui-page-active`
 * between them; the router outlet renders exactly one page component, and
 * `JqmPage` puts `ui-page-active` on it -- so `document.querySelector('.ui-page-active').id`
 * still answers "where is the app", which is how the E2E suite navigates.
 *
 * The header and footer were "external" jQuery Mobile toolbars: declared once
 * outside the pages and cloned into whichever page was showing. They render
 * once here, and their visibility follows the auth state directly rather than
 * being shown and hidden from `pagecreate` and `pagecontainertransition`
 * handlers in `main.js`.
 */
import { computed, onMounted, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { hashForRoute } from '@/router'
import { JqmFooter, JqmHeader, JqmLoader, JqmPopup } from '@/components/jqm'
import GlobalErrorRegion from '@/components/GlobalErrorRegion.vue'
import { currentRemountKey, onRemount } from '@/testing/app-api'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()

/**
 * The heading text.
 *
 * jQuery Mobile read it from the active page's `data-title` on every
 * transition; each route declares the same string in `meta.title`.
 */
const title = computed(() => (route.meta.title as string) || 'Yorick')

/** Chrome is hidden for anonymous visitors, as `main.js` did on `pagecreate`. */
const chromeVisible = computed(() => auth.isLoggedIn)

const logoutLabel = computed(() => (auth.username ? `Log Out ${auth.username}` : 'Log Out'))

/*
 * Every `JqmPage` needs to know whether the fixed toolbars are showing, so it
 * can leave room for them. Provided rather than passed as a prop, because the
 * pages are rendered by the router outlet and never see App.vue's props.
 */
provide('jqmChromeVisible', chromeVisible)

/** See the RouterView key below. */
const remountKey = ref(currentRemountKey())
onRemount(() => {
  remountKey.value = currentRemountKey()
})

/*
 * The footer marks the current tab by matching hrefs, and its hrefs are
 * Backbone hashes (`#characters?all`). `route.fullPath` is the INTERNAL path
 * (`/characters/all`) that only Vue Router's matcher ever sees, so matching on
 * it would never mark anything active. `hashForRoute` renders the route back
 * through its Backbone pattern, which is the string the address bar shows.
 */
const activeHref = computed(() => {
  const hash = hashForRoute(route)
  return hash ? '#' + hash : '#'
})

watch(title, (value) => {
  ui.title = value
  document.title = value === 'Yorick' ? 'Yorick' : `Yorick - ${value}`
}, { immediate: true })

onMounted(() => {
  // `main.js` removed the splash on jQuery Mobile's `pagecreate`; the
  // equivalent moment is the shell's first mount.
  document.getElementById('splashscreen')?.remove()
  auth.identifyForErrorReporting()
})
</script>

<template>
  <JqmHeader
    :title="title"
    :logout-label="logoutLabel"
    :visible="chromeVisible"
    :back-href="ui.backHref"
  />

  <RouterView v-slot="{ Component }">
    <!--
      Keyed on the route AND a remount counter. The route half is what makes two
      different characters render as two different component instances rather
      than one instance whose props changed; the counter half is what lets the
      E2E harness re-run the current route in place, which is the job
      `Backbone.history.loadUrl` used to do.
    -->
    <component :is="Component" :key="route.fullPath + ':' + remountKey" />
  </RouterView>

  <!--
    The inline error banner. Mounted here, outside the router outlet, so it
    survives the redirect that several failure handlers perform right after
    reporting; it teleports itself INTO the active page so the message lands
    where the user is looking. See `components/GlobalErrorRegion.vue`.
  -->
  <GlobalErrorRegion />

  <JqmFooter :links="auth.navLinks" :active-href="activeHref" :visible="chromeVisible" />

  <JqmLoader :active="ui.loading" :text="ui.loaderText" />

  <JqmPopup :open="!!ui.errorMessage" id="popup-global-error" @update:open="ui.clearError()">
    <template #default="{ close }">
      <div data-role="header" class="ui-header ui-bar-a">
        <h2 class="ui-title">Error Reported</h2>
        <a
          href="#"
          class="ui-btn ui-corner-all ui-btn-a ui-icon-delete ui-btn-icon-notext ui-btn-right"
          @click.prevent="close()"
          >Close</a
        >
      </div>
      <span class="ui-content">{{ ui.errorMessage }}</span>
    </template>
  </JqmPopup>
</template>
