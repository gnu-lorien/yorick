<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['characterId'])

const name = '[characterId]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
</script>

<template>
  your current character
  {{ character.id }}
</template>

<style scoped>

</style>
