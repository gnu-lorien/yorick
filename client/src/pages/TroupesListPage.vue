<script setup lang="ts">
/**
 * The troupes directory -- `#troupes`.
 *
 * `index.html:161-168` is a "Create Troupe" link above a `div[role=troupe-list]`
 * that `TroupesListView` filled. The list itself is `TroupeList.vue`, shared
 * with the three pick-a-troupe screens.
 *
 * `#troupes-list` as the page id is load-bearing: the E2E helpers scope their
 * row queries to it (`#troupes-list a.troupe-listing`, `#troupes-list
 * img.troupe-link-portrait`), which is what keeps a directory row apart from a
 * pick-screen row rendered by the same component.
 */
import { JqmPage } from '@/components/jqm'
import TroupeList from '@/components/TroupeList.vue'
</script>

<template>
  <JqmPage id="troupes-list" title="Troupes">
    <ul>
      <li><a href="#troupe/new">Create Troupe</a></li>
    </ul>
    <div role="troupe-list">
      <TroupeList />
    </div>
  </JqmPage>
</template>
