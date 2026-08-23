/**
 * Every `Parse.Cloud.run` the browser makes, in one typed place.
 *
 * ## Why this file is a hard API contract and not a convenience
 *
 * parse-server 9.10.0 defaults `enforcePrivateUsers` true, so a `_User` row
 * created after the upgrade carries only `ACL[objectId] = {read, write}`. The
 * browser has no master key. Every read of somebody ELSE's account row --
 * the account directory, a character's owner name, a troupe's staff roster,
 * a ballot's caster -- therefore cannot happen client-side at all any more; it
 * happens here or it does not happen. The same is true of the admin password
 * reset (Parse never returns another user's `email` to a client, so the button
 * used to hand `requestPasswordReset` an empty string) and of casting a
 * referendum ballot (the `ReferendumBallot` class now refuses `create` to
 * everyone, precisely so the patronage check cannot be skipped by POSTing a
 * row directly).
 *
 * The function NAMES and the ARGUMENT SHAPES below are the wire protocol of a
 * server this client does not deploy in lockstep with. They are copied from
 * `cloud/main.js` and must not be tidied, renamed or "normalised" to camelCase.
 * The exported TypeScript wrappers are camelCase; the strings they send are not.
 *
 * ## The include("owner") trap, carried over from helpers/UserWreqr.js
 *
 * The obvious way to put an owner's name on a roster is `query.include("owner")`.
 * Do not. parse-server's `handleInclude` returns EARLY when nothing was asked
 * to be included, and it deletes a pointer only when it was asked to EXPAND one
 * and could not read it. So:
 *
 *   - with `include("owner")`   -> an unreadable owner is DELETED from the row
 *   - without `include("owner")` -> the raw pointer SURVIVES, id and all
 *
 * and an ABSENT `owner` is what ARCHIVED means -- `Character#archive` is
 * literally `self.unset("owner"); self.save()` (models/Character.js:930-934).
 * An over-eager `include` therefore makes every character whose owner the
 * viewer cannot read look archived, and a storyteller's troupe roster silently
 * loses live characters with no error anywhere. Query WITHOUT the include, keep
 * the pointer, and resolve just the display name through `getUsersById` here.
 * Only the owner's NAME needs a Cloud function; the pointer already has the id.
 *
 * ## Deliberately not ported
 *
 * `submit_facebook_profile_data` (cloud/main.js:840). Facebook login is removed
 * from this client, not migrated -- the owner's explicit call, and it was
 * already half-removed on greensboro where the buttons are hidden. The Cloud
 * function still exists server-side and the `UserFacebookData` rows still
 * exist; nothing in the Vue client writes to either. If Facebook login ever
 * comes back, this is the line it comes back on.
 *
 * ## Notes for callers
 *
 * These are native promises. The Backbone call sites combined several of them
 * with `Parse.Promise.when(...)`, which resolves with SEPARATE ARGUMENTS and
 * waits for every input to settle; `Promise.all` resolves with one array and
 * rejects on the first failure. `routers/mobileRouter.js:2305` and `:2353` both
 * do this with `get_my_patronage_status`, and `models/Character.js:1109` does it
 * with `get_expected_vampire_ids`. Every such site must be rewritten to
 * destructure explicitly, and to decide on purpose whether a partial failure
 * should still render.
 *
 * Rejections arrive as `Parse.Error`. Most bodies in `cloud/main.js` end in
 * `response.error(_.isString(error) ? error : error.message)`, so the useful
 * text is on `error.message` and the code is 141 (`SCRIPT_FAILED`). Two
 * functions (`get_expected_vampire_ids`, `change_troupe_staff`) hand
 * `response.error` a non-string object instead; their `message` is whatever
 * parse-server made of it. Noted, not fixed -- the server is out of scope here.
 */
// The NAMED export from '@/parse', not the default one. `@/parse` re-exports
// the SDK both ways, and only a named re-export of an import alias carries the
// `Parse` *namespace* through with the value -- which is what makes
// `Parse.User<IdentityAttributes>` usable as a type below. The default export
// gives back a value alone, and the type annotations here would stop compiling.
import { Parse } from '@/parse'

