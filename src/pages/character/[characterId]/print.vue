<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['characterId'])

const name = '[characterId]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
await character.value.fetch_all_simpletrait_categories()
await character.value.fetch_long_text('extended_print_text')

const slidingValue = shallowRef(0)
function tisSelected() {
  triggerRef(character)
  console.log('Triggered the character ref')
}

const characterRef = computed(() => {
  return character.value
})
</script>

<template>
  <div id="cpp-settings hidden-when-printing">
    Font size and include extended print text
  </div>
  {{ character.get('title') }}
  <div id="cpp-header">
    <HeaderView :character="character" />
  </div>
  <h1><FormatSimpleText :character="characterRef" target="title" :count="slidingValue" /> </h1>
  <form class="p-2 mb-2 bg-light border-bottom">
    <label for="value-slider">Value:</label>
    <input id="value-slider" v-model.number="slidingValue" type="range" name="simpleTraitValue" class="value-slider" min="1" :max="10">
  </form>
  <div class="container p-1 m-1">
    <template v-if="character.get('title')">
      {{ character.get('title') }}
    </template>
    <Suspense>
      <template #fallback>
        Loading...
      </template>
      <SimpleTextNew
        category="titles"
        target="title"
        :character-id="props.characterId"
        @selected.once="tisSelected()"
      />
    </Suspense>
  </div>

  <div id="cpp-settings" class="hidden-when-printing" />
  <div id="cpp-header" />
  <div id="cpp-firstbar" />
  <div id="cpp-secondbar" />
  <div id="cpp-attributes" />
  <div class="ui-grid-b ui-responsive">
    <div id="cpp-blood" class="ui-block-a" />
    <div class="ui-block-b">
      <div id="cpp-willpower" />
      <div id="cpp-morality" />
    </div>
    <div id="cpp-health-levels" class="ui-block-c" />
  </div>
  <div class="ui-grid-b ui-responsive">
    <div id="cpp-total-a" class="ui-block-a" />
    <div id="cpp-total-b" class="ui-block-b" />
    <div id="cpp-total-c" class="ui-block-c" />
  </div>
  <div id="cpp-skills" />
  <div class="ui-grid-b ui-responsive">
    <div id="cpp-bottom-one-a" class="ui-block-a" />
    <div id="cpp-bottom-one-b" class="ui-block-b" />
    <div id="cpp-bottom-one-c" class="ui-block-c" />
  </div>
  <div class="ui-grid-b ui-responsive">
    <div id="cpp-bottom-two-a" class="ui-block-a" />
    <div id="cpp-bottom-two-b" class="ui-block-b" />
    <div id="cpp-bottom-two-c" class="ui-block-c" />
  </div>
  <div id="cpp-extended-print-text" class="ui-content" />
</template>

<style scoped></style>
