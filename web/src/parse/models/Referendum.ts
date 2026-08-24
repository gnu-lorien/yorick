import { Parse } from '../init';
import { PORTRAIT_FALLBACK } from '@/config/assets';

/**
 * A referendum put to the membership, and the ballots cast in it.
 *
 * Ports models/Referendum.js, models/ReferendumBallot.js,
 * collections/Referendums.js and collections/ReferendumBallots.js. The two
 * collections are ~50 lines each of Backbone plumbing around one query and one
 * comparator, so they come across as the query and the sort below rather than
 * as classes.
 */
export class Referendum extends Parse.Object {
  // Forwarded rather than dropped -- see the note on the same
  // constructor in models/Patronage.ts.
  constructor(attributes?: Record<string, unknown>) {
    super('Referendum');
    if (attributes) this.set(attributes);
  }

  get name(): string {
    return (this.get('name') as string) ?? '';
  }

  get shortdescription(): string {
    return (this.get('shortdescription') as string) ?? '';
  }

  get description(): string {
    return (this.get('description') as string) ?? '';
  }

  /**
   * The sort key. `undefined` on a row that never had one set, which matters:
   * the comparator in collections/Referendums.js compares with lodash `gt`/`lt`
   * and those are false for any comparison involving `undefined`, so unordered
   * rows compare equal to everything and keep the order they arrived in.
   */
  get order(): number | undefined {
    return this.get('order') as number | undefined;
  }

  /**
   * The portrait thumbnail URL, without a round trip.
   *
   * `get_thumbnail_sync` in models/Referendum.js, which is what the listing
   * template calls: `_.result(self, "attributes.portrait.attributes.thumb_<n>.url",
   * "head_skull.png")`. Requires the query to have `include`d the portrait --
   * `referendumsQuery` below does, and so does the detail route.
   */
  thumbnailUrl(size: number): string {
    const portrait = this.get('portrait') as Parse.Object | undefined;
    const file = portrait?.get(`thumb_${size}`) as Parse.File | undefined;
    return file?.url() ?? PORTRAIT_FALLBACK;
  }

  /** The text of one ballot option, or undefined if that slot is unset. */
  option(field: string): string | undefined {
    return this.get(field) as string | undefined;
  }
}

Parse.Object.registerSubclass('Referendum', Referendum);

export class ReferendumBallot extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('ReferendumBallot');
    if (attributes) this.set(attributes);
  }

  /** The option field name voted for -- "option_0", not the option's text. */
  get choice(): string {
    return (this.get('choice') as string) ?? '';
  }

  /**
   * The voter, as an unfetched pointer.
   *
   * `undefined` only when the row genuinely has no `caster`; see
   * `fetchBallots` for why the pointer is deliberately not `include`d.
   */
  get caster(): Parse.Object | undefined {
    return this.get('caster') as Parse.Object | undefined;
  }
}

Parse.Object.registerSubclass('ReferendumBallot', ReferendumBallot);

/**
 * The fields the listing needs.
 *
 * Field list and `include("portrait")` are ReferendumsListView.register's,
 * verbatim. Note what is NOT selected: `location` and `staffemail`.
 * templates/referendums-list.html is a copy of the troupe row and still prints
 * both, but the select means neither is ever present, so those two lines have
 * never rendered. See the comment on the row in Referendums.tsx.
 */
export function referendumsQuery(): Parse.Query<Referendum> {
  return new Parse.Query(Referendum)
    .select('id', 'name', 'portrait', 'shortdescription', 'order')
    .include('portrait');
}

/** Every referendum, paged through as `each` does rather than one query page. */
export async function fetchReferendums(): Promise<Referendum[]> {
  const found: Referendum[] = [];
  await referendumsQuery().each((r) => {
    found.push(r);
  });
  return found;
}

/**
 * Sort by `order`, as collections/Referendums.js's comparator does.
 *
 * lodash `gt`/`lt` are bare `>` and `<`, so this is JavaScript comparison, not
 * a numeric one: rows whose `order` is unset compare equal to every other row
 * and Array#sort is stable, which leaves them where `each` returned them.
 */
export function sortReferendums(list: Referendum[]): Referendum[] {
  return [...list].sort((left, right) => {
    const l = left.order;
    const r = right.order;
    if (l! > r!) return 1;
    if (l! < r!) return -1;
    return 0;
  });
}

/** A pointer to a referendum, for the ballot queries that filter on `owner`. */
export function referendumPointer(id: string): Referendum {
  return Referendum.createWithoutData(id) as Referendum;
}

/** The current user's own ballot in a referendum, if they have cast one. */
export async function fetchMyBallot(
  referendumId: string,
  user: Parse.User,
): Promise<ReferendumBallot | undefined> {
  return new Parse.Query(ReferendumBallot)
    .equalTo('owner', referendumPointer(referendumId))
    .equalTo('caster', user)
    .first();
}

