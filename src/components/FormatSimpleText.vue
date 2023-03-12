<script setup>
import * as _ from 'lodash-es'
const props = defineProps(['character', 'target'])

const character = shallowRef(props.character)

const transform = computed(() => {
  if (!character.value.transform_description)
    return null
  const matcher = {
    name: target,
    category: 'core',
  }
  if (_.find(character.transform_description, matcher)) {
    const results = {
      priors: [],
      current: '',
    }
    results.priors = _.chain(character.transform_description)
      .select(matcher)
      .reject({ old_text: undefined })
      .reverse()
      .map('old_text')
      .value()
    results.current = character.get(target)
    return results
  }
  return null
})
</script>

<template>
  <span v-if="transform">
    <span v-for="prior in transform.priors" style="color: indianred"><i class="fa fa-minus">{{ prior }}</i></span>
    <span style="color: darkseagreen"><i class="fa fa-plus">{{ current }}</i></span>
  </span>
  <span v-else>{{ character.get(target) }}</span>
</template>

<style scoped>

</style>
