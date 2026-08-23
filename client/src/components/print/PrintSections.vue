<script setup lang="ts">
/**
 * One column of headed trait blocks -- the `print/section.html` template.
 *
 * A section is omitted entirely when the character has nothing in it: the
 * original's `if (character.has(name) && 0 != character.get(name).length)`. An
 * empty heading on a printed sheet is worse than no heading, because it reads as
 * "this character has none" rather than "this section does not apply".
 *
 * Every section is SORTED, and the default is by name -- so the printed sheet
 * lists traits alphabetically rather than in the order they were bought. Only
 * Gifts asks for `value`, which orders by value then name.
 *
 * `formatSkill` returns markup on the approval and history screens, where a
 * changed trait is shown as its old value struck through beside its new one,
 * so it is rendered as HTML. The strings it composes are built from stored trait
 * names, which are player-supplied -- see the note on `v-html` below.
 */
import { computed } from 'vue'
import type { PrintSection } from '@/domain/printRegions'
import { formatSkill, type PrintableTrait, type TransformDescription } from '@/domain/print'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'

const props = defineProps<{
  character: Parse.Object
  sections: readonly PrintSection[]
  transformDescription?: readonly TransformDescription[]
}>()

type Row = { display: string; values: string[] }

function sorted(traits: (Parse.Object & PrintableTrait)[], section: PrintSection) {
  const by = section.sort ?? 'name'
  const copy = traits.slice()
  copy.sort((a, b) => {
    if (by === 'value') {
      const av = (a.get('value') as number) ?? 0
      const bv = (b.get('value') as number) ?? 0
      if (av !== bv) return av - bv
    }
    const an = (a.get('name') as string) ?? ''
    const bn = (b.get('name') as string) ?? ''
    return an < bn ? -1 : an > bn ? 1 : 0
  })
  return (section.direction ?? 'asc') === 'desc' ? copy.reverse() : copy
}

const rows = computed<Row[]>(() => {
  trackAll()
  const out: Row[] = []
  for (const section of props.sections) {
    const traits =
      (props.character.get(section.name) as (Parse.Object & PrintableTrait)[] | undefined) ?? []
    if (traits.length === 0) continue
    out.push({
      display: section.display,
      values: sorted(traits, section).map((trait) =>
        formatSkill(trait, section.format, props.transformDescription),
      ),
    })
  }
  return out
})
</script>

<template>
  <div>
    <template v-for="row in rows" :key="row.display">
      <h4 class="ui-bar ui-bar-a ui-corner-all">{{ row.display }}</h4>
      <template v-for="(value, i) in row.values" :key="i">
        <!--
          `v-html` because `formatSkill` composes the approval diff markup -- a
          struck-through old value beside the new one. The only interpolated
          text is a trait's own name and specialization, both of which the
          player types, so this is the one place on the sheet where stored text
          reaches the DOM as markup. It is the behaviour the approval screen has
          always had; narrowing it is a change to what storytellers see and
          belongs in its own commit.
        -->
        <span v-html="value"></span><br />
      </template>
    </template>
  </div>
</template>
