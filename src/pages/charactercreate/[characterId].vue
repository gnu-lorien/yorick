<script setup>
import * as _ from 'lodash-es'
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

const picking = reactive({})

for (const { name } of character.value.all_text_attributes())
  picking[name] = false

function allTexts() {
  const texts = []
  for (const attributes of character.value.all_text_attributes()) {
    const d = {
      ...attributes,
      pickText: character.value.get(name) ? 'Repick' : 'Pick',
    }
    texts.push(d)
  }
  return texts
}
</script>

<template>
  <p>You have {{ creation.get("initial_xp") }} initial XP to spend</p>
  <p>Remaining steps for {{ character.get("name") }}</p>

  <template v-for="{ name, category, upper, pickText } in allTexts()">
    <div v-if="character.get(name)">
      {{ character.get(name) }}
    </div>
    <router-link
      :to="{ name: 'charactercreate-simpletext-category-target-characterId-pick', params: { category, target: name, characterId: props.characterId } }"
    >
      {{ pickText }} {{ upper }}
    </router-link>
    <template v-if="picking[name]">
      <button @click="picking[name] = false">
        Done Picking {{ upper }}
      </button>
      <Suspense>
        <template #fallback>
          Loading...
        </template>
        <SimpleTextNew
          :category="category"
          :target="name"
          :character-id="props.characterId"
          @selected.once="picking[name] = false"
        />
      </Suspense>
    </template>
    <template v-else>
      <button @click="picking[name] = true">
        Pick {{ upper }}
      </button>
    </template>
  </template>
</template>

<style scoped>

</style>
