/**
 * The route table.
 *
 * GENERATED from `public/scripts/app/routers/mobileRouter.js:198-303` and kept
 * in that file's declaration order, because Backbone matched routes in order
 * and so does `hashToPath`: `troupe/new` must be tried before `troupe/:id`.
 *
 * Each entry keeps its Backbone `pattern` verbatim. That string is the URL the
 * address bar shows and the one the E2E suite navigates by; the `path` beside
 * it is an internal detail of Vue Router's matcher and is never displayed. See
 * `backbone-hash.ts` for why the two have to differ.
 *
 * `pageId` is the id of the `data-role="page"` div this route used to activate
 * in `index.html`. It is preserved on the rendered element because
 * `activePageId` in the E2E helpers reads it to decide where the app is.
 *
 * A handler that reaches a character through `get_character` is gated `user`,
 * because `get_character` itself begins with `enforce_logged_in()`
 * (`mobileRouter.js:1571`) -- the gate is one call down rather than on the
 * handler's own first line, which is why it is easy to read those routes as
 * ungated. `access-control.spec.js:390` walks a logged-out visitor through
 * fifteen of them and expects the login page every time.
 *
 * `gate` mirrors what the handler enforced: `admin` called `enforce_admin`,
 * `user` called `enforce_logged_in`, and `none` was reachable signed out.
 * Handlers that reached a character through `get_character` were gated by that
 * call rather than directly, and are marked `user` here -- stating the gate the
 * route actually had, rather than the one its first line spelled out.
 */
import type { RouteRecordRaw } from 'vue-router'

export interface YorickRouteMeta {
  /** The Backbone pattern; the hash written to the address bar. */
  pattern: string
  /** The `data-role="page"` id this route renders, for .ui-page-active. */
  pageId: string | null
  /** The page's `data-title`, shown in the fixed header. */
  title: string
  /**
   * Which auth gate the original handler applied.
   *
   * `admin` is `enforce_admin()` followed by `admin_route_failed`: the refusal
   * is reported in the banner and the user is sent home.
   *
   * `admin-silent` is the OTHER shape the same check took, and the difference
   * is observable. `administration_user` and `administration_user_patronages`
   * wrap their whole body in a bare `if (is_ad) { ... }` with no `else`, so a
   * non-administrator's navigation simply does nothing: no message, no
   * redirect, and the page they were already on stays on screen.
   * `access-control.spec.js` 384 and 385 assert exactly that, against the page
   * they parked on first.
   */
  gate: 'none' | 'user' | 'admin' | 'admin-silent'
  /**
   * The route reaches a character through `get_character` before rendering.
   *
   * Those handlers called `changePage` INSIDE the fetch's success branch, so a
   * character the caller cannot read left them where they were -- there was no
   * empty approval screen to look at, because the screen never came up. With
   * one component per route that has to be a navigation guard: the fetch runs
   * first and the navigation is abandoned if it fails.
   *
   * The value is the message the refusal is reported under, because the old
   * handlers each named their own -- `ReportError.on("Couldn't open the
   * approval page")` and friends. A refusal the reader cannot read is the
   * defect this whole mechanism exists to avoid.
   */
  requiresReadableCharacter?: string
  /** The Backbone handler this route came from, for tracing back. */
  handler: string
}

