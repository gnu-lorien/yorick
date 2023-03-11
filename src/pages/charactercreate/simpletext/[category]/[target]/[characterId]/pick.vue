<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['category', 'target', 'characterId'])

const name = '[new]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const creation = character.value.get('creation')

const route = useRoute()
const redirectTo = {
  name: 'charactercreate-characterId',
  params: { characterId: props.characterId },
}
</script>

<template>
  {{ redirectTo }}
  <Suspense>
    <template #fallback>
      Loading...
    </template>
    <SimpleTextNew
      :category="props.category"
      :target="props.target"
      :character-id="props.characterId"
      :redirect-to="redirectTo"
    />
  </Suspense>
</template>

<style scoped>

</style>
