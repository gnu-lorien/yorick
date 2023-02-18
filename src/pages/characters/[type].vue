<script>
import Parse from 'parse/dist/parse.js'
import { useCharacterStore } from '~/stores/characters'

const characterStore = useCharacterStore()
const characters = characterStore.getUserCharacters(Parse.User.current())

export default {
  name: '[type]',
}
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
