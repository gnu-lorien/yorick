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
      Tis a werewolf!
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
      Tis a vampire!y
      <p>{{ character.get("sect") }} {{ character.get("archetype") }} {{ character.get("clan") }}</p>
      <template v-if="character.get('antecedence') || character.get('faction') || character.get('title')">
        <p>{{ character.get("antecedence") }} {{ character.get("faction") }} {{ character.get("title") }}</p>
      </template>
    </template>
    <template v-if="character.has('owner') && character.get('owner').get('username')">
      <p>{{ character.get('owner').get('realname') }} {{ character.get('owner').get('email') }} {{ character.get('owner').get('username') }}</p>
    </template>
    <template v-else>
      <p>DELETED</p>
    </template>
  </div>
</template>

<style scoped>

</style>
