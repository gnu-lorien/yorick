<script setup lang="ts">
/**
 * Rename a character -- `#character-rename`.
 *
 * A port of `CharacterRenameView.js`. Backform generated the two controls; the
 * behaviour worth carrying is its submit-button state machine, which is what the
 * user reads as feedback:
 *
 *  - the button starts DISABLED, and any edit to the field enables it;
 *  - a successful save disables it again and says "Successfully Updated";
 *  - a failure leaves it enabled and shows the server's message.
 *
 * `e2e/character-sheet.spec.js:182` drives exactly that sequence and asserts the
 * success text, so the ids and the button name are preserved.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { get_character, type Character } from '@/domain/Character'
import { reportErrorOn } from '@/domain/errors'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const cid = computed(() => route.params.cid as string)
useBackHref(() => `#character?${cid.value}`)

/*
 * `shallowRef`, never `ref`.
 *
 * A `Parse.Object` must not be deep-proxied: `ref()` walks the object, hands
 * the SDK proxies where it expects its own instances, and UNWRAPS any nested
 * ref it finds -- which is how the XP ledger's `notations` (a `ShallowRef` on
 * `CharacterExperience`) silently became a plain array in one place and an
 * empty table in another. `@/parse/reactivity` is what makes mutations visible;
 * the ref only has to hold the reference.
 */
const character = shallowRef<Character | null>(null)
const name = ref('')
const status = ref<'idle' | 'success' | 'error'>('idle')
const message = ref('')
const dirty = ref(false)

onMounted(async () => {
  try {
    const c = await ui.runWork(() => get_character(cid.value))
    character.value = c
    name.value = (c.get('name') as string) ?? ''
  } catch (error) {
    await reportErrorOn("Couldn't open the character")(error).catch(() => {})
  }
})

/**
 * Backform's `change` handler, and it is bound to `change` on purpose.
 *
 * The form's own listener was `"change"`, delegated -- so the button unlocks
 * when the field is committed, not on every keystroke. Watching the `name` ref
 * instead looks equivalent and is not: loading the character writes the ref,
 * which fires the watcher, and the button was enabled before the user had
 * touched anything. `helpers/lifecycle.js:renameCharacter` asserts the disabled
 * state first, for exactly this reason.
 */
function touch() {
  dirty.value = true
  if (status.value === 'success') {
    status.value = 'idle'
    message.value = ''
  }
}

const submitDisabled = computed(() => !dirty.value || !character.value)

async function submit() {
  const c = character.value
  if (!c) return
  try {
    await ui.runWork(async () => {
      c.set('name', name.value)
      await c.save()
    })
    status.value = 'success'
    message.value = 'Successfully Updated'
    dirty.value = false
  } catch (error) {
    status.value = 'error'
    message.value = (error as Error)?.message ?? String(error)
  }
}
</script>

<template>
  <JqmPage id="character-rename" title="Rename Character">
    <!--
      Backform's own markup: `form.backform.form-horizontal` holding one
      `div.form-group` per field, each carrying the field NAME as a class
      (`Control.render` does `.addClass(field.name)`). The status span and its
      `text-success` / `text-danger` classes are `ButtonControl`'s, and
      `helpers/lifecycle.js:renameCharacter` waits on exactly those two classes
      to know the save has landed either way.

      `text-danger` and not `text-error`: the latter is Backform's `bootstrap2()`
      variant and nothing in this app calls it.
    -->
    <form id="character-rename-main" class="backform form-horizontal" @submit.prevent="submit">
      <div class="form-group name">
        <label class="control-label" for="character-rename-name">Character Name</label>
        <div class="controls">
          <input
            id="character-rename-name"
            v-model="name"
            class="form-control"
            type="text"
            name="name"
            @change="touch"
          />
        </div>
      </div>

      <div class="form-group submit">
        <label class="control-label">&nbsp;</label>
        <div class="controls">
          <button id="submit" type="submit" name="submit" class="btn" :disabled="submitDisabled">
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
  </JqmPage>
</template>
