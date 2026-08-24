<script setup lang="ts">
/**
 * The about page -- static markup that lived directly in `index.html:100-124`
 * rather than in a view, and whose route handler was a bare `changePage`.
 *
 * Reachable signed out, as it was.
 */
import { JqmPage } from '@/components/jqm'
</script>

<template>
  <JqmPage id="about" title="About">
    <p>
      <a href="https://github.com/gnu-lorien/yorick">Yorick</a> is a troupe and character management
      application designed to support role-playing game systems published by
      <a href="http://www.bynightstudios.com/">By Night Studios</a>.
    </p>
    <p>
      This website is primarily maintained for usage by the non-profit
      <a href="http://www.undergroundtheater.org/">Underground Theater</a>.
    </p>
    <p>
      <a href="https://github.com/gnu-lorien/yorick">Yorick</a> is an open-source project that anybody
      may contribute to. It is licensed under the AGPLv3.
    </p>
    <p>
      Real-time analytics and error reported is provided by <a href="https://trackjs.com/">Track JS</a>.
    </p>
    <p>
      Some icons are provided by <a href="http://game-icons.net/">Game-icons.net</a> under the terms of
      the <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a> license.
    </p>
    <p><a href="#">Return to Login</a></p>
  </JqmPage>
</template>
