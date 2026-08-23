<script setup lang="ts">
/**
 * A jQuery Mobile slider.
 *
 * Small in count -- seven in the whole app -- but disproportionately important,
 * because the approval screen is built out of three of them and the E2E suite
 * drives that screen entirely through `setJqmSlider`. `e2e/helpers/approvals.js`
 * documents the arrangement: `#sliderbaserange` and `#slider` bound the change
 * range, `#approval-slider` picks the approval.
 *
 * The markup reproduces what jQuery Mobile 1.4.5 produced from
 * `<input type="range" id="x" min max value>`: the *original input keeps its id*
 * and is re-typed to `number` with class `ui-slider-input`, showing the value in
 * a box beside the track, and a sibling `.ui-slider-track` carries the fill and
 * the draggable handle. Keeping the id on a real, writable input is what lets
 * the E2E helper set a value the same way it always has -- the only change it
 * needs is to dispatch native events instead of going through jQuery.
 *
 * Dragging is implemented with pointer events, which jQuery Mobile predates. It
 * covers what its mouse/touch handling did: press anywhere on the track to jump,
 * drag to scrub, arrow keys and Home/End from the handle, all snapped to `step`
 * and clamped to `min`/`max`.
 */
import { computed, ref } from 'vue'

/*
 * Attributes land on the INPUT, not on the wrapper.
 *
 * jQuery Mobile re-typed the author's `<input type="range" class="value-slider">`
 * in place and built the track around it, so the class, the name and anything
 * else the author wrote stayed on the input. Vue's default is to fall the
 * attributes through to the root element -- here the `.ui-slider` div -- which
 * would put `class="value-slider"` somewhere no selector expects it.
 *
 * `e2e/character-sheet.spec.js:159` asserts `input.value-slider` exactly, and
 * `lifecycle.js` addresses another slider by `input[name=historyChangePicker]`,
 * so both the class and the name have to be on the control itself.
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: number
    id?: string
    name?: string
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    mini?: boolean
    theme?: string
    /** Hide the paired number box, as `data-show-value="false"` did. */
    showValue?: boolean
  }>(),
  { min: 0, max: 100, step: 1, disabled: false, mini: false, showValue: true, theme: 'a' },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const track = ref<HTMLElement | null>(null)
const dragging = ref(false)

/** Where the handle sits, 0-100, guarding the degenerate `min === max` case. */
const percent = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 0
  const clamped = Math.min(Math.max(props.modelValue, props.min), props.max)
  return ((clamped - props.min) / span) * 100
})

function commit(raw: number) {
  if (props.disabled) return
  const step = props.step > 0 ? props.step : 1
  const snapped = Math.round((raw - props.min) / step) * step + props.min
  const clamped = Math.min(Math.max(snapped, props.min), props.max)
  // Snapping in floating point can leave 4.999999999999999; the old slider
  // dealt only in whole steps, and the approval views index arrays with these
  // values, so a fractional result would be a silent off-by-one.
  const rounded = Number(clamped.toFixed(10))
  if (rounded !== props.modelValue) emit('update:modelValue', rounded)
}

function valueFromClientX(clientX: number) {
  const el = track.value
  if (!el) return props.modelValue
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return props.modelValue
  const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
  return props.min + ratio * (props.max - props.min)
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled) return
  dragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  commit(valueFromClientX(event.clientX))
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  commit(valueFromClientX(event.clientX))
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  const step = props.step > 0 ? props.step : 1
  const moves: Record<string, number | 'min' | 'max'> = {
    ArrowLeft: -step,
    ArrowDown: -step,
    ArrowRight: step,
    ArrowUp: step,
    PageDown: -step * 10,
    PageUp: step * 10,
    Home: 'min',
    End: 'max',
  }
  const move = moves[event.key]
  if (move === undefined) return
  event.preventDefault()
  if (move === 'min') commit(props.min)
  else if (move === 'max') commit(props.max)
  else commit(props.modelValue + move)
}

/**
 * The number box is a real input, so it can be typed into and can hold a
 * transiently invalid value while typing; only numbers reach `commit`.
 */
function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  if (raw === '') return
  const parsed = Number(raw)
  if (Number.isFinite(parsed)) commit(parsed)
}
</script>

<template>
  <div class="ui-slider" :class="[mini ? 'ui-mini' : '', disabled ? 'ui-state-disabled' : '']">
    <input
      :id="id"
      :name="name"
      v-bind="$attrs"
      type="number"
      data-type="range"
      class="ui-shadow-inset ui-body-inherit ui-corner-all ui-slider-input"
      :class="{ 'ui-slider-input-hidden': !showValue }"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      @input="onInput"
      @change="onInput"
    />
    <div
      ref="track"
      role="application"
      class="ui-slider-track ui-shadow-inset ui-bar-inherit ui-corner-all"
      :class="mini ? 'ui-mini' : ''"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <!--
        No `.ui-slider-bg` fill element. jQuery Mobile only emits one for a
        slider built with the highlight option, and none of this app's seven
        sliders uses it -- verified by reading the enhanced markup back out of
        the running legacy app. Adding one would draw a filled track where the
        original draws an empty one.
      -->
      <a
        href="#"
        class="ui-slider-handle ui-btn ui-shadow"
        :style="{ left: percent + '%' }"
        role="slider"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuenow="modelValue"
        :aria-valuetext="String(modelValue)"
        :title="String(modelValue)"
        :aria-disabled="disabled || undefined"
        @click.prevent
        @keydown="onKeydown"
      ></a>
    </div>
  </div>
</template>

<style scoped>
.ui-slider-input-hidden {
  display: none;
}
</style>
