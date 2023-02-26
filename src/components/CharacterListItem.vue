<script setup>
import { useCharacterStore } from '~/stores/characters'

const props = defineProps(['characterId'])
const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
</script>

<template>
  <img :src="character.get_thumbnail_sync(128)" class="rounded float-start">
  <h5 class="mb-1 text-start ps-5">
    {{ character.get('name') }}
  </h5>
  <template v-if="character.get('type') === 'Werewolf'">
    <template v-if="character.get('wta_tribe') || character.get('wta_breed') || character.get('wta_auspice')">
      <p>{{ character.get("wta_tribe") }} {{ character.get("wta_breed") }} {{ character.get("wta_auspice") }}</p>
    </template>
    <p>{{ character.get("wta_faction") }} {{ character.get("archetype") }} {{ character.get("wta_camp") }}</p>
    <p>{{ character.get("antecedence") }}</p>
  </template>
  <template v-else-if="character.get('type') === 'ChangelingBetaSlice'">
    Changeling's not supported yet
  </template>
  <template v-else>
    <p class="text-start ps-5">
      {{ character.get("sect") }} {{ character.get("archetype") }} {{ character.get("clan") }}
    </p>
    <template v-if="character.get('antecedence') || character.get('faction') || character.get('title')">
      <p class="text-start ps-5">
        {{ character.get("antecedence") }} {{ character.get("faction") }} {{ character.get("title") }}
      </p>
    </template>
  </template>
  <template v-if="character.has('owner') && character.get('owner').get('username')">
    <p class="text-start ps-5">
      {{ character.get('owner').get('realname') }} {{ character.get('owner').get('email') }} {{ character.get('owner').get('username') }}
    </p>
  </template>
  <template v-else>
    <p class="text-start ps-5">
      DELETED
    </p>
  </template>
</template>

<style scoped>

</style>
