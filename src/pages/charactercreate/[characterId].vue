<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['characterId'])

const name = '[new]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const creation = character.value.get('creation')

const route = useRoute()
const redirectTo = {
  name: route.name,
  params: route.params,
}
</script>

<template>
  <p>You have {{ creation.get("initial_xp") }} initial XP to spend</p>
  <p>Remaining steps for {{ character.get("name") }}</p>

  {{ redirectTo }}
</template>

<style scoped>

</style>
