/**
 * Troupes -- the game groups a character can belong to.
 *
 * Ported from `public/scripts/app/models/Troupe.js` and
 * `public/scripts/app/collections/Troupes.js`.
 *
 * ## What changed in the port
 *
 * **No `Parse.Object.extend`.** `@/parse/classes` registers `TroupeObject` for
 * the "Troupe" className once, for the whole app. Everything the Backbone model
 * carried as a prototype method is a free function here, taking the troupe as
 * its first argument. That keeps the class registration in one file (which is
 * the rule this migration exists to enforce -- see the note at the top of
 * `@/parse/classes`) and leaves these functions unit-testable against a plain
 * object with a `get`.
 *
 * **No `Parse.Collection`.** `collections/Troupes.js` was a comparator and
 * nothing else -- no custom `fetch`, no query. It becomes `compareTroupes`
 * plus `sortTroupes` below; whoever holds the list (the troupes store) owns the
 * array.
 *
 * **`initialize` is now `applyTroupeAcl`.** See the note on that function: it
 * is a deliberate deviation and the only one in this file.
 */
import Parse from '@/parse'
import { TroupeObject } from '@/parse/classes'

/** A troupe record. The registered class for className "Troupe". */
export type Troupe = TroupeObject

/**
 * The staff titles a troupe has, in the order they are displayed.
 *
 * The source kept this on each instance (`self.title_options`), with the
 * commented-out two-entry variant left in place above it. The order is
 * load-bearing: `get_troupe_staff` returns staff in exactly LST, AST, Narrator
 * order server-side, and the old client-side version iterated an object whose
 * key order came from promise resolution instead.
 */
export const TROUPE_TITLE_OPTIONS = ['LST', 'AST', 'Narrator'] as const

export type TroupeTitle = (typeof TROUPE_TITLE_OPTIONS)[number]

/** What `get_thumbnail`/`get_thumbnail_sync` fall back to. */
const THUMBNAIL_FALLBACK = 'head_skull.png'

/**
 * Stamp the troupe ACL: world-readable, nobody writes but Administrators.
 *
 * ### Why this is a function and not the constructor
 *
 * The source did this in `initialize`, which Parse 1.5 ran from the
 * constructor -- including the constructor `Parse.Object.fromJSON` uses to
 * decode a query result. So every troupe the client ever saw arrived carrying a
 * pending `setACL` operation, and any later `save()` re-wrote the same ACL back.
 *
 * The registered `TroupeObject` in `@/parse/classes` has no `initialize` hook to
 * hang that on, and reproducing it would mean marking every fetched troupe dirty
 * before anyone touched it -- which is the exact trap `helpers/UserWreqr.js`
 * documents at length for `_User` rows (a dirty child gets deep-saved by its
 * parent and takes a 403). So the stamp moved to the one moment it is actually
 * needed: creating a troupe.
 *
 * Call it before the first save of a new troupe. The values are unchanged.
 */
export function applyTroupeAcl(troupe: Parse.Object): void {
  const acl = new Parse.ACL()
  acl.setPublicReadAccess(true)
  acl.setPublicWriteAccess(false)
  acl.setRoleReadAccess('Administrator', true)
  acl.setRoleWriteAccess('Administrator', true)
  troupe.setACL(acl)
}

/** A new, unsaved troupe with the ACL already stamped on. */
export function createTroupe(attributes?: Record<string, unknown>): Troupe {
  const troupe = new TroupeObject(attributes)
  applyTroupeAcl(troupe)
  return troupe
}

/**
 * The columns the directory listing reads, and no more.
 *
 * This query runs for every user who opens the directory, so selecting more
 * would hand every player the full contents of every troupe record.
 */
const LIST_FIELDS = ['id', 'name', 'portrait', 'shortdescription', 'location', 'staffemail']

