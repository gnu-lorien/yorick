<script setup lang="ts">
/**
 * Rename an EXISTING trait's specialization -- `#simpletrait-specialization`.
 *
 * A port of `SimpleTraitSpecializationView.js` and the shared
 * `#simpleTraitSpecialization` template at `index.html:844`.
 *
 * Two routes render it, and they differ only in where they go afterwards:
 *
 *  - `#simpletrait/specialize/:category/:cid/:bid` returns to the trait list.
 *  - `#charactercreate/simpletraits/:category/:cid/specialize/:stid/:i` returns
 *    to the creation wizard, and CANCELLING returns to the same wizard step it
 *    was opened from (`window.location.hash` at open time, in the source).
 *
 * ## Unlike its new-trait sibling, this one writes
 *
 * A specialization is part of the trait's `name` (see `@/domain/SimpleTrait`),
 * so setting one is a rename, and a rename goes through `update_trait` --
 * which can be REFUSED, because the new name may collide with a trait the
 * character already has.
 *
 * That refusal is real and the name genuinely never persists, but until
 * recently the only trace of it was a `console.log` no player ever saw. The
 * error is reported before the redirect, and the banner follows the redirect,
 * which is why `reportError` lives outside any one page.
 *
 * On failure the redirect is the CANCEL destination, not the save one: the edit
 * did not happen, so the user goes back where they came from rather than
 * onwards as though it had.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { descriptionQueryForSpecialization, type Description } from '@/domain/Description'
import { clearError, reportError, reportErrorOn } from '@/domain/errors'
import { setTraitSpecialization, traitBaseName, traitSpecialization } from '@/domain/SimpleTrait'
import type Parse from '@/parse'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const category = computed(() => route.params.category as string)
const cid = computed(() => route.params.cid as string)
/** `:bid` on the trait-list route, `:stid` on the creation one. Same thing. */
const traitId = computed(() => (route.params.bid ?? route.params.stid) as string)
const duringCreation = computed(() => route.meta.handler === 'charactercreatespecializesimpletrait')

const listHref = computed(() => `#simpletraits/${category.value}/${cid.value}/all`)
const wizardHref = computed(() => `#charactercreate/${cid.value}`)

useBackHref(() => (duringCreation.value ? wizardHref.value : listHref.value))

/**
 * Where Cancel goes.
 *
 * The creation route passed `window.location.hash` AS IT WAS WHEN THE ROUTE
 * RAN, so cancelling returns to this very screen -- which is what the source
 * does, and which reads as "nothing happened" because the screen is unchanged.
 * Captured on mount rather than read at click time, so a later navigation
 * cannot move it.
 */
const cancelHref = ref('')

const character = shallowRef<Character | null>(null)
const trait = shallowRef<Parse.Object | null>(null)
const description = shallowRef<Description | null>(null)
const specialization = ref('')
const baseName = ref('')
/** False until the trait and its help text are in hand. */
const loaded = ref(false)

onMounted(async () => {
  cancelHref.value = duringCreation.value ? window.location.hash : listHref.value
  try {
    await ui.runWork(async () => {
      const c = await get_character(cid.value, [category.value])
      character.value = c
      const [found] = await c.get_trait(category.value, traitId.value)
      if (!found) throw new Error('No such trait: ' + traitId.value)
      trait.value = found
      baseName.value = traitBaseName(found as never)
      specialization.value = traitSpecialization(found as never) ?? ''
      description.value =
        (await descriptionQueryForSpecialization(category.value, baseName.value).first()) ?? null
    })
  } catch (error) {
    await reportErrorOn("Couldn't open that trait")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})

function cancel() {
  window.location.hash = cancelHref.value
}

async function save() {
  const c = character.value
  const t = trait.value
  if (!c || !t) return

  setTraitSpecialization(t as never, specialization.value)
  try {
    await ui.runWork(() => c.update_trait(t))
    clearError()
    window.location.hash = duringCreation.value ? wizardHref.value : listHref.value
  } catch (error) {
    await reportError(error, "Couldn't rename this trait").catch(() => {})
    window.location.hash = cancelHref.value
  }
}
</script>

<template>
  <JqmPage id="simpletrait-specialization" title="Simple Trait Specialization" :ready="loaded">
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