// ---------------------------------------------------------------------------
// The wire names.
// ---------------------------------------------------------------------------

/**
 * The exact strings sent to the server, in one place so a typo is a compile
 * error rather than a 141 "Invalid function" at runtime.
 *
 * An unknown name does not fail quietly: parse-server answers
 * `{code: 141, error: "Invalid function: <name>"}`. That is also what
 * `getCapturedEmails` gets on a deployment with a real mail provider -- see
 * its doc comment.
 */
export const CLOUD_FUNCTIONS = {
  listUsers: 'list_users',
  getUsersById: 'get_users_by_id',
  updateVampireChangePermissionsFor: 'update_vampire_change_permissions_for',
  getExpectedVampireIds: 'get_expected_vampire_ids',
  getTroupeStaff: 'get_troupe_staff',
  getMyPatronageStatus: 'get_my_patronage_status',
  requestPasswordResetFor: 'request_password_reset_for',
  voteForReferendum: 'vote_for_referendum',
  changeTroupeStaff: 'change_troupe_staff',
  makeMeAdmin: 'make_me_admin',
  checkUserPassword: 'check_user_password',
  getCapturedEmails: 'get_captured_emails',
} as const

export type CloudFunctionName = (typeof CLOUD_FUNCTIONS)[keyof typeof CLOUD_FUNCTIONS]

/**
 * The one call into the SDK.
 *
 * The SDK's own overloads for `Cloud.run` infer the result from a supplied
 * function type, which is no help across a network boundary where the real
 * contract lives in `cloud/main.js`. Each wrapper below states its result type
 * explicitly and this asserts it, so there is exactly one unchecked cast per
 * process instead of one per call site, and it sits next to the doc comment
 * that justifies it.
 *
 * No options bag: the browser's current session token is applied by the SDK,
 * and `useMasterKey` is not a thing a browser has.
 */
async function run<TResult>(
  name: CloudFunctionName,
  params?: Record<string, unknown>,
): Promise<TResult> {
  const result = await Parse.Cloud.run(name, params as never)
  return result as unknown as TResult
}

// ---------------------------------------------------------------------------
// Identity. Read cloud/main.js:1130-1345 before changing anything here.
// ---------------------------------------------------------------------------

/**
 * Everything about a `_User` that the server will let out.
 *
 * This mirrors `IDENTITY_FIELDS` (cloud/main.js:1139) exactly, and every field
 * is optional because `identity_of` copies a field only when it is neither
 * `undefined` nor `null` -- a user who has never touched the mass-mail checkbox
 * has no `massmailauthorization` key in the payload at all. Do not paper over
 * that with a default here: `undefined` means "not set", `false` means "set to
 * no", and the admin form at `#administration/user/:id` renders the difference.
 *
 * `email` is NOT in this list and must not be added. parse-server withholds it
 * from every non-master read on its own (`protectedFields` defaults to
 * `{_User: {'*': ['email']}}`), so no browser caller can see another member's
 * address today and none could before the migration. The Cloud functions read
 * under the MASTER KEY, which bypasses that filter entirely, so returning it
 * would be an expansion of what the app exposes dressed up as a migration.
 * Owner decision, 2026-08-20: no new capabilities around email. The server-side
 * switch is `IDENTITY_INCLUDES_EMAIL` (cloud/main.js:1165) and it is false; if
 * it is ever flipped, that is a product decision and this type changes with it.
 *
 * A member's own address is unaffected and always was -- the caller's own row
 * comes from `Parse.User.current()`, never through these functions.
 *
 * A type alias rather than an interface on purpose: only an alias gets the
 * implicit index signature that satisfies the SDK's `Attributes` constraint.
 */
export type IdentityAttributes = {
  username?: string
  realname?: string
  massmailauthorization?: boolean
  acceptedtos?: boolean
}

