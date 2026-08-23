<script setup lang="ts">
/**
 * One creation pool: the picks made, and the slots still open.
 *
 * Nine of the wizard's templates are this same list with different words --
 * `create/attributes.html`, `skills.html`, `backgrounds.html`, `focuses.html`,
 * `disciplines.html`, `gifts.html`, `arts.html`, `merits.html`, `flaws.html`.
 * They differ only in the heading, the category, the rating range, and the
 * wording of the pick link, so those are props and the markup is written once.
 *
 * ## How a pool is stored
 *
 * For a category `c` and a rating `i`, the creation record holds
 * `c_<i>_picks` (the traits taken at that rating) and `c_<i>_remaining` (how
 * many slots are left). Ratings are walked from HIGH to LOW, which is what puts
 * the scarce, expensive picks at the top of the list.
 *
 * The count badge is `creation.remaining_picks(category)`, which sums only the
 * `c_<bare integer>_remaining` keys -- a key with a non-integer suffix must not
 * be counted, which is how `<category>_undefined_remaining` (R19) stayed
 * invisible while it was being written.
 *
 * ## The creation-pool limit
 *
 * Nothing here enforces it. `mobileRouter.js:616` is the ENTIRE enforcement in
 * the system -- `if (isNumber(remaining) && remaining <= 0)` in the pick route
 * -- and `cloud/main.js` has no equivalent. Rendering one pick link per
 * remaining slot is what makes the limit hold in practice; the route guard is
 * what makes it hold when someone types the URL.
 */
import { computed } from 'vue'
import { vJqmListview } from '@/components/jqm'
import Parse from '@/parse'
import { remainingPicks, type VampireCreation } from '@/domain/VampireCreation'
import { trackAll } from '@/parse/reactivity'

const props = defineProps<{
  characterId: string
  creation: Parse.Object
  /** The heading, e.g. "Attributes" or "Physical Focus". */
  heading: string
  /** The stored category, e.g. `attributes` or `wta_backgrounds`. */
  category: string
  /** Ratings from highest to lowest, e.g. `[8,7,6,5,4,3,2,1]`. */
  ratings: readonly number[]
  /** Builds the pick link's text for a rating. */
  pickLabel: (rating: number) => string
  /** Focus picks show only a name; every other pool shows `name xvalue`. */
  showValue?: boolean
}>()

/*
 * `remainingPicks` is a free function, not a method on the creation record.
 *
 * Called directly rather than through an optional `creation.remaining_picks?.()`
 * -- which is how the first version of this file was written, and which returned
 * 0 for every pool because no such method exists. A badge reading 0 next to a
 * list of available picks is exactly the kind of wrong that looks like data.
 */
const remaining = computed(() => {
  trackAll()
  return remainingPicks(props.creation as VampireCreation, props.category)
})

const groups = computed(() => {
  trackAll()
  return props.ratings.map((rating) => {
    const picks =
      (props.creation.get(`${props.category}_${rating}_picks`) as Parse.Object[] | undefined) ?? []
    const open = Number(props.creation.get(`${props.category}_${rating}_remaining`)) || 0
    return {
      rating,
      picks: picks.filter(Boolean).map((trait) => ({
        // `linkId()` is `id ?? localId`: an unsaved pick has no object id yet
        // and still has to be unpickable.
        linkId:
          (trait as unknown as { linkId?: () => string }).linkId?.() ?? (trait.id as string),
        name: (trait.get('name') as string) ?? '',
        value: trait.get('value') as number | undefined,
      })),
      open: Math.max(0, open),
    }
  })
})
</script>

<template>
  <ul
    v-jqm-listview
    data-role="listview"
    data-inset="true"
    class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
    :category="category"
  >
    <li data-role="list-divider" class="ui-li-divider ui-bar-inherit">
      {{ heading }}<span class="ui-li-count">{{ remaining }}</span>
    </li>

    <template v-for="group in groups" :key="group.rating">
      <li v-for="pick in group.picks" :key="pick.linkId" data-icon="delete">
        <a href="javascript: void(0)">
          {{ pick.name }}<template v-if="showValue !== false"> x{{ pick.value }}</template>
        </a>
        <a
          :href="`#charactercreate/simpletraits/${category}/${characterId}/unpick/${pick.linkId}/${group.rating}`"
          >Delete</a
        >
      </li>
      <li v-for="n in group.open" :key="`open-${group.rating}-${n}`">
        <a :href="`#charactercreate/simpletraits/${category}/${characterId}/pick/${group.rating}`">
          {{ pickLabel(group.rating) }}
        </a>
      </li>
    </template>
  </ul>
</template>
