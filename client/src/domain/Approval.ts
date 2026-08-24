/**
 * Approvals -- a storyteller signing off on a character up to a point in its
 * history.
 *
 * Ported from `public/scripts/app/models/Approval.js` and
 * `public/scripts/app/collections/Approvals.js`.
 *
 * Note the className: the model file is `Approval.js` but it registers
 * **"VampireApproval"**, and that is the table. `@/parse/classes` registers
 * `ApprovalObject` under that name; the mismatch between file name and class
 * name is historical and is not a typo to fix.
 *
 * An approval points at the `VampireChange` row it approved up to (`change`),
 * which is how `Character#get_transformed_last_approved` replays the character
 * to its last approved state.
 */
import Parse from '@/parse'
import { ApprovalObject } from '@/parse/classes'

/** An approval record. The registered class for className "VampireApproval". */
export type Approval = ApprovalObject

/** A new, unsaved approval. */
export function createApproval(attributes?: Record<string, unknown>): Approval {
  return new ApprovalObject(attributes)
}

/**
 * The collection's comparator: OLDEST first.
 *
 * Read it carefully before changing anything. It looks like the patronage
 * comparator -- the operands are swapped the same way, `l` from `right` and `r`
 * from `left` -- but the returns are ALSO swapped (`-1` on greater, where
 * patronage returns `1`). Two reversals cancel, so this one is ascending where
 * patronage is descending.
 *
 * That direction is load-bearing: `Character#get_approvals` and
 * `get_transformed_last_approved` read `self.approvals.last()` to find the most
 * recent approval, and `get_approvals` uses `last().createdAt` as the boundary
 * for its incremental fetch. Flip this comparator and the "last approved" state
 * becomes the FIRST approval ever recorded, and the incremental fetch re-reads
 * the whole table forever.
 *
 * `_.gt`/`_.lt` in lodash 3 are plain `>` and `<`. An unsaved approval has no
 * `createdAt`, so it compares equal to everything and keeps its position.
 */
export function compareApprovals(left: Approval, right: Approval): number {
  const l = right.createdAt
  const r = left.createdAt
  if ((l as unknown as number) > (r as unknown as number)) {
    return -1
  } else if ((l as unknown as number) < (r as unknown as number)) {
    return 1
  }
  return 0
}

/** A new array in comparator order: oldest first, so the last entry is newest. */
export function sortApprovals(approvals: readonly Approval[]): Approval[] {
  return [...approvals].sort(compareApprovals)
}

/** Every approval. */
export function approvalQuery(): Parse.Query<Approval> {
  return new Parse.Query(ApprovalObject)
}

/** One character's approvals. */
export function approvalQueryFor(owner: Parse.Object): Parse.Query<Approval> {
  return approvalQuery().equalTo('owner', owner)
}

/**
 * Fetch a character's approvals, incrementally.
 *
 * This is the query half of `Character#get_approvals`. The serialising
 * `_approvalsFetch` queue that wraps it stays on `Character` -- it is a
 * per-character mutex, not a property of approvals.
 *
 * With approvals already held, the query is constrained to
 * `createdAt > (the newest held)`. The source read that boundary off
 * `self.approvals.last()`, which is the newest only because of the comparator
 * above; here it is computed from the list directly so the two cannot drift
 * apart.
 *
 * `each()` rather than `find()`, so it pages past the 100-row default. The
 * source added each row into the collection as it arrived; the merge below is
 * the same thing done to an array, skipping ids already present the way
 * Backbone's `add` did without `merge`.
 */
export async function fetchApprovals(
  owner: Parse.Object,
  existing: readonly Approval[] = [],
): Promise<Approval[]> {
  const query = approvalQueryFor(owner)
  if (existing.length !== 0) {
    const createds = existing
      .map((approval) => approval.createdAt)
      .filter((created): created is Date => created !== undefined)
      .sort((a, b) => a.getTime() - b.getTime())
    const newest = createds[createds.length - 1]
    if (newest !== undefined) {
      query.greaterThan('createdAt', newest)
    }
  }

  const merged = [...existing]
  const seen = new Set(merged.map((approval) => approval.id))
  await query.each((approval) => {
    if (approval.id !== undefined && seen.has(approval.id)) return
    if (approval.id !== undefined) seen.add(approval.id)
    merged.push(approval)
  })
  return sortApprovals(merged)
}
