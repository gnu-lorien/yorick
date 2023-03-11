<script setup lang="ts">
import * as _ from 'lodash-es'
import Fuse from 'fuse.js'
import { useCharacterStore } from '~/stores/characters'
import { useDescriptionStore } from '~/stores/descriptions'
const props = defineProps(['category', 'target', 'characterId', 'specialCategory'])
const emit = defineEmits<{
  (e: 'selected'): void
}>()

const name = 'SimpleTraitPick'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)

const descriptionStore = useDescriptionStore()
const descriptions = await descriptionStore.getDescriptionsForCategory(props.category)
const filter = ref('')

const router = useRouter()

async function selectDescription(description) {
  await character.value.update_text(props.target, description.get('name'))
  triggerRef(character)
  emit('selected')
}

const filteredDescriptions = computed(() => {
  if (filter.value.trim() === '')
    return [...descriptions]
  const fuse = new Fuse(descriptions, { keys: ['attributes.name'] })
  const filtered = fuse.search(filter.value)
  return _.map(filtered, 'item')
})
</script>

<template>
  <slot />
  <div class="list-group">
    <form class="p-2 mb-2 bg-light border-bottom">
      <input v-model="filter" type="search" class="form-control" autocomplete="false" placeholder="Type to filter...">
    </form>
    <button v-for="description in filteredDescriptions" class="list-group-item list-group-item-action text-start" @click="selectDescription(description)">
      {{ description.get("name") }}
    </button>
  </div>
</template>

<style scoped>

</style>
