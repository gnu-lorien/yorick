<script setup lang="ts">
import * as _ from 'lodash-es'
import Fuse from 'fuse.js'
import { FauxTrait } from '~/helpers/FauxTrait'
import { SimpleTrait } from '~/models/SimpleTrait'
import { useCharacterStore } from '~/stores/characters'
import { useDescriptionStore } from '~/stores/descriptions'
const props = defineProps(['category', 'characterId', 'simpleTraitId'])
const emit = defineEmits<{
  (e: 'selected'): void
}>()

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const trait = await character.value.get_trait(props.category, props.simpleTraitId)
</script>

<template>
  <Suspense>
    <template #fallback>
      Loading...
    </template>
    <SimpleTraitView
      :category="props.category"
      :character-id="props.characterId"
      :trait="trait"
      @selected.once="(trait) => redirectOnSelected(trait)"
    >
      New trait for {{ details.pretty }}
    </SimpleTraitView>
  </Suspense>
</template>

<style scoped>

</style>
