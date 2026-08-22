import { Parse } from '../init';

/**
 * A paid patronage: one owner, a paid-on date and an expires-on date.
 *
 * Ports public/scripts/app/models/Patronage.js, which is nothing but
 * `Parse.Object.extend("Patronage", ExpirationMixin)` -- so the whole of the
 * model is the expiration helpers, the same three that are already on
 * Character.
 *
 * Keep the asymmetry helpers/ExpirationMixin.js defines. A record with no
 * `expiresOn` is neither active nor expired -- both `isActive` and `isExpired`
 * answer false -- but `status()` still reports "Expired", because it asks only
 * `isActive`. Every listing therefore labels a dateless record "Expired", and
 * the same row would answer `isExpired() === false` if anything asked. Nothing
 * in the app does, which is why this has never surfaced.
 */
export class Patronage extends Parse.Object {
  constructor() {
    super('Patronage');
  }

  /**
   * The owning account, as a bare pointer.
   *
   * The collection's query does not `include("owner")`, so this carries an id
   * and nothing else; the display fields come from the account directory. See
   * `listUsers` below.
   */
  get owner(): Parse.User | undefined {
    return this.get('owner') as Parse.User | undefined;
  }

  get ownerId(): string | undefined {
    return this.owner?.id;
  }

  get paidOn(): Date | undefined {
    return this.get('paidOn') as Date | undefined;
  }

  get expiresOn(): Date | undefined {
    return this.get('expiresOn') as Date | undefined;
  }

  isActive(): boolean {
    const expiresOn = this.expiresOn;
    return expiresOn ? expiresOn.getTime() > Date.now() : false;
  }

  isExpired(): boolean {
    const expiresOn = this.expiresOn;
    return expiresOn ? expiresOn.getTime() < Date.now() : false;
  }

  status(): 'Active' | 'Expired' {
    return this.isActive() ? 'Active' : 'Expired';
  }

  /**
   * The access policy PatronageView.js stamps on every save.
   *
   * Public read, no public write, Administrator read and write. Written on
   * every save rather than only at creation, exactly as the original does --
   * so re-saving an old record that predates the policy brings it into line.
   */
  applyAdminACL(): void {
    const acl = new Parse.ACL();
    acl.setPublicReadAccess(true);
    acl.setPublicWriteAccess(false);
    acl.setRoleReadAccess('Administrator', true);
    acl.setRoleWriteAccess('Administrator', true);
    this.setACL(acl);
  }
}

Parse.Object.registerSubclass('Patronage', Patronage);

/**
 * Every patronage.
 *
 * collections/Patronages.js builds a bare `new Parse.Query(self.model)` -- no
 * `select`, no `include` -- and pages it with `each`. Both are kept: `find`
 * would cap at 100 rows, and an `include("owner")` is refused for accounts the
 * caller may not read, which is why identity is resolved through the directory
 * instead.
 */
export function patronagesQuery(): Parse.Query<Patronage> {
  return new Parse.Query(Patronage);
}

/**
 * Newest expiry first, as the collection's comparator orders them.
 *
 * The comparator in collections/Patronages.js reads
 *
 *     l = right.get("expiresOn"); r = left.get("expiresOn");
 *     if (_.gt(l, r)) return 1; else if (_.lt(l, r)) return -1; return 0;
 *
 * -- left and right swapped, so it is descending. `_.gt`/`_.lt` coerce a Date
 * through `valueOf`, so this is a timestamp comparison; a record with no
 * `expiresOn` coerces to NaN and compares equal to everything, which leaves it
 * wherever the sort happened to put it.
 *
 * The `sortbycreated` branch above it is dead. Five call sites in
 * mobileRouter.js set `sortbycreated` on a local *array* while the comparator
 * reads it off the *collection*, and `reset()` copies the array's elements and
 * not its properties -- so the flag never arrives and every patronage listing
 * has always sorted by expiry. See docs/react-migration/README.md, which
 * confirms it against the running app. Matching the behaviour means there is
 * no created-order branch here at all.
 */
