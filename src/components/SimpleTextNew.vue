<script setup>
import { useCharacterStore } from '~/stores/characters'
import { useDescriptionStore } from '~/stores/descriptions'
const props = defineProps(['category', 'target', 'characterId', 'redirectTo'])

const name = '[new]'
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
  router.push(props.redirectTo)
}

const filteredDescriptions = computed(() => {
  if (filter.value.trim() === '')
    return [...descriptions]
  const filtered = []
  for (const description of descriptions) {
    if (description.get('name').toLowerCase().startsWith(filter.value.toLowerCase()))
      filtered.push(description)
  }
  return filtered
})
</script>

<template>
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
