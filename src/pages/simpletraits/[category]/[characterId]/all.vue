<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['category', 'characterId'])

const name = '[all]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const details = character.value.simpletrait_details(props.category)
await character.value.fetch_category(props.category)
</script>

<template>
  <ul>
    <li>
      <router-link :to="{ name: 'simpletraits-category-characterId-new', params: { ...props } }">
        Add New {{ details.pretty }}
      </router-link>
    </li>
  </ul>
  <ul v-if="character.has(props.category)">
    <li v-for="e in character.get(props.category)">
      {{ e.get("name") }} x{{ e.get("value") }}
    </li>
  </ul>
</template>

<style scoped>

</style>
