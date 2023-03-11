<script setup lang="ts">
import * as _ from 'lodash-es'
import Fuse from 'fuse.js'
import { useCharacterStore } from '~/stores/characters'
import { useDescriptionStore } from '~/stores/descriptions'
const props = defineProps(['category', 'freeValue', 'characterId'])
const emit = defineEmits<{
  (e: 'selected'): void
}>()

const name = 'SimpleTraitPick'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)

const descriptionStore = useDescriptionStore()
const descriptions = await descriptionStore.getDescriptionsForCategory(props.category)
const filter = ref('')

const router = useRouter()

async function selectDescription(description) {
  await character.value.update_text(props.target, description.get('name'))
  triggerRef(character)
  emit('selected')
}

const specialCategory = computed(() => {
  if (props.category == 'disciplines')
    return ['in clan disciplines']
  else if (props.category == 'wta_gifts')
    return ['affinity', 'show_only_value_1']
  return []
})

const categoryFilteredDescriptions = computed(async () => {
  const requireSpecializations = _.chain([...descriptions]).filter((model) => {
    if (model.get('requirement') == 'requires_specialization')
      return true
    return false
  }).map('attributes').map('name').value()
  const traitNames = _.chain(character.value.get(self.category))
    .map('attributes')
    .map('name')
    .without(requireSpecializations)
    .value()
  let descriptionItems
  if (_.includes(specialCategory.value, 'in clan disciplines')) {
    const icd = _.without(await character.value.get_in_clan_disciplines(), undefined)
    descriptionItems = _.chain([...descriptions])
    if (icd.length != 0) {
      descriptionItems = descriptionItems.filter((model) => {
        if (_.includes(traitNames, model.get('name')))
          return false

        if (_.includes(icd, model.get('name')))
          return true

        return false
      })
    }
    descriptionItems = descriptionItems.value()
  }
  else if (_.includes(specialCategory.value, 'affinity')) {
    const icd = _.without(await character.value.get_affinities(), undefined)
    descriptionItems = _.chain([...descriptions])
    if (icd.length != 0) {
      descriptionItems = descriptionItems.filter((model) => {
        if (_.includes(traitNames, model.get('name')))
          return false

        return _.some(_.map(_.range(1, 4), (i) => {
          if (_.includes(icd, model.get(`affinity_${i}`)))
            return true
          else
            return false
        }))
        return false
      })
    }
    descriptionItems = descriptionItems.value()
  }
  else {
    descriptionItems = _.chain([...descriptions]).filter((model) => {
      if (!_.includes(traitNames, model.get('name')))
        return true

      return false
    }).value()
  }
  if (_.includes(specialCategory.value, 'show_only_value_1')) {
    descriptionItems = _.filter(descriptionItems, (model) => {
      return model.get('value') == 1
    })
  }
  return descriptionItems
})

const filteredDescriptions = computed(() => {
  if (filter.value.trim() === '')
    return [...categoryFilteredDescriptions.value]
  const fuse = new Fuse(categoryFilteredDescriptions.value, { keys: ['attributes.name'] })
  const filtered = fuse.search(filter.value)
  return _.map(filtered, 'item')
})
</script>

<template>
  <div class="list-group">
    <slot />
    <form class="p-2 mb-2 bg-light border-bottom">
      <input v-model="filter" type="search" class="form-control" autocomplete="false" placeholder="Type to filter...">
    </form>
    <button v-for="description in filteredDescriptions" class="list-group-item list-group-item-action text-start" @click="selectDescription(description)">
      {{ description.get("name") }}
    </button>
  </div>
</template>

<style scoped>

</style>
