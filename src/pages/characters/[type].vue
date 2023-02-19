<script setup>
import Parse from 'parse/dist/parse.js'
import { useCharacterStore } from '~/stores/characters'

const props = defineProps({
  type: String,
})

const characters = ref([])

onMounted(async () => {
  const characterStore = useCharacterStore()
  const newCharacters = await characterStore.getUserCharacters(Parse.User.current())
  characters.value.splice(0, newCharacters.length, ...newCharacters)
})

const name = '[type]'
defineExpose([name])
</script>

<template>
  all characters
  <ol>
    <li v-for="character in characters">
      {{ character }}
    </li>
  </ol>
</template>

<style scoped>

</style>
