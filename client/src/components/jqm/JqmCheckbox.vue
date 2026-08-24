<script setup lang="ts">
/**
 * A jQuery Mobile checkbox.
 *
 * Transcribed from the enhanced markup in the running legacy app:
 *
 *     <div class="ui-checkbox">
 *       <label for="x" class="ui-btn ui-corner-all ui-btn-inherit
 *                             ui-btn-icon-left ui-checkbox-off">Check</label>
 *       <input type="checkbox" id="x">
 *     </div>
 *
 * Note there is no `ui-icon-checkbox-off` class -- `ui-checkbox-off` carries
 * the icon itself in 1.4.5. The label comes BEFORE the input, and the real
 * input keeps its id, so `page.check()` in the E2E suite still works.
 */
withDefaults(
  defineProps<{ modelValue: boolean; id?: string; name?: string; disabled?: boolean; mini?: boolean }>(),
  { disabled: false, mini: false },
)

defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <div class="ui-checkbox" :class="mini ? 'ui-mini' : ''">
    <label
      class="ui-btn ui-corner-all ui-btn-inherit ui-btn-icon-left"
      :class="[modelValue ? 'ui-checkbox-on' : 'ui-checkbox-off', disabled ? 'ui-state-disabled' : '']"
      :for="id"
    >
      <slot />
    </label>
    <input
      :id="id"
      type="checkbox"
      :name="name"
      :disabled="disabled"
      :checked="modelValue"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
  </div>
</template>
