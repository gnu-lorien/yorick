<script setup lang="ts">
/**
 * Edit one trait -- `#simpletrait-change`.
 *
 * A port of `SimpleTraitChangeView.js` and the two templates at
 * `public/index.html:473` and `:488`. Two routes reach it: editing an existing
 * trait (`simpletrait/:category/:cid/:bid`) and creating one from the picker
 * (`simpletrait/spacer/:category/:cid/:name/:value/:free_value/new`).
 *
 * ## The working copy
 *
 * Every price quoted on this page is computed from a `fauxtrait` -- a detached
 * copy of the trait carrying the values the sliders currently show, so the
 * player sees what the change WOULD cost before committing it. Nothing is
 * written until Save.
 *
 * R31 is why the copy is rebuilt on every `register` rather than only when the
 * trait's object identity changes: the router handed back the same cached
 * instance for the life of the page, so after the first visit it never was
 * rebuilt and the copy kept the values it held when the page first opened.
 * Measured: after raising Physical 5->6 (quoted 3, charged 3), reopening and
 * sliding to 7 quoted 6 -- the cost from 5 -- rather than the 3-point
 * increment. The save was correct; the player was shown the wrong price. Here
 * the copy is built in `onMounted`, and the component is keyed on the route, so
 * it cannot outlive the trait it was made from.
 *
 * ## Two ways to save, and the fourth argument
 *
 * An EXISTING trait is written by setting the new values onto the real trait and
 * calling `update_trait(trait, undefined, undefined, 0)`. That fourth argument
 * is `free_value` and passing `0` is not cosmetic: R19.
 * `update_creation_rules_for_changed_trait` composes its key from it, so
 * `undefined` wrote the right number to `<category>_undefined_remaining` -- a
 * key nothing reads -- and left the real `<category>_0_remaining` stale, so the
 * creation pool a player was shown never moved. One shared file, so one fix
 * covered all three venues.
 *
 * A NEW trait is written by the seven-argument form instead, which carries the
 * picked free value through.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage, JqmSlider } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { clearError, reportErrorOn } from '@/domain/errors'
import { SimpleTraitObject } from '@/parse/classes'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const category = computed(() => route.params.category as string)
const cid = computed(() => route.params.cid as string)
/** Present when editing; absent when the picker is creating a new trait. */
const bid = computed(() => route.params.bid as string | undefined)

useBackHref(() => `#simpletraits/${category.value}/${cid.value}/all`)

/*
 * `shallowRef`, never `ref`.
 *
 * A `Parse.Object` must not be deep-proxied: `ref()` walks the object, hands
 * the SDK proxies where it expects its own instances, and UNWRAPS any nested
 * ref it finds -- which is how the XP ledger's `notations` (a `ShallowRef` on
 * `CharacterExperience`) silently became a plain array in one place and an
 * empty table in another. `@/parse/reactivity` is what makes mutations visible;
 * the ref only has to hold the reference.
 */
const character = shallowRef<Character | null>(null)
/** The real trait, when editing. Null for a brand-new one. */
const trait = shallowRef<Parse.Object | null>(null)
/** The detached working copy every quote is computed from. */
const faux = shallowRef<Parse.Object | null>(null)

const value = ref(1)
const freeValue = ref(0)
const specialization = ref('')
const experienceCostType = ref<'automatic' | 'flat' | 'linear'>('automatic')
const experienceCostModifier = ref(1)

/**
 * False until this page's data is in hand.
 *
 * `JqmPage` renders no content while it is false, which is what stops
 * `waitForActivePage` reporting the page settled before its list exists. See
 * the note in `JqmPage.vue`.
 */
const loaded = ref(false)

/**
 * The slider's upper bound.
 *
 * Per venue: skills cap at 10, everything else at 20. It is a function of the
 * TRAIT, not of the category name, because that is the shape the venue
 * strategies expose -- the trait carries its own category.
 */
const traitMax = computed(() => {
  const c = character.value
  const f = faux.value
  if (!c || !f) return 20
  return c.venue.max_trait_value(f as never)
})

onMounted(async () => {
  try {
    // One `runWork` for the whole load; see the note in SimpletextNewPage.
    const c = await ui.runWork(() => get_character(cid.value, [category.value]))
    character.value = c

    if (bid.value) {
      const found = ((c.get(category.value) as Parse.Object[] | undefined) ?? []).find(
        (t) => t && t.id === bid.value,
      )
      if (!found) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'That trait is not on this character')
      trait.value = found
      faux.value = new SimpleTraitObject({ ...(found.attributes as Record<string, unknown>) })
    } else {
      // The picker route carries the new trait's name, value and free value.
      const created = new SimpleTraitObject({
        name: route.params.name as string,
        value: Number(route.params.value),
        free_value: Number(route.params.free_value),
        category: category.value,
      })
      faux.value = created
    }

    const f = faux.value
    value.value = (f.get('value') as number) ?? 1
    freeValue.value = (f.get('free_value') as number) ?? 0
    specialization.value =
      (f as unknown as { get_specialization?: () => string }).get_specialization?.() ?? ''
    experienceCostType.value = (f.get('experience_cost_type') as 'flat' | 'linear') ?? 'automatic'
    experienceCostModifier.value = (f.get('experience_cost_modifier') as number) ?? 1
  } catch (error) {
    await reportErrorOn("Couldn't open that trait")(error).catch(() => {})
  } finally {
    // Set on BOTH paths: a page that failed to load must still render, so the
    // error banner is visible instead of the page hanging empty until the
    // harness times out.
    loaded.value = true
  }
})

