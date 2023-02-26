<script setup>
import { useCharacterStore } from '~/stores/characters'

const props = defineProps(['characterId'])
const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
</script>

<template>
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
</template>

<style scoped>

</style>
