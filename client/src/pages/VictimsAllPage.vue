<script setup lang="ts">
/**
 * `#victims-all` -- a placeholder that shipped.
 *
 * `mobileRouter.js:1835` is the whole handler: for `type == "all"` it changes to
 * this page and does nothing else. The page's markup (`index.html:514`) is three
 * bare `<li>`s -- "All", "Idle", "Occupied" -- with no links, no data and no
 * view class anywhere in the application.
 *
 * Ported as it is rather than dropped, because a route that exists and renders
 * three words is a different thing from a route that 404s, and nothing else in
 * this codebase says which of those the owner wants. Nothing links here; it is
 * reachable only by typing `#victims?all`.
 */
import { JqmPage } from '@/components/jqm'
</script>

<template>
  <JqmPage id="victims-all" title="VictimsAll">
    <ul>
      <li>All</li>
      <li>Idle</li>
      <li>Occupied</li>
    </ul>
  </JqmPage>
</template>