/** The field list the server projects, mirrored for callers that build forms. */
export const IDENTITY_FIELDS = [
  'username',
  'realname',
  'massmailauthorization',
  'acceptedtos',
] as const

/**
 * A user as these functions return them.
 *
 * The server builds these with `Parse.Object.fromJSON`, field by field off the
 * allowlist, rather than by filtering a fetched row -- a master-key read
 * bypasses `protectedFields` AND the `authData` strip, and `authData` carries a
 * live OAuth access token, while `request.user`'s server data carries the
 * caller's SESSION TOKEN. Constructing the result means nothing escapes by
 * accident. It also means what arrives here is CLEAN: `dirty() === false`, no
 * pending ops, so it can be read and dropped without ever being saved.
 *
 * These must never be saved. They are projections of a row the caller almost
 * certainly cannot write, and a save would take a 403 on a row the user never
 * asked to change. Read `.get('username')`, render it, discard it.
 */
export type IdentityUser = Parse.User<IdentityAttributes>

/**
 * The server's cap on one `get_users_by_id` call (`MAX_IDENTITY_IDS`,
 * cloud/main.js:1168).
 *
 * `getUsersById` is a faithful 1:1 wrapper and does NOT chunk -- over the cap
 * the server refuses the whole call with "Ask about at most 200 accounts per
 * call." rather than truncating, so a caller resolving a large roster must
 * chunk at this number and run the chunks in sequence, the way
 * `helpers/UserWreqr.js#prime` did.
 */
export const MAX_IDENTITY_IDS = 200

// ---------------------------------------------------------------------------
// The account directory.
// ---------------------------------------------------------------------------

/**
 * Which tier of the directory the server was willing to serve.
 *
 * `"all"` for an administrator or any troupe staffer, `"self"` for everyone
 * else. It is returned so the client can SAY why a list is short instead of
 * rendering a mysteriously empty picker, and so the deployed policy is visible
 * in devtools.
 */
export type UserDirectoryScope = 'all' | 'self'

export interface ListUsersResult {
  scope: UserDirectoryScope
  users: IdentityUser[]
}

/**
 * `list_users` -- the whole account directory, or just yourself.
 *
 * Replaces `collections/Users.js`'s client-side sweep and the second,
 * independent sweep in `views/UsersView.js`. Both of those were ordinary
 * ACL-filtered `find`s: under private users they would have started silently
 * skipping people, one signup at a time, with nothing anywhere saying so. (The
 * `createdAt` high-water mark that used to page them went with them: it took
 * its watermark from rows ALREADY LOADED, so the moment new accounts became
 * invisible it froze and re-scanned an empty window forever.)
 *
 * The "self" tier is not a refusal. `#profile` and `#patronage/:id` are
 * login-only routes that legitimately need the caller's own row, and it
 * reproduces exactly the filter `helpers/UserWreqr.js` already applied in the
 * browser -- moved to where it can actually withhold something.
 *
 * Who counts as staff is decided server-side from the ROLE GRAPH, never from
 * `admininterface` / `storytellerinterface`: those are UI caches the browser
 * writes onto the user's own row, and `_User` grants update to '*', so a player
 * can set either on themselves. Staff means "holds any troupe role" by owner
 * decision, 2026-08-20, so no storyteller loses a capability they have today.
 *
 * Refuses: an anonymous caller, with "Unauthorized: Must be logged in."
 * Cannot truncate: the server pages with `each`, not `find` (which would cap at
 * 100 and lose most of the production accounts).
 */
export function listUsers(): Promise<ListUsersResult> {
  // Called with no params, exactly as collections/Users.js did.
  return run<ListUsersResult>(CLOUD_FUNCTIONS.listUsers)
}

export interface GetUsersByIdResult {
  users: IdentityUser[]
  /**
   * Ids that were asked about and not answered.
   *
   * This deliberately CONFLATES "you may not see this account" with "there is
   * no such account". Reporting them apart would turn this into an existence
   * oracle for arbitrary objectIds. The one place that cared about the
   * distinction -- archived versus merely hidden -- is answered by whether the
   * `owner` POINTER is present on the character, not by this call, because
   * archiving unsets `owner` outright.
   *
   * Cache the misses. An unreadable owner should cost one request per page
   * load, not one per render.
   */
  withheld: string[]
}

