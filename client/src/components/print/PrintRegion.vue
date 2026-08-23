<script setup lang="ts">
/**
 * Renders whatever the region descriptor says goes in one slot.
 *
 * This is the `showChildView(region, new SomeView(...))` dispatch from
 * `CharacterPrintView#setup_regions`, turned inside out: the descriptor table
 * says which view and with what, and this picks the component. Adding a region
 * to a venue is then a data change in `printRegions.ts` rather than another
 * branch in a 460-line function.
 *
 * Several fields are rendered with `v-html` because the approval and history
 * screens hand back diff markup -- an old value struck through beside the new
 * one. The interpolated text is trait and attribute names the player typed, so
 * this is where stored text reaches the DOM as markup. That is the behaviour
 * the approval screen has always had; narrowing it changes what storytellers
 * see and belongs in its own change.
 */
import { computed } from 'vue'
import type { PrintRegionSpec } from '@/domain/printRegions'
import type { TransformDescription } from '@/domain/print'
import {
  formatAttributeFocus,
  formatAttributeValue,
  formatSimpleText,
  formatSkill,
} from '@/domain/print'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'
import PrintBoxes from '@/components/print/PrintBoxes.vue'
import PrintSections from '@/components/print/PrintSections.vue'

const props = defineProps<{
  spec: PrintRegionSpec
  character: Parse.Object
  transformDescription?: readonly TransformDescription[]
}>()

const td = computed(() => props.transformDescription)

const heading = computed(() => formatSimpleText(props.character, 'name', td.value))

/** The two bars under the header. A field with no value is omitted entirely. */
const barFields = computed(() => {
  if (props.spec.view !== 'TextBarView') return []
  trackAll()
  return props.spec.fields
    .map((field, i) => ({
      ...field,
      block: String.fromCharCode(97 + i),
      value: formatSimpleText(props.character, field.name, td.value),
      present: !!props.character.get(field.name),
    }))
    .filter((f) => f.present)
})

/** Physical / Social / Mental, each with its value and its focus list. */
const attributeColumns = computed(() => {
  trackAll()
  const attributes = (props.character.get('attributes') as Parse.Object[] | undefined) ?? []
  return ['Physical', 'Social', 'Mental'].map((name, i) => {
    const attribute = attributes.find((a) => a && a.get('name') === name)
    return {
      name,
      block: String.fromCharCode(97 + i),
      value: attribute ? formatAttributeValue(attribute as never, td.value) : '',
      focus: formatAttributeFocus(props.character, name, td.value),
    }
  })
})

/**
 * Skills, in rows of three.
 *
 * The original chunked them into threes and laid each row across
 * `ui-block-a/b/c`, which is what keeps three columns on a wide screen and one
 * on a narrow one.
 */
const skillRows = computed(() => {
  trackAll()
  const skills = ((props.character.get('skills') as Parse.Object[] | undefined) ?? [])
    .slice()
    .sort((a, b) => {
      const an = (a.get('name') as string) ?? ''
      const bn = (b.get('name') as string) ?? ''
      return an < bn ? -1 : an > bn ? 1 : 0
    })
  const rows: { block: string; text: string }[][] = []
  for (let i = 0; i < skills.length; i += 3) {
    rows.push(
      skills.slice(i, i + 3).map((skill, j) => ({
        block: String.fromCharCode(97 + (j % 3)),
        text: formatSkill(skill as never, 1, td.value),
      })),
    )
  }
  return rows
})

const healthLevels = computed(() => {
  trackAll()
  const c = props.character as unknown as { health_levels?: () => [string, number | undefined][] }
  return c.health_levels?.() ?? []
})

const willpowerTotal = computed(() => {
  trackAll()
  const c = props.character as unknown as { get_willpower_total?: () => number }
  return c.get_willpower_total?.() ?? 0
})

/** Blood per turn by generation, from `print/blood.html`. */
const BLOOD_PER_TURN: Record<number, number> = { 1: 10, 2: 12, 3: 15, 4: 20, 5: 30 }

/**
 * `character.generation()` -- the CHARACTER's method, not the venue's.
 *
 * `print/blood.html` calls it directly, and it is `raw_generation() || 1`, so
 * the floor is 1 and never 0. Reading it off the venue strategy instead found
 * nothing there (`generation` is built per character in
 * `venues/vampire.ts`, not exported on the strategy) and the `?? 0` fallback
 * turned that into a silent wrong answer: `BLOOD_PER_TURN[0]` is undefined, so
 * every printed Vampire sheet read "Blood / 0" instead of "Blood 10 / 1".
 *
 * Unguarded, as the source is: `BloodView` is Vampire's region alone, and a
 * werewolf reaching it is a bug worth a TypeError rather than a plausible
 * number.
 */
const generation = computed(() => {
  trackAll()
  return (props.character as unknown as { generation(): number }).generation()
})

