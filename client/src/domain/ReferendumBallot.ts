/**
 * Referendum ballots -- one vote, by one caster, on one referendum.
 *
 * Ported from `public/scripts/app/models/ReferendumBallot.js` and
 * `public/scripts/app/collections/ReferendumBallots.js`.
 *
 * Client code only ever *reads* ballots. Casting one goes through the
 * `vote_for_referendum` Cloud function, which is where the patronage
 * requirement and the one-ballot-per-user check live; a ballot written directly
 * from the client would bypass both.
 */
import Parse from '@/parse'
import { ReferendumBallotObject } from '@/parse/classes'
import type { Referendum } from '@/domain/Referendum'

/** A ballot record. The registered class for className "ReferendumBallot". */
export type ReferendumBallot = ReferendumBallotObject

/**
 * `collections/ReferendumBallots.js`'s comparator: by `order`, ascending.
 *
 * Identical to the referendum comparator, on the same column name. `_.gt`/`_.lt`
 * in lodash 3 are plain `>` and `<`, so a ballot with no `order` compares equal
 * to everything and keeps its incoming position.
 */
export function compareReferendumBallots(
  left: ReferendumBallot,
  right: ReferendumBallot,
): number {
  const l = left.get('order')
  const r = right.get('order')
  if (l > r) {
    return 1
  } else if (l < r) {
    return -1
  }
  return 0
}

/** A new array in comparator order. */
export function sortReferendumBallots(
  ballots: readonly ReferendumBallot[],
): ReferendumBallot[] {
  return [...ballots].sort(compareReferendumBallots)
}

/** Every ballot. */
export function referendumBallotQuery(): Parse.Query<ReferendumBallot> {
  return new Parse.Query(ReferendumBallotObject)
}

/**
 * Fill in the display fields of the ballots' `caster` pointers, in place.
 *
 * This is the user-directory hydrate that `helpers/UserWreqr.js` provides in
 * the Backbone app. It is not this module's to own -- the directory does not
 * exist in the Vue client yet -- so it is a parameter, and the reason it must
 * be supplied is spelled out on `fetchReferendumBallots` below.
 */
export type HydrateCasters = (ballots: ReferendumBallot[]) => Promise<void> | void

/**
 * Every ballot cast on one referendum.
 *
 * ### Why there is no `include("caster")`
 *
 * Same defect as `include("owner")` elsewhere in this app: parse-server deletes
 * an unreadable pointer only when it is asked to EXPAND it. With the include, a
 * private voter's ballot arrived with no `caster` at all -- and the options
 * template reads `ballot.get("caster").get("username")`, which throws on
 * `undefined` rather than rendering short. Without the include the pointer
 * survives as a bare pointer and the hydrate supplies the name.
 *
 * So `hydrateCasters` is not an optimisation hook. Skipping it leaves every
 * ballot's caster an unfetched pointer with no `username`, which is the state
 * the include was there to avoid. In the Backbone version the hydrate had to
 * run BEFORE `collection.reset(...)` because `_finishFetch` fires no change
 * event; here it has to run before the array is handed to a caller for the same
 * reason -- `_finishFetch` is one of the mutators `@/parse/reactivity`
 * instruments, but a component that has already rendered the pointer-shaped
 * ballot has already thrown.
 *
 * `each()` rather than `find()`, so it pages past the 100-row default.
 */
export async function fetchReferendumBallots(
  referendum: Referendum,
  hydrateCasters?: HydrateCasters,
): Promise<ReferendumBallot[]> {
  const query = referendumBallotQuery().equalTo('owner', referendum)
  const latest: ReferendumBallot[] = []
  await query.each((ballot) => {
    latest.push(ballot)
  })
  if (hydrateCasters) {
    await hydrateCasters(latest)
  }
  return sortReferendumBallots(latest)
}

/**
 * The current user's own ballot on a referendum, if they have cast one.
 *
 * From `views/ReferendumView.js#cast_ballot`, which re-reads the ballot after
 * the Cloud function returns rather than trusting its reply.
 */
export async function getOwnBallot(
  referendum: Referendum,
): Promise<ReferendumBallot | undefined> {
  const query = referendumBallotQuery()
    .equalTo('owner', referendum)
    .equalTo('caster', Parse.User.current())
  return await query.first()
}

/** What `castBallot` resolves with: the Cloud function's message and the stored row. */
export interface CastBallotResult {
  /** Whatever `vote_for_referendum` replied, or the error it rejected with. */
  message: unknown
  /** The ballot as the server stored it, re-read afterwards. */
  ballot: ReferendumBallot | undefined
}

/**
 * Cast a vote.
 *
 * Ported from `views/ReferendumView.js#cast_ballot`, whose promise chain is
 * easy to misread and whose behaviour is deliberate:
 *
 *   - `.fail(...)` came BEFORE `.then(...)`, so a rejected `vote_for_referendum`
 *     was HANDLED there and the chain continued into the re-read. A refused
 *     vote (not a patron, already voted) still ends by looking up whatever
 *     ballot the caller does have, and the refusal text is what gets shown.
 *   - `.always(...)` at the end re-attached the click handler and re-rendered
 *     whichever way it went, so the button never stays dead. `.always` is
 *     `then(cb, cb)`; `finally` would re-throw, so the equivalent here is a
 *     `catch` on the re-read, not a `finally`.
 *
 * Both branches resolve. This function never rejects, which is what lets the UI
 * treat "voted" and "refused" as the same redraw.
 */
export async function castBallot(
  referendum: Referendum,
  ballotOption: string,
): Promise<CastBallotResult> {
  let message: unknown
  try {
    message = await Parse.Cloud.run('vote_for_referendum', {
      referendum_id: referendum.id,
      ballot_option: ballotOption,
    })
  } catch (error) {
    // The source assigned the error to `ballot_message` and carried on.
    message = error
  }
  const ballot = await getOwnBallot(referendum).catch(() => undefined)
  return { message, ballot }
}
