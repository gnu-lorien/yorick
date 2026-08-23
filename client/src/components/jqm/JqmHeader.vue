<script setup lang="ts">
/**
 * The fixed page header.
 *
 * jQuery Mobile called this an "external header": one element outside every
 * page, which jQM cloned into whichever page was active. There is no cloning
 * here -- it renders once, above the router outlet -- but the ids the old
 * markup carried (`header-back-button`, `header-logout-button`) are kept,
 * because both the app and the E2E suite address them by id.
 *
 * The heading text tracked the active page's `data-title` via jQM's
 * `pagecontainertransition` event; here it is simply the current route's title.
 */
defineProps<{ title: string; logoutLabel: string; visible: boolean; backHref: string }>()
</script>

<template>
  <div
    v-show="visible"
    data-role="header"
    data-position="fixed"
    class="ui-header ui-bar-a ui-header-fixed slidedown"
    role="banner"
  >
    <!--
      A real href, not a history call. `set_back_button(url)` gave every route
      an explicit destination, which is not the same as "the previous page":
      several handlers surface an error and then redirect, and going back to the
      page that just refused you is the wrong answer.
    -->
    <a
      id="header-back-button"
      :href="backHref"
      class="ui-btn ui-corner-all ui-shadow ui-btn-left ui-btn-icon-left ui-icon-arrow-l"
      >Back</a
    >
    <!--
      A plain link to `#logout`, not a click handler. The hash change drives the
      route, so signing out has exactly one implementation
      (`actions/LogoutAction.vue`) whether the user clicks this button, follows
      a link, or types the URL.
    -->
    <a
      id="header-logout-button"
      href="#logout"
      class="ui-btn ui-corner-all ui-shadow ui-btn-right ui-btn-icon-right ui-icon-minus"
      >{{ logoutLabel }}</a
    >
    <h1 class="ui-title" role="heading" aria-level="1">{{ title }}</h1>
  </div>
</template>
