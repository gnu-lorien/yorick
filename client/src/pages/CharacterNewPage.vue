<script setup lang="ts">
/**
 * The new-character form -- `#character-new`.
 *
 * A port of `CharacterNewView.js`, which was a `Backform.Form` over a two-field
 * model. Backform is not ported: it generated this markup from a `fields` array,
 * and two fields written out are smaller than the generator plus its quirks --
 * chiefly that its controls copy their DOM value into the model only on
 * `change`, which is why `fillBackformInput` in the E2E helpers dispatches one
 * by hand.
 *
 * One Backform detail is deliberately NOT reproduced: `SelectControl` ran option
 * values through `Backform.JSONFormatter`, so the DOM value of the Vampire
 * option was the six characters `"Vampire"` -- quotes included. The E2E helper
 * that drives these selects resolves options by their visible TEXT and reads
 * back whatever value the browser assigned, precisely so it does not depend on
 * that; plain values are what a select should have had all along.
 *
 * The venue is chosen here and nowhere else: this is the one screen that decides
 * which of the three creature types a row becomes.
 */
import { ref } from 'vue'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { venueFor, type VenueKey } from '@/domain/venues'
import { get_character } from '@/domain/Character'
import { getLatestPatronage } from '@/domain/Patronage'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

useBackHref('#characters?all')

const VENUES: { label: string; value: VenueKey }[] = [
  { label: 'Vampire', value: 'Vampire' },
  { label: 'Werewolf', value: 'Werewolf' },
  { label: 'Changeling', value: 'ChangelingBetaSlice' },
]

const name = ref('New Character Name')
const type = ref<VenueKey>('Vampire')
const nameError = ref('')
const busy = ref(false)

async function create() {
  nameError.value = ''
  if (!name.value.trim()) {
    nameError.value = 'Name cannot be empty.'
    return
  }
  busy.value = true
  try {
    const character = await ui.runWork(() =>
      venueFor(type.value).create(name.value, {
        get_latest_patronage: getLatestPatronage,
        get_character: (id: string) => get_character(id) as never,
        progress: (text: string) => ui.progress(text),
      } as never),
    )
    window.location.hash = `#character?${(character as { id?: string }).id}`
  } catch (error) {
    // The original logged this and left the form up, which is what it does here.
    console.log('Failed to save a character', (error as Error)?.message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <JqmPage id="character-new" title="New Character">
    <form id="character-new-form" @submit.prevent="create">
      <label for="character-new-name">Character Name</label>
      <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
        <input id="character-new-name" v-model="name" type="text" name="name" />
      </div>
      <p v-if="nameError" class="error">{{ nameError }}</p>

      <label for="character-new-type">Venue</label>
      <div class="ui-select">
        <div class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
          <span>{{ VENUES.find((v) => v.value === type)?.label }}</span>
          <select id="character-new-type" v-model="type" name="type">
            <option v-for="v in VENUES" :key="v.value" :value="v.value">{{ v.label }}</option>
          </select>
        </div>
      </div>

      <button type="submit" class="ui-btn ui-shadow ui-corner-all" :disabled="busy">
        Create New Character
      </button>
    </form>
  </JqmPage>
</template>
