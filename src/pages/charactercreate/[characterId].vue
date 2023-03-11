<script setup>
import * as _ from 'lodash-es'
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['characterId'])

const name = '[new]'
defineExpose([name])

const router = useRouter()

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)
const creation = computed(() => {
  return character.value.get('creation')
})

await character.value.fetch_creation_categories()

const route = useRoute()
const redirectTo = {
  name: route.name,
  params: route.params,
}

const picking = ref(false)

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
    pretty: 'Attributes',
    remaining: creation.remaining_picks('attributes'),
    unpicks: [],
    picks: [],
  }
  _.each(_.range(8, 0, -1), (i) => {
    const n = `attributes_${i}_remaining`
    _.each(creation.get(`attributes_${i}_picks`), (st) => {
      results.unpicks.push({ st, i })
    })
    _.each(_.range(creation.get(n)), (inner) => {
      results.picks.push({ i, picking: `attributes_${i}_${inner}` })
    })
  })
  return results
})

async function unpick(category, st, i) {
  await character.value.unpick_from_creation(category, st.id, i)
  triggerRef(character)
}

const focusPicking = computed(() => {
  const creation = character.value.get('creation')
  const totalResults = []
  _.each(_.zip(['Physical', 'Social', 'Mental'], ['focus_physicals', 'focus_socials', 'focus_mentals']), (z) => {
    const target = z[1]
    const results = {
      name: target,
      pretty: character.value.simpletrait_details(target).pretty,
      remaining: creation.remaining_picks(target),
      unpicks: [],
      picks: [],
    }
    _.each(_.range(2, 0, -1), (i) => {
      const n = `${target}_${i}_remaining`
      _.each(creation.get(`${target}_${i}_picks`), (st) => {
        results.unpicks.push({
          st,
          i,
        })
      })
      _.each(_.range(creation.get(n)), (inner) => {
        results.picks.push({
          i,
          picking: `${target}_${i}_${inner}`,
        })
      })
    })
    totalResults.push(results)
  })
  return totalResults
})

const skillsPicking = computed(() => {
  const creation = character.value.get('creation')
  const target = 'skills'
  const results = {
    name: target,
    pretty: character.value.simpletrait_details(target).pretty,
    remaining: creation.remaining_picks(target),
    unpicks: [],
    picks: [],
  }
  _.each(_.range(4, 0, -1), (i) => {
    const n = `${target}_${i}_remaining`
    _.each(creation.get(`${target}_${i}_picks`), (st) => {
      results.unpicks.push({
        st,
        i,
      })
    })
    _.each(_.range(creation.get(n)), (inner) => {
      results.picks.push({
        i,
        picking: `${target}_${i}_${inner}`,
      })
    })
  })
  return [results]
})

const bottomPicking = computed(() => {
  const creation = character.value.get('creation')
  const totalResults = []
  _.each([['backgrounds', true], ['disciplines', true], ['merits', false], ['flaws', false]], (z) => {
    const target = z[0]
    const results = {
      name: target,
      pretty: character.value.simpletrait_details(target).pretty,
      remaining: creation.remaining_picks(target),
      unpicks: [],
      picks: [],
      hasRating: z[1],
    }
    _.each(_.range(10, -1, -1), (i) => {
      const n = `${target}_${i}_remaining`
      _.each(creation.get(`${target}_${i}_picks`), (st) => {
        results.unpicks.push({
          st,
          i,
        })
      })
      _.each(_.range(creation.get(n)), (inner) => {
        results.picks.push({
          i,
          picking: `${target}_${i}_${inner}`,
        })
      })
    })
    totalResults.push(results)
  })
  return totalResults
})

async function complete() {
  await character.value.complete_character_creation()
  router.push({ name: 'character-characterId', params: { characterId: character.value.id } })
}
</script>