/**
 * Every troupe the caller can see, optionally narrowed.
 *
 * `narrow` is `TroupesListView.register`'s second argument: the three
 * pick-a-troupe screens passed a function that constrained `objectId` to (or
 * away from) the character's own membership.
 *
 * This lives here rather than in the list component because the component
 * renders inside a page whose `ready` gate is what decides when the page goes
 * live -- so a component that fetched on mount could never report the result
 * that ungates it. See the note on `ready` in `JqmPage.vue`.
 */
export async function fetchTroupeList(
  narrow?: (query: Parse.Query) => void,
): Promise<Troupe[]> {
  const query = new Parse.Query('Troupe')
  query.select(...LIST_FIELDS)
  query.include('portrait')
  narrow?.(query)
  const found: Troupe[] = []
  // `each` rather than `find`: it pages the whole class with no limit, which is
  // what the original relied on to list every troupe.
  await query.each((t) => {
    found.push(t as Troupe)
  })
  return found
}

/** One staff member as `get_troupe_staff` returns them. */
export interface TroupeStaffMember extends Parse.User {
  /** The title the Cloud function attached; not a stored column. */
  get(attribute: string): unknown
}

/**
 * The troupe's staff, from the server.
 *
 * This used to walk each role's users relation with an ordinary client query
 * carrying no options at all. That is an ACL-filtered read, so a private
 * staffer was simply ABSENT -- the roster rendered one fewer name with no
 * marker anywhere, re-creating exactly the "this troupe has no staff" confusion
 * the troupe view documents fighting.
 *
 * It also did `user.set("role", title)`, dirtying a `_User` row the caller
 * cannot write. The Cloud function attaches the title without dirtying
 * anything.
 *
 * Role order is fixed LST, AST, Narrator server-side; the old version iterated
 * an object whose key order came from promise resolution.
 */
export async function getTroupeStaff(troupe: Troupe): Promise<TroupeStaffMember[]> {
  const payload = (await Parse.Cloud.run('get_troupe_staff', { troupe_id: troupe.id })) as {
    staff: TroupeStaffMember[]
  }
  return payload.staff
}

/**
 * Create a troupe's three staff roles and give the troupe over to its LST.
 *
 * `TroupeNewView.js` did this inline in a submit handler, in four chained saves.
 * The order and the ACLs are exactly the source's, because they are the whole
 * permission model for a troupe and nothing else writes them:
 *
 *  1. `LST_<id>`, `AST_<id>` and `Narrator_<id>` are minted. Each is
 *     world-readable, writable by nobody, and additionally read/write by
 *     Administrator -- and each contains the Administrator role, so an
 *     administrator IS a member of every troupe role.
 *  2. The nesting widens as it goes down: AST's ACL also grants LST, and
 *     Narrator's grants both LST and AST. So an LST can edit the AST roster and
 *     the narrator roster; an AST can edit only the narrator roster.
 *  3. The three are saved BEFORE they are nested inside each other, because a
 *     `Parse.Role` cannot contain an unsaved role -- which is why there are two
 *     `saveAll` calls over the same three objects rather than one.
 *  4. Finally the troupe's own ACL gains LST read AND write. Until that last
 *     save the troupe is writable only by Administrators; this is what hands it
 *     to its head storyteller.
 *
 * A role is a `_Role` row, and `_Role` is not client-writable in a locked-down
 * Parse Server -- so this whole cascade only succeeds for an administrator. The
 * source's failure branch (log it and go to `#administration`) is preserved at
 * the call site.
 */
