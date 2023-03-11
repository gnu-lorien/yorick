<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['characterId'])

const name = '[new]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const creation = character.value.get('creation')

const route = useRoute()
const redirectTo = {
  name: route.name,
  params: route.params,
}
</script>

<template>
  <p>You have {{ creation.get("initial_xp") }} initial XP to spend</p>
  <p>Remaining steps for {{ character.get("name") }}</p>

  {{ character.get("clan") }}
  <router-link
    :to="{ name: 'charactercreate-simpletext-category-target-characterId-pick', params: { category: 'clans', target: 'clan', characterId: props.characterId } }"
  >
    Pick Clan
  </router-link>
  <Suspense>
    <template #fallback>
      Loading...
    </template>
    <SimpleTextNew
      category="clans"
      target="clan"
      :character-id="props.characterId"
      redirect-to=""
    />
  </Suspense>
</template>

<style scoped>

</style>
