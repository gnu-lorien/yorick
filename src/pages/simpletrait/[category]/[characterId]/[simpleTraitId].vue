<script setup lang="ts">
import * as _ from 'lodash-es'
import Fuse from 'fuse.js'
import { SimpleTrait } from '~/models/SimpleTrait'
import { useCharacterStore } from '~/stores/characters'
import { useDescriptionStore } from '~/stores/descriptions'
const props = defineProps(['category', 'characterId', 'simpleTraitId'])
const emit = defineEmits<{
  (e: 'selected'): void
}>()

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const trait = await character.value.get_trait(props.category, props.simpleTraitId)
const fauxtrait = ref(new SimpleTrait({ ...trait.attributes }))
const calculatedCost = asyncComputed(async () => {
  return await character.value.calculate_trait_to_spend(trait)
}, NaN)
const finalCost = asyncComputed(async () => {
  const toSpend = await character.value.calculate_trait_to_spend(trait)
  const available = character.value.experience_available()
  return available - toSpend
}, NaN)
const traitMax = asyncComputed(async () => {
  const max = character.value.max_trait_value(fauxtrait.value)
  return max
}, 10)
</script>

<template>
  <p>{{ character.get('name') }} {{ fauxtrait.name }} {{ fauxtrait.value }}</p>
  <p>Cost: {{ calculatedCost }}</p>
  <p>Available XP: {{ character.experience_available() }}</p>
  <p>Final: {{ finalCost }}</p>
  <form class="p-2 mb-2 bg-light border-bottom">
    <label for="value-slider">Slider:</label>
    <input id="value-slider" v-model="fauxtrait.value" type="range" name="simpleTraitValue" class="value-slider" min="1" :max="traitMax">
  </form>
</template>

<style scoped>

</style>
