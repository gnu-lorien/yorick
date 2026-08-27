<script setup lang="ts">
/**
 * The fixed footer navbar.
 *
 * A direct port of `templates/footer.html`, which the old router re-rendered
 * into the footer on every `enforce_logged_in` with `.html(...).trigger('create')`.
 * The three role variants -- admin, storyteller, player -- differ only in how
 * many cells the grid has, so the grid class is derived from the link count
 * rather than branched three ways, which is the same output with one code path.
 *
 * jQuery Mobile marked the current tab with `ui-btn-active`; the router used to
 * set it by matching the header text. Here it is matched on the route hash,
 * which is what it was really trying to approximate.
 */
import { computed } from 'vue'

const props = defineProps<{ links: { href: string; label: string }[]; activeHref: string; visible: boolean }>()

const GRID = ['ui-grid-solo', 'ui-grid-a', 'ui-grid-b', 'ui-grid-c', 'ui-grid-d']
const BLOCK = ['ui-block-a', 'ui-block-b', 'ui-block-c', 'ui-block-d', 'ui-block-e']

const gridClass = computed(() => GRID[Math.min(props.links.length - 1, GRID.length - 1)])

function isActive(href: string) {
  return props.activeHref === href || props.activeHref.startsWith(href.split('?')[0] + '?')
}
</script>

<template>
  <div
    v-show="visible"
    data-role="footer"
    data-position="fixed"
    class="ui-footer ui-bar-a ui-footer-fixed slideup"
    role="contentinfo"
  >
    <div data-role="navbar" class="ui-navbar" role="navigation">
      <ul :class="gridClass">
        <li v-for="(link, i) in links" :key="link.href" :class="BLOCK[i]">
          <a
            :href="link.href"
            class="ui-btn"
            :class="isActive(link.href) ? 'ui-btn-active' : ''"
            >{{ link.label }}</a
          >
        </li>
      </ul>
    </div>
  </div>
</template>