/**
 * Every ballot cast in a referendum. Administrators only, by ACL.
 *
 * No `include("caster")`, and that is load-bearing -- the comment in
 * collections/ReferendumBallots.js explains it and it still applies:
 * parse-server deletes an unreadable pointer only when asked to EXPAND it, so
 * including it made a private voter's ballot arrive with no `caster` at all and
 * the template's `caster.get("username")` threw rather than rendering short.
 * Without the include the pointer survives with its id, and `casterIdentities`
 * puts the names back.
 */
export async function fetchBallots(referendumId: string): Promise<ReferendumBallot[]> {
  const found: ReferendumBallot[] = [];
  await new Parse.Query(ReferendumBallot)
    .equalTo('owner', referendumPointer(referendumId))
    .each((b) => {
      found.push(b);
    });
  return found;
}

/** The display fields the ballot dump prints for a voter. */
export interface CasterIdentity {
  username: string;
  realname: string;
  email: string;
}

/**
 * A pointer nothing could resolve.
 *
 * The value, not a blank, is UserWreqr's `UNRESOLVED_USER` and its reason
 * carries over unchanged: the CSV templates emit their identity columns only
 * inside `if (owner.get("username"))`, so a falsy username makes a row emit no
 * columns at all and shifts every later column.
 */
const UNRESOLVED_USER: CasterIdentity = { username: '(unknown)', realname: '', email: '' };

/** The Cloud function's own cap on ids per call, as UserWreqr.prime batches to. */
const IDENTITY_BATCH = 200;

/**
 * Resolve ballot casters to display names, keyed by user id.
 *
 * This is UserWreqr.hydrate's job, minus the `_finishFetch` machinery. The
 * original had to write the names back onto the pointer objects because the
 * template read them off `ballot.get("caster")`, and doing that with `.set()`
 * would have dirtied a `_User` row the caller cannot write -- see the long
 * comment in helpers/UserWreqr.js. Returning a lookup table instead sidesteps
 * the whole trap: nothing is mutated, so nothing can be deep-saved by accident.
 *
 * The caller's own row is answered from `Parse.User.current()` without asking
 * the server, as UserWreqr's "user get" handler does -- parse-server always
 * grants a user read access to their own row, so it is the one identity that
 * needs no directory call.
 */
export async function casterIdentities(
  ballots: ReferendumBallot[],
): Promise<Map<string, CasterIdentity>> {
  const resolved = new Map<string, CasterIdentity>();
  const current = Parse.User.current();
  if (current?.id) resolved.set(current.id, identityOf(current));

  const ids = [...new Set(ballots.map((b) => b.caster?.id).filter((id): id is string => !!id))];
  const need = ids.filter((id) => !resolved.has(id));

  for (let i = 0; i < need.length; i += IDENTITY_BATCH) {
    const batch = need.slice(i, i + IDENTITY_BATCH);
    const payload = (await Parse.Cloud.run('get_users_by_id', { ids: batch })) as {
      users: Parse.Object[];
    };
    for (const user of payload.users) if (user.id) resolved.set(user.id, identityOf(user));
  }

  // Ids the server withheld stay unresolved rather than absent, so a caller
  // cannot tell the two apart and skip a column.
  for (const id of ids) if (!resolved.has(id)) resolved.set(id, UNRESOLVED_USER);

  return resolved;
}

function identityOf(user: Parse.Object): CasterIdentity {
  return {
    username: (user.get('username') as string) ?? '',
    realname: (user.get('realname') as string) ?? '',
    email: (user.get('email') as string) ?? '',
  };
}

/**
 * Whether the current user is a patron in good standing, and so may vote.
 *
 * `get_my_patronage_status` resolves to a bare boolean. It is the *viewing*
 * user's status, which is why the admin detail page shows the option list only
 * when the administrator themselves happens to hold a patronage -- see the
 * file comment in e2e/admin-referendums.spec.js.
 */
export async function myPatronageStatus(): Promise<boolean> {
  return (await Parse.Cloud.run('get_my_patronage_status')) as boolean;
}

/**
 * Cast a ballot.
 *
 * Resolves with whatever `vote_for_referendum` resolved with, which on success
 * is the bare string "Ballot has been cast" -- not an object. The options
 * template prints `ballot_message.message`, so the dedicated confirmation
 * paragraph has always rendered empty; that is finding 6 in
 * e2e/admin-referendums.spec.js and it is reproduced, not fixed.
 *
 * The function has no update path: once a ballot exists for (referendum,
 * caster) it rejects with "Existing ballot found." unconditionally. The UI
 * never offers a second vote anyway, because the option links are replaced by
 * the "you voted for X" line the moment a ballot exists.
 */
export async function voteForReferendum(
  referendumId: string,
  ballotOption: string,
): Promise<unknown> {
  return Parse.Cloud.run('vote_for_referendum', {
    referendum_id: referendumId,
    ballot_option: ballotOption,
  });
}
