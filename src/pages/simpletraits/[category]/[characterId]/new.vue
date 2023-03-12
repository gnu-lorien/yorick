<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['category', 'characterId'])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const details = character.value.simpletrait_details(props.category)
</script>

<template>
  <Suspense>
    <template #fallback>
      Loading...
    </template>
    <SimpleTraitPick
      :category="props.category"
      :character-id="props.characterId"
      @selected.once="picking = false"
    >
      New trait for {{ details.pretty }}
    </SimpleTraitPick>
  </Suspense>
</template>

<style scoped>

</style>
