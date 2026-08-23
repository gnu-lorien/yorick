import { Parse } from './init';

/**
 * Filling in the user pointers a query deliberately did not expand.
 *
 * Ports `UserWreqr.hydrate` and `UserWreqr.prime`.
 *
 * Every listing that shows an owner's name faces the same problem: it must NOT
 * `include("owner")` on the query. parse-server deletes an unreadable pointer
 * only when it was asked to *expand* it, so including it made a private owner's
 * character arrive with the key missing outright -- and the troupe roster's
 * `has("owner")` test reads a missing owner as archived, so those characters
 * silently vanished from it. Without the include the bare pointer survives.
 *
 * The names then have to come from somewhere, and that is here: one Cloud call
 * for the ids, and the results written into the pointers in place.
 */

/**
 * A pointer nothing could resolve.
 *
 * A VALUE and not a blank, because the three CSV templates emit their identity
 * columns only *inside* `if (e.get("owner").get("username"))` -- so a falsy
 * username makes them emit no columns at all, shifting every later column in
 * the row. A missed hydrate has to be visible rather than silently corrupting a
 * spreadsheet.
 */
export const UNRESOLVED_USER = {
  username: '(unknown)',
  realname: '',
  email: '',
} as const;

/** Ids already asked about, whether or not the server answered. */
const asked = new Set<string>();
/** Users the server has returned, by id. */
const known = new Map<string, Parse.User>();

/**
 * Fetch the users behind these ids, once each.
 *
 * Caching the MISSES as well as the hits is what stops a roster full of
 * unreadable owners re-asking on every render. The current user is never
 * fetched: parse-server writes `ACL[objectId] = {read, write}` on every _User
 * row, so the caller's own record is already in hand.
 *
 * Batched at 200, as the original chunks them -- the Cloud function takes a
 * list and a roster can be long.
 */
export async function primeUsers(ids: (string | undefined)[]): Promise<void> {
  const current = Parse.User.current();
  const need = [...new Set(ids.filter((id): id is string => !!id))].filter(
    (id) => !asked.has(id) && id !== current?.id,
  );
  if (!need.length) return;

  for (let i = 0; i < need.length; i += 200) {
    const batch = need.slice(i, i + 200);
    const payload = (await Parse.Cloud.run('get_users_by_id', { ids: batch })) as {
      users: Parse.User[];
    };
    for (const user of payload.users) {
      if (user.id) known.set(user.id, user);
    }
    for (const id of batch) asked.add(id);
  }
}

/**
 * Fill in the `key` pointers on these objects, in place.
 *
 * In place, and before anything renders, because the legacy note explains what
 * happens otherwise: `_finishFetch` fires no Backbone change event, so names
 * filled in after the collection reset would never appear. React re-renders
 * from state rather than from events, but mutating the pointers a caller
 * already holds is still the shape the rest of the port expects -- the list
 * item components read `character.owner.get("username")` directly.
 *
 * A pointer that already carries a username is left alone.
 */
export async function hydratePointers(
  objects: Parse.Object[],
  key: string,
  missing: Record<string, unknown> = UNRESOLVED_USER,
): Promise<void> {
  const pointers = objects
    .map((object) => object.get(key) as Parse.User | undefined)
    .filter((pointer): pointer is Parse.User => !!pointer);
  if (!pointers.length) return;

  await primeUsers(pointers.map((pointer) => pointer.id));

  const current = Parse.User.current();
  for (const pointer of pointers) {
    if (pointer.get('username')) continue;
    const source = pointer.id === current?.id ? current : known.get(pointer.id ?? '');
    const data = source
      ? // `sessionToken` is omitted deliberately: `Parse.User.current().toJSON()`
        // carries it, and the self-answer above can hand back exactly that
        // object. ACL is dropped for the same reason -- neither belongs on a
        // display-only pointer.
        omit(source.toJSON() as Record<string, unknown>, ['ACL', 'sessionToken'])
      : missing;
    // `_finishFetch` marks the pointer as fetched and installs the attributes
    // without a save. It is internal to the SDK and there is no public
    // equivalent; the legacy code uses it for the same reason.
    (pointer as unknown as { _finishFetch(data: unknown): void })._finishFetch(data);
  }
}

function omit(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) out[key] = value;
  }
  return out;
}