/**
 * `get_users_by_id` -- resolve ids you already hold. The workhorse.
 *
 * This is what replaces every `include("owner")`, the `include("caster")` on
 * ballots, and the three by-id user gets. It CANNOT be used to enumerate: you
 * must already know the ids, and the server independently decides which of them
 * you are entitled to.
 *
 * How that entitlement is decided is worth knowing, because it is not a role
 * check. An admin or a staffer gets everything asked for. Anyone else gets
 * their own id, plus the owners of characters THEY CAN READ -- the server
 * re-runs the character query as the caller, with the caller's session token,
 * so the answer is the character ACL itself rather than a second implementation
 * of it that could drift from `models/Character.js#get_me_acl`. "Vampire"
 * covers all three venues there; Werewolf and ChangelingBetaSlice register that
 * className on purpose.
 *
 * @param ids at most {@link MAX_IDENTITY_IDS}; duplicates and non-strings are
 *   dropped server-side, and an empty array answers `{users: [], withheld: []}`
 *   without touching the database.
 *
 * Refuses: an anonymous caller ("Unauthorized: Must be logged in."), a non-array
 * `ids` ("`ids` must be an array of objectIds."), and more than the cap
 * ("Ask about at most 200 accounts per call.").
 */
export function getUsersById(ids: readonly string[]): Promise<GetUsersByIdResult> {
  return run<GetUsersByIdResult>(CLOUD_FUNCTIONS.getUsersById, { ids: [...ids] })
}

// ---------------------------------------------------------------------------
// Troupe staff.
// ---------------------------------------------------------------------------

/**
 * The three staff titles, in the order the server returns them.
 *
 * Fixed LST, AST, Narrator server-side. The browser-side version this replaces
 * (`models/Troupe.js#get_staff`) iterated an object whose key order came from
 * promise resolution, so the roster shuffled between loads.
 */
export type TroupeStaffTitle = 'LST' | 'AST' | 'Narrator'

/** LST, AST, Narrator -- `Troupe#title_options` from models/Troupe.js:17. */
export const TROUPE_STAFF_TITLES: readonly TroupeStaffTitle[] = ['LST', 'AST', 'Narrator']

/**
 * A staff member: an {@link IdentityUser} carrying their per-troupe title.
 *
 * `role` is smuggled into the JSON the server builds, never `.set()` onto the
 * object. A `.set()` would make the object dirty, and the encoder ships a dirty
 * object as a bare attribute-less Pointer -- the browser would render blanks
 * with no error anywhere. That is also why the old `user.set("role", title)` in
 * `models/Troupe.js#get_staff` could not simply be lifted to the server.
 *
 * Spelled out rather than intersected with IdentityAttributes so it keeps the
 * implicit index signature the SDK's `Attributes` constraint wants.
 */
export type TroupeStaffAttributes = {
  username?: string
  realname?: string
  massmailauthorization?: boolean
  acceptedtos?: boolean
  role: TroupeStaffTitle
}

export type TroupeStaffMember = Parse.User<TroupeStaffAttributes>

/**
 * `get_troupe_staff` -- a troupe's roster, each name with its title.
 *
 * Replaces `models/Troupe.js#get_staff`, whose relation query carried NO
 * options at all. That is an ordinary ACL-filtered client read, so a private
 * staffer was simply ABSENT: the roster rendered one fewer name with no marker
 * anywhere, re-creating exactly the "this troupe has no staff" confusion
 * `views/TroupeView.js` documents fighting.
 *
 * Any logged-in caller may ask about any troupe. That is today's behaviour and
 * the one place where universal visibility reads as intent: `#troupe/:id` is
 * gated only by "are you logged in", the roster renders for every viewer
 * regardless of write access, troupe rows are public by construction, and the
 * troupe already publishes a `staffemail` to everyone. The roster answers the
 * question the page exists to answer.
 *
 * Unwrapped from the server's `{staff: [...]}` envelope, as
 * `models/Troupe.js#get_staff` did -- the envelope carries nothing else.
 *
 * Refuses: an anonymous caller ("Unauthorized: Must be logged in.") and a
 * missing id ("No troupe was named."). A troupe missing one of its three role
 * objects yields a short list rather than an error, on purpose.
 */
