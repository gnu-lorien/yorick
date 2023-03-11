<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['category', 'target', 'characterId', 'redirectTo'])

const name = '[new]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
</script>

<template>
  {{ props.redirectTo }}
  {{ character }}
</template>

<style scoped>

</style>