/* Every control writes straight through to the working copy, as the original's
 * `update_*` handlers did, so the quote below recomputes on each change. */
watch(value, (v) => faux.value?.set('value', v))
watch(freeValue, (v) => faux.value?.set('free_value', v))
watch(specialization, (v) =>
  (faux.value as unknown as { set_specialization?: (s: string) => void })?.set_specialization?.(v),
)
watch(experienceCostModifier, (v) => faux.value?.set('experience_cost_modifier', v))
watch(experienceCostType, (v) => {
  const f = faux.value
  if (!f) return
  // "automatic" means the attribute is ABSENT, not the string "automatic".
  if (v === 'automatic') f.unset('experience_cost_type')
  else f.set('experience_cost_type', v)
  if (!Number.isFinite(f.get('experience_cost_modifier'))) f.set('experience_cost_modifier', 1)
})

/**
 * The quote.
 *
 * `undefined` here means the cost engine has no rule for this category, and it
 * is rendered in words. A category with no cost branch used to show a literal
 * "Cost: NaN" and "Final: NaN" to the player; whatever the engine cannot work
 * out, say so -- never show arithmetic on a non-number.
 */
const quote = computed(() => {
  const c = character.value
  const f = faux.value
  if (!c || !f) return null
  trackAll()
  const cost = c.calculate_trait_to_spend(f)
  const known = Number.isFinite(cost)
  const available = c.experience.experience_available()
  return {
    known,
    cost,
    available,
    final: known ? available - (cost as number) : undefined,
  }
})

const traitName = computed(() => (faux.value?.get('name') as string) ?? '')

async function save() {
  const c = character.value
  const f = faux.value
  if (!c || !f) return
  try {
    await ui.runWork(async () => {
      if (trait.value) {
        trait.value.set({
          name: f.get('name'),
          value: f.get('value'),
          category: f.get('category'),
          free_value: f.get('free_value'),
          experience_cost_type: f.get('experience_cost_type'),
          experience_cost_modifier: f.get('experience_cost_modifier'),
        })
        // The `0` is R19 -- see the note at the top of this file.
        await c.update_trait(trait.value, undefined, undefined, 0)
      } else {
        await c.update_trait(
          f.get('name') as string,
          f.get('value') as number,
          f.get('category') as string,
          f.get('free_value') as number,
          true,
          f.get('experience_cost_type') as string | undefined,
          f.get('experience_cost_modifier') as number | undefined,
        )
      }
    })
    clearError()
    window.location.hash = `#simpletraits/${category.value}/${cid.value}/all`
  } catch (error) {
    // Stay on the page and say what went wrong: the refusal for an unpriceable
    // trait is the whole point of the `isFinite` gate in `update_trait`.
    await reportErrorOn("Couldn't save that trait")(error).catch(() => {})
  }
}

async function remove() {
  const c = character.value
  if (!c || !trait.value) return
  try {
    await ui.runWork(() => c.remove_trait(trait.value as Parse.Object))
  } catch (error) {
    await reportErrorOn("Couldn't remove that trait")(error).catch(() => {})
  } finally {
    // `.always()` in the original: the navigation happens either way.
    window.location.hash = `#simpletraits/${category.value}/${cid.value}/all`
  }
}
</script>

<template>
  <JqmPage id="simpletrait-change" title="SimpleTraitChange" :ready="loaded">
    <div id="simpletrait-viewing">
      <template v-if="character && faux">
        <p>{{ character.get('name') }} {{ traitName }} {{ value }}</p>
        <p>
          Cost:
          {{ quote?.known ? quote?.cost : 'unknown - no cost rule for this category' }}
        </p>
        <p>Available XP: {{ quote?.available }}</p>
        <p>Final: {{ quote?.known ? quote?.final : 'unknown' }}</p>
      </template>
    </div>

    <div id="simpletrait-changing">
      <template v-if="faux">
        <p>
          <label for="value-slider">Slider:</label>
          <JqmSlider
            id="value-slider"
            v-model="value"
            name="simpleTraitValue"
            class="value-slider"
            :min="1"
            :max="traitMax"
          />
        </p>
        <p>
          <button v-if="trait" class="remove ui-btn" @click.prevent="remove">Remove</button>
          <button class="save ui-btn" @click.prevent="save">Save Changes</button>
        </p>
        <div>
          <h2>Advanced Options</h2>
          <label for="specialize-name">Specialize Name</label>
          <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
            <input
              id="specialize-name"
              v-model="specialization"
              type="text"
              name="specialize-name"
            />
          </div>

          <label for="free-slider">Free Value:</label>
          <JqmSlider
            id="free-slider"
            v-model="freeValue"
            name="free-slider"
            class="free-slider"
            :min="0"
            :max="traitMax"
          />

          <label for="experience-type-select">Experience Cost Type Override</label>
          <div class="ui-select">
            <div class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
              <span>{{ experienceCostType }}</span>
              <select
                id="experience-type-select"
                v-model="experienceCostType"
                name="experience-type-select"
              >
                <option value="automatic">Automatic</option>
                <option value="flat">Flat</option>
                <option value="linear">Linear</option>
              </select>
            </div>
          </div>

          <label for="experience-cost-modifier">Experience Cost Modifier</label>
          <JqmSlider
            id="experience-cost-modifier"
            v-model="experienceCostModifier"
            name="experience-cost-modifier"
            class="cost-modifier-slider"
            :min="1"
            :max="10"
          />
        </div>
      </template>
    </div>
  </JqmPage>
</template>
