<script setup lang="ts">
/**
 * A jQuery Mobile text input, pre-enhanced.
 *
 * Measured against the running legacy app rather than assumed: jQuery Mobile
 * puts the styling classes on a WRAPPER DIV and leaves the control itself
 * classless. `#login-username` in the legacy client is
 *
 *     <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
 *       <input type="text" id="login-username" placeholder="Username">
 *     </div>
 *
 * Putting the classes on the input instead looks nearly right and is not --
 * `ui-input-text` sets the border and padding on a block container, so a
 * classed input renders at the wrong size and an inline control loses its box
 * entirely. The wrapper is emitted here so the 1.4.5 stylesheet sees the shape
 * it was written for.
 */
withDefaults(
  defineProps<{
    modelValue: string | number | null | undefined
    id?: string
    name?: string
    type?: string
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    multiline?: boolean
    rows?: number
    mini?: boolean
    step?: string | number
    min?: string | number
    max?: string | number
  }>(),
  { type: 'text', disabled: false, readonly: false, multiline: false, rows: 4, mini: false },
)

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div
    class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset"
    :class="[mini ? 'ui-mini' : '', disabled ? 'ui-state-disabled' : '']"
  >
    <textarea
      v-if="multiline"
      :id="id"
      :name="name"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :value="modelValue ?? ''"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <input
      v-else
      :id="id"
      :name="name"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :step="step"
      :min="min"
      :max="max"
      :value="modelValue ?? ''"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