export async function getTroupeStaff(troupeId: string): Promise<TroupeStaffMember[]> {
  const payload = await run<{ staff: TroupeStaffMember[] }>(CLOUD_FUNCTIONS.getTroupeStaff, {
    troupe_id: troupeId,
  })
  return payload.staff
}

export interface ChangeTroupeStaffParams {
  troupe_id: string
  user_to_change_id: string
  /** Titles to grant. `views/TroupeEditStaffView.js` sends at most one. */
  roles_to_add: readonly TroupeStaffTitle[]
  /** Titles to revoke -- everything the form did not select. */
  roles_to_remove: readonly TroupeStaffTitle[]
}

/**
 * `change_troupe_staff` -- promote or demote somebody in a troupe.
 *
 * The parameter names are snake_case and are load-bearing. `tests/troupe-test.js`
 * records two specs that sent `{troupeId, userId, role}` instead: `troupe_id`
 * arrived `undefined`, the call died fetching a troupe with no id long before
 * it reached the authorisation check, and the specs' `expect(error).toBeDefined()`
 * passed anyway. They would have stayed green if a regular member COULD promote
 * themselves. Keep the names exactly as the server reads them, and keep this
 * interface as the only place they are written.
 *
 * Authorisation is the interesting part: the caller must be reachable from the
 * troupe's `LST_<troupe_id>` role, following the role graph two levels deep --
 * which is how an Administrator passes, since Administrator is a member role of
 * every troupe role. It is checked against `request.user.id` on the server, so
 * nothing the browser sends can influence it.
 *
 * The write touches BOTH role sets: the prefixed per-troupe roles
 * (`LST_<id>` …) and the generic org-wide ones (`LST`, `AST`, `Narrator`). That
 * is why the directory's staff test matches only the PREFIXED names -- every
 * current and former storyteller org-wide holds the bare ones.
 *
 * Two known server-side behaviours, recorded rather than worked around here:
 * a failed role save is caught and logged server-side, so a partial write still
 * resolves successfully; and a troupe missing one of the three role objects
 * makes the server throw while building the change rather than refusing
 * cleanly. Neither is this file's to fix.
 *
 * Resolves with nothing (`response.success()` with no argument).
 * Refuses: an anonymous caller ("Cannot change staff without logging in") and a
 * caller not in the troupe's LST graph ("Couldn't find user in appropriate
 * roles").
 */
export function changeTroupeStaff(params: ChangeTroupeStaffParams): Promise<void> {
  return run<void>(CLOUD_FUNCTIONS.changeTroupeStaff, {
    troupe_id: params.troupe_id,
    user_to_change_id: params.user_to_change_id,
    roles_to_add: [...params.roles_to_add],
    roles_to_remove: [...params.roles_to_remove],
  })
}

// ---------------------------------------------------------------------------
// Character permissions.
// ---------------------------------------------------------------------------

