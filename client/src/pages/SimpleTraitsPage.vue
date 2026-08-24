<script setup lang="ts">
/**
 * `#simpletraits/:category/:cid/:type` -- two screens behind one route.
 *
 * `type` selects which: `all` lists the traits in a category
 * (`#simpletraitcategory-all`), `new` opens the picker for adding one
 * (`#simpletrait-new`). The Backbone handler branched the same way
 * (`mobileRouter.js:1803-1833`), including on where Back goes -- the listing
 * returns to the character sheet, the picker returns to the listing.
 *
 * The route's `meta.pageId` names the `all` case, because that is the common
 * one and a route table should read as the thing it usually does; the rendered
 * page id is decided here.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SimpleTraitCategory from '@/components/SimpleTraitCategory.vue'
import SimpleTraitNew from '@/components/SimpleTraitNew.vue'

const route = useRoute()

const isNew = computed(() => route.params.type === 'new')
</script>

<template>
  <SimpleTraitNew v-if="isNew" />
  <SimpleTraitCategory v-else />
</template>
