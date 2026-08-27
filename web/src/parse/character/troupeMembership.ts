import { Parse } from '../init';
import type { Character } from '../models/Character';
import type { Troupe } from '../models/Troupe';
import { characterAcl, setCachedAcl, setTroupeIds, troupeIdsOf } from './acl';
import { fetchExperienceNotations } from './experience';

/**
 * A character's troupe membership, and the permissions that follow from it.
 *
 * Ports `initialize_troupe_membership`, `update_troupe_acls`, `join_troupe`,
 * `leave_troupe`, `get_owned_ids`, `update_server_client_permissions_mismatch`
 * and `check_server_client_permissions_mismatch` from
 * models/Character.js:936-1133.
 *
 * Membership is a Parse *relation*, not an array attribute, so the ids are not
 * on the row: they have to be walked. `acl.ts` keeps them in a plain
 * `troupeIds` property for exactly this reason, and its comment is the one to
 * read first -- an ACL built before the walk has run grants no staff access at
 * all, and says nothing about it. Every entry point here therefore initialises
 * membership before it builds an ACL.
 *
 * `broken_update_troupe_acls` (Character.js:966) is NOT ported, and its name is
 * accurate. It is the same chain with `return Parse.Promise.error();` standing
 * where the experience-notation fetch belongs, so the chain always rejects at
 * "Fetching experience notations": the notations are never re-ACLed, the
 * `update_vampire_change_permissions_for` Cloud call never runs, and the caller
 * sees a failure after the character and its traits have already been rewritten.
 * It is dead code -- nothing calls it -- and porting it would mean porting a
 * half-applied permission change. The working one below is what everything uses.
 */

/**
 * Private, non-attribute state the legacy model hangs off the object.
 *
 * All four are plain JS properties on the model, not Parse attributes, so none
 * of them are saved or fetched -- they live exactly as long as the in-memory
 * character does. `troupeIds` is read through acl.ts's `troupeIdsOf`, which is
 * why it is not declared here.
 */
interface MembershipState {
  troupeIds?: string[];
  /** `last_initialized_troupe_membership`, as epoch millis. */
  lastInitializedTroupeMembership?: number;
  /** `is_mismatched`: undefined until the first check has run. */
  isMismatched?: boolean;
  /** `_mismatchFetch`: the self-chaining queue that serialises those checks. */
  mismatchFetch?: Promise<unknown>;
}

function stateOf(character: Character): MembershipState {
  return character as unknown as MembershipState;
}

/** How long a throttled `initializeTroupeMembership` trusts what it already has. */
export const TROUPE_MEMBERSHIP_THROTTLE_MS = 50000;

/**
 * The `troupes` relation, ready to query.
 *
 * `targetClassName` is set explicitly, as the legacy does. Without it parse@8
 * builds the query against the *character's* class with
 * `redirectClassNameForKey` instead of a `$relatedTo` constraint
 * (ParseRelation.query, parse/lib/browser/ParseRelation.js:130) -- which the
 * server also answers, but with a different request shape than the app has
 * ever sent.
 *
 * Rebuilt on every call rather than cached on the character. The legacy model
 * caches it as `self.troupes` and then has to repair that cache twice: once in
 * `initialize_troupe_membership`, which re-parents a relation whose `parent`
 * `get_transformed` nulled ("Relations aren't cloned properly so it's the
 * *same* damned relation", Character.js:799), and once in `update_troupe_acls`,
 * which deletes the relation from `attributes`, `_previousAttributes`,
 * `_serverData` and the model itself so the next read rebuilds it. Nothing here
 * holds a relation between calls, so there is no cache to go stale and none of
 * that repair work has anything to do.
 */
function troupesRelation(character: Character): Parse.Relation<Character, Troupe> {
  const relation = character.relation<Troupe>('troupes') as Parse.Relation<Character, Troupe>;
  relation.targetClassName = 'Troupe';
  return relation;
}

/**
 * Walk the troupe relation and cache the ids on the character.
 *
 * `throttle` is what the vampire venue passes (`Vampire.js:367`); the werewolf
 * and changeling venues call it unthrottled. It only ever suppresses work when
 * a list is already there, so the first call always walks.
 *
 * The list is emptied before the walk and filled as results stream in, as the
 * original does. That leaves a window worth knowing about: if the walk rejects
 * part way, the character keeps a *truncated* list, and a throttled call within
 * the next 50 seconds will serve it as if it were complete. That is the state
 * acl.ts warns about -- fewer troupe ids than the character really has means an
 * ACL that silently drops staff access -- so it is reproduced rather than
 * quietly repaired, and reported.
 */
