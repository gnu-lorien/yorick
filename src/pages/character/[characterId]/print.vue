<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['characterId'])

const name = '[characterId]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
await character.value.fetch_all_simpletrait_categories()
await character.value.fetch_long_text('extended_print_text')

function getTraitSections() {
  const sections = []
  const sorted = character.value.all_simpletrait_categories()
  let section = null
  /*
  {
    heading: null,
    entries: [],
  }
   */
  for (const grouping of sorted) {
    const entry = {
      description: grouping[1],
      category: grouping[0],
    }
    const heading = grouping[2]
    if (section === null) {
      section = {
        heading,
        entries: [],
      }
    }
    if (heading !== section.heading) {
      sections.push(section)
      section = {
        heading,
        entries: [],
      }
    }
    section.entries.push(entry)
  }
  return sections
}

function getTextGroupings() {
  const groupings = []
  const sorted = character.value.all_text_attributes()
  for (const { name, upper } of sorted) {
    const d = {
      st: name,
      ust: upper,
    }
    groupings.push(d)
  }
  return groupings
}
</script>

<template>
  <div id="cpp-settings">
    Font size and include extended print text
  </div>
  <h1><FormatSimpleText :character="character" target="name" /> </h1>
</template>

<style scoped>

</style>
