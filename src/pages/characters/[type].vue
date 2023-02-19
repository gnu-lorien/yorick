<script setup>
import Parse from 'parse/dist/parse.js'
import { useCharacterStore } from '~/stores/characters'

const props = defineProps({
  type: String,
})

const characters = ref([])

onMounted(async () => {
  const characterStore = useCharacterStore()
  const newCharacters = await characterStore.getUserCharacters(Parse.User.current(), props.type, 5)
  characters.value.splice(0, newCharacters.length, ...newCharacters)
})

const name = '[type]'
defineExpose([name])
</script>

<template>
  all characters
  <div class="list-group">
    <a v-for="character in characters" href="#" class="list-group-item list-group-item-action active">
      <div class="d-flex w-100 justify-content-between">
        <img :src="character.get_thumbnail_sync(128)">
        <h2>{{ character.get('name') }}</h2>
        <template v-if="character.get('type') === 'Werewolf'">
          <template v-if="character.get('wta_tribe') || character.get('wta_breed') || character.get('wta_auspice')">
            <p>{{ character.get("wta_tribe") }} {{ character.get("wta_breed") }} {{ character.get("wta_auspice") }}</p>
          </template>
        </template>
        <p>{{ character.get("wta_faction") }} {{ character.get("archetype") }} {{ character.get("wta_camp") }}</p>
        <p>{{ character.get("antecedence") }}</p>
      </div>
    </a>
  </div>
  <ol>
    <li v-for="character in characters">
      <img :src="character.get_thumbnail_sync(128)">
      {{ character }}
    </li>
  </ol>
</template>

<style scoped>

</style>