export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: () => import('@/pages/PlayerOptionsPage.vue'),
    meta: {
      pattern: "",
      pageId: "player-options",
      title: "Player Options",
      gate: "user",
      handler: "home",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/start",
    name: "home_2",
    component: () => import('@/pages/PlayerOptionsPage.vue'),
    meta: {
      pattern: "start",
      pageId: "player-options",
      title: "Player Options",
      gate: "user",
      handler: "home",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/about",
    name: "about",
    component: () => import('@/pages/AboutPage.vue'),
    meta: {
      pattern: "about",
      pageId: "about",
      title: "About",
      gate: "none",
      handler: "about",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/privacy",
    name: "privacy_policy",
    component: () => import('@/pages/PrivacyPage.vue'),
    meta: {
      pattern: "privacy",
      pageId: "privacy",
      title: "Privacy Policy",
      gate: "none",
      handler: "privacy_policy",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/logout",
    name: "logout",
    component: () => import('@/actions/LogoutAction.vue'),
    meta: {
      pattern: "logout",
      pageId: null,
      title: "",
      gate: "none",
      handler: "logout",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/signup",
    name: "signup",
    component: () => import('@/pages/SignupPage.vue'),
    meta: {
      pattern: "signup",
      pageId: "signup",
      title: "Sign Up",
      gate: "none",
      handler: "signup",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/reset",
    name: "resetpassword",
    component: () => import('@/pages/UserResetPasswordPage.vue'),
    meta: {
      pattern: "reset",
      pageId: "user-reset-password",
      title: "Reset Password",
      gate: "none",
      handler: "resetpassword",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/profile",
    name: "profile",
    component: () => import('@/pages/UserSettingsProfilePage.vue'),
    meta: {
      pattern: "profile",
      pageId: "user-settings-profile",
      title: "Profile",
      gate: "user",
      handler: "profile",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/patronage/:id",
    name: "a_patronage",
    component: () => import('@/pages/AdministrationPatronageViewPage.vue'),
    meta: {
      pattern: "patronage/:id",
      pageId: "administration-patronage-view",
      title: "Patronage",
      gate: "user",
      handler: "a_patronage",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/category/:type",
    name: "category",
    component: () => import('@/actions/CategoryAction.vue'),
    meta: {
      pattern: "category?:type",
      pageId: null,
      title: "",
      gate: "none",
      handler: "category",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/victims/:type",
    name: "victims",
    component: () => import('@/pages/VictimsAllPage.vue'),
    meta: {
      pattern: "victims?:type",
      pageId: "victims-all",
      title: "VictimsAll",
      gate: "none",
      handler: "victims",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/characters/:type",
    name: "characters",
    component: () => import('@/pages/CharactersAllPage.vue'),
    meta: {
      pattern: "characters?:type",
      pageId: "characters-all",
      title: "Characters",
      gate: "user",
      handler: "characters",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:id",
    name: "character",
    component: () => import('@/pages/CharacterPage.vue'),
    meta: {
      pattern: "character?:id",
      pageId: "character",
      title: "Character",
      gate: "none",
      handler: "character",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/simpletraits/:category/:cid/:type",
    name: "simpletraits",
    component: () => import('@/pages/SimpleTraitsPage.vue'),
    meta: {
      pattern: "simpletraits/:category/:cid/:type",
      pageId: "simpletraitcategory-all",
      title: "SimpleTraitCategoryAll",
      gate: "none",
      handler: "simpletraits",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/simpletrait/:category/:cid/:bid",
    name: "simpletrait",
    component: () => import('@/pages/SimpletraitChangePage.vue'),
    meta: {
      pattern: "simpletrait/:category/:cid/:bid",
      pageId: "simpletrait-change",
      title: "SimpleTraitChange",
      gate: "none",
      handler: "simpletrait",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/simpletrait/specialize/:category/:cid/:bid",
    name: "simpletraitspecialize",
    component: () => import('@/pages/SimpletraitSpecializationPage.vue'),
    meta: {
      pattern: "simpletrait/specialize/:category/:cid/:bid",
      pageId: "simpletrait-specialization",
      title: "Simple Trait Specialization",
      gate: "none",
      handler: "simpletraitspecialize",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/simpletrait/spacer/:category/:cid/:name/:value/:free_value/new",
    name: "simpletraitnew",
    component: () => import('@/pages/SimpletraitChangePage.vue'),
    meta: {
      pattern: "simpletrait/spacer/:category/:cid/:name/:value/:free_value/new",
      pageId: "simpletrait-change",
      title: "SimpleTraitChange",
      gate: "none",
      handler: "simpletraitnew",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/simpletrait/specialize/:category/:cid/:name/:value/:free_value/new",
    name: "simpletrait_new_specialize",
    component: () => import('@/pages/SimpletraitNewSpecializationPage.vue'),
    meta: {
      pattern: "simpletrait/specialize/:category/:cid/:name/:value/:free_value/new",
      pageId: "simpletrait-new-specialization",
      title: "Simple Trait Specialization",
      gate: "none",
      handler: "simpletrait_new_specialize",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/simpletext/:category/:target/:cid/pick",
    name: "simpletextpick",
    component: () => import('@/pages/SimpletextNewPage.vue'),
    meta: {
      pattern: "simpletext/:category/:target/:cid/pick",
      pageId: "simpletext-new",
      title: "New Simple Text",
      gate: "none",
      handler: "simpletextpick",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/simpletext/:category/:target/:cid/unpick",
    name: "simpletextunpick",
    component: () => import('@/actions/SimpletextunpickAction.vue'),
    meta: {
      pattern: "simpletext/:category/:target/:cid/unpick",
      pageId: null,
      title: "",
      gate: "none",
      handler: "simpletextunpick",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/charactercreate/:cid",
    name: "charactercreate",
    component: () => import('@/pages/CharacterCreatePage.vue'),
    meta: {
      pattern: "charactercreate/:cid",
      pageId: "character-create",
      title: "Create Character",
      gate: "user",
      handler: "charactercreate",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/charactercreate/simpletraits/:category/:cid/pick/:i",
    name: "charactercreatepicksimpletrait",
    component: () => import('@/pages/CharacterCreateSimpletraitNewPage.vue'),
    meta: {
      pattern: "charactercreate/simpletraits/:category/:cid/pick/:i",
      pageId: "character-create-simpletrait-new",
      title: "New Simple Trait",
      gate: "none",
      handler: "charactercreatepicksimpletrait",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/charactercreate/simpletraits/:category/:cid/unpick/:stid/:i",
    name: "charactercreateunpicksimpletrait",
    component: () => import('@/actions/CharactercreateunpicksimpletraitAction.vue'),
    meta: {
      pattern: "charactercreate/simpletraits/:category/:cid/unpick/:stid/:i",
      pageId: null,
      title: "",
      gate: "none",
      handler: "charactercreateunpicksimpletrait",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/charactercreate/simpletraits/:category/:cid/specialize/:stid/:i",
    name: "charactercreatespecializesimpletrait",
    component: () => import('@/pages/SimpletraitSpecializationPage.vue'),
    meta: {
      pattern: "charactercreate/simpletraits/:category/:cid/specialize/:stid/:i",
      pageId: "simpletrait-specialization",
      title: "Simple Trait Specialization",
      gate: "none",
      handler: "charactercreatespecializesimpletrait",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/charactercreate/simpletext/:category/:target/:cid/pick",
    name: "charactercreatepicksimpletext",
    component: () => import('@/pages/SimpletextNewPage.vue'),
    meta: {
      pattern: "charactercreate/simpletext/:category/:target/:cid/pick",
      pageId: "simpletext-new",
      title: "New Simple Text",
      gate: "none",
      handler: "charactercreatepicksimpletext",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/charactercreate/simpletext/:category/:target/:cid/unpick",
    name: "charactercreateunpicksimpletext",
    component: () => import('@/actions/CharactercreateunpicksimpletextAction.vue'),
    meta: {
      pattern: "charactercreate/simpletext/:category/:target/:cid/unpick",
      pageId: null,
      title: "",
      gate: "none",
      handler: "charactercreateunpicksimpletext",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/charactercreate/complete/:cid",
    name: "charactercreatecomplete",
    component: () => import('@/actions/CharactercreatecompleteAction.vue'),
    meta: {
      pattern: "charactercreate/complete/:cid",
      pageId: null,
      title: "",
      gate: "none",
      handler: "charactercreatecomplete",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/characternew",
    name: "characternew",
    component: () => import('@/pages/CharacterNewPage.vue'),
    meta: {
      pattern: "characternew",
      pageId: "character-new",
      title: "New Character",
      gate: "user",
      handler: "characternew",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/print",
    name: "characterprint",
    component: () => import('@/pages/PrintableSheetPage.vue'),
    meta: {
      pattern: "character/:cid/print",
      pageId: "printable-sheet",
      title: "Printable Sheet",
      gate: "user",
      handler: "characterprint",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/costs",
    name: "charactercosts",
    component: () => import('@/pages/CharacterCostsPage.vue'),
    meta: {
      pattern: "character/:cid/costs",
      pageId: "character-costs",
      title: "Character Costs",
      gate: "user",
      handler: "charactercosts",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/log/:start/:changeBy",
    name: "characterlog",
    component: () => import('@/pages/CharacterLogPage.vue'),
    meta: {
      pattern: "character/:cid/log/:start/:changeBy",
      pageId: "character-log",
      title: "Character Log",
      gate: "user",
      handler: "characterlog",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/history/:id",
    name: "characterhistory",
    component: () => import('@/pages/CharacterHistoryPage.vue'),
    meta: {
      pattern: "character/:cid/history/:id",
      pageId: "character-history",
      title: "Character History",
      gate: "user",
      handler: "characterhistory",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/portrait",
    name: "characterportrait",
    component: () => import('@/pages/CharacterPortraitPage.vue'),
    meta: {
      pattern: "character/:cid/portrait",
      pageId: "character-portrait",
      title: "Profile",
      gate: "user",
      handler: "characterportrait",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/delete",
    name: "characterdelete",
    component: () => import('@/pages/CharacterDeletePage.vue'),
    meta: {
      pattern: "character/:cid/delete",
      pageId: "character-delete",
      title: "Delete Character",
      gate: "none",
      handler: "characterdelete",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/troupes",
    name: "character_list_troupes",
    component: () => import('@/pages/CharacterPickTroupeToShowPage.vue'),
    meta: {
      pattern: "character/:cid/troupes",
      pageId: "character-pick-troupe-to-show",
      title: "Show Troupe",
      gate: "none",
      handler: "character_list_troupes",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/troupes/leave",
    name: "character_pick_troupe_to_leave",
    component: () => import('@/pages/CharacterPickTroupeToLeavePage.vue'),
    meta: {
      pattern: "character/:cid/troupes/leave",
      pageId: "character-pick-troupe-to-leave",
      title: "Leave Troupe",
      gate: "none",
      handler: "character_pick_troupe_to_leave",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/troupes/join",
    name: "character_pick_troupe_to_join",
    component: () => import('@/pages/CharacterPickTroupeToJoinPage.vue'),
    meta: {
      pattern: "character/:cid/troupes/join",
      pageId: "character-pick-troupe-to-join",
      title: "Join Troupe",
      gate: "none",
      handler: "character_pick_troupe_to_join",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/troupe/:tid/join",
    name: "character_join_troupe",
    component: () => import('@/pages/TroupePage.vue'),
    meta: {
      pattern: "character/:cid/troupe/:tid/join",
      pageId: "troupe",
      title: "Troupe",
      gate: "none",
      handler: "character_join_troupe",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/troupe/:tid/leave",
    name: "character_leave_troupe",
    component: () => import('@/actions/CharacterLeaveTroupeAction.vue'),
    meta: {
      pattern: "character/:cid/troupe/:tid/leave",
      pageId: null,
      title: "",
      gate: "none",
      handler: "character_leave_troupe",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/troupe/:tid/show",
    name: "character_show_troupe",
    component: () => import('@/pages/TroupePage.vue'),
    meta: {
      pattern: "character/:cid/troupe/:tid/show",
      pageId: "troupe",
      title: "Troupe",
      gate: "none",
      handler: "character_show_troupe",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/approval",
    name: "characterapproval",
    component: () => import('@/pages/CharacterApprovalPage.vue'),
    meta: {
      pattern: "character/:cid/approval",
      pageId: "character-approval",
      title: "Character Approval",
      requiresReadableCharacter: "Couldn't open the approval page",
      gate: "user",
      handler: "characterapproval",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/rename",
    name: "characterrename",
    component: () => import('@/pages/CharacterRenamePage.vue'),
    meta: {
      pattern: "character/:cid/rename",
      pageId: "character-rename",
      title: "Rename Character",
      gate: "user",
      handler: "characterrename",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/approved",
    name: "character_show_approved",
    component: () => import('@/pages/CharacterPrintNoApprovalPage.vue'),
    meta: {
      pattern: "character/:cid/approved",
      pageId: "character-print-no-approval",
      title: "Print Approval",
      gate: "user",
      handler: "character_show_approved",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/extendedprinttext",
    name: "character_extended_print_text",
    component: () => import('@/pages/ExtendedPrintTextPage.vue'),
    meta: {
      pattern: "character/:cid/extendedprinttext",
      pageId: "extended-print-text",
      title: "Additional Printed Text",
      gate: "user",
      handler: "character_extended_print_text",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/backgroundlt",
    name: "character_background_long_text",
    component: () => import('@/pages/LongTextPage.vue'),
    meta: {
      pattern: "character/:cid/backgroundlt",
      pageId: "long-text",
      title: "Long Text",
      gate: "user",
      handler: "character_background_long_text",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/noteslt",
    name: "character_notes_long_text",
    component: () => import('@/pages/LongTextPage.vue'),
    meta: {
      pattern: "character/:cid/noteslt",
      pageId: "long-text",
      title: "Long Text",
      gate: "user",
      handler: "character_notes_long_text",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/character/:cid/experience/:start/:changeBy",
    name: "characterexperience",
    component: () => import('@/pages/ExperienceNotationsAllPage.vue'),
    meta: {
      pattern: "character/:cid/experience/:start/:changeBy",
      pageId: "experience-notations-all",
      title: "Experience Notations",
      gate: "user",
      handler: "characterexperience",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/new",
    name: "troupenew",
    component: () => import('@/pages/TroupeNewPage.vue'),
    meta: {
      pattern: "troupe/new",
      pageId: "troupe-new",
      title: "New Troupe",
      gate: "user",
      handler: "troupenew",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupes",
    name: "troupes",
    component: () => import('@/pages/TroupesListPage.vue'),
    meta: {
      pattern: "troupes",
      pageId: "troupes-list",
      title: "Troupes",
      gate: "user",
      handler: "troupes",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id",
    name: "troupe",
    component: () => import('@/pages/TroupePage.vue'),
    meta: {
      pattern: "troupe/:id",
      pageId: "troupe",
      title: "Troupe",
      gate: "user",
      handler: "troupe",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id/staff/add",
    name: "troupeaddstaff",
    component: () => import('@/pages/TroupeAddStaffPage.vue'),
    meta: {
      pattern: "troupe/:id/staff/add",
      pageId: "troupe-add-staff",
      title: "Add Staff",
      gate: "user",
      handler: "troupeaddstaff",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id/staff/edit/:uid",
    name: "troupeeditstaff",
    component: () => import('@/pages/TroupeEditStaffPage.vue'),
    meta: {
      pattern: "troupe/:id/staff/edit/:uid",
      pageId: "troupe-edit-staff",
      title: "Edit Staff",
      gate: "user",
      handler: "troupeeditstaff",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id/characters/:type",
    name: "troupecharacters",
    component: () => import('@/pages/TroupeCharactersAllPage.vue'),
    meta: {
      pattern: "troupe/:id/characters/:type",
      pageId: "troupe-characters-all",
      title: "Troupe Characters",
      gate: "user",
      handler: "troupecharacters",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id/characters/summarize/:type",
    name: "troupesummarizecharacters",
    component: () => import('@/pages/TroupeSummarizeCharactersAllPage.vue'),
    meta: {
      pattern: "troupe/:id/characters/summarize/:type",
      pageId: "troupe-summarize-characters-all",
      title: "Troupe Characters",
      gate: "user",
      handler: "troupesummarizecharacters",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id/characters/selecttoprint/:type",
    name: "troupe_select_to_print_characters",
    component: () => import('@/pages/TroupeSelectToPrintCharactersAllPage.vue'),
    meta: {
      pattern: "troupe/:id/characters/selecttoprint/:type",
      pageId: "troupe-select-to-print-characters-all",
      title: "Troupe Characters",
      gate: "user",
      handler: "troupe_select_to_print_characters",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id/characters/print/:type",
    name: "troupe_print_characters",
    component: () => import('@/pages/TroupePrintCharactersAllPage.vue'),
    meta: {
      pattern: "troupe/:id/characters/print/:type",
      pageId: "troupe-print-characters-all",
      title: "Print Troupe Characters",
      gate: "user",
      handler: "troupe_print_characters",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id/characters/relationships/network",
    name: "troupe_relationship_network",
    component: () => import('@/pages/TroupeCharacterRelationshipsNetworkPage.vue'),
    meta: {
      pattern: "troupe/:id/characters/relationships/network",
      pageId: "troupe-character-relationships-network",
      title: "Relationships Network",
      gate: "user",
      handler: "troupe_relationship_network",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id/character/:cid",
    name: "troupe_character",
    component: () => import('@/pages/CharacterPage.vue'),
    meta: {
      pattern: "troupe/:id/character/:cid",
      pageId: "character",
      title: "Character",
      gate: "none",
      handler: "troupe_character",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/troupe/:id/portrait",
    name: "troupe_portrait",
    component: () => import('@/pages/TroupePortraitPage.vue'),
    meta: {
      pattern: "troupe/:id/portrait",
      pageId: "troupe-portrait",
      title: "Profile",
      gate: "user",
      handler: "troupe_portrait",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration",
    name: "administration",
    component: () => import('@/pages/AdministrationPage.vue'),
    meta: {
      pattern: "administration",
      pageId: "administration",
      title: "Administration",
      gate: "admin",
      handler: "administration",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/characters/all",
    name: "administration_characters_all",
    component: () => import('@/pages/CharactersAllPage.vue'),
    meta: {
      pattern: "administration/characters/all",
      pageId: "characters-all",
      title: "Characters",
      gate: "admin",
      handler: "administration_characters_all",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/characters/summarize",
    name: "administration_characters_summarize",
    component: () => import('@/pages/TroupeSummarizeCharactersAllPage.vue'),
    meta: {
      pattern: "administration/characters/summarize",
      pageId: "troupe-summarize-characters-all",
      title: "Troupe Characters",
      gate: "admin",
      handler: "administration_characters_summarize",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/character/:id",
    name: "administration_character",
    component: () => import('@/pages/CharacterPage.vue'),
    meta: {
      pattern: "administration/character/:id",
      pageId: "character",
      title: "Character",
      gate: "none",
      handler: "administration_character",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/users/all",
    name: "administration_users",
    component: () => import('@/pages/TroupeAddStaffPage.vue'),
    meta: {
      pattern: "administration/users/all",
      pageId: "troupe-add-staff",
      title: "Add Staff",
      gate: "user",
      handler: "administration_users",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/user/:id",
    name: "administration_user",
    component: () => import('@/pages/AdministrationUserViewPage.vue'),
    meta: {
      pattern: "administration/user/:id",
      pageId: "administration-user-view",
      title: "User View",
      gate: "admin-silent",
      handler: "administration_user",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/patronages/user/:id",
    name: "administration_user_patronages",
    component: () => import('@/pages/AdministrationUserPatronagesViewPage.vue'),
    meta: {
      pattern: "administration/patronages/user/:id",
      pageId: "administration-user-patronages-view",
      title: "Patronages",
      gate: "admin-silent",
      handler: "administration_user_patronages",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/patronages",
    name: "administration_patronages",
    component: () => import('@/pages/AdministrationPatronagesViewPage.vue'),
    meta: {
      pattern: "administration/patronages",
      pageId: "administration-patronages-view",
      title: "Patronages",
      gate: "user",
      handler: "administration_patronages",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/patronagescsv",
    name: "administration_patronages_csv",
    component: () => import('@/pages/AdministrationPatronagesViewCsvPage.vue'),
    meta: {
      pattern: "administration/patronagescsv",
      pageId: "administration-patronages-view-csv",
      title: "Patronages",
      gate: "user",
      handler: "administration_patronages_csv",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/patronage/:id",
    name: "administration_patronage",
    component: () => import('@/pages/AdministrationPatronageViewPage.vue'),
    meta: {
      pattern: "administration/patronage/:id",
      pageId: "administration-patronage-view",
      title: "Patronage",
      gate: "admin",
      handler: "administration_patronage",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/patronages/new",
    name: "administration_patronage_new",
    component: () => import('@/pages/AdministrationPatronageViewPage.vue'),
    meta: {
      pattern: "administration/patronages/new",
      pageId: "administration-patronage-view",
      title: "Patronage",
      gate: "admin",
      handler: "administration_patronage_new",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/patronages/new/:userid",
    name: "administration_patronage_new_2",
    component: () => import('@/pages/AdministrationPatronageViewPage.vue'),
    meta: {
      pattern: "administration/patronages/new/:userid",
      pageId: "administration-patronage-view",
      title: "Patronage",
      gate: "admin",
      handler: "administration_patronage_new",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/descriptions",
    name: "administration_descriptions",
    component: () => import('@/pages/AdministrationDescriptionsPage.vue'),
    meta: {
      pattern: "administration/descriptions",
      pageId: "administration-descriptions",
      title: "Descriptions",
      gate: "admin",
      handler: "administration_descriptions",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/bnsctdbs_kith_rules",
    name: "administration_bnsctdbs_kith_rules",
    component: () => import('@/pages/AdministrationDescriptionsPage.vue'),
    meta: {
      pattern: "administration/bnsctdbs_kith_rules",
      pageId: "administration-descriptions",
      title: "Descriptions",
      gate: "admin",
      handler: "administration_bnsctdbs_kith_rules",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/bnsmetv1_clan_rules",
    name: "administration_bnsmetv1_clan_rules",
    component: () => import('@/pages/AdministrationDescriptionsPage.vue'),
    meta: {
      pattern: "administration/bnsmetv1_clan_rules",
      pageId: "administration-descriptions",
      title: "Descriptions",
      gate: "admin",
      handler: "administration_bnsmetv1_clan_rules",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/bnsmetv1_elder_discipline_rules",
    name: "administration_bnsmetv1_elder_discipline_rules",
    component: () => import('@/pages/AdministrationDescriptionsPage.vue'),
    meta: {
      pattern: "administration/bnsmetv1_elder_discipline_rules",
      pageId: "administration-descriptions",
      title: "Descriptions",
      gate: "admin",
      handler: "administration_bnsmetv1_elder_discipline_rules",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/bnsmetv1_technique_rules",
    name: "administration_bnsmetv1_technique_rules",
    component: () => import('@/pages/AdministrationDescriptionsPage.vue'),
    meta: {
      pattern: "administration/bnsmetv1_technique_rules",
      pageId: "administration-descriptions",
      title: "Descriptions",
      gate: "admin",
      handler: "administration_bnsmetv1_technique_rules",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/bnsmetv1_ritual_rules",
    name: "administration_bnsmetv1_ritual_rules",
    component: () => import('@/pages/AdministrationDescriptionsPage.vue'),
    meta: {
      pattern: "administration/bnsmetv1_ritual_rules",
      pageId: "administration-descriptions",
      title: "Descriptions",
      gate: "admin",
      handler: "administration_bnsmetv1_ritual_rules",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/referendums",
    name: "referendums",
    component: () => import('@/pages/ReferendumsListPage.vue'),
    meta: {
      pattern: "referendums",
      pageId: "referendums-list",
      title: "Referendums",
      gate: "user",
      handler: "referendums",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/referendum/:id",
    name: "referendum",
    component: () => import('@/pages/ReferendumPage.vue'),
    meta: {
      pattern: "referendum/:id",
      pageId: "referendum",
      title: "Referendum",
      gate: "user",
      handler: "referendum",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/referendums",
    name: "administration_referendums",
    component: () => import('@/pages/ReferendumsListPage.vue'),
    meta: {
      pattern: "administration/referendums",
      pageId: "referendums-list",
      title: "Referendums",
      gate: "admin",
      handler: "administration_referendums",
    } satisfies YorickRouteMeta,
  },
  {
    path: "/administration/referendum/:id",
    name: "administration_referendum",
    component: () => import('@/pages/ReferendumPage.vue'),
    meta: {
      pattern: "administration/referendum/:id",
      pageId: "referendum",
      title: "Referendum",
      gate: "admin",
      handler: "administration_referendum",
    } satisfies YorickRouteMeta,
  },
]
