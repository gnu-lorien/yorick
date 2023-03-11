<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['characterId'])

const name = '[new]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
</script>

<template>
  {{ character }}
</template>

<style scoped>

</style>
