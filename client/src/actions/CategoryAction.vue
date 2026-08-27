<script setup lang="ts">
/**
 * `#category?:type` -- a route that cannot succeed, reproduced as one.
 *
 * The handler (`mobileRouter.js:1842`) reads `this[type + "View"].collection`.
 * No router property is named that way for any value of `type` -- the views are
 * `characterNewView`, `troupeView` and so on, and none of them has a
 * `collection` -- so the first line throws a TypeError whatever is passed. It
 * has been dead for as long as the file has existed, nothing links to it, and
 * it appears in no template.
 *
 * So there is nothing to port. Rendering an invented screen here would be
 * making up a feature; throwing to match would be theatre. It does what the
 * broken handler effectively did: nothing at all, leaving whatever page the
 * user was on. Recorded here rather than deleted so the next person does not
 * spend an afternoon working out what `#category` was supposed to show.
 */
</script>

<template><div /></template>