export function sortPatronages(patronages: Patronage[]): Patronage[] {
  const key = (p: Patronage) => p.expiresOn?.getTime() ?? NaN;
  // Array#sort is stable, so equal keys -- which includes every pair of
  // dateless records -- keep the order `each` returned them in, objectId
  // ascending.
  return [...patronages].sort((left, right) => {
    const l = key(right);
    const r = key(left);
    if (l > r) return 1;
    if (l < r) return -1;
    return 0;
  });
}

/**
 * MM/DD/YYYY in local time, which is what `moment(...).format('MM/DD/YYYY')`
 * produces in every patronage template and what the form's datepicker reads
 * back.
 *
 * Local, not UTC, on purpose: the E2E suite builds its expected strings from
 * local `Date` accessors precisely because an ISO-string round trip shifts the
 * day for anyone west of Greenwich.
 */
export function formatPatronageDate(date: Date | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
}

/**
 * The inverse, for the form's two date fields.
 *
 * Returns an Invalid Date for anything that is not MM/DD/YYYY, which is what
 * `moment(text, 'MM/DD/YYYY').toDate()` does with an empty or malformed field.
 * PatronageView.js hands that straight to `model.set` and lets the save fail,
 * and so does this -- a silent fallback to "today" is how the suite's note at
 * `fillBackformInput` describes a date going missing.
 */
export function parsePatronageDate(text: string): Date {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text);
  if (!match) return new Date(NaN);
  const [, mm, dd, yyyy] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

/**
 * The account directory, from the `list_users` Cloud function.
 *
 * This is what `helpers/UserWreqr.js` + `collections/Users.js` load, and the
 * reason it is a Cloud call rather than a `_User` query is written up in
 * Users.js: under `enforcePrivateUsers` a client-side sweep silently returns
 * fewer people every week and nothing says so. `scope` records which tier the
 * server was willing to serve -- "all" for an admin or staffer, "self" for
 * everyone else -- so a caller can say *why* a list is short.
 *
 * It lives here rather than in web/src/data/queries.ts only because that file
 * is shared and this port may not edit it. It is a directory, not a patronage,
 * and belongs beside `useTroupes` when someone owns that file.
 */
export interface UserDirectory {
  scope: 'all' | 'self';
  users: Parse.User[];
}

export async function listUsers(): Promise<UserDirectory> {
  return (await Parse.Cloud.run('list_users')) as UserDirectory;
}

/**
 * One account by id, with UserWreqr.get_user's reject-on-missing shape.
 *
 * `get_users_by_id` deliberately conflates "withheld" with "no such row", so
 * there is one message for both and it is the one the original used.
 */
export async function getUserById(id: string): Promise<Parse.User> {
  const payload = (await Parse.Cloud.run('get_users_by_id', { ids: [id] })) as {
    users: Parse.User[];
  };
  const user = payload.users[0];
  if (!user) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'That account is not available to you.');
  }
  return user;
}

/**
 * How a user reads in the owner select and in a list row's heading.
 *
 * `"" + username + " " + realname + " " + email`, from PatronageView.js and
 * templates/patronage-list-item.html. String concatenation, so an account with
 * no realname and no email labels as `devuser undefined undefined` in the
 * select -- confirmed live against the legacy app. The list row uses `<%= %>`,
 * which prints an empty string for the same missing fields, so the two differ.
 * Both are reproduced; `joinWith` is which of the two rules applies.
 */
export function userLabel(user: Parse.User, joinWith: 'concat' | 'interpolate'): string {
  const parts = [user.get('username'), user.get('realname'), user.get('email')];
  if (joinWith === 'concat') return parts.map((p) => String(p)).join(' ');
  return parts.map((p) => (p === undefined || p === null ? '' : String(p))).join(' ');
}
