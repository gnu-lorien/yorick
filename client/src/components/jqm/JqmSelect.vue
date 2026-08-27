<script setup lang="ts">
/**
 * A jQuery Mobile select.
 *
 * jQM's default ("native menu") select kept the real `<select>` and put a
 * styled button in front of it, with the `<select>` transparent on top so the
 * platform picker still opened. That is reproduced here: the `<select>` is the
 * real control -- keeping its id, so tests and labels still find it -- and the
 * `.ui-btn` beneath shows the current option's text.
 */
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null | undefined
    id?: string
    name?: string
    disabled?: boolean
    mini?: boolean
    inline?: boolean
  }>(),
  { disabled: false, mini: false, inline: false },
)

defineEmits<{ 'update:modelValue': [value: string] }>()

const root = ref<HTMLSelectElement | null>(null)

/**
 * The visible label. Read off the live `<select>` rather than tracked
 * separately so it cannot drift from the options actually rendered -- the
 * option lists here are built from server data and change after mount.
 */
const label = computed(() => {
  const el = root.value
  if (!el) return ''
  const opt = el.selectedOptions?.[0]
  return opt ? opt.textContent || '' : ''
})
</script>

<template>
  <div
    class="ui-select"
    :class="[mini ? 'ui-mini' : '', inline ? 'ui-btn-inline' : '', disabled ? 'ui-state-disabled' : '']"
  >
    <div :id="id ? id + '-button' : undefined" class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
      <span>{{ label }}</span>
      <select
        :id="id"
        ref="root"
        :name="name"
        :disabled="disabled"
        :value="modelValue ?? ''"
        @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      >
        <slot />
      </select>
    </div>
  </div>
</template>
