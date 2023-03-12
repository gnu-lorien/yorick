<script setup>
import * as _ from 'lodash-es'
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['category', 'characterId'])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const details = character.value.simpletrait_details(props.category)
const router = useRouter()
const route = useRoute()

const redirectPath = _.get(route, 'query.redirectPath', '')
const redirectTo = redirectPath ? { path: redirectPath } : ''
</script>

<template>
  <Suspense>
    <template #fallback>
      Loading...
    </template>
    <SimpleTraitPick
      :category="props.category"
      :character-id="props.characterId"
      @selected.once="router.push(redirectTo)"
    >
      New trait for {{ details.pretty }}
    </SimpleTraitPick>
  </Suspense>
</template>

<style scoped>

</style>
