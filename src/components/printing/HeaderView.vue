<script setup>
const props = defineProps(['character', 'target'])
const character = shallowRef(props.character)
</script>

<template>
  <h1><FormatSimpleText :character="character" target="name" /> </h1>
</template>

<style scoped>

</style>
