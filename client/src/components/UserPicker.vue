<script setup lang="ts">
/**
 * Pick a user from the account directory.
 *
 * A port of `UsersView.js` and `templates/choose-user.html`. Reused wherever a
 * user has to be chosen: adding troupe staff, the administration user list, and
 * creating a patronage against an account.
 *
 * Presentational only: the users are a PROP. The page fetches them, because a
 * page renders no content until its data is ready (see `JqmPage.vue`) and a
 * component that both fetches and lives inside that gate would never mount to
 * do the fetching.
 *
 * ## No email address
 *
 * `choose-user.html` printed `username email realname`. The identity projection
 * deliberately does not include `email` (`IDENTITY_INCLUDES_EMAIL` is false), so
 * that column is simply absent now -- the server will not hand a member's email
 * to another member. The row reads `username realname`.
 *
 * ## A short list has to explain itself
 *
 * The function answers with a `scope`: `all` for staff, `self` for everyone
 * else. A player calling it legitimately gets back one row -- their own -- and
 * a one-row picker with no explanation reads as a bug. The original said so in
 * a message, and so does this.
 */
import { computed } from 'vue'
import { JqmListview } from '@/components/jqm'
import type { IdentityUser } from '@/domain/cloud'

const props = withDefaults(
  defineProps<{
    users: readonly IdentityUser[]
    /** Where a row links to, given the user's id. */
    hrefFor: (userId: string) => string
    /**
     * Shown above the list when it is not the whole directory, or when it could
     * not be loaded. A one-row picker with no explanation reads as a bug.
     */
    message?: string
    filterId?: string
  }>(),
  { message: '', filterId: 'filter-choose-user' },
)

const rows = computed(() =>
  props.users.map((u) => {
    const username = (u.get('username') as string) ?? ''
    const realname = (u.get('realname') as string) ?? ''
    return {
      id: u.id as string,
      // The template's `name` attribute; a `_User` has no `name`, so the
      // username is what identifies the row to a reader and to a test.
      name: username,
      label: [username, realname].filter(Boolean).join(' '),
      filterText: [username, realname].join(' ').toLowerCase(),
    }
  }),
)

</script>

<template>
  <p v-if="message" class="message">{{ message }}</p>
  <JqmListview filter :filter-id="filterId" v-slot="{ query }">
    <li
      v-for="row in rows"
      v-show="!query || row.filterText.includes(query.toLowerCase())"
      :key="row.id"
    >
      <a
        :name="row.name"
        :backendId="row.id"
        :href="hrefFor(row.id)"
        class="ui-btn ui-btn-icon-right ui-icon-carat-r user-listing"
      >
        {{ row.label }}
      </a>
    </li>
  </JqmListview>
</template>
