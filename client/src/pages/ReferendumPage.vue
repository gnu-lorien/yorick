<script setup lang="ts">
/**
 * One referendum -- `#referendum`.
 *
 * A port of `ReferendumView.js` and `templates/referendum/{referendum,
 * description,options}.html`. Two routes render it: `#referendum/:id`, where a
 * member votes, and `#administration/referendum/:id`, which additionally dumps
 * every ballot cast.
 *
 * ## The patron gate is the whole point of this screen
 *
 * `get_my_patronage_status` decides whether the option links render at all. A
 * non-patron gets a sentence instead, and there is nothing to click. That is the
 * end of the loop that starts at the PayPal button on the profile page: a
 * donation writes a `PaymentPaypal`, whose `afterSave` mints a `Patronage`,
 * whose `expiresOn` is what this reads. Porting this page without the gate would
 * hand every member a ballot.
 *
 * The gate is on the VIEWING user, on both routes -- so an administrator who is
 * not a patron sees the refusal on the admin page too, and sees no options. That
 * is why `admin-referendums.spec.js` grants devuser a patronage in `beforeAll`.
 *
 * ## Three states, in the source's order
 *
 * Not a patron -> the refusal. Otherwise, a message from a vote just cast or an
 * existing ballot -> what you voted for. Otherwise -> the options. So casting a
 * vote replaces the buttons with the record of it, and nobody votes twice
 * through this screen.
 *
 * ## The admin ballot dump
 *
 * Rendered whenever `ballots` was fetched, INDEPENDENTLY of the patron gate
 * above -- it is a separate block in the same template. It is quoted CSV in a
 * `<p>`, one line per ballot, and the E2E suite parses it with a regexp; a
 * ballot whose caster the reader cannot see prints the literal
 * `"USER DELETED"` fields rather than being omitted, which is the difference
 * between "nobody voted" and "you cannot see who did".
 *
 * `caster` is deliberately not `include`d -- see `fetchReferendumBallots` --
 * so the names arrive through the hydrate instead.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { getMyPatronageStatus } from '@/domain/cloud'
import { reportErrorOn } from '@/domain/errors'
import { referendumQuery, type Referendum } from '@/domain/Referendum'
import {
  castBallot,
  fetchReferendumBallots,
  getOwnBallot,
  type ReferendumBallot,
} from '@/domain/ReferendumBallot'
import { trackAll } from '@/parse/reactivity'
import type Parse from '@/parse'
import { useUiStore } from '@/stores/ui'
import { useUsersStore } from '@/stores/users'

const route = useRoute()
const ui = useUiStore()
const usersStore = useUsersStore()

const referendumId = computed(() => route.params.id as string)
const isAdminView = computed(() => route.meta.handler === 'administration_referendum')

useBackHref(() => (isAdminView.value ? '#administration/referendums' : '#referendums'))

const referendum = shallowRef<Referendum | null>(null)
const ballot = shallowRef<ReferendumBallot | undefined>(undefined)
const ballots = shallowRef<ReferendumBallot[] | null>(null)
const patronageStatus = ref(false)
/** Whatever `vote_for_referendum` last replied, message or refusal. */
const ballotMessage = ref('')
/** False until the referendum is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

/** `_.range(0, 4)`: four option slots, only the filled ones render. */
const options = computed(() => {
  const r = referendum.value
  if (!r) return []
  trackAll()
  return [0, 1, 2, 3]
    .map((i) => ({ name: `option_${i}`, text: r.get(`option_${i}`) as string | undefined }))
    .filter((o) => !!o.text)
})

/** What the member voted for, resolved through the referendum's own options. */
const votedFor = computed(() => {
  const r = referendum.value
  const b = ballot.value
  if (!r || !b) return ''
  return (r.get(b.get('choice') as string) as string) ?? ''
})

/** One CSV line per ballot, exactly as `options.html` emitted them. */
const ballotRows = computed(() => {
  if (!ballots.value) return []
  trackAll()
  return ballots.value.map((b) => {
    const caster = b.get('caster') as Parse.User | undefined
    const fields = caster
      ? [
          (caster.get('username') as string) ?? '',
          (caster.get('realname') as string) ?? '',
          (caster.get('email') as string) ?? '',
        ]
      : ['USER DELETED', 'USER REALNAME DELETED', 'USER EMAIL DELETED']
    return (
      [...fields, (b.get('choice') as string) ?? '', String(b.updatedAt ?? '')]
        .map((f) => `"${f}"`)
        .join(',')
    )
  })
})

onMounted(async () => {
  try {
    await ui.runWork(async () => {
      const found = await referendumQuery().include('portrait').get(referendumId.value)
      referendum.value = found

      const [status, own] = await Promise.all([
        getMyPatronageStatus(),
        isAdminView.value ? Promise.resolve(undefined) : getOwnBallot(found),
      ])
      patronageStatus.value = status
      ballot.value = own

      if (isAdminView.value) {
        ballots.value = await fetchReferendumBallots(found, async (rows) => {
          await usersStore.hydrate(rows as unknown as Parse.Object[], 'caster')
        })
      }
    })
  } catch (error) {
    await reportErrorOn("Couldn't open that referendum")(error).catch(() => {})
  } finally {
    loaded.value = true
  }
})

async function vote(option: string) {
  const r = referendum.value
  if (!r) return
  const result = await ui.runWork(() => castBallot(r, option))
  // The Cloud function's reply and its refusal both land here; `castBallot`
  // never rejects, which is what lets both end in the same redraw.
  const message = result.message
  ballotMessage.value =
    typeof message === 'string' ? message : ((message as Error)?.message ?? '')
  ballot.value = result.ballot
}
</script>

<template>
  <JqmPage id="referendum" title="Referendum" :content="false" :ready="loaded">
    <div role="main" class="ui-content">
      <div class="ui-body ui-body-a ui-corner-all">
        <div id="referendum-description">
          <div>
            <h1>{{ referendum?.get('name') }}</h1>
            <p>{{ referendum?.get('shortdescription') }}</p>
            <p>{{ referendum?.get('description') }}</p>
          </div>
        </div>
      </div>
      <hr />
      <div class="ui-body ui-body-a ui-corner-all">
        <div id="referendum-options">
          <div>
            <p v-if="!patronageStatus">
              You are not currently a Patron of Underground Theater so you are not eligible to vote.
            </p>
            <template v-else-if="ballotMessage || ballot">
              <p v-if="ballotMessage">{{ ballotMessage }}</p>
              <p v-if="ballot">
                On {{ ballot.createdAt }} you voted for {{ votedFor }}
              </p>
            </template>
            <template v-else>
              <p v-for="option in options" :key="option.name">
                <a :name="option.name" href="#" class="ui-btn" @click.prevent="vote(option.name)">
                  {{ option.text }}
                </a>
              </p>
            </template>

            <p v-if="ballots">
              <template v-for="(row, i) in ballotRows" :key="i">{{ row }}<br /></template>
            </p>
          </div>
        </div>
      </div>
    </div>
  </JqmPage>
</template>
