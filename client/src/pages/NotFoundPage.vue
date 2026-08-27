<script setup lang="ts">
/**
 * Shown for a hash that matches no route.
 *
 * Backbone ignored an unmatched hash and left the previous page up, which is
 * invisible mid-session and a blank document on a cold load. This says so.
 */
import { JqmButton, JqmPage } from '@/components/jqm'
</script>

<template>
  <JqmPage id="not-found" title="Not Found">
    <p>That address does not match anything in Yorick.</p>
    <JqmButton href="#characters?all">Go to your characters</JqmButton>
  </JqmPage>
</template>