export async function initializeTroupeMembership(
  character: Character,
  options: { throttle?: boolean } = {},
): Promise<Character> {
  const state = stateOf(character);

  if (options.throttle && state.troupeIds && state.lastInitializedTroupeMembership !== undefined) {
    if (Date.now() - state.lastInitializedTroupeMembership < TROUPE_MEMBERSHIP_THROTTLE_MS) {
      return character;
    }
  }

  state.lastInitializedTroupeMembership = Date.now();
  const ids: string[] = [];
  setTroupeIds(character, ids);
  // `each`, not `find`: a character in more troupes than the query limit would
  // otherwise lose the tail of its own membership, and with it the staff access
  // for those troupes.
  await troupesRelation(character).query().each((troupe) => {
    ids.push(troupe.id!);
  });
  return character;
}

/** Progress text, which the legacy model puts in the loading spinner. */
export type ProgressReporter = (text: string) => void;

/**
 * Rewrite the character's permissions, and everything hanging off it.
 *
 * Ports `update_troupe_acls` (Character.js:1010). The ACL is recomputed from
 * the *current* `troupeIds`, so callers set that first; then the same ACL shape
 * is stamped on the character, every SimpleTrait it owns, every
 * ExperienceNotation, and every LongText, with a Cloud call in the middle that
 * does the same for the server-side change log. A row that keeps an older ACL
 * than its character is a row its owner -- or its new storyteller -- can no
 * longer read.
 *
 * The character is saved FIRST and on its own. In `joinTroupe` and
 * `leaveTroupe` the pending relation change is sitting on the character, so
 * this one save is what commits the membership as well as the ACL; everything
 * after it depends on the server already agreeing about who is in the troupe.
 *
 * `onProgress` replaces the model's `progress()` helper, which writes into
 * `$.mobile.loading`. A model reaching into the page's loading widget is what
 * `progress()` exists to soften -- it already guards for `$` being absent so
 * the model can run without a page -- so the text is handed to the caller
 * instead. web/src/jqm/Loader.tsx has no text of its own, so today's screens
 * pass nothing and the strings are kept here for the next one that wants them.
 */
export async function updateTroupeAcls(
  character: Character,
  onProgress: ProgressReporter = () => {},
): Promise<Character> {
  onProgress('Updating character permissions');
  const acl = characterAcl(character);
  setCachedAcl(character, acl);
  character.setACL(acl);
  await character.save();

  onProgress('Updating trait permissions');
  const traits: Parse.Object[] = [];
  await new Parse.Query('SimpleTrait').equalTo('owner', character).each((trait) => {
    // A fresh ACL per row, as the original builds one per row. Sharing one
    // instance would work only for as long as nobody mutates it, and an ACL
    // shared by a character and several hundred of its traits is a piece of
    // shared mutable state that looks like a value.
    trait.setACL(characterAcl(character));
    traits.push(trait);
  });

  onProgress('Saving trait permissions');
  await Promise.all(
    traits.map((trait) =>
      trait.save().catch(() => {
        // The original writes `.fail(function (error) { return new
        // Parse.Error(Parse.Error.OTHER_CAUSE, "Could not save " + name) })`,
        // which reads as "fail with a better message" and does the opposite: a
        // rejection handler that RETURNS a value resolves the chain, so the
        // constructed error is discarded and the trait is silently skipped.
        // `Parse.Promise.when` over these therefore always succeeds, and a
        // permission update that could not rewrite a trait still reports done.
        // Reproduced, message and all, so the two apps skip the same rows.
        return new Parse.Error(
          Parse.Error.OTHER_CAUSE,
          'Could not save ' + (trait.get('name') as string),
        );
      }),
    ),
  );

  onProgress('Fetching experience notations');
  const notations = await fetchExperienceNotations(character);

  onProgress('Updating experience notations');
  for (const notation of notations) notation.setACL(characterAcl(character));
  await Parse.Object.saveAll(notations);

  onProgress('Updating server side change log');
  // VampireChange rows are written by cloud code and are not readable here, so
  // the server rewrites their ACLs itself. This is the step
  // `broken_update_troupe_acls` never reaches.
  await Parse.Cloud.run('update_vampire_change_permissions_for', { character: character.id });

  onProgress('Fetching long texts to update');
  const longTexts = await minimalLongTexts(character);

  onProgress('Updating long texts with new permissions');
  for (const text of longTexts) text.setACL(characterAcl(character));
  await Parse.Object.saveAll(longTexts);

  onProgress('Finishing up!');
  return character;
}

