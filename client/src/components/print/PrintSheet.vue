<script setup lang="ts">
/**
 * The printable character sheet's layout.
 *
 * A port of `templates/character-print-parent.html` -- twenty named slots in a
 * fixed arrangement. Which slot gets what is `printRegions.ts`; this file is
 * only where they sit.
 *
 * The `cpp-*` ids are preserved exactly. The E2E suite reads the sheet through
 * them, and `e2e/helpers/approvals.js` records the reason they must be scoped
 * carefully: the approval screen nests a whole second copy of this sheet inside
 * `#approval-sheet`, so the same ids appear twice in one document and any read
 * has to be scoped to one page or the other.
 *
 * `force-printing-page-break` and `hidden-when-printing` come from
 * `css/printable_sheet.css`, which is 86 lines of `@media print` rules written
 * entirely against jQuery Mobile class names -- one more reason the stylesheet
 * had to survive the migration intact.
 */
import { computed, ref } from 'vue'
import type { TransformDescription } from '@/domain/print'
import { PRINT_REGIONS, type PrintRegionEntry } from '@/domain/printRegions'
import { venueOf } from '@/parse/classes'
import Parse from '@/parse'
import { trackAll } from '@/parse/reactivity'
import PrintRegion from '@/components/print/PrintRegion.vue'

const props = defineProps<{
  character: Parse.Object
  transformDescription?: readonly TransformDescription[]
  /** Percent, applied to this sheet alone. Omit to use the sheet's own control. */
  fontSize?: number
  /** The troupe print screen's "Exclude Extended Print Text" checkbox. */
  excludeExtended?: boolean
  /**
   * Suppress the per-sheet print settings form.
   *
   * `CharactersPrintView`'s CollectionView passes `no_print_settings_form: true`
   * to every child and hands them ONE shared `print_options` instead, because a
   * font-size control per character on a fifty-character print run is noise.
   * A single sheet renders its own.
   */
  noPrintSettingsForm?: boolean
}>()

/**
 * This sheet's own print settings.
 *
 * `CharacterPrintView.initialize` created a `print_options` model per view
 * (font_size 100, exclude_extended false) and `setup` replaced it only when the
 * caller passed one. So the single-character sheet owns its settings and the
 * troupe run shares the screen's; the props are that override.
 *
 * `match_font_size` set the font size on the VIEW's own element, so it scales
 * one sheet rather than the page -- which is what makes it useful on a run of
 * many.
 */
const localFontSize = ref(100)
const localExcludeExtended = ref(false)

const FONT_SIZES = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]

const fontSize = computed(() => props.fontSize ?? localFontSize.value)
const excluded = computed(() => props.excludeExtended ?? localExcludeExtended.value)

/**
 * The already-fetched `extended_print_text`, or nothing.
 *
 * `get_fetched_long_text` is a CACHE read and never a fetch: the page that
 * renders this sheet is responsible for having loaded the text first, which is
 * the same contract the source's `ExtendedPrintTextView` had.
 */
const extendedPrintText = computed(() => {
  trackAll()
  const character = props.character as unknown as {
    get_fetched_long_text?: (category: string) => { get(key: string): unknown } | null | undefined
  }
  const lt = character.get_fetched_long_text?.('extended_print_text')
  return (lt?.get('text') as string) ?? ''
})

/**
 * The regions this character's venue asks for, with the one conditional slot
 * resolved.
 *
 * Werewolf writes `morality` twice, guarded on tribe: Ananasi get a fixed blood
 * pool, everybody else gets Rage. Evaluating the guard here means the template
 * below can stay a flat lookup.
 */
const regions = computed<Map<string, PrintRegionEntry>>(() => {
  trackAll()
  const venue = venueOf(props.character.get('type'))
  const out = new Map<string, PrintRegionEntry>()
  for (const entry of PRINT_REGIONS[venue]) {
    if (entry.when) {
      const value = props.character.get(entry.when.attribute)
      if (entry.when.equals !== undefined && value !== entry.when.equals) continue
      if (entry.when.notEquals !== undefined && value === entry.when.notEquals) continue
    }
    out.set(entry.region, entry)
  }
  return out
})

function specFor(region: string) {
  return regions.value.get(region)?.spec
}
</script>

