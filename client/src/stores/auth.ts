/**
 * Who is signed in, and what they are allowed to see.
 *
 * This replaces the router's `enforce_logged_in` / `enforce_admin` pair
 * (`public/scripts/app/routers/mobileRouter.js:1483` and `:1546`). Those did
 * five unrelated things per navigation -- redirect anonymous visitors, relabel
 * the logout button, re-render the footer navbar, configure TrackJS, and
 * refresh the administrator flag -- because the router was the only place that
 * ran on every route. Here the state lives in one store, the header and footer
 * read it reactively, and the redirect is a router guard.
 *
 * Facebook login is not ported. That was the owner's explicit call: it was
 * already half-removed on greensboro with the buttons hidden, and under parse@8
 * `Parse.FacebookUtils.init` threw during bootstrap and took the whole app down
 * with it. `helpers/InjectAuthData.js` existed only to refresh Facebook tokens
 * before a user save, so it has no port either.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import Parse from '@/parse'
import { track } from '@/parse/reactivity'

/** How long an administrator-role check is trusted, matching the old router. */
const ADMIN_CHECK_TTL_MS = 300000

declare const trackJs: { configure: (opts: Record<string, unknown>) => void } | undefined

export const useAuthStore = defineStore('auth', () => {
  /**
   * `shallowRef`, not `ref`. A `Parse.User` is a live SDK object with its own
   * internal state; deep-proxying it would make Vue rewrite every nested
   * attribute and hand the SDK proxies where it expects its own objects.
   * `bump` below is what makes reads re-evaluate after a mutation.
   */
  const user = shallowRef<Parse.User | null>(Parse.User.current())
  const revision = ref(0)
  let lastAdminCheck = 0

  function bump() {
    user.value = Parse.User.current()
    revision.value++
  }

  const isLoggedIn = computed(() => {
    void revision.value
    return !!user.value
  })

  /*
   * These read FIELDS off the user, so they subscribe to that object's own
   * revision as well as to `revision`.
   *
   * `revision` alone covers the store's own writes -- login, logout,
   * `refreshAdminStatus` -- because those all call `bump`. It does not cover a
   * mutation made anywhere else, and `Parse.User.current()` is reachable from
   * the whole app: `AdministrationUserViewPage` writes `admininterface` when a
   * storyteller edits a user, and that user can be the current one. Without
   * `track`, the footer's links and every admin gate would go on reporting the
   * value as of the last `bump`.
   *
   * `track` is the same subscription the character screens use, so a Parse
   * mutation reaches these the way it reaches everything else.
   */
  const username = computed(() => {
    void revision.value
    if (user.value) track(user.value)
    return (user.value?.get('username') as string) || ''
  })

  const isAdmin = computed(() => {
    void revision.value
    if (user.value) track(user.value)
    return !!user.value?.get('admininterface')
  })

  const isStoryteller = computed(() => {
    void revision.value
    if (user.value) track(user.value)
    return !!user.value?.get('storytellerinterface')
  })

  /**
   * The footer's destinations, which is what `templates/footer.html` branched
   * on: administrators get four, storytellers three, everyone else two.
   */
  const navLinks = computed(() => {
    const links = [
      { href: '#characters?all', label: 'Characters' },
      { href: '#profile', label: 'Profile' },
    ]
    if (isAdmin.value) {
      links.push({ href: '#administration', label: 'Administration' })
      links.push({ href: '#troupes', label: 'Troupes' })
    } else if (isStoryteller.value) {
      links.push({ href: '#troupes', label: 'Troupes' })
    }
    return links
  })

  async function logIn(name: string, password: string) {
    await Parse.User.logIn(name, password)
    bump()
  }

  async function signUp(name: string, password: string) {
    const u = new Parse.User()
    u.set('username', name)
    u.set('password', password)
    await u.signUp()
    bump()
  }

  async function logOut() {
    await Parse.User.logOut()
    bump()
  }

  /**
   * Refresh `admininterface` from actual role membership.
   *
   * The flag is a cached denormalisation on the user record, not the authority:
   * the authority is membership of the `Administrator` or `SiteAdministrator`
   * role, and this is what keeps the two in step. Rate-limited to one check per
   * five minutes exactly as the router was, so ordinary navigation does not add
   * a role query per page.
   */
  async function refreshAdminStatus(force = false) {
    const current = Parse.User.current()
    if (!current) return null
    if (!force && Date.now() - lastAdminCheck < ADMIN_CHECK_TTL_MS) return current
    lastAdminCheck = Date.now()

    const admin = new Parse.Query(Parse.Role).equalTo('users', current).equalTo('name', 'Administrator')
    const siteAdmin = new Parse.Query(Parse.Role)
      .equalTo('users', current)
      .equalTo('name', 'SiteAdministrator')
    const count = await Parse.Query.or(admin, siteAdmin).count()
    const isAdministrator = count ? true : false

    if (current.get('admininterface') !== isAdministrator) {
      current.set('admininterface', isAdministrator)
      await current.save()
    }
    bump()
    return current
  }

  /**
   * Refresh `storytellerinterface` from role membership.
   *
   * The `home` route handler (`mobileRouter.js:306-324`) did this on every
   * visit to the front page: count the roles this user holds -- ANY role, not
   * only troupe ones -- and set the flag to `count > 0`. The flag drives the
   * footer's three-way grid, the front page's troupe shortcut, and a troupe
   * route.
   *
   * One deliberate difference: the original called `user.save()`
   * unconditionally, so every visit to the front page wrote to the `_User` row
   * whether or not anything had changed. This writes only on a change. The flag
   * ends up the same; what is dropped is a redundant write per page view, on
   * the one screen every session starts from.
   */
  async function refreshStorytellerStatus() {
    const current = Parse.User.current()
    if (!current) return null
    const count = await new Parse.Query(Parse.Role).equalTo('users', current).count()
    const isStoryteller = count > 0
    if (current.get('storytellerinterface') !== isStoryteller) {
      current.set('storytellerinterface', isStoryteller)
      await current.save()
    }
    bump()
    return current
  }

  /** Attach the signed-in identity to error reports, as the router did. */
  function identifyForErrorReporting() {
    const current = Parse.User.current()
    if (!current) return
    if (typeof trackJs !== 'undefined') {
      trackJs.configure({ userId: current.get('username'), sessionId: current.getSessionToken() })
    }
  }

  return {
    user,
    revision,
    isLoggedIn,
    username,
    isAdmin,
    isStoryteller,
    navLinks,
    logIn,
    signUp,
    logOut,
    refreshAdminStatus,
    refreshStorytellerStatus,
    identifyForErrorReporting,
    bump,
  }
})
