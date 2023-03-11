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

const router = useRouter()

async function selectDescription(description) {
  await character.value.update_text(props.target, description.get('name'))
  triggerRef(character)
  router.push(props.redirectTo)
}
</script>

<template>
  <div class="list-group">
    <button v-for="description in descriptions" class="list-group-item list-group-item-action text-start" @click="selectDescription(description)">
      {{ description.get("name") }}
    </button>
  </div>
</template>

<style scoped>

</style>
