<script setup lang="ts">
/**
 * Pick a user -- `#troupe-add-staff`.
 *
 * One page, two routes, and the id says "add staff" only because that was its
 * first use:
 *
 *  - `#troupe/:id/staff/add` picks someone to give a troupe role to, and a row
 *    links to that troupe's staff editor.
 *  - `#administration/users/all` is the administration user directory, and a row
 *    links to that user's detail page.
 *
 * The page id is shared in the original and is kept, because `activePageId` is
 * how the E2E suite knows where it is.
 *
 * The admin route was gated on `admininterface` INSIDE the handler and rendered
 * nothing for anyone else, which reads as a broken page rather than a refusal.
 * The route table marks it `gate: 'user'` -- matching what the handler enforced
 * -- and `list_users` decides server-side what the caller may actually see.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { JqmPage } from '@/components/jqm'
import UserPicker from '@/components/UserPicker.vue'
import { useBackHref } from '@/composables/useBackHref'
import { listUsers, type IdentityUser } from '@/domain/cloud'

const route = useRoute()

const isAdminDirectory = computed(() => route.meta.handler === 'administration_users')
const troupeId = computed(() => route.params.id as string | undefined)

useBackHref(() => (isAdminDirectory.value ? '#administration' : `#troupe/${troupeId.value}`))

const hrefFor = computed(() =>
  isAdminDirectory.value
    ? (userId: string) => `#administration/user/${userId}`
    : (userId: string) => `#troupe/${troupeId.value}/staff/edit/${userId}`,
)

const users = shallowRef<IdentityUser[]>([])
const message = ref('')
/** False until the directory is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

onMounted(async () => {
  try {
    const result = await listUsers()
    users.value = result.users
    if (result.scope !== 'all') {
      message.value = 'Only storytellers and administrators can browse the full member list.'
    }
  } catch (error) {
    // A refusal used to be `console.log("No users? " + error.message)`, which
    // rendered an empty picker and told the user nothing.
    message.value = 'The member list could not be loaded: ' + ((error as Error)?.message ?? '')
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <JqmPage id="troupe-add-staff" title="Add Staff" :ready="loaded">
    <UserPicker :users="users" :href-for="hrefFor" :message="message" />
  </JqmPage>
</template>