export async function provisionTroupeRoles(troupe: Troupe): Promise<Troupe> {
  const adminQuery = new Parse.Query(Parse.Role)
  adminQuery.equalTo('name', 'Administrator')
  const adminRole = await adminQuery.first()

  const base = () => {
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(true)
    acl.setPublicWriteAccess(false)
    acl.setRoleReadAccess('Administrator', true)
    acl.setRoleWriteAccess('Administrator', true)
    return acl
  }

  const lstAcl = base()
  const lstRole = new Parse.Role('LST_' + troupe.id, lstAcl)

  const astAcl = base()
  astAcl.setRoleReadAccess(lstRole, true)
  astAcl.setRoleWriteAccess(lstRole, true)
  const astRole = new Parse.Role('AST_' + troupe.id, astAcl)

  const narratorAcl = base()
  narratorAcl.setRoleReadAccess(lstRole, true)
  narratorAcl.setRoleWriteAccess(lstRole, true)
  narratorAcl.setRoleReadAccess(astRole, true)
  narratorAcl.setRoleWriteAccess(astRole, true)
  const narratorRole = new Parse.Role('Narrator_' + troupe.id, narratorAcl)

  /*
   * `adminRole` can be undefined -- the query is a `first()`. Parse 1.5's
   * `relation.add(undefined)` was a silent no-op; the modern SDK throws. The
   * guard keeps a database with no Administrator role from turning troupe
   * creation into a TypeError, which is what the source did.
   */
  if (adminRole) {
    for (const role of [lstRole, astRole, narratorRole]) role.getRoles().add(adminRole)
  }

  await Parse.Object.saveAll([lstRole, astRole, narratorRole])

  astRole.getRoles().add(lstRole)
  narratorRole.getRoles().add([lstRole, astRole])
  await Parse.Object.saveAll([lstRole, astRole, narratorRole])

  const acl = troupe.getACL()
  if (acl) {
    acl.setRoleReadAccess(lstRole, true)
    acl.setRoleWriteAccess(lstRole, true)
  }
  return (await troupe.save()) as Troupe
}

/** The three role lookups, keyed by title. A title with no role maps to `undefined`. */
export type TroupeRoles = Partial<Record<TroupeTitle, Parse.Role | undefined>>

/**
 * Wait for every promise to settle, the way `Parse.Promise.when` did.
 *
 * `Promise.all` is NOT a translation of `Parse.Promise.when`: it rejects the
 * moment the first input rejects, abandoning the rest, and it rejects with a
 * single error. `Parse.Promise.when` waited for every input to settle and then
 * rejected with an ARRAY of errors indexed to the inputs. Both role lookups
 * below fill in a shared object as a side effect and depend on all three
 * queries having finished, so the difference is real, not academic.
 *
 * The array-shaped rejection is preserved: a caller inspecting `error[1]` to
 * find out which title failed still can.
 */
async function whenAllSettled<T>(promises: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises)
  if (settled.some((outcome) => outcome.status === 'rejected')) {
    throw settled.map((outcome) => (outcome.status === 'rejected' ? outcome.reason : undefined))
  }
  return settled.map((outcome) => (outcome as PromiseFulfilledResult<T>).value)
}

/**
 * The troupe-specific roles: `LST_<troupeId>`, `AST_<troupeId>`, `Narrator_<troupeId>`.
 *
 * A title with no matching role is present in the result with an `undefined`
 * value, exactly as the source left it -- the object was seeded by assignment
 * inside each `then`, so a missing role wrote `undefined` rather than skipping
 * the key.
 */
export async function getTroupeRoles(troupe: Troupe): Promise<TroupeRoles> {
  const roles: TroupeRoles = {}
  await whenAllSettled(
    TROUPE_TITLE_OPTIONS.map(async (title) => {
      const query = new Parse.Query(Parse.Role)
      query.equalTo('name', title + '_' + troupe.id)
      roles[title] = await query.first()
    }),
  )
  return roles
}

/**
 * The generic roles: `LST`, `AST`, `Narrator`, with no troupe suffix.
 *
 * Same shape as `getTroupeRoles`; these are the app-wide roles rather than the
 * per-troupe ones.
 */
export async function getGenericTroupeRoles(troupe: Troupe): Promise<TroupeRoles> {
  // `troupe` is unused, as it was in the source -- the query has no suffix. It
  // stays in the signature so the two functions remain interchangeable at a
  // call site that picks between them.
  void troupe
  const roles: TroupeRoles = {}
  await whenAllSettled(
    TROUPE_TITLE_OPTIONS.map(async (title) => {
      const query = new Parse.Query(Parse.Role)
      query.equalTo('name', title)
      roles[title] = await query.first()
    }),
  )
  return roles
}

