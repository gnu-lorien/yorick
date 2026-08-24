import { Parse } from '../init';
import { PORTRAIT_FALLBACK } from '@/config/assets';

/**
 * The Troupe class.
 *
 * Ports public/scripts/app/models/Troupe.js. Two things carried across exactly:
 *
 * - `initialize` stamps an ACL on every new Troupe: public read, no public
 *   write, Administrator read and write. Parse applies the ACL a client sets,
 *   so this is the access policy for troupes, not a default.
 * - `get_staff` goes through the `get_troupe_staff` Cloud function rather than
 *   querying the roles' user relations. The comment in the original explains
 *   why and it still applies: a client-side relation query is ACL-filtered, so
 *   a staffer with a private profile silently vanished from the roster, and the
 *   old code also dirtied a _User row the caller cannot write.
 */

/** The staff titles a troupe has roles for, in the order they are shown. */
export const TROUPE_TITLES = ['LST', 'AST', 'Narrator'] as const;
export type TroupeTitle = (typeof TROUPE_TITLES)[number];

export class Troupe extends Parse.Object {
  constructor() {
    super('Troupe');
  }

  /** Called by the SDK for new objects only, not on ones loaded from a query. */
  override initialize(): void {
    const acl = new Parse.ACL();
    acl.setPublicReadAccess(true);
    acl.setPublicWriteAccess(false);
    acl.setRoleReadAccess('Administrator', true);
    acl.setRoleWriteAccess('Administrator', true);
    this.setACL(acl);
  }

  get name(): string {
    return (this.get('name') as string) ?? '';
  }

  get location(): string {
    return (this.get('location') as string) ?? '';
  }

  get shortdescription(): string {
    return (this.get('shortdescription') as string) ?? '';
  }

  get staffemail(): string {
    return (this.get('staffemail') as string) ?? '';
  }

  /**
   * The staff roster, from the Cloud function.
   *
   * Role order is fixed LST, AST, Narrator server-side. The pre-Cloud version
   * iterated an object whose key order came from promise resolution, so the
   * roster could come back in a different order each time.
   *
   * These are `Parse.User` objects, not plain records: the Cloud function
   * builds each one with `Parse.Object.fromJSON({className: "_User", ...})`, so
   * the wire form carries `__type: "Object"` and the SDK decodes it back into a
   * user. They are projections, not whole rows -- `identity_of` copies an
   * allowlist of fields -- and the per-troupe title arrives as an extra
   * attribute named `role`, which is what templates/troupe-staff-list.html
   * reads. `email` is never among them: parse-server withholds another user's
   * address from every non-master read, and cloud/main.js keeps it that way
   * deliberately (IDENTITY_INCLUDES_EMAIL is false).
   */
  async getStaff(): Promise<Parse.User[]> {
    const payload = (await Parse.Cloud.run('get_troupe_staff', { troupe_id: this.id })) as {
      staff: Parse.User[];
    };
    return payload.staff;
  }

  /** This troupe's per-troupe roles, keyed by title: `LST_<troupeId>` etc. */
  async getRoles(): Promise<Partial<Record<TroupeTitle, Parse.Role>>> {
    const entries = await Promise.all(
      TROUPE_TITLES.map(async (title) => {
        const role = await new Parse.Query(Parse.Role).equalTo('name', `${title}_${this.id}`).first();
        return [title, role] as const;
      }),
    );
    return Object.fromEntries(entries.filter(([, role]) => role));
  }

  /** The system-wide roles of the same names, with no troupe id suffix. */
  async getGenericRoles(): Promise<Partial<Record<TroupeTitle, Parse.Role>>> {
    const entries = await Promise.all(
      TROUPE_TITLES.map(async (title) => {
        const role = await new Parse.Query(Parse.Role).equalTo('name', title).first();
        return [title, role] as const;
      }),
    );
    return Object.fromEntries(entries.filter(([, role]) => role));
  }

  /**
   * The portrait thumbnail URL, without a round trip.
   *
   * Falls back to head_skull.png, which is what the legacy templates render for
   * a troupe with no portrait. Requires the query to have `include`d the
   * portrait -- see `troupesQuery` below, which does.
   */
  thumbnailUrl(size: number): string {
    const portrait = this.get('portrait') as Parse.Object | undefined;
    const file = portrait?.get(`thumb_${size}`) as Parse.File | undefined;
    return file?.url() ?? PORTRAIT_FALLBACK;
  }

  /**
   * The full-size portrait URL for templates/troupe-portrait-display.html.
   *
   * `null` means the troupe has no portrait pointer at all, which is the case
   * the template renders as an "Add Portrait" link rather than an `<img>` --
   * so the two are not interchangeable and an empty string is not a stand-in
   * for either. A pointer that resolves to a row with no `original` file gives
   * an empty string, keeping the `<img>` the template would have emitted.
   *
   * `fetch()` mutates the pointer in place, so the caller's troupe ends up
   * holding the hydrated portrait exactly as TroupeView.render leaves it.
   */
  async fetchPortraitOriginalUrl(): Promise<string | null> {
    const portrait = this.get('portrait') as Parse.Object | undefined;
    if (!portrait) return null;
    const fetched = await portrait.fetch();
    const file = fetched.get('original') as Parse.File | undefined;
    return file?.url() ?? '';
  }

  /** The portrait thumbnail URL, fetching the portrait if it is a stub. */
  async fetchThumbnailUrl(size: number): Promise<string> {
    const portrait = this.get('portrait') as Parse.Object | undefined;
    if (!portrait) return PORTRAIT_FALLBACK;
    const fetched = await portrait.fetch();
    const file = fetched.get(`thumb_${size}`) as Parse.File | undefined;
    return file?.url() ?? PORTRAIT_FALLBACK;
  }
}

Parse.Object.registerSubclass('Troupe', Troupe);

/**
 * Every troupe, with just the fields the listings need.
 *
 * The field list and the `include("portrait")` are from TroupeWreqr's
 * `get_troupes`; the include is what makes `thumbnailUrl` work without a
 * second request per row.
 */
export function troupesQuery(): Parse.Query<Troupe> {
  return new Parse.Query(Troupe)
    .select('id', 'name', 'portrait', 'shortdescription', 'location', 'staffemail')
    .include('portrait');
}

/**
 * The troupe id embedded in a per-troupe role name.
 *
 * Role names are `<title>_<troupeId>` -- "LST_k7zf9B7bwV". PlayerOptionsView
 * pulls the id out with `name.split('_')[1]`, and this keeps that exactly,
 * including the consequence that a *generic* role ("LST", no suffix) yields
 * undefined and is skipped.
 */
export function troupeIdFromRoleName(roleName: string): string | undefined {
  return roleName.split('_')[1];
}
