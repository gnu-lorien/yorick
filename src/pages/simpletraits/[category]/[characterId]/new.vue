<script setup>
import * as _ from 'lodash-es'
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['category', 'characterId'])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const details = character.value.simpletrait_details(props.category)
const router = useRouter()
const route = useRoute()

function redirectOnSelected(trait) {
  const redirectPath = _.get(route, 'query.redirectPath', '')
  if (redirectPath) {
    router.push({ path: redirectPath })
    return
  }
  router.push({ name: 'simpletrait-category-characterId-simpleTraitId', params: { ...props, simpleTraitId: trait.id } })
}
</script>

<template>
  <Suspense>
    <template #fallback>
      Loading...
    </template>
    <SimpleTraitPick
      :category="props.category"
      :character-id="props.characterId"
      @selected.once="(trait) => redirectOnSelected(trait)"
    >
      New trait for {{ details.pretty }}
    </SimpleTraitPick>
  </Suspense>
</template>

<style scoped>

</style>