const morality = computed(() => {
  trackAll()
  const c = props.character as unknown as { venue?: { morality?: (ch: unknown) => Parse.Object } }
  const m = c.venue?.morality?.(props.character)
  if (!m) return null
  return { name: m.get('name') as string, value: Number(m.get('value')) || 0 }
})

const gnosisTotal = computed(() => {
  trackAll()
  const c = props.character as unknown as {
    venue?: { get_gnosis_total?: (ch: unknown) => number }
  }
  return c.venue?.get_gnosis_total?.(props.character) ?? 0
})
</script>

<template>
  <h1 v-if="spec.view === 'HeaderView'" class="ui-bar ui-bar-a" v-html="heading"></h1>

  <div v-else-if="spec.view === 'TextBarView'" class="ui-grid-b ui-responsive">
    <div v-for="field in barFields" :key="field.name" :class="`ui-block-${field.block}`">
      <h2 class="ui-bar ui-bar-a">{{ field.display }}: <span v-html="field.value"></span></h2>
    </div>
  </div>

  <div v-else-if="spec.view === 'AttributesView'" class="ui-grid-b ui-responsive">
    <div v-for="col in attributeColumns" :key="col.name" :class="`ui-block-${col.block}`">
      <h4 class="ui-bar ui-bar-a ui-corner-all">{{ col.name }}</h4>
      <div class="ui-body">
        <span v-html="col.value"></span><br />
        <span v-html="col.focus"></span>
      </div>
    </div>
  </div>

  <template v-else-if="spec.view === 'SkillsView'">
    <h4 class="ui-bar ui-bar-a">Skills</h4>
    <div class="ui-grid-b ui-responsive">
      <template v-for="(row, i) in skillRows" :key="i">
        <div v-for="(cell, j) in row" :key="j" :class="`ui-block-${cell.block}`">
          <div class="ui-body" style="overflow: hidden; white-space: nowrap">
            <span v-html="cell.text"></span>
          </div>
        </div>
      </template>
    </div>
  </template>

  <PrintBoxes v-else-if="spec.view === 'WillpowerView'" name="Willpower" :total="willpowerTotal" />

  <div v-else-if="spec.view === 'HealthLevelsView'">
    <h4 class="ui-bar ui-bar-a ui-corner-all">Health Levels</h4>
    <template v-for="(level, i) in healthLevels" :key="i">
      <i v-for="n in Math.max(0, Number(level[1]) || 0)" :key="n" class="fa fa-square-o"></i>
      {{ level[0] }}
      <br />
    </template>
  </div>

  <!--
    Blood is 30 boxes with a gap every 5 and a break every 10, then one filled
    circle per generation dot, then blood-per-turn / generation.
  -->
  <div v-else-if="spec.view === 'BloodView'">
    <h4 class="ui-bar ui-bar-a ui-corner-all">Blood</h4>
    <template v-for="i in 30" :key="i">
      <i class="fa fa-square-o"></i>
      <template v-if="i % 5 === 0">&nbsp;</template>
      <br v-if="i % 10 === 0" />
    </template>
    <i v-for="i in Math.max(0, generation)" :key="`g${i}`" class="fa fa-circle"></i>
    {{ BLOOD_PER_TURN[generation] }} / {{ generation }}
  </div>

  <PrintBoxes v-else-if="spec.view === 'GnosisView'" name="Gnosis" :total="gnosisTotal" />

  <PrintBoxes v-else-if="spec.view === 'GlamourView'" name="Glamour" :total="10" />

  <div v-else-if="spec.view === 'MoralityView'">
    <h4 class="ui-bar ui-bar-a ui-corner-all">Morality</h4>
    <template v-if="morality">
      {{ morality.name }}<br />
      <template v-for="i in Math.max(0, morality.value)" :key="i">
        <i class="fa fa-square-o"></i>
        <template v-if="i % 5 === 0">&nbsp;</template>
      </template>
    </template>
  </div>

  <PrintBoxes
    v-else-if="spec.view === 'TotalView'"
    :name="spec.total.name"
    :total="spec.total.total"
    :split="spec.total.split"
  />

  <!-- Ananasi get a fixed blood pool where every other tribe gets Rage. -->
  <div v-else-if="spec.view === 'FixedBloodView'">
    <h4 class="ui-bar ui-bar-a ui-corner-all">Blood</h4>
    <template v-for="i in Math.max(0, spec.fixedBlood.total)" :key="i">
      <i class="fa fa-square-o"></i>
      <template v-if="i % spec.fixedBlood.split === 0">&nbsp;</template>
      <br v-if="i % spec.fixedBlood.linebreak === 0" />
    </template>
    {{ spec.fixedBlood.blood_per_turn }}
  </div>

  <PrintSections
    v-else-if="spec.view === 'SectionsView'"
    :character="character"
    :sections="spec.sections"
    :transform-description="transformDescription"
  />
</template>
