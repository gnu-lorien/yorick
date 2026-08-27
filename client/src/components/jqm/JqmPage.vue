<script setup lang="ts">
/**
 * One jQuery Mobile page.
 *
 * This component is the single most important compatibility surface in the
 * migration, because the Playwright suite navigates by it. `e2e/helpers/
 * jqm-helpers.js` reads `document.querySelector('.ui-page-active').id` to know
 * where the app is, and `waitForActivePage` additionally requires a
 * `div[role="main"]` inside it that is non-empty. Emitting exactly that markup,
 * with the same id the old `<div data-role="page" id="...">` carried, is what
 * lets 423 existing tests keep their navigation assertions unchanged.
 *
 * Unlike jQuery Mobile, only the active page is in the document at all. jQM
 * kept every visited page around hidden, which is why the old helper had to
 * distinguish "present" from "active"; that distinction is now free, and the
 * `.ui-page-active` class is emitted purely to honour the contract above.
 *
 * ## `ready`, and why an empty page is the correct intermediate state
 *
 * `waitForActivePage` in the E2E helpers waits for the active page's
 * `div[role="main"]` to STOP BEING EMPTY. It exists because the old Marionette
 * views re-rendered their regions asynchronously after the page became active,
 * so "active" alone never meant "settled".
 *
 * That contract still holds, and it cuts both ways: a page that renders chrome
 * -- a filter box, a heading, a paging control -- before its data arrives
 * satisfies the check early, and the caller reads an empty list. The loading
 * spinner does not save it either, because `waitForJqmLoader` treats a MISSING
 * `.ui-loader` as clear and Vue applies the spinner a tick after the work
 * starts.
 *
 * So a page that loads anything passes `:ready="false"` until it has it. The
 * page element and its id still render -- navigation still resolves -- but the
 * content area stays empty, which is exactly the state the helper knows how to
 * wait through.
 *
 * ## Room for the fixed toolbars
 *
 * `.ui-page` is `position: absolute` and has no padding, so a page rendered
 * under a fixed header starts underneath it. jQuery Mobile's toolbar code fixed
 * that by measuring the toolbars and writing an inline style on the active
 * page -- measured on the running legacy app as
 * `position: relative; padding-top: 45px; padding-bottom: 2px;`.
 *
 * Rather than re-measure, this applies jQuery Mobile's OWN classes for the job,
 * `ui-page-header-fixed` (`padding-top: 2.8125em`, which is those 45px) and
 * `ui-page-footer-fixed`, and only while the chrome is actually on screen.
 *
 * That is one deliberate difference from the legacy app: there, the padding was
 * present even on the signed-out pages where the header and footer are hidden,
 * because the inline style was never recalculated after they were hidden. The
 * login screen therefore carries 45px of dead space above the logo that this
 * does not reproduce.
 */
import { computed, inject, type Ref } from 'vue'

withDefaults(
  defineProps<{
    /** The page id, matching the old `data-role="page"` element's id. */
    id: string
    /** The `data-title` the old markup carried; drives the header heading. */
    title?: string
    /** Set false for pages that lay out their own content wrapper. */
    content?: boolean
    /** False while the page is still loading; see the note above. */
    ready?: boolean
    theme?: string
  }>(),
  { title: '', content: true, ready: true, theme: 'a' },
)

/**
 * Whether the fixed header and footer are on screen. Provided by `App.vue`,
 * which owns the auth state that decides it.
 */
const chromeVisible = inject<Ref<boolean> | boolean>('jqmChromeVisible', false)

const hasChrome = computed(() =>
  typeof chromeVisible === 'boolean' ? chromeVisible : chromeVisible.value,
)
</script>

<template>
  <div
    :id="id"
    data-role="page"
    :data-title="title"
    class="ui-page ui-page-active"
    :class="[
      `ui-page-theme-${theme}`,
      hasChrome ? 'ui-page-header-fixed ui-page-footer-fixed' : '',
    ]"
    style="position: relative"
  >
    <div v-if="content" role="main" class="ui-content">
      <slot v-if="ready" />
    </div>
    <template v-else-if="ready"><slot /></template>
  </div>
</template>
