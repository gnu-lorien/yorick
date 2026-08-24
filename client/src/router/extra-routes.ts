/**
 * Routes that were never in Backbone's route table.
 *
 * `#login` is the important one, and it is a page without a route by design.
 * `enforce_logged_in` reached it with
 * `$.mobile.changePage("#login", {changeHash: false})`
 * (mobileRouter.js:1486) -- deliberately leaving the hash alone, so a
 * signed-out visitor following a link to a character sees the login form with
 * their original URL still in the address bar, and lands where they meant to go
 * once they sign in. Modelling it as a route with an empty `pattern` and a
 * suppressed hash write reproduces that exactly.
 *
 * Kept out of `routes.ts` because that file is generated from the Backbone
 * table and is meant to diff against it line for line.
 */
import type { RouteRecordRaw } from 'vue-router'
import type { YorickRouteMeta } from './routes'

export const extraRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: {
      pattern: '',
      pageId: 'login',
      title: 'Log In',
      gate: 'none',
      handler: 'enforce_logged_in',
    } satisfies YorickRouteMeta,
  },
  {
    /*
     * A hash Backbone did not match was silently ignored, leaving the previous
     * page on screen. There is no previous page on a cold load, so an unknown
     * hash lands here rather than on a blank document.
     */
    path: '/:pathMatch(.*)*',
    name: 'not_found',
    component: () => import('@/pages/NotFoundPage.vue'),
    meta: {
      pattern: '',
      pageId: 'not-found',
      title: 'Not Found',
      gate: 'none',
      handler: '',
    } satisfies YorickRouteMeta,
  },
]