/**
 * The character's LongTexts, with only what a permission rewrite needs.
 *
 * Ports `get_minimal_long_texts` (Character.js:1282). The three selected fields
 * are the point: a LongText's body is the largest thing a character owns, and
 * re-saving one whose `text` was never loaded must not blank it -- so the query
 * asks for `owner`, `category` and `ACL` and nothing else, and the save that
 * follows sends only the ACL it changed.
 *
 * The original chains this onto `self._ltPromise`, the same queue
 * `get_long_text` uses, so a permission rewrite cannot interleave with a
 * long-text read that might create one. That queue guards `_ltCache`, which
 * this port does not have -- long texts are not cached on the character here --
 * so there is nothing for it to serialise.
 */
async function minimalLongTexts(character: Character): Promise<Parse.Object[]> {
  const texts: Parse.Object[] = [];
  await new Parse.Query('LongText')
    .equalTo('owner', character)
    .select('owner', 'category', 'ACL')
    .each((text) => {
      texts.push(text);
    });
  return texts;
}

/**
 * Put the character in a troupe.
 *
 * Ports `join_troupe`. The order is the whole of it: read the membership the
 * server has, add the troupe to the relation and its id to the cached list,
 * *then* rewrite the ACLs -- because `characterAcl` reads that list, and the
 * new troupe's `LST_`/`AST_` roles only appear in the ACL if the id is already
 * in it. The relation change is still pending when `updateTroupeAcls` saves, so
 * one save commits both.
 */
export async function joinTroupe(
  character: Character,
  troupe: Troupe,
  onProgress?: ProgressReporter,
): Promise<Character> {
  await initializeTroupeMembership(character);
  troupesRelation(character).add(troupe);
  setTroupeIds(character, [...troupeIdsOf(character), troupe.id!]);
  return updateTroupeAcls(character, onProgress);
}

/**
 * Take the character out of a troupe.
 *
 * Ports `leave_troupe`, including a bug that changes what the ACL ends up
 * saying. The original is:
 *
 *     self.troupe_ids = _.remove(self.troupe_ids, troupe.id);
 *
 * `_.remove(array, predicate)` removes the elements the predicate matches and
 * returns *those removed elements*, so even a working predicate would assign
 * the wrong half. The predicate is worse: a string argument is read as
 * `_.property("<troupeId>")`, which asks each id-string for a property named
 * after the troupe and gets undefined. Measured against the repo's own lodash
 * 4.18.1 -- `_.remove(['aa','bb'], 'aa')` leaves the array untouched and
 * returns `[]`.
 *
 * So the list is not filtered, it is EMPTIED, and the ACL `updateTroupeAcls`
 * then builds carries no troupe roles at all. For a character in one troupe --
 * everything the E2E suite exercises, and the common case -- that is
 * indistinguishable from the intent. For a character in two, leaving one also
 * revokes the other troupe's storytellers, until something walks the relation
 * again and rewrites the ACLs.
 *
 * Kept as-is: this is a port, and a character's permissions quietly changing
 * shape is not a difference to introduce in the same commit that moves the code.
 * Reported instead.
 */
export async function leaveTroupe(
  character: Character,
  troupe: Troupe,
  onProgress?: ProgressReporter,
): Promise<Character> {
  await initializeTroupeMembership(character);
  troupesRelation(character).remove(troupe);
  setTroupeIds(character, []);
  return updateTroupeAcls(character, onProgress);
}

/** The three classes whose rows are owned by a character. */
export const OWNED_CLASS_NAMES = ['SimpleTrait', 'ExperienceNotation', 'VampireChange'] as const;

export type OwnedIds = Record<(typeof OWNED_CLASS_NAMES)[number], string[]>;

/**
 * Every row this character owns, by class.
 *
 * Ports `get_owned_ids`, which describes itself as "a spiritual clone of
 * `get_expected_vampire_ids` in cloud/main.js" -- and the two are meant to be
 * compared, so the shape has to stay identical to what that Cloud function
 * returns (cloud/main.js:781): the same three keys, in the same order, each an
 * array filled in `each` order.
 *
 * `select("id")` is copied from both sides. There is no `id` column -- the
 * server's name for it is `objectId`, which comes back regardless -- so it
 * selects nothing and costs nothing, and changing it here would leave the
 * client asking for a different projection than the server does.
 */
