<script setup lang="ts">
/**
 * The inline error banner -- `#global-error-region`.
 *
 * The rendering half of `domain/errors.ts`, which is the port of
 * `helpers/ReportError.js`. That module decides WHAT is showing and for how
 * long; this decides WHERE, and the split exists because `reportError` is
 * called from places that have no component at all (the router's auth gate, and
 * `Character.update_trait` refusing a trait with no cost rule).
 *
 * ## Why it moves between pages
 *
 * The banner is rendered into the ACTIVE page, not into the shell, because a
 * message that scrolls with the chrome instead of the content reads as part of
 * the furniture. jQuery Mobile made that easy -- every visited page stayed in
 * the document, so `ReportError` could `$region.detach()` and `prepend()` it
 * into whichever one was showing. Here exactly one page component is mounted at
 * a time, and it is torn down on navigation, so a plain child of the page would
 * be destroyed by the very redirect the banner is supposed to survive.
 *
 * A `<Teleport>` into a stable anchor node solves it. The anchor is a plain
 * `<div>` this component owns and moves; because it is the SAME node before and
 * after, the teleported banner rides along with it and Vue never has to
 * re-render the content. Moving it is `attach()` below, and it is deliberately
 * a `prepend` into `div[role="main"]` -- the same target and the same position
 * the jQuery version used, with the same fallbacks (the page element, then
 * `<body>`).
 *
 * ## Why the MutationObserver
 *
 * `attach()` runs when `domain/errors.ts` says to. That covers a report and the
 * one navigation the banner follows. It does NOT cover the page being rebuilt
 * underneath it without a route change -- which the E2E harness does on every
 * `__yorickApi.reload()`, the replacement for `Backbone.history.loadUrl`. When
 * that happens the anchor leaves the document with the page that held it, and
 * an invisible banner is exactly the swallowed-failure behaviour this whole
 * module exists to end. So while a message is showing, and only then, we watch
 * for the anchor being disconnected and put it back.
 */
import { nextTick, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  REGION_ID,
  bannerAttachSeq,
  bannerMessage,
  clearError,
  installErrorNavigationWatch,
} from '@/domain/errors'

installErrorNavigationWatch(useRouter())

/**
 * The stable host for the teleported banner. Created once and moved between
 * pages; never re-created, so the banner's own DOM is never rebuilt.
 *
 * Deliberately a plain `const` and not a `ref`: it never changes identity, and
 * a DOM node has no business in the reactivity graph.
 */
const anchor = document.createElement('div')
anchor.id = 'global-error-anchor'

/** The port of `ReportError.attach()`, target selection included. */
function attach(): void {
  const page = document.querySelector('.ui-page-active')
  const main = page?.querySelector('div[role="main"]') ?? null
  const host = (main ?? page ?? document.body) as HTMLElement
  // `prepend` moves the node when it is already in the document, which is what
  // `$region.detach()` followed by `prepend` did.
  host.prepend(anchor)
}

let observer: MutationObserver | null = null

function watchForRebuilds(): void {
  if (observer) return
  observer = new MutationObserver(() => {
    if (!bannerMessage.value) return
    if (anchor.isConnected) return
    // Re-attaching mutates the DOM and so re-enters this callback once; the
    // `isConnected` check above is what stops it there.
    attach()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function stopWatchingForRebuilds(): void {
  observer?.disconnect()
  observer = null
}

/*
 * A new message, or an explicit re-attach request from the phase machine.
 * `nextTick` because on the 'follow' step the page the banner is moving TO has
 * only just been resolved by the router and is not in the document yet.
 */
watch(
  [bannerMessage, bannerAttachSeq],
  async ([text]) => {
    if (!text) {
      stopWatchingForRebuilds()
      return
    }
    watchForRebuilds()
    await nextTick()
    attach()
  },
  { flush: 'post' },
)

onBeforeUnmount(stopWatchingForRebuilds)
</script>

<template>
  <!--
    The inline styles are the ones `ReportError.js` set by hand, kept verbatim
    so the banner looks exactly as it did: the app's stylesheet has no rule for
    `.error`, so dropping them would render a refusal in body text.
  -->
  <Teleport v-if="bannerMessage" :to="anchor">
    <div
      :id="REGION_ID"
      role="alert"
      class="error ui-body ui-body-a"
      style="margin: 0.5em 0; padding: 0.5em; border: 1px solid #b00; color: #b00; cursor: pointer"
      @click="clearError()"
    >
      {{ bannerMessage }}
    </div>
  </Teleport>
</template>
