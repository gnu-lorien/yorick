<script setup lang="ts">
/**
 * The new-troupe form -- `#troupe-new`.
 *
 * A port of `TroupeNewView.js` and `forms/TroupeForm.js`. Backform generated the
 * markup from a `fields` array; the eight fields are written out here for the
 * same reason they are in `CharacterNewPage.vue` -- the generator plus its
 * quirks is larger than the form it generates, and one of those quirks (values
 * reaching the model only on `change`) is why the E2E helpers dispatch events by
 * hand.
 *
 * Submitting does far more than save a row. `provisionTroupeRoles` mints the
 * troupe's three staff roles and hands the troupe to its LST; see the note there
 * for why the order and the ACLs are load-bearing. That cascade writes `_Role`
 * rows, so it only succeeds for an administrator.
 *
 * The failure branch is the source's, and it is worth naming because it looks
 * like a bug and is not: a failed save sends the user to `#administration`
 * rather than leaving the form up with a message. The troupe row may well have
 * been created before the role cascade failed, so re-submitting the form would
 * make a SECOND troupe; bouncing to the admin screen is what stops that.
 *
 * `#troupe-new-form`, the `name`/`shortname`/`shortdescription` input names and
 * the submit button are what `helpers/troupes.js:createTroupe` drives, and every
 * troupe fixture in the suite goes through it.
 */
import { ref } from 'vue'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { createTroupe, provisionTroupeRoles } from '@/domain/Troupe'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

useBackHref('#troupes')

/** `forms/TroupeForm.js`, in order. `spacer` sat before `description`. */
const TEXT_FIELDS = [
  { name: 'name', label: 'Name' },
  { name: 'shortname', label: 'Short Name' },
  { name: 'shortdescription', label: 'Short Public Description' },
  { name: 'location', label: 'Location' },
  { name: 'boundaries', label: 'Troupe Boundaries' },
  { name: 'staffemail', label: 'Staff Email Address' },
] as const

const AREA_FIELDS = [
  { name: 'description', label: 'Long Public Description' },
  { name: 'proxypolicy', label: 'Policies for Proxied Characters' },
] as const

const values = ref<Record<string, string>>({
  name: '',
  shortname: '',
  shortdescription: '',
  location: '',
  boundaries: '',
  staffemail: '',
  description: '',
  proxypolicy: '',
})

const busy = ref(false)

async function submit() {
  busy.value = true
  try {
    await ui.runWork(async () => {
      // Only fields the user filled in are written, so a blank box does not
      // store an empty string where the column was previously absent.
      const attributes: Record<string, string> = {}
      for (const [key, value] of Object.entries(values.value)) {
        if (value !== '') attributes[key] = value
      }
      const troupe = await createTroupe(attributes).save()
      const provisioned = await provisionTroupeRoles(troupe)
      window.location.hash = `#troupe/${provisioned.id}`
    })
  } catch (error) {
    console.log('Failed to save troupe ' + (error as Error)?.message)
    window.location.hash = '#administration'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <JqmPage id="troupe-new" title="New Troupe">
    <form id="troupe-new-form" @submit.prevent="submit">
      <template v-for="field in TEXT_FIELDS" :key="field.name">
        <label :for="`troupe-new-${field.name}`">{{ field.label }}</label>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input
            :id="`troupe-new-${field.name}`"
            v-model="values[field.name]"
            type="text"
            :name="field.name"
          />
        </div>
      </template>

      <!-- Backform's `spacer` control, which rendered an empty row. -->
      <div class="ui-block-a"></div>

      <template v-for="field in AREA_FIELDS" :key="field.name">
        <label :for="`troupe-new-${field.name}`">{{ field.label }}</label>
        <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <textarea
            :id="`troupe-new-${field.name}`"
            v-model="values[field.name]"
            :name="field.name"
            rows="5"
          ></textarea>
        </div>
      </template>

      <button type="submit" class="ui-btn ui-shadow ui-corner-all" :disabled="busy">Add New</button>
    </form>
  </JqmPage>
</template>
