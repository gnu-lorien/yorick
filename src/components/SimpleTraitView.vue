<script setup lang="ts">
import * as _ from 'lodash-es'
import { FauxTrait } from '~/helpers/FauxTrait'
import { SimpleTrait } from '~/models/SimpleTrait'
import { SimpleTraitMixin } from '~/models/SimpleTraitMixin'
import { useCharacterStore } from '~/stores/characters'

const props = defineProps(['category', 'characterId', 'fauxtrait', 'trait'])
const emit = defineEmits<{
  (e: 'selected'): void
}>()
const router = useRouter()
const route = useRoute()

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
const finalName = computed(() => {
  return SimpleTraitMixin.get_specialized_name(fauxtrait.name, specialization.value)
})

function redirectOnSelected(trait) {
  const redirectPath = _.get(route, 'query.redirectPath', '')
  if (redirectPath) {
    router.push({ path: redirectPath })
    return
  }
  router.push({ name: 'simpletrait-category-characterId-simpleTraitId', params: { ...props, simpleTraitId: trait.id } })
}

async function save() {
  let updated
  if (props.trait) {
    /* We have an existing trait so we have to update it directly. This guarantees that a specialization name change
     * keeps with the same XP history
     */
    const new_values = {
      name: finalName.value,
      value: _.parseInt(fauxtrait.get('value')),
      category: fauxtrait.get('category'),
      free_value: fauxtrait.get('free_value'),
      experience_cost_type: fauxtrait.get('experience_cost_type'),
      experience_cost_modifier: fauxtrait.get('experience_cost_modifier'),
    }
    props.trait.set(new_values)
    updated = await character.value.update_trait(props.trait)
  }
  else {
    updated = await character.value.update_trait(
      fauxtrait.get('name'),
      fauxtrait.get('value'),
      fauxtrait.get('category'),
      fauxtrait.get('free_value'),
      true,
      fauxtrait.get('experience_cost_type'),
      fauxtrait.get('experience_cost_modifier'),
      specialization.value,
    )
  }
  router.push({ name: 'simpletraits-category-characterId-all', params: { ...props } })
}

function cancel() {
  router.push({ name: 'simpletraits-category-characterId-all', params: { ...props } })
}
</script>

<template>
  <p>{{ character.get('name') }} {{ finalName }} {{ fauxtrait.value }}</p>
  <p>Cost: {{ calculatedCost }}</p>
  <p>Available XP: {{ character.experience_available() }}</p>
  <p>Final: {{ finalCost }}</p>
  <form class="p-2 mb-2 bg-light border-bottom">
    <label for="value-slider">Value:</label>
    <input id="value-slider" v-model.number="fauxtrait.value" type="range" name="simpleTraitValue" class="value-slider" min="1" :max="traitMax">
  </form>
  <div>
    <button class="btn btn-warning">
      Remove
    </button>
  </div>
  <div>
    <button class="btn btn-success" @click="save()">
      Save
    </button>
  </div>
  <div>
    <button class="btn btn-secondary" @click="cancel()">
      Cancel
    </button>
  </div>
  <h2>Advanced Options</h2>
  <form class="p-2 mb-2">
    <label for="specialize-name">Specialize Name</label>
    <input id="specialize-name" v-model="specialization" type="text">
    <label for="free-slider">Free Value:</label>
    <input id="free-slider" v-model.number="fauxtrait.free_value" type="range" name="free-slider" class="free-slider" min="0" :max="traitMax">
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
    <input id="experience-cost-modifier" v-model.number="fauxtrait.experience_cost_modifier" type="range" name="experience-cost-modifier" min="1" max="10">
  </form>
</template>

<style scoped>

</style>