/**
 * `update_vampire_change_permissions_for` -- re-stamp the ACL on every
 * `VampireChange` row belonging to a character.
 *
 * The change log is the one child collection the browser cannot re-ACL itself.
 * `get_vampire_change_acl` (cloud/main.js:207-238) grants the owner READ and
 * explicitly NOT write on every `VampireChange` row -- the audit trail is
 * written by an afterSave trigger under the master key and is not the player's
 * to edit -- so a character that joins or leaves a troupe would otherwise carry
 * a change log still readable by the wrong people. `models/Character.js` walks
 * the traits, experience notations and long texts itself and then calls this
 * for the rows it cannot touch: `update_permissions` (:997) ends on it, and
 * `update_troupe_acls` (:1048) runs it midway, before the long texts.
 *
 * @param characterId the character's objectId -- sent as `character`, not
 *   `character_id`. The server fetches it with the master key, so this works
 *   for a character the caller cannot read; the entitlement question is not
 *   asked at all here, which is worth knowing before calling it from anywhere
 *   other than the owner's own save path.
 *
 * Resolves with "Successfully updated permissions."
 * On a batch failure it reports the FIRST failing child row only -- the server
 * loops `response.error(...)` over an aggregate error and only the first call
 * settles the response.
 */
export function updateVampireChangePermissionsFor(characterId: string): Promise<string> {
  return run<string>(CLOUD_FUNCTIONS.updateVampireChangePermissionsFor, {
    character: characterId,
  })
}

/**
 * The three child collections keyed by `owner`, as the server sees them.
 *
 * Ids only, in whatever order Mongo paged them. The client's own
 * `Character#get_owned_ids` builds the same shape from what IT can read; the
 * point of the pair is that a difference means the client is missing rows it
 * ought to own, i.e. an ACL repair is due.
 */
export interface ExpectedVampireIds {
  SimpleTrait: string[]
  ExperienceNotation: string[]
  VampireChange: string[]
}

/**
 * `get_expected_vampire_ids` -- what the SERVER thinks a character owns.
 *
 * Read under the master key, so it is the unfiltered truth; the client-side
 * twin is ACL-filtered. `models/Character.js:1109` runs both and compares them
 * to set `is_mismatched`, which drives the "repair permissions" affordance.
 *
 * Two things a caller must handle that the Backbone version did not:
 *
 * 1. Neither side is sorted. Comparing them requires sorting each array first
 *    (or comparing as sets); `each` pages by objectId in practice but nothing
 *    promises it, and an order-sensitive comparison would report a mismatch on
 *    a healthy character.
 * 2. The old comparison is `_.eq(client, server)`, and it WORKS. The vendored
 *    lodash 3.10.0 aliases `eq` to `isEqual` (`lodash.js:12065`), so this is a
 *    deep compare and `is_mismatched` has always been set. Verified against the
 *    vendored copy: `_.eq === _.isEqual` is `true`, and `_.eq([1,2],[2,1])` is
 *    `false`.
 *
 *    That last part matters for point 1: because the comparison is deep and
 *    order-sensitive, "sort both sides first" would be a BEHAVIOUR CHANGE, not
 *    a repair. `Character.ts` ports it as-is with lodash 4's `isEqual`. Do not
 *    "fix" it without deciding, deliberately, that the repair affordance should
 *    fire less often than it does today.
 *
 *    (An earlier draft of this comment claimed `_.eq` did not exist and that the
 *    check had never reported anything. That was false, and it is called out
 *    here because acting on it would have quietly changed the behaviour of a
 *    permissions-repair tool.)
 *
 * The server reports failures with `response.error(error)` on a raw error
 * object rather than a string, so the rejection's `message` is whatever
 * parse-server made of it.
 */
export function getExpectedVampireIds(characterId: string): Promise<ExpectedVampireIds> {
  return run<ExpectedVampireIds>(CLOUD_FUNCTIONS.getExpectedVampireIds, {
    character: characterId,
  })
}

// ---------------------------------------------------------------------------
// Patronage and referendums.
// ---------------------------------------------------------------------------

/**
 * `get_my_patronage_status` -- is the CALLER a current patron?
 *
 * `true` only when the caller's newest `Patronage` row has not expired.
 * `false` both for "no patronage row at all" and for "the latest one lapsed" --
 * the caller cannot tell those apart from here, and no screen needs to.
 *
 * About the caller only. There is no parameter and there is deliberately no way
 * to ask about somebody else: the server reads `request.user`, under the master
 * key, because `Patronage` rows are not publicly readable.
 *
 * Refuses: an anonymous caller, with "Cannot request patronage status unless
 * loggen in" -- the typo is the server's and is reproduced here so the string
 * can be searched for.
 */
