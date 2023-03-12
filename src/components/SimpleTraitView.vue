<script setup lang="ts">
import * as _ from 'lodash-es'
import Fuse from 'fuse.js'
import { FauxTrait } from '~/helpers/FauxTrait'
import { SimpleTrait } from '~/models/SimpleTrait'
import { useCharacterStore } from '~/stores/characters'
import { useDescriptionStore } from '~/stores/descriptions'
const props = defineProps(['category', 'characterId', 'fauxtrait', 'trait'])
const emit = defineEmits<{
  (e: 'selected'): void
}>()

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const fauxtrait = reactive(props.fauxtrait || new FauxTrait(props.trait.attributes))
const specialization = ref(fauxtrait.get_specialization())
const calculatedCost = asyncComputed(async () => {
  return await character.value.calculate_trait_to_spend(fauxtrait)
}, NaN)
const finalCost = asyncComputed(async () => {
  const toSpend = calculatedCost.value
  const available = character.value.experience_available()
  return available - toSpend
}, NaN)
const traitMax = asyncComputed(async () => {
  const max = character.value.max_trait_value(new SimpleTrait({ ...fauxtrait }))
  return max
}, 10)
</script>

<template>
  <p>{{ character.get('name') }} {{ fauxtrait.name }} {{ fauxtrait.value }}</p>
  <p>Cost: {{ calculatedCost }}</p>
  <p>Available XP: {{ character.experience_available() }}</p>
  <p>Final: {{ finalCost }}</p>
  <form class="p-2 mb-2 bg-light border-bottom">
    <label for="value-slider">Value:</label>
    <input id="value-slider" v-model="fauxtrait.value" type="range" name="simpleTraitValue" class="value-slider" min="1" :max="traitMax">
  </form>
  <div>
    <button class="btn btn-warning">
      Remove
    </button>
  </div>
  <div>
    <button class="btn btn-success">
      Save
    </button>
  </div>
  <div>
    <button class="btn btn-secondary">
      Cancel
    </button>
  </div>
  <h2>Advanced Options</h2>
  <form class="p-2 mb-2">
    <label for="specialize-name">Specialize Name</label>
    <input id="specialize-name" v-model="specialization" type="text">
    <label for="free-slider">Free Value:</label>
    <input id="free-slider" v-model="fauxtrait.free_value" type="range" name="free-slider" class="free-slider" min="0" :max="traitMax">
    <label for="experience-type-select">Experience Cost Type Override</label>
    <select id="experience-type-select" name="experience-type-select">
      <option value="automatic" :selected="fauxtrait.experience_cost_type === ''">
        Automatic
      </option>
      <option value="flat" :selected="fauxtrait.experience_cost_type === 'flat'">
        Flat
      </option>
      <option value="linear" :selected="fauxtrait.experience_cost_type === 'linear'">
        Linear
      </option>
    </select>
    <label for="experience-cost-modifier">Experience Cost Modifier</label>
    <input id="experience-cost-modifier" v-model="fauxtrait.experience_cost_modifier" type="range" name="experience-cost-modifier" class="cost-modifier-slider" min="1" max="10">
  </form>
</template>

<style scoped>

</style>
