<script setup>
import { useCharacterStore } from '~/stores/characters'

const props = defineProps(['characterId'])
const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
</script>

<template>
  {{ character.attributes.clan }}
</template>

<style scoped>

</style>