export function getMyPatronageStatus(): Promise<boolean> {
  // No params, exactly as routers/mobileRouter.js:2305 and :2353 called it.
  return run<boolean>(CLOUD_FUNCTIONS.getMyPatronageStatus)
}

/**
 * `vote_for_referendum` -- cast one ballot.
 *
 * This function is the ONLY writer of `ReferendumBallot`. The class refuses
 * `create` to everyone at the class level, on purpose: while it granted create
 * to '*', a client could skip the patronage requirement and the
 * one-ballot-per-caster check and POST a ballot directly -- any choice, any
 * caster, any ACL, as many times as it liked. Casting a ballot any other way is
 * not a shortcut, it is the hole.
 *
 * The refusals are real refusals now. The shipped version was a run of
 * `.then().fail()` pairs where a refusal did `response.error(msg); return;`,
 * which ends only its own callback: the next `.then()` still ran, read
 * `undefined` as "no existing ballot", and saved one with
 * `casterpatronagestatus` hardcoded `true`. A non-patron was told their vote was
 * refused and had it recorded anyway, as though they were a patron. Every arm
 * rejects now, and `casterpatronagestatus` records the check that actually
 * passed rather than asserting it.
 *
 * @param referendumId the `Referendum` objectId
 * @param ballotOption the chosen option, taken from the clicked control's
 *   `name` attribute in `views/ReferendumView.js`. Not validated against the
 *   referendum's option list on either side.
 *
 * Resolves with "Ballot has been cast".
 * Refuses, all as plain strings: "Cannot vote for a referendum unless logged
 * in", "Couldn't find referendum <id> because of …", "No patronage found",
 * "Latest patronage is expired", and "Existing ballot found.…" -- so a
 * double-vote reads as an error, and the caller should show it as "you have
 * already voted" rather than as a failure.
 *
 * The caller cannot read back what it just wrote from the result: the old view
 * re-queried `ReferendumBallot` for `{owner: referendum, caster: current}`
 * afterwards, and still must.
 */
export function voteForReferendum(referendumId: string, ballotOption: string): Promise<string> {
  return run<string>(CLOUD_FUNCTIONS.voteForReferendum, {
    referendum_id: referendumId,
    ballot_option: ballotOption,
  })
}

// ---------------------------------------------------------------------------
// Administration.
// ---------------------------------------------------------------------------

/**
 * `request_password_reset_for` -- send a reset mail to an account you cannot see.
 *
 * `views/AdministrationUserView.js` used to read `model.get("email")` and hand
 * it to `Parse.User.requestPasswordReset`. Parse never returns another user's
 * email to a client -- it is private to that user -- so the address was always
 * empty and the call failed with "you must provide an email", even once a mail
 * adapter was configured. An administrator does not need to SEE the address to
 * reset it: the lookup happens server-side under the master key and the address
 * is never sent to the browser. Do not add one to the payload; there is nothing
 * for the client to pass.
 *
 * Administrators only -- `Administrator` or `SiteAdministrator`, checked
 * against the role graph server-side.
 *
 * Resolves with `true`.
 * Refuses: "Unauthorized: Must be logged in.", "Unauthorized: Administrator
 * access is required.", "No user was named.", "That user has no email address
 * on file.", and a 101 "Object not found." for an id that does not exist.
 */
export function requestPasswordResetFor(userId: string): Promise<true> {
  return run<true>(CLOUD_FUNCTIONS.requestPasswordResetFor, { user_id: userId })
}

// ---------------------------------------------------------------------------
// Test-only surface.
//
// The three below are called from `public/scripts/app/tests/` and from nowhere
// in the application. They are typed here because they ARE part of the Cloud
// contract and a test that hand-rolls `Parse.Cloud.run` with the wrong argument
// names is exactly the failure `tests/troupe-test.js` records at :85 -- a
// security spec that passed because the call died before reaching the check it
// was testing. No application code should import these.
// ---------------------------------------------------------------------------

