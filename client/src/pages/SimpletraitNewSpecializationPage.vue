<script setup lang="ts">
/**
 * Name a specialization for a trait that does not exist yet --
 * `#simpletrait-new-specialization`.
 *
 * A port of `SimpleTraitNewSpecializationView.js` and the
 * `#simpleTraitSpecialization` template at `index.html:844`.
 *
 * ## A specialization is part of the trait's NAME
 *
 * There is no `specialization` column. `"Allies: The Night Watch"` is stored in
 * `name`, and `get_base_name()` / `get_specialization()` split it on `": "`
 * (`@/domain/SimpleTrait`). That is why this screen exists at all, and why the
 * sibling screen for an EXISTING trait has to go through `update_trait` and can
 * be refused: renaming a trait can collide with another one.
 *
 * Here nothing is saved. The trait is built from the URL, given its
 * specialization, and handed on to the trait-change screen through the hash --
 * which is where a value and a cost are chosen and the row is finally written.
 * So the Save button on this page commits nothing, and cancelling loses nothing.
 *
 * The help text above the field is the `Description` row whose `name` STARTS
 * WITH the trait's base name, in the same category. `startsWith` rather than
 * equality is deliberate: it is how "Allies" finds the help for "Allies", and
 * how a trait that already carries a specialization still finds it.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { descriptionQueryForSpecialization, type Description } from '@/domain/Description'
import { reportErrorOn } from '@/domain/errors'
import {
  setTraitSpecialization,
  traitBaseName,
  traitSpecialization,
} from '@/domain/SimpleTrait'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const category = computed(() => route.params.category as string)
const cid = computed(() => route.params.cid as string)
/*
 * The name arrives percent-encoded, because a trait name can contain the `/`
 * that separates the route's own segments. `_.parseInt(value) || 0` for the two
 * numbers: they come off the URL, and `SimpleTraitMixin.validate` rejects a
 * non-finite value. Parse 1.5 constructed silently and never validated; parse@8
 * throws.
 */
const name = computed(() => decodeURIComponent(route.params.name as string))
const value = computed(() => Number.parseInt(route.params.value as string, 10) || 0)
const freeValue = computed(() => Number.parseInt(route.params.free_value as string, 10) || 0)

useBackHref(() => `#simpletraits/${category.value}/${cid.value}/all`)

/** A plain holder: nothing here is a Parse row yet. */
const working = ref({ name: name.value })
const nameReader = {
  get: (_attribute: 'name') => working.value.name,
  set: (_attribute: 'name', v: string) => {
    working.value.name = v
  },
}

const baseName = computed(() => traitBaseName(nameReader))
const specialization = ref('')
const description = shallowRef<Description | null>(null)
/** False until the help text has been looked up; see the note in `JqmPage.vue`. */
const loaded = ref(false)

onMounted(async () => {
  specialization.value = traitSpecialization(nameReader) ?? ''
  try {
    description.value =
      (await ui.runWork(() =>
        descriptionQueryForSpecialization(category.value, baseName.value).first(),
      )) ?? null
  } catch (error) {
    await reportErrorOn("Couldn't load the help for that trait")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})

function cancel() {
  window.location.hash = `#simpletraits/${category.value}/${cid.value}/all`
}

function save() {
  setTraitSpecialization(nameReader, specialization.value)
  const trait = working.value.name
  window.location.hash =
    `#simpletrait/spacer/${category.value}/${cid.value}/` +
    `${encodeURIComponent(trait)}/${value.value}/${freeValue.value}/new`
}
</script>

<template>
  <JqmPage id="simpletrait-new-specialization" title="Simple Trait Specialization" :ready="loaded">
    <p>{{ description?.get('help_specialization') ?? '' }}</p>
    <form @submit.prevent="save">
      <label for="specialization">Specialization for {{ baseName }}:</label>
      <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
        <input id="specialization" v-model="specialization" type="text" name="specialization" />
      </div>
    </form>
    <p>
      <button class="cancel ui-btn" @click="cancel">Cancel</button>
      <button class="save ui-btn" @click="save">Save Changes</button>
    </p>
  </JqmPage>
</template>
