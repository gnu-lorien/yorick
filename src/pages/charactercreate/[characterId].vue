<script setup>
import * as _ from 'lodash-es'
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['characterId'])

const name = '[new]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const creation = computed(() => {
  return character.value.get('creation')
})

const route = useRoute()
const redirectTo = {
  name: route.name,
  params: route.params,
}

const picking = reactive({})

for (const { name } of character.value.all_text_attributes())
  picking[name] = false

for (const category of character.value.all_simpletrait_categories())
  picking[category[0]] = false

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

const attributePicking = computed(() => {
  const creation = character.value.get('creation')
  const results = {
    name: 'attributes',
    remaining: creation.remaining_picks('attributes'),
    unpicks: [],
    picks: [],
  }
  _.each(_.range(8, 0, -1), (i) => {
    const n = `attributes_${i}_remaining`
    _.each(creation.get(`attributes_${i}_picks`), (st) => {
      results.unpicks.push({ st, i })
    })
    _.each(_.range(creation.get(n)), () => {
      results.picks.push(i)
    })
  })
  return results
})
</script>

<template>
  <p>You have {{ creation.get("initial_xp") }} initial XP to spend</p>
  <p>Remaining steps for {{ character.get("name") }}</p>

  <div v-for="{ name, category, pretty, pickText } in allTexts()" class="container p-1 m-1">
    <template v-if="character.get(name)">
      {{ character.get(name) }}
    </template>
    <template v-if="picking[name]">
      <button @click="picking[name] = false">
        Done {{ pretty }}
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
        {{ pickText }} {{ pretty }}
      </button>
    </template>
  </div>

  <div class="list-group">
    <div class="list-group-item list-group-item-secondary d-flex justify-content-between align-items-start">
      Attributes
      <span class="badge bg-secondary rounded-pill">{{ attributePicking.remaining }}</span>
    </div>
    <div v-for="toUnpick in attributePicking.unpicks" class="list-group-item d-flex justify-content-between">
      {{ toUnpick.st.get("name") }} x{{ toUnpick.st.get("value") }} <button>Delete</button>
    </div>
    <div v-for="toPick in attributePicking.picks" class="list-group-item align-items-start d-flex justify-content-between">
      <template v-if="picking[attributePicking.name]">
        <button @click="picking[attributePicking.name] = false">
          Done picking {{ attributePicking.name }} at rating {{ toPick }}
        </button>
        <Suspense>
          <template #fallback>
            Loading...
          </template>
          <SimpleTraitPick
            :category="attributePicking.name"
            :free-value="toPick"
            :character-id="props.characterId"
            @selected.once="picking[attributePicking.name] = false"
          >
            Pick one for value {{ toPick }}
          </SimpleTraitPick>
        </Suspense>
      </template>
      <button v-else @click="picking[attributePicking.name] = true">
        Pick {{ attributePicking.name }} at rating {{ toPick }}
      </button>
    </div>
  </div>
</template>

<style scoped>

</style>