/**
 * `make_me_admin` -- add the CALLER to the Administrator role. Test-only.
 *
 * Gated on `ADMIN_SECRET_KEY` from the server's environment. If that variable
 * is unset the function refuses everyone who is not calling with the master key,
 * which is the safe default; there is no configuration in which an ordinary
 * logged-in user can escalate. `tests/admin-test.js:89` and `:100` assert both
 * halves -- an anonymous caller and an authenticated non-admin both refused.
 *
 * @param secretKey sent as `secret_key`. `tests/admin-test.js` passes `{}` and
 *   expects the refusal; omitting it here sends `{}` likewise.
 *
 * Resolves with the Administrator role's objectId.
 * Refuses: "Unauthorized: Invalid or missing administrator secret key.",
 * "Unauthorized: User not authenticated.", "Administrator role not found."
 */
export function makeMeAdmin(secretKey?: string): Promise<string> {
  // `{}` when no key, matching tests/admin-test.js exactly. `secret_key:
  // undefined` would be dropped by JSON encoding anyway, but sending the key
  // only when there is one keeps the request bodies identical to the old ones.
  return run<string>(
    CLOUD_FUNCTIONS.makeMeAdmin,
    secretKey === undefined ? {} : { secret_key: secretKey },
  )
}

/**
 * `check_user_password` -- verify the CALLER's own password. Test-only.
 *
 * Only `password` is read. `tests/admin-test.js:113` also passes a `username`;
 * the server ignores it and uses `request.user.getUsername()`, so this can only
 * ever check the logged-in caller's own password and cannot be used to probe
 * anyone else's. The parameter is dropped here rather than accepted and
 * discarded, so nobody reads the call site and believes otherwise.
 *
 * A WRONG password resolves with `false`. It does not reject -- deliberate, and
 * asserted by the test. Only an infrastructure failure rejects.
 *
 * Warning, recorded at cloud/main.js:823-834: under parse@8 a stale
 * `{success, error}` callback bag in the server body would make this HANG
 * rather than fail, since neither callback fires and the response is never
 * settled. That was fixed; if this call ever appears to hang rather than
 * reject, that is where to look. Callers should carry their own timeout.
 *
 * Beware the side effect: the server verifies by calling `Parse.User.logIn`, so
 * every successful check mints a brand new `_Session` row that nobody ever logs
 * out of. It is a test affordance, not a re-authentication primitive to put
 * behind a "confirm your password" dialog.
 */
export function checkUserPassword(password: string): Promise<boolean> {
  return run<boolean>(CLOUD_FUNCTIONS.checkUserPassword, { password })
}

/** One message the in-memory mail adapter captured instead of sending. */
export interface CapturedEmail {
  to: string
  subject: string
  text: string
  /** Encoded as a Parse date on the wire and decoded back to a `Date`. */
  sentAt: Date
}

/**
 * `get_captured_emails` -- read the mail the test server did not send. Test-only.
 *
 * `cloud/MemoryEmailAdapter.js` retains password-reset messages in memory so
 * `request_password_reset_for` can be asserted end to end without any real mail
 * leaving the process. Newest last, bounded to the adapter's buffer (100).
 *
 * Two conditions, both of which a caller must expect to fail on:
 *
 * - The function only EXISTS while that adapter is in use. Point
 *   `MAIL_ADAPTER_MODULE` at a real provider and the definition never runs, so
 *   this rejects with 141 "Invalid function: get_captured_emails". That is the
 *   correct outcome, not a bug to route around.
 * - Administrators only, even then, because the captured bodies carry LIVE
 *   password-reset links.
 *
 * Refuses: "Unauthorized: Must be logged in.", "Unauthorized: Administrator
 * access is required."
 */
export function getCapturedEmails(): Promise<CapturedEmail[]> {
  return run<CapturedEmail[]>(CLOUD_FUNCTIONS.getCapturedEmails)
}
