<script setup lang="ts">
import * as _ from 'lodash-es'
import Fuse from 'fuse.js'
import { useCharacterStore } from '~/stores/characters'
import { useDescriptionStore } from '~/stores/descriptions'
const props = defineProps(['category', 'characterId', 'simpleTraitId'])
const emit = defineEmits<{
  (e: 'selected'): void
}>()

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const trait = await character.value.get_trait(props.category, props.simpleTraitId)
const fauxtrait = ref({ ...trait.attributes, id: trait.id })
const calculatedCost = asyncComputed(async () => {
  return await character.value.calculate_trait_to_spend(trait)
}, NaN)
const finalCost = asyncComputed(async () => {
  const toSpend = await character.value.calculate_trait_to_spend(trait)
  const available = character.value.experience_available()
  return available - toSpend
}, NaN)
</script>

<template>
  <p>{{ character.get('name') }} {{ fauxtrait.name }} {{ fauxtrait.value }}</p>
  <p>Cost: {{ calculatedCost }}</p>
  <p>Available XP: {{ character.experience_available() }}</p>
  <p>Final: {{ finalCost }}</p>
</template>

<style scoped>

</style>
