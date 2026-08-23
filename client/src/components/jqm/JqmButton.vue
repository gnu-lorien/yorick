<script setup lang="ts">
/**
 * A jQuery Mobile button, rendered pre-enhanced.
 *
 * jQuery Mobile turned `<a data-icon="arrow-l" data-iconpos="left">` into
 * `<a class="ui-btn ui-shadow ui-corner-all ui-btn-icon-left ui-icon-arrow-l">`
 * at runtime. Since Vue owns the markup we emit the result directly, which is
 * both faster and safe -- the old enhancement mutated the DOM underneath the
 * view layer, which is precisely the class of behaviour Vue cannot tolerate.
 *
 * `href` renders an anchor, otherwise a `<button>`. Existing templates use both
 * and the E2E suite clicks them by class or id, so the element type matters.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    href?: string
    icon?: string
    iconpos?: 'left' | 'right' | 'top' | 'bottom' | 'notext'
    theme?: string
    inline?: boolean
    mini?: boolean
    disabled?: boolean
    corners?: boolean
    shadow?: boolean
    type?: 'button' | 'submit' | 'reset'
  }>(),
  { iconpos: 'left', inline: false, mini: false, disabled: false, corners: true, shadow: true, type: 'button' },
)

const classes = computed(() => [
  'ui-btn',
  props.shadow ? 'ui-shadow' : '',
  props.corners ? 'ui-corner-all' : '',
  props.theme ? `ui-btn-${props.theme}` : '',
  props.icon ? `ui-btn-icon-${props.iconpos} ui-icon-${props.icon}` : '',
  props.inline ? 'ui-btn-inline' : '',
  props.mini ? 'ui-mini' : '',
  props.disabled ? 'ui-state-disabled' : '',
])
</script>

<template>
  <a v-if="href" :href="href" :class="classes" :aria-disabled="disabled || undefined">
    <slot />
  </a>
  <button v-else :type="type" :class="classes" :disabled="disabled">
    <slot />
  </button>
</template>
