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

const picking = reactive({ clans: false })
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
  <template v-if="picking.clans">
    <button @click="picking.clans = false">
      Done Picking Clan
    </button>
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
  <template v-else>
    <button @click="picking.clans = true">
      Local Pick Clan
    </button>
  </template>
</template>

<style scoped>

</style>
