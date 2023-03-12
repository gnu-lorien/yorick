<script setup>
import * as _ from 'lodash-es'
import { FauxTrait } from '~/helpers/FauxTrait'
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['category', 'characterId'])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const details = character.value.simpletrait_details(props.category)
const router = useRouter()
const route = useRoute()

const picking = ref(true)
const fauxtrait = ref({})

function redirectOnSelected(trait) {
  const redirectPath = _.get(route, 'query.redirectPath', '')
  if (redirectPath) {
    router.push({ path: redirectPath })
    return
  }
  router.push({ name: 'simpletrait-category-characterId-simpleTraitId', params: { ...props, simpleTraitId: trait.id } })
}

function switchToEditing(trait) {
  fauxtrait.value = trait
  picking.value = false
}
</script>

<template>
  <Suspense v-if="picking">
    <template #fallback>
      Loading...
    </template>
    <SimpleTraitPick
      :category="props.category"
      :character-id="props.characterId"
      :faux="true"
      @selected.once="(trait) => switchToEditing(trait)"
    >
      New trait for {{ details.pretty }}
    </SimpleTraitPick>
  </Suspense>
  <Suspense v-else>
    <template #fallback>
      Loading...
    </template>
    <SimpleTraitView
      :category="props.category"
      :character-id="props.characterId"
      :fauxtrait="fauxtrait"
      @selected.once="(trait) => redirectOnSelected(trait)"
    >
      New trait for {{ details.pretty }}
    </SimpleTraitView>
  </Suspense>
</template>

<style scoped>

</style>
