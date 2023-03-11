<script setup>
import { useCharacterStore } from '~/stores/characters'
import { useDescriptionStore } from '~/stores/descriptions'
const props = defineProps(['category', 'target', 'characterId', 'redirectTo'])

const name = '[new]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)

const descriptionStore = useDescriptionStore()
const descriptions = await descriptionStore.getDescriptionsForCategory(props.category)
</script>

<template>
  {{ props.redirectTo }}
  {{ character }}
  {{ descriptions }}
</template>

<style scoped>

</style>