export async function getOwnedIds(character: Character): Promise<OwnedIds> {
  const results: OwnedIds = { SimpleTrait: [], ExperienceNotation: [], VampireChange: [] };
  await Promise.all(
    OWNED_CLASS_NAMES.map((className) =>
      new Parse.Query(className)
        .equalTo('owner', character)
        .select('id')
        .each((row) => {
          results[className].push(row.id!);
        }),
    ),
  );
  return results;
}

/**
 * Whether what the client can see differs from what the server says exists.
 *
 * Ports `update_server_client_permissions_mismatch`. The comparison is the
 * interesting part, and it does not do what it reads as:
 *
 *     if (_.eq(client, server)) { self.is_mismatched = false; }
 *     else                      { self.is_mismatched = true; }
 *
 * `_.eq` means different things in different lodash majors, and which one this
 * app has decides what the line does:
 *
 *   lodash 3  `_.eq` is an alias of `_.isEqual` -- a DEEP comparison.
 *   lodash 4  `_.eq` is SameValueZero, i.e. `===` for objects.
 *
 * The app loads the VENDORED lodash, not the one in node_modules:
 * `public/scripts/app.js` maps the AMD name `underscore` to
 * `public/scripts/lib/lodash.js`, which is 3.10.0. Measured in the running app:
 * `_.VERSION` is "3.10.0", `_.eq({x:[1]},{x:[1]})` is **true**, and the lodash 3
 * survivors the rest of this codebase depends on -- `_.contains`, `_.pluck`,
 * `_.select`, `_.any` -- are all present, which they would not be under 4.
 *
 * So this is a real deep comparison, and `is_mismatched` is true only when the
 * two sides genuinely differ. An earlier version of this file asserted the
 * opposite, having tested against node_modules' lodash 4 rather than the
 * vendored 3 the browser loads, and implemented `client !== server` -- which on
 * two freshly-built objects is always true. That is not a harmless difference:
 * `_check_character_mismatch` (mobileRouter.js:1578) runs this whenever someone
 * who does not own a character opens it, and "repairs" a mismatch by running
 * the whole of `updateTroupeAcls`. Every storyteller opening any player's sheet
 * would have rewritten that character's ACL, its traits', its notations' and
 * its long texts', and waited for it.
 */
export async function updateServerClientPermissionsMismatch(
  character: Character,
): Promise<Character> {
  const state = stateOf(character);

  const run = async (): Promise<Character> => {
    const [client, server] = await Promise.all([
      getOwnedIds(character),
      Parse.Cloud.run('get_expected_vampire_ids', { character: character.id }) as Promise<OwnedIds>,
    ]);
    // Deep, because lodash 3's `_.eq` is `_.isEqual`. See the note above.
    state.isMismatched = !deepEqual(client, server);
    return character;
  };

  // `self._mismatchFetch = self._mismatchFetch.always(...)`: one check per
  // character at a time, and the next one runs whether the last succeeded or
  // failed. `.then(run, run)` is the `.always()` of a native promise.
  const queue = state.mismatchFetch ?? Promise.resolve();
  const next = queue.then(run, run);
  state.mismatchFetch = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Check once per character; later callers reuse the answer. */
export async function checkServerClientPermissionsMismatch(
  character: Character,
): Promise<Character> {
  if (stateOf(character).isMismatched === undefined) {
    return updateServerClientPermissionsMismatch(character);
  }
  return character;
}

/** The last mismatch verdict, or undefined if no check has run. */
export function isMismatched(character: Character): boolean | undefined {
  return stateOf(character).isMismatched;
}

/**
 * Structural equality, standing in for lodash 3's `_.eq`.
 *
 * Only has to handle what `getOwnedIds` and the `get_expected_vampire_ids`
 * Cloud function return: an object keyed by class name whose values are arrays
 * of id strings. Order matters and is preserved by both sides, so the arrays
 * are compared element-wise rather than as sets -- which is what `_.isEqual`
 * does too.
 */
function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;

  const leftKeys = Object.keys(left as Record<string, unknown>);
  const rightKeys = Object.keys(right as Record<string, unknown>);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      deepEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
  );
}
