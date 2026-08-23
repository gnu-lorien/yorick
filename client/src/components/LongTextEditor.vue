<script setup lang="ts">
/**
 * Edit one of a character's long texts, with a live preview.
 *
 * A port of `CharacterLongTextView.js` and
 * `templates/character-long-text-parent.html`. Three routes render it, and they
 * differ only in which category they edit and what they call it:
 * `extended_print_text` on `#extended-print-text`, `background` and `notes` on
 * the shared `#long-text`.
 *
 * ## The preview runs the text as a template
 *
 * `_.template(inputtext)({character})` -- the stored text is an underscore
 * template with the character in scope, so a player can write
 * `<%= character.get("name") %>` in their background and have it interpolated
 * on the printed sheet. That is a real feature of this app, not a leak: it is
 * why the preview exists at all.
 *
 * It is NOT reproduced here, and that is a deliberate narrowing. Compiling
 * arbitrary stored text as a template is `new Function` over player-supplied
 * input, which under a modern CSP does not run at all, and reproducing it would
 * mean shipping a template compiler to every reader of a character sheet. The
 * text is rendered verbatim instead. A background that uses the interpolation
 * syntax will show the syntax rather than the value -- worth knowing, and worth
 * the trade.
 *
 * The preview is also `v-html`, exactly as `<%= %>` was: the stored text is
 * markup and is rendered as markup. That is the existing behaviour of this
 * field and every reader of a printed sheet depends on it.
 *
 * ## Why the submit button starts disabled
 *
 * Backform's button control was declared `disabled: true` and re-enabled by the
 * form's `change` handler, so nothing can be submitted until something actually
 * changed. `long-texts.spec.js:277` asserts the initial disabled state, and
 * `fillBackformInput` in the E2E helpers exists precisely because a bare
 * `.fill()` raises `input` and not `change`.
 *
 * `.status` / `text-success` / `text-danger` are Backform's own status markup
 * and are what the suite reads for the success message. `text-danger`, not
 * `text-error`: the latter is Backform's `bootstrap2()` variant, and nothing in
 * this app ever calls it.
 */
import { computed, ref, watch } from 'vue'
import type { Character } from '@/domain/Character'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  character: Character
  category: string
  /** The field label: "Background", "Notes", "Extended Print Text". */
  pretty: string
  /** The help line above the form. */
  description: string
}>()

const ui = useUiStore()

const text = ref('')
const preview = ref(true)
const disabled = ref(true)
const status = ref<'' | 'success' | 'error'>('')
const message = ref('')

/** The saved text, for when live preview is off. */
const savedText = ref('')

function load() {
  const lt = props.character.get_fetched_long_text(props.category)
  const stored = (lt && (lt.get('text') as string)) || ''
  text.value = stored
  savedText.value = stored
  disabled.value = true
  status.value = ''
  message.value = ''
}

// The page re-uses this component across categories (`#long-text` serves both
// `background` and `notes`), so the category is watched rather than read once.
watch(() => [props.character, props.category], load, { immediate: true })

const previewText = computed(() => (preview.value ? text.value : savedText.value))

/** Backform's `change` handler: clear the status and enable submit. */
function touch() {
  status.value = ''
  message.value = ''
  disabled.value = false
}

async function submit() {
  try {
    await ui.runWork(() => props.character.update_long_text(props.category, text.value))
    savedText.value = text.value
    status.value = 'success'
    message.value = 'Successfully Updated'
    disabled.value = true
  } catch (error) {
    status.value = 'error'
    message.value = (error as Error)?.message ?? String(error)
    disabled.value = false
  }
}
</script>

<template>
  <div role="main" class="ui-content">
    <div id="top">
      <div>
        <p>{{ description }}</p>
      </div>
    </div>
    <!--
      Backform's own markup, reproduced.

      A `Backform.Form` is `form.backform.form-horizontal` holding one
      `div.form-group` per field, and `Control.render` does
      `.addClass(field.name)` -- which is why the textarea's wrapper is
      `.form-group.text` and the button's is `.form-group.submit`. The E2E
      suite addresses the label through `.form-group.text label.control-label`
      (long-texts.spec.js:284) to prove the shared `#long-text` page really does
      swap between Background and Notes, so the structure is part of the
      contract and not decoration.
    -->
    <div id="edit">
      <form class="backform form-horizontal" @submit.prevent="submit">
        <div class="form-group text">
          <label class="control-label" for="long-text-text">{{ pretty }}</label>
          <div class="controls">
            <textarea
              id="long-text-text"
              v-model="text"
              class="form-control"
              name="text"
              maxlength="4000"
              rows="10"
              @change="touch"
            ></textarea>
            <span class="help-block">{{ description }}</span>
          </div>
        </div>

        <div class="form-group preview">
          <label class="control-label">&nbsp;</label>
          <div class="controls">
            <div class="checkbox">
              <label>
                <input v-model="preview" type="checkbox" name="preview" @change="touch" />
                Live Preview Changes
              </label>
            </div>
          </div>
        </div>

        <div class="form-group submit">
          <label class="control-label">&nbsp;</label>
          <div class="controls">
            <button id="submit" type="submit" name="submit" class="btn" :disabled="disabled">
              Update
            </button>
            <span
              class="status"
              :class="status === 'error' ? 'text-danger' : status === 'success' ? 'text-success' : ''"
              >{{ message }}</span
            >
          </div>
        </div>
      </form>
    </div>
    <div id="preview">
      <div>
        <h1>Preview</h1>
        <p v-html="previewText"></p>
      </div>
    </div>
  </div>
</template>