<template>
  <p>You have {{ creation.get("initial_xp") }} initial XP to spend</p>
  <p>Remaining steps for {{ character.get("name") }}</p>

  <div v-for="{ name, category, pretty, pickText } in allTexts()" class="container p-1 m-1">
    <template v-if="character.get(name)">
      {{ character.get(name) }}
    </template>
    <template v-if="picking === name">
      <button @click="picking = false">
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
          @selected.once="picking = false"
        />
      </Suspense>
    </template>
    <template v-else>
      <button @click="picking = name">
        {{ pickText }} {{ pretty }}
      </button>
    </template>
  </div>

  <div class="list-group mt-2">
    <div class="list-group-item list-group-item-secondary d-flex justify-content-between align-items-start">
      {{ attributePicking.pretty }}
      <span class="badge bg-secondary rounded-pill">{{ attributePicking.remaining }}</span>
    </div>
    <div v-for="toUnpick in attributePicking.unpicks" class="list-group-item d-flex justify-content-between">
      {{ toUnpick.st.get("name") }} x{{ toUnpick.st.get("value") }}
      <button class="btn btn-secondary" @click="unpick(attributePicking.name, toUnpick.st, toUnpick.i)">
        Delete
      </button>
    </div>
    <div v-for="toPick in attributePicking.picks" class="list-group-item align-items-start d-flex justify-content-between">
      <template v-if="picking === toPick.picking">
        <button @click="picking = false">
          Done picking {{ attributePicking.name }} at rating {{ toPick.i }}
        </button>
        <Suspense>
          <template #fallback>
            Loading...
          </template>
          <SimpleTraitPick
            :category="attributePicking.name"
            :free-value="toPick.i"
            :character-id="props.characterId"
            @selected.once="picking = false"
          >
            Pick one for value {{ toPick.i }}
          </SimpleTraitPick>
        </Suspense>
      </template>
      <button v-else @click="picking = toPick.picking">
        Pick {{ attributePicking.pretty }} at rating {{ toPick.i }}
      </button>
    </div>
  </div>

  <div v-for="attributePicking in focusPicking" class="list-group mt-2">
    <div class="list-group-item list-group-item-secondary d-flex justify-content-between align-items-start">
      {{ attributePicking.pretty }}
      <span class="badge bg-secondary rounded-pill">{{ attributePicking.remaining }}</span>
    </div>
    <div v-for="toUnpick in attributePicking.unpicks" class="list-group-item d-flex justify-content-between">
      {{ toUnpick.st.get("name") }} x{{ toUnpick.st.get("value") }}
      <button class="btn btn-secondary" @click="unpick(attributePicking.name, toUnpick.st, toUnpick.i)">
        Delete
      </button>
    </div>
    <div v-for="toPick in attributePicking.picks" class="list-group-item align-items-start d-flex justify-content-between">
      <template v-if="picking === toPick.picking">
        <button @click="picking = false">
          Done picking {{ attributePicking.name }} at rating {{ toPick.i }}
        </button>
        <Suspense>
          <template #fallback>
            Loading...
          </template>
          <SimpleTraitPick
            :category="attributePicking.name"
            :free-value="toPick.i"
            :character-id="props.characterId"
            @selected.once="picking = false"
          >
            Pick one for value {{ toPick.i }}
          </SimpleTraitPick>
        </Suspense>
      </template>
      <button v-else @click="picking = toPick.picking">
        Pick {{ attributePicking.pretty }} at rating {{ toPick.i }}
      </button>
    </div>
  </div>

  <div v-for="attributePicking in skillsPicking" class="list-group mt-2">
    <div class="list-group-item list-group-item-secondary d-flex justify-content-between align-items-start">
      {{ attributePicking.pretty }}
      <span class="badge bg-secondary rounded-pill">{{ attributePicking.remaining }}</span>
    </div>
    <div v-for="toUnpick in attributePicking.unpicks" class="list-group-item d-flex justify-content-between">
      {{ toUnpick.st.get("name") }} x{{ toUnpick.st.get("value") }}
      <button class="btn btn-secondary" @click="unpick(attributePicking.name, toUnpick.st, toUnpick.i)">
        Delete
      </button>
    </div>
    <div v-for="toPick in attributePicking.picks" class="list-group-item align-items-start d-flex justify-content-between">
      <template v-if="picking === toPick.picking">
        <button @click="picking = false">
          Done picking {{ attributePicking.name }} at rating {{ toPick.i }}
        </button>
        <Suspense>
          <template #fallback>
            Loading...
          </template>
          <SimpleTraitPick
            :category="attributePicking.name"
            :free-value="toPick.i"
            :character-id="props.characterId"
            @selected.once="picking = false"
          >
            Pick one for value {{ toPick.i }}
          </SimpleTraitPick>
        </Suspense>
      </template>
      <button v-else @click="picking = toPick.picking">
        Pick {{ attributePicking.pretty }} at rating {{ toPick.i }}
      </button>
    </div>
  </div>

  <div v-for="attributePicking in bottomPicking" class="list-group mt-2">
    <div class="list-group-item list-group-item-secondary d-flex justify-content-between align-items-start">
      {{ attributePicking.pretty }}
      <span class="badge bg-secondary rounded-pill">{{ attributePicking.remaining }}</span>
    </div>
    <div v-for="toUnpick in attributePicking.unpicks" class="list-group-item d-flex justify-content-between">
      {{ toUnpick.st.get("name") }} x{{ toUnpick.st.get("value") }}
      <button class="btn btn-secondary" @click="unpick(attributePicking.name, toUnpick.st, toUnpick.i)">
        Delete
      </button>
    </div>
    <div v-for="toPick in attributePicking.picks" class="list-group-item align-items-start d-flex justify-content-between">
      <template v-if="picking === toPick.picking">
        <button @click="picking = false">
          Done picking {{ attributePicking.name }} <span v-if="attributePicking.hasRating">at rating {{ toPick.i }}</span>
        </button>
        <Suspense>
          <template #fallback>
            Loading...
          </template>
          <SimpleTraitPick
            :category="attributePicking.name"
            :free-value="toPick.i"
            :character-id="props.characterId"
            @selected.once="picking = false"
          >
            <span v-if="attributePicking.hasRating">Pick one for value {{ toPick.i }}</span>
          </SimpleTraitPick>
        </Suspense>
      </template>
      <button v-else @click="picking = toPick.picking">
        Pick {{ attributePicking.pretty }} <span v-if="attributePicking.hasRating">at rating {{ toPick.i }}</span>
      </button>
    </div>
  </div>
  <button class="btn btn-primary" @click="complete()">
    Complete Character Creation!
  </button>
</template>

<style scoped>

</style>
