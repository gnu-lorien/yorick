import { Parse } from '../init';
import { PORTRAIT_FALLBACK } from '@/config/assets';

/**
 * A character -- vampire, werewolf or changeling.
 *
 * All three creature types live in one Mongo table and register the Parse
 * className "Vampire". That is deliberate and must not be split; see
 * public/scripts/app/helpers/VenueClass.js for the long version.
 *
 * The legacy app implements this by registering the same className three times
 * and then repairing the damage: Parse 8 keeps one class per className and
 * merges every registration into it, so all three modules got the same
 * constructor and the last one loaded won. VenueClass.js exists to hand each
 * module back a private constructor and prototype, plus a `__compatCast` that
 * the query shim calls on every result so `new Parse.Query(Werewolf)` yields
 * werewolf-flavoured objects.
 *
 * None of that is needed here. There is one class, and the venue is a property
 * of the row -- the `type` attribute, which is exactly what the templates
 * already switch on. Behaviour that differs by venue is looked up through
 * `venue`, so there is one object per creature type instead of one prototype
 * chain per creature type, and nothing depends on module load order.
 */

export type VenueName = 'Vampire' | 'Werewolf' | 'ChangelingBetaSlice';

/** The Parse className all three creature types share. */
export const CHARACTER_CLASS_NAME = 'Vampire';

export class Character extends Parse.Object {
  // Forwarded rather than dropped -- see the note on the same
  // constructor in models/Patronage.ts.
  constructor(attributes?: Record<string, unknown>) {
    super(CHARACTER_CLASS_NAME);
    if (attributes) this.set(attributes);
  }

  /**
   * Which creature this is.
   *
   * Rows written before the werewolf and changeling venues existed have no
   * `type`, and every template treats that as a vampire -- their checks are
   * `type == "Werewolf"`, `type == "ChangelingBetaSlice"`, else vampire. This
   * keeps that fallback rather than reading a missing field as an error.
   */
  get venue(): VenueName {
    const type = this.get('type') as string | undefined;
    return type === 'Werewolf' || type === 'ChangelingBetaSlice' ? type : 'Vampire';
  }

  get name(): string {
    return (this.get('name') as string) ?? '';
  }

  /** The owning user. May be absent: the legacy list renders "DELETED" then. */
  get owner(): Parse.User | undefined {
    return this.get('owner') as Parse.User | undefined;
  }

  /**
   * The portrait thumbnail URL, without a round trip.
   *
   * Falls back to head_skull.png. Needs the query to have `include`d the
   * portrait, which `userCharactersQuery` does.
   */
  thumbnailUrl(size: number): string {
    const portrait = this.get('portrait') as Parse.Object | undefined;
    const file = portrait?.get(`thumb_${size}`) as Parse.File | undefined;
    return file?.url() ?? PORTRAIT_FALLBACK;
  }

  /**
   * The same URL, fetching the portrait pointer if it is still a stub.
   *
   * `get_thumbnail` in models/Character.js. The relationship network is its one
   * caller, and it needs the round trip because the troupe character query does
   * not `include("portrait")`.
   */
  async fetchThumbnailUrl(size: number): Promise<string> {
    const portrait = this.get('portrait') as Parse.Object | undefined;
    if (!portrait) return PORTRAIT_FALLBACK;
    const fetched = await portrait.fetch();
    const file = fetched.get(`thumb_${size}`) as Parse.File | undefined;
    return file?.url() ?? PORTRAIT_FALLBACK;
  }

  /* --------------------------------------------------------- expiration -- */
  /*
   * From helpers/ExpirationMixin.js, which Vampire, Troupe and Patronage all
   * mix in. Note the asymmetry it defines and this keeps: a character with no
   * `expiresOn` at all is neither active nor expired by `isActive`/`isExpired`,
   * but `status()` still reports "Expired", because it asks only `isActive`.
   */

  isActive(): boolean {
    const expiresOn = this.get('expiresOn') as Date | undefined;
    return expiresOn ? expiresOn.getTime() > Date.now() : false;
  }

  isExpired(): boolean {
    const expiresOn = this.get('expiresOn') as Date | undefined;
    return expiresOn ? expiresOn.getTime() < Date.now() : false;
  }

  /** "Active" or "Expired" -- the patronage state shown in every listing. */
  status(): 'Active' | 'Expired' {
    return this.isActive() ? 'Active' : 'Expired';
  }
}

Parse.Object.registerSubclass(CHARACTER_CLASS_NAME, Character);

/**
 * The characters a user owns.
 *
 * From mobileRouter's `get_user_characters`: filter by owner and include the
 * portrait, then page through with `each` rather than `find` so the query limit
 * does not silently truncate someone's roster.
 */
export function userCharactersQuery(user: Parse.User): Parse.Query<Character> {
  return new Parse.Query(Character).equalTo('owner', user).include('portrait');
}

/**
 * How a character list is ordered: by name, always.
 *
 * The legacy comparator looks like it supports two orders --
 *
 *     comparator: function (left, right) {
 *         if (_.has(self, "sortbycreated")) { ...by createdAt, descending... }
 *         else                              { ...by name... }
 *     }                                        -- collections/Vampires.js
 *
 * -- and five places in mobileRouter appear to switch it on:
 *
 *     var c = [];
 *     if (Parse.User.current().get("username") == "devuser") { c.sortbycreated = true; }
 *     ...
 *     self.characters.collection.reset(c);     -- get_user_characters, and four others
 *
 * The flag never arrives. It is set on `c`, a plain array, while the comparator
 * reads it off `self`, the collection; `reset(c)` copies the array's *elements*
 * and not its properties, so the branch is dead and every listing has always
 * been sorted by name. Confirmed against the running app: devuser -- the one
 * username that is supposed to trigger it -- gets an alphabetical roster.
 *
 * So this sorts by name, with no flag. Reproducing the intent instead would
 * have changed the order of every list for that user, which is a visible
 * change dressed up as a faithful port.
 *
 * Patronages.js and Users.js carry copies of the same dead comparator.
 */
export function sortCharacters(characters: Character[]): Character[] {
  return [...characters].sort((left, right) => {
    const l = left.name;
    const r = right.name;
    return l > r ? 1 : l < r ? -1 : 0;
  });
}