/**
 * The troupe's portrait thumbnail at `size`, fetching the portrait first.
 *
 * Yes, troupes have portraits -- and so do referendums. The identical pair of
 * methods lives on `Referendum` and on `Character`; the source duplicated them
 * verbatim in all three models and the duplication is kept rather than hoisted,
 * because these are three unrelated classes that happen to agree today.
 *
 * The source logged `get_thumbnail_sync(size)` to the console on every call.
 * That was a debug leftover with no reader and it is not reproduced.
 *
 * Note that this fetches the portrait record every time it is called, which is
 * how the source behaved; nothing caches it.
 */
export async function getTroupeThumbnail(
  troupe: Troupe,
  size: number | string,
): Promise<string | undefined> {
  const portrait = troupe.get('portrait') as Parse.Object | undefined
  if (!portrait) {
    return THUMBNAIL_FALLBACK
  }
  const fetched = await portrait.fetch()
  // `.url()` on a missing thumb throws, as it did before. A portrait row that
  // never generated its thumbnails is a broken record, not a blank avatar.
  return (fetched.get('thumb_' + size) as Parse.File).url()
}

/**
 * The thumbnail URL from what is already in memory, or `head_skull.png`.
 *
 * The source was
 * `_.result(self, "attributes.portrait.attributes.thumb_" + size + ".url", "head_skull.png")`.
 * Three things about that expression have to survive the translation:
 *
 *   - lodash 3's `_.result` INVOKES the resolved value when it is a function,
 *     bound to its parent. `url` is a `Parse.File` method, so the result is the
 *     URL string, not the function.
 *   - the default is returned only when the path resolves to `undefined` --
 *     which is the case that matters here: an unfetched portrait pointer has an
 *     empty attribute bag.
 *   - `attributes` is SDK-private in parse@8. `get()` reads the same estimated
 *     data, so the walk is done with `get()` instead.
 *
 * `_.result` in lodash 4 no longer supports this shape at all, which is why
 * this is spelled out rather than translated call-for-call.
 *
 * The return is `string | undefined`, not `string`, and that is not a widening
 * for convenience: `Parse.File#url()` is declared to return `string |
 * undefined`, and the default in `_.result` was substituted BEFORE the function
 * was invoked, so a file whose `url()` answered `undefined` returned
 * `undefined` from the whole expression -- not `head_skull.png`. Coercing that
 * to the fallback here would be inventing a behaviour the source did not have.
 */
export function getTroupeThumbnailSync(
  troupe: Troupe,
  size: number | string,
): string | undefined {
  const portrait = troupe.get('portrait') as Parse.Object | undefined
  const thumb = portrait?.get('thumb_' + size) as Parse.File | undefined
  if (!thumb || typeof thumb.url !== 'function') {
    return THUMBNAIL_FALLBACK
  }
  return thumb.url()
}

/**
 * `collections/Troupes.js`'s comparator: by `name`, ascending.
 *
 * The source used lodash 3's `_.gt`/`_.lt`, which are plain `>` and `<`. Two
 * troupes with no name -- or any pair where the comparison is neither greater
 * nor less, including anything involving `undefined` -- compare equal, so they
 * keep their incoming order.
 */
export function compareTroupes(left: Troupe, right: Troupe): number {
  const l = left.get('name')
  const r = right.get('name')
  if (l > r) {
    return 1
  } else if (l < r) {
    return -1
  }
  return 0
}

/** A new array in comparator order. Backbone sorted in place; nothing here does. */
export function sortTroupes(troupes: readonly Troupe[]): Troupe[] {
  return [...troupes].sort(compareTroupes)
}

/**
 * A query for every troupe.
 *
 * `Parse.Collection.fetch` with no `query` set built exactly this and called
 * `find()` on it -- so the SDK's default 100-row limit applied. Callers that
 * need the whole class page through it with `each()`, which is what the troupes
 * store does; this returns the query rather than the rows so the caller keeps
 * that choice.
 */
export function troupeQuery(): Parse.Query<Troupe> {
  return new Parse.Query(TroupeObject)
}
