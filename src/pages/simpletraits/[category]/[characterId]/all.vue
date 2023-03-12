<script setup>
import Fuse from 'fuse.js'
import * as _ from 'lodash-es'
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['category', 'characterId'])

const name = '[all]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const details = character.value.simpletrait_details(props.category)
await character.value.fetch_category(props.category)

const route = useRoute()
const redirectPath = route.path

const filter = ref('')

const filteredCategory = asyncComputed(async () => {
  if (!character.value.has(props.category))
    return []
  if (filter.value.trim() === '')
    return character.value.get(props.category)

  const fuse = new Fuse(character.value.get(props.category), { keys: ['attributes.name'] })
  const filtered = fuse.search(filter.value)
  return _.map(filtered, 'item')
}, [])
</script>

<template>
  <div>
    <router-link class="btn btn-primary" :to="{ name: 'simpletraits-category-characterId-new', params: { ...props }, query: { redirectPath } }">
      Add New {{ details.pretty }}
    </router-link>
  </div>
  <div v-if="character.has(props.category)" class="list-group">
    <form class="p-2 mb-2 bg-light border-bottom">
      <input v-model="filter" type="search" class="form-control" autocomplete="false" placeholder="Type to filter...">
    </form>
    <router-link v-for="e in filteredCategory" :to="{ name: 'simpletrait-category-characterId-simpleTraitId', params: { ...props, simpleTraitId: e.id } }" class="list-group-item list-group-item-action">
      {{ e.get("name") }} x{{ e.get("value") }}
    </router-link>
  </div>
</template>

<style scoped>

</style>
