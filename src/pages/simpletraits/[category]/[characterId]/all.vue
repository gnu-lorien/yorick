<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['category', 'characterId'])

const name = '[all]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
</script>

<template>
  <ul>
    <li><a href="#simpletraits/{{ props.category }}/{{ character.id }}/new">Add New {{ props.category }}</a></li>
  </ul>
  <ul v-if="character.has(props.category)">
    <li v-for="e in character.value.get(props.category)" v-bind="e.id">
      <a href="#simpletrait/{{ category }}/{{ character.id }}/{{ e.id }}" class="ui-btn ui-btn-icon-right ui-icon-carat-r">{{ e.get("name") }} x{{ e.get("value") }}</a>
    </li>
  </ul>
</template>

<style scoped>

</style>