<template>
  <div
    role="main"
    class="ui-content force-printing-page-break"
    :style="{ fontSize: fontSize + '%' }"
  >
    <div id="cpp-settings" class="hidden-when-printing">
      <slot name="settings">
        <form v-if="!noPrintSettingsForm" class="backform form-horizontal" @submit.prevent>
          <div class="form-group font_size">
            <label class="control-label">Font Size</label>
            <div class="controls">
              <select v-model.number="localFontSize" class="form-control" name="font_size">
                <option v-for="size in FONT_SIZES" :key="size" :value="size">{{ size }}%</option>
              </select>
            </div>
          </div>
          <div class="form-group exclude_extended">
            <label class="control-label">&nbsp;</label>
            <div class="controls">
              <div class="checkbox">
                <label>
                  <input
                    v-model="localExcludeExtended"
                    type="checkbox"
                    name="exclude_extended"
                  />
                  Exclude Extended Print Text
                </label>
              </div>
            </div>
          </div>
        </form>
      </slot>
    </div>

    <div id="cpp-header">
      <PrintRegion
        v-if="specFor('header')"
        :spec="specFor('header')!"
        :character="character"
        :transform-description="transformDescription"
      />
    </div>
    <div id="cpp-firstbar">
      <PrintRegion
        v-if="specFor('firstbar')"
        :spec="specFor('firstbar')!"
        :character="character"
        :transform-description="transformDescription"
      />
    </div>
    <div id="cpp-secondbar">
      <PrintRegion
        v-if="specFor('secondbar')"
        :spec="specFor('secondbar')!"
        :character="character"
        :transform-description="transformDescription"
      />
    </div>
    <div id="cpp-attributes">
      <PrintRegion
        v-if="specFor('attributeRegion')"
        :spec="specFor('attributeRegion')!"
        :character="character"
        :transform-description="transformDescription"
      />
    </div>

    <div class="ui-grid-b ui-responsive">
      <div id="cpp-blood" class="ui-block-a">
        <PrintRegion
          v-if="specFor('blood')"
          :spec="specFor('blood')!"
          :character="character"
          :transform-description="transformDescription"
        />
      </div>
      <div class="ui-block-b">
        <div id="cpp-willpower">
          <PrintRegion
            v-if="specFor('willpower')"
            :spec="specFor('willpower')!"
            :character="character"
            :transform-description="transformDescription"
          />
        </div>
        <div id="cpp-morality">
          <PrintRegion
            v-if="specFor('morality')"
            :spec="specFor('morality')!"
            :character="character"
            :transform-description="transformDescription"
          />
        </div>
      </div>
      <div id="cpp-health-levels" class="ui-block-c">
        <PrintRegion
          v-if="specFor('health_levels')"
          :spec="specFor('health_levels')!"
          :character="character"
          :transform-description="transformDescription"
        />
      </div>
    </div>

    <div class="ui-grid-b ui-responsive">
      <div v-for="slot in ['total_a', 'total_b', 'total_c']" :id="`cpp-${slot.replace('_', '-')}`" :key="slot" :class="`ui-block-${slot.slice(-1)}`">
        <PrintRegion
          v-if="specFor(slot)"
          :spec="specFor(slot)!"
          :character="character"
          :transform-description="transformDescription"
        />
      </div>
    </div>

    <div id="cpp-skills">
      <PrintRegion
        v-if="specFor('skills')"
        :spec="specFor('skills')!"
        :character="character"
        :transform-description="transformDescription"
      />
    </div>

    <div class="ui-grid-b ui-responsive">
      <div
        v-for="slot in ['bottom_one_a', 'bottom_one_b', 'bottom_one_c']"
        :id="`cpp-${slot.replace(/_/g, '-')}`"
        :key="slot"
        :class="`ui-block-${slot.slice(-1)}`"
      >
        <PrintRegion
          v-if="specFor(slot)"
          :spec="specFor(slot)!"
          :character="character"
          :transform-description="transformDescription"
        />
      </div>
    </div>

    <div class="ui-grid-b ui-responsive">
      <div
        v-for="slot in ['bottom_two_a', 'bottom_two_b', 'bottom_two_c']"
        :id="`cpp-${slot.replace(/_/g, '-')}`"
        :key="slot"
        :class="`ui-block-${slot.slice(-1)}`"
      >
        <PrintRegion
          v-if="specFor(slot)"
          :spec="specFor(slot)!"
          :character="character"
          :transform-description="transformDescription"
        />
      </div>
    </div>

    <!--
      The player's own extra text, rendered as markup exactly as `<%= %>` did.
      `excludeExtended` is the troupe print screen's checkbox, shared through
      `useTroupePrintStore`; the single-character sheet never sets it.

      The source ran this text through `_.template(...)({character})`, so a
      player could interpolate their own character into it. That is not
      reproduced -- see the note in `LongTextEditor.vue` for why -- and the text
      is rendered verbatim.
    -->
    <div id="cpp-extended-print-text" class="ui-content">
      <slot name="extended-print-text">
        <span v-if="!excluded" v-html="extendedPrintText"></span>
      </slot>
    </div>
  </div>
</template>
