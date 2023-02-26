<script setup>
import Parse from 'parse/dist/parse.js'
import { useCharacterStore } from '~/stores/characters'

const props = defineProps({
  type: String,
})

const characters = ref([])
const loading = ref(true)

onMounted(async () => {
  const characterStore = useCharacterStore()
  const newCharacters = await characterStore.getUserCharacters(Parse.User.current(), props.type, 5)
  characters.value.splice(0, newCharacters.length, ...newCharacters)
  loading.value = false
})

const name = '[type]'
defineExpose([name])
</script>

<template>
  all characters
  <template v-if="loading">
    Loading all characters
  </template>
  <template v-else>
    <div class="list-group">
      <a v-for="character in characters" :key="character.id" href="#" class="list-group-item list-group-item-action active">
        <Suspense>
          <template #fallback>
            <div>Loading {{ character.id }}</div>
          </template>
          <CharacterListItem :character-id="character.id" />
        </Suspense>
      </a>
    </div>
    <ol>
      <li v-for="character in characters">
        <img :src="character.get_thumbnail_sync(128)">
        {{ character }}
      </li>
    </ol>
  </template>
</template>

<style scoped>

</style>
