import { Parse } from '../init';
import type { Character } from '../models/Character';
import { SimpleTrait, fauxTrait } from '../models/SimpleTrait';
import { fetchRecordedChanges } from './recordedChanges';

/**
 * Approvals, and the replay that turns the change timeline back into a
 * character.
 *
 * Ports models/Approval.js, collections/Approvals.js and the block of
 * models/Character.js (:788-:935) that the approval screen and the printable
 * sheet share: `get_approvals`, `get_transformed_last_approved`,
 * `get_transformed`, `get_sorted_skills`, `get_grouped_skills`,
 * `get_willpower_total`, `health_levels` and `archive`.
 *
 * The shape of the whole feature, because none of it is obvious from the names:
 *
 *   VampireChange   one row per edit, holding both the old and the new value.
 *                   `recordedChanges.ts` reads them, oldest first.
 *   VampireApproval one row per "I have looked at this character up to change
 *                   X and it is fine". It points at a single VampireChange.
 *   get_transformed the replay. Handed a list of changes it *undoes* them, in
 *                   the order given, against a clone of the character -- so
 *                   feeding it every change newer than an approval yields the
 *                   character as that approver saw it.
 *
 * Nothing here mutates the real character. `get_transformed` clones first and
 * every write lands on the clone, which is why the approval screen can redraw a
 * different point in history on every slider move without saving anything.
 */

/** The Parse class approvals live in. Not "Approval" -- the file name lies. */
export const APPROVAL_CLASS = 'VampireApproval';

/* ------------------------------------------------------------ approvals -- */

/**
 * A character's approvals, oldest first.
 *
 * That order is collections/Approvals.js's comparator, which is written
 * inside-out (`l = right.createdAt; r = left.createdAt`) and therefore sorts
 * *ascending* despite reading like a descending one. Everything downstream
 * depends on it: `approvals.last()` is the newest approval, and the approvals
 * slider's index is a position in this list.
 */
export function sortApprovals(approvals: Parse.Object[]): Parse.Object[] {
  return [...approvals].sort((left, right) => {
    const l = right.createdAt?.getTime() ?? 0;
    const r = left.createdAt?.getTime() ?? 0;
    return l > r ? -1 : l < r ? 1 : 0;
  });
}

export function approvalsQuery(character: Character): Parse.Query {
  return new Parse.Query(APPROVAL_CLASS).equalTo('owner', character);
}

/**
 * Fetch approvals, or only the ones recorded since the list already held.
 *
 * Ports `get_approvals`, whose incremental branch is
 * `greaterThan("createdAt", self.approvals.last().createdAt)` -- the *last*
 * element, because the collection is oldest-first. `each` rather than `find`
 * for the same reason it is used everywhere else in this app: it pages past the
 * query limit instead of silently truncating.
 *
 * The legacy version chains onto `self._approvalsFetch` with `.always()` so two
 * overlapping calls cannot double-add into the shared collection. There is no
 * shared collection here -- the list is passed in and returned, held in React
 * state -- so the last call to resolve simply wins.
 */
export async function fetchApprovals(
  character: Character,
  known: Parse.Object[] = [],
): Promise<Parse.Object[]> {
  const query = approvalsQuery(character);
  const newest = known[known.length - 1];
  if (newest) query.greaterThan('createdAt', newest.createdAt);

  const found: Parse.Object[] = [];
  await query.each((approval) => {
    found.push(approval);
  });
  return sortApprovals([...known, ...found]);
}

/**
 * Record an approval of one change.
 *
 * Ports `EditView.approve_change`. One click is one row pointing at one
 * VampireChange, however wide the range on screen -- the sliders choose *which*
 * change is approved, not how many.
 *
 * No ACL is set here, deliberately: `beforeSave("VampireApproval")` in
 * cloud/main.js decides who may write one at all, and it genuinely refuses some
 * -- a player approving their own character, an approver with no Storyteller
 * role for the troupe. The caller must have a failure handler; without one the
 * refusal has nowhere to go and the button silently does nothing.
 */
export function approveChange(character: Character, change: Parse.Object): Promise<Parse.Object> {
  const Approval = Parse.Object.extend(APPROVAL_CLASS);
  const approval = new Approval();
  approval.set({
    approved: true,
    change,
    approver: Parse.User.current(),
    owner: character,
  });
  return approval.save();
}

/** The five columns templates/character-approval-edit.html prints. */
export const APPROVAL_HEADERS = [
  'createdAt',
  'approved',
  'change',
  'approver',
  'owner',
] as const;

export type ApprovalHeader = (typeof APPROVAL_HEADERS)[number];

/**
 * One cell of the approval table.
 *
 * Ports `EditView.format_approval`, whose three branches are:
 *
 *   the attribute, if there is one            -- `approved` is `true`
 *   otherwise the property of the same name   -- `createdAt` is not an
 *                                                attribute in parse@8, it is a
 *                                                property, so this is the only
 *                                                column that takes this path
 *   the id, if the value is a pointer         -- `change`, `approver`, `owner`
 *
 * The pointer branch is why the "approver" column shows an object id rather
 * than a username, which e2e/approvals.spec.js calls out as a defect of the
 * plan's wording rather than of the code: nothing here ever fetches the user.
 */
export function formatApproval(approval: Parse.Object, header: ApprovalHeader): string {
  const attribute = approval.get(header) as unknown;
  const value =
    attribute === undefined
      ? (approval as unknown as Record<string, unknown>)[header]
      : attribute;
  if (value && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id);
  }
  // `<%= %>` stringifies; a Date lands here as its full toString(), which is
  // what the legacy table prints in the createdAt column.
  return value === undefined || value === null ? '' : String(value);
}

/* ------------------------------------------------------------- transform -- */

/**
 * One line of `transform_description`: what undoing a change did.
 *
 * The `type` strings are the template's vocabulary and are not the change
 * row's `type`. A change of type "define" -- the trait was created -- undoes to
 * a description of type "define" meaning "this trait did not exist yet"; a
 * change of type "remove" undoes to type "removed", carrying the trait back.
 */
export interface TransformEntry {
  category: string;
  name: string;
  /** The trait as it was before the change. Absent when it did not yet exist. */
  fake?: SimpleTrait;
  type: 'changed' | 'define' | 'removed' | 'update';
  /** Core (text attribute) rows only. */
  old_text?: string;
}

/** A character reconstructed at some point in the past, and how it got there. */
export interface TransformedCharacter {
  /** A clone. Never the real row, and never saved. */
  character: Character;
  /** One entry per change replayed, in the order they were replayed. */
  description: TransformEntry[];
}

/**
 * A trait the sheet should draw struck through: it existed then, not now.
 *
 * `trait.fake.is_deleted = true` in CharacterApprovalView.js:336, read back as
 * a plain property (`if (!skill.is_deleted)`) by helpers/VampirePrintHelper.js.
 * A Parse attribute would not do: this must never reach the server, and these
 * faux traits are display-only.
 */
export function markDeleted(trait: SimpleTrait): void {
  (trait as unknown as { is_deleted?: boolean }).is_deleted = true;
}

export function isDeleted(trait: SimpleTrait): boolean {
  return (trait as unknown as { is_deleted?: boolean }).is_deleted === true;
}

/**
 * Rewind a character by undoing a list of changes.
 *
 * Ports `get_transformed`, the ~90 lines both the approval screen and the
 * printable sheet render from. Handed `changes` it walks them in order and
 * applies each one's *old* side to a clone, so the result is the character as
 * it stood before the first change in the list was made. Callers therefore pass
 * changes newest-first: `takeRightWhile(...).reverse()`.
 *
 * Two things in the original look like mistakes and are kept:
 *
 * **`old_value || value`, `old_cost || cost`, `old_text || name`.** These are
 * truthiness fallbacks, so a genuine recorded *old value of 0* falls through to
 * the new value and the rewind shows the trait at its post-change rating. It is
 * the difference between "this trait was at 0" and "this change did not record
 * an old value", which the row cannot express, and the original resolves it
 * this way. Changing it here would silently alter every historical sheet.
 *
 * **The `undefined` guard in the lookup.** When the change names a trait the
 * character no longer has, `current` is undefined -- and `_.xor` then treats
 * undefined as a member of the second array and *appends it* to the category.
 * That is the source of "Something went wrong fetching the full character
 * object and now a name is undefined", which the original logs on the next pass
 * over the same array. Reproduced, log and all: a category array holding an
 * undefined entry is a state the print helper already copes with, and dropping
 * the entry would change which traits the sheet draws.
 *
 * `this.troupes.parent = null` from the original does **not** come across, and
 * that is measured rather than assumed. It works around Backbone-era `clone()`
 * handing the copy the *same* Parse.Relation object, whose parent then pointed
 * at the clone and broke the original. parse@8's `set` rebuilds a relation
 * against its new parent on assignment (ParseObject.js: `changes[k] instanceof
 * ParseRelation` -> `new ParseRelation(this, k)`), and `clone()` is
 * `clone.set(this.attributes)`, so the two objects no longer share one relation.
 */
export function getTransformed(
  character: Character,
  changes: Parse.Object[],
): TransformedCharacter {
  const c = character.clone() as Character;
  const description: TransformEntry[] = [];

  for (const change of changes) {
    const category = change.get('category') as string;
    const type = change.get('type') as string;

    if (category === 'experience') {
      // Belt and braces with `recordedChangesQuery`, which already excludes
      // these: an XP notation is neither a trait nor a text attribute, so there
      // is nothing here to replay onto the character. Without both guards the
      // replay manufactures a trait in a category no venue has and the approval
      // screen never finishes rendering.
      continue;
    }

    if (category !== 'core') {
      const traits = (c.get(category) as SimpleTrait[] | undefined) ?? [];
      const current = traits.find((trait) => {
        if (trait === undefined) {
          console.log(
            'Something went wrong fetching the full character object and now a name is undefined',
          );
          return false;
        }
        return trait.get('name') === change.get('name');
      });

      const trait = fauxTrait({
        name: change.get('old_text') || change.get('name'),
        free_value: change.get('free_value'),
        value: change.get('old_value') || change.get('value'),
        cost: change.get('old_cost') || change.get('cost'),
        category,
      });

      if (type === 'update') {
        // Swap the current trait for the old-valued one.
        c.set(category, xor(traits, [current, trait]));
        description.push({ category, name: change.get('name') as string, fake: trait, type: 'changed' });
      } else if (type === 'define') {
        // The change created this trait, so before it there was none.
        c.set(category, without(traits, current));
        description.push({ category, name: trait.name, type: 'define' });
      } else if (type === 'remove') {
        // The change deleted this trait, so before it the trait was there.
        c.set(category, union(traits, [trait]));
        description.push({ category, name: trait.name, fake: trait, type: 'removed' });
      }
      continue;
    }

    const name = change.get('name') as string;
    if (type === 'core_define') {
      // The attribute did not exist before this change.
      c.set(name, undefined);
      description.push({ category, name, old_text: undefined, type: 'define' });
    } else if (type === 'core_update') {
      c.set(name, change.get('old_text'));
      description.push({
        category,
        name,
        old_text: change.get('old_text') as string,
        type: 'update',
      });
    }
  }

  return { character: c, description };
}

/**
 * The character as the last approver saw it, or null if nobody has approved it.
 *
 * Ports `get_transformed_last_approved`. `takeRightWhile` collects every change
 * *newer* than the approved one -- the list is oldest-first, so that is a run
 * from the end -- and reversing it puts the newest first, which is the order
 * `getTransformed` undoes in.
 *
 * The null is not an error case and callers must not treat it as one:
 * `character_show_approved` swaps to `#character-print-no-approval` on it,
 * which reads "No approved versions of your character". There is no creation
 * baseline snapshot to fall back to.
 *
 * When the approved change is not in the timeline at all -- it was an
 * `experience` row, which `recordedChangesQuery` filters out -- the predicate
 * never matches and the whole timeline is undone, rewinding to creation. That
 * is the original's behaviour too, and it is the second reason XP rows are kept
 * out of the timeline rather than merely skipped during replay.
 */
export async function transformedLastApproved(
  character: Character,
): Promise<TransformedCharacter | null> {
  const approvals = await fetchApprovals(character);
  const changes = await fetchRecordedChanges(character);
  const last = approvals[approvals.length - 1];
  if (!last) return null;

  const approvedChangeId = (last.get('change') as Parse.Object | undefined)?.id;
  const toUndo = takeRightWhile(changes, (change) => change.id !== approvedChangeId).reverse();
  return getTransformed(character, toUndo);
}

/** What the approval screen hands its sheet: a character, a range, and a diff. */
export interface TransformedRange extends TransformedCharacter {
  /**
   * The character as it stood *before* the left-hand change -- the "from" side
   * of the comparison. The sheet draws `character`; this is what the
   * description was computed against.
   */
  described: Character;
}

/**
 * The character as at `right`, annotated with everything that happened between
 * `left` and `right`.
 *
 * Ports `LayoutView.update_override_character_and_transform`, which is the
 * piece that makes the two sliders mean something. It runs the replay twice:
 *
 *   once to `right`  -- undo every change *after* the right-hand one, giving
 *                       the character as that change left it. This is the sheet.
 *   once to `left`   -- undo every change from `left` to the end, giving the
 *                       character as it stood before the range began. Its
 *                       description is the running commentary, newest first, and
 *                       `takeRight(..., right + 1 - left)` keeps the oldest
 *                       `right - left + 1` entries of it, which are exactly the
 *                       changes in [left, right].
 *
 * Then every "removed" entry is put *back* onto the sheet with `is_deleted`
 * set, so a trait deleted inside the range is drawn struck through rather than
 * simply missing.
 *
 * `takeRightWhile(changes, (_, i) => i !== left - 1)` is the original's way of
 * saying "from index `left` to the end"; with `left` 0 the predicate never
 * matches and it takes everything, which is correct.
 *
 * **The empty-timeline guard is an addition.** The original reads
 * `recorded_changes.at(right).id` with `right` of -1 for a character with no
 * non-XP changes, throws `Cannot read properties of undefined (reading 'id')`,
 * and the route's `.fail(PromiseFailReport)` leaves you on whatever page you
 * were on with only a console line -- so `#character/:cid/approval` cannot be
 * opened at all for a freshly created character. Measured against the running
 * app on 2026-08-22 with a character whose only change row was its creation XP.
 * Here the id falls back to null, no change matches it, and the whole timeline
 * (which is empty) is undone -- the character as at creation.
 */
export function transformedForRange(
  character: Character,
  changes: Parse.Object[],
  left: number,
  right: number,
): TransformedRange {
  const rightId = changes[right]?.id ?? null;
  const toRight = takeRightWhile(changes, (change) => change.id !== rightId).reverse();
  const sheet = getTransformed(character, toRight);

  const fromLeft = takeRightWhile(changes, (_change, index) => index !== left - 1).reverse();
  const described = getTransformed(character, fromLeft);
  const description = takeRight(described.description, right + 1 - left);

  for (const entry of description) {
    if (entry.type !== 'removed' || !entry.fake) continue;
    markDeleted(entry.fake);
    const traits = (sheet.character.get(entry.category) as SimpleTrait[] | undefined) ?? [];
    sheet.character.set(entry.category, union(traits, [entry.fake]));
  }

  return { character: sheet.character, description, described: described.character };
}

/* ---------------------------------------------------------- sheet parts -- */

/**
 * The character's skills, by name.
 *
 * `_.sortBy(skills, "attributes.name")` -- a deep path into the Parse
 * attribute bag, which is the same thing as the trait's `name`.
 */
export function sortedSkills(character: Character): SimpleTrait[] {
  const skills = (character.get('skills') as SimpleTrait[] | undefined) ?? [];
  return [...skills].sort((left, right) => {
    const l = left?.name ?? '';
    const r = right?.name ?? '';
    return l > r ? 1 : l < r ? -1 : 0;
  });
}

/**
 * Skills dealt into three columns and then read back row by row.
 *
 * Ports `get_grouped_skills`. It cuts the sorted list into `columnCount`
 * consecutive blocks of `ceil(n / columnCount)` and zips them, so the result is
 * a list of rows, each row holding one skill per column and `undefined` where a
 * column has run out -- which is why templates/print/skills.html tests
 * `if (skill)` before drawing a block.
 *
 * `columnCount` is a lie in the original: the accumulator is initialised as
 * `{0: [], 1: [], 2: []}` and the zip is written out as
 * `_.zip(groupedSkills[0], groupedSkills[1], groupedSkills[2])`, so any value
 * other than 3 slices the list into the wrong number of blocks and then throws
 * away everything past the third. Both call sites pass 3 or nothing. Kept as
 * the parameter it is, with the fixed zip, because a caller passing 4 must lose
 * the fourth column here exactly as it does there.
 */
export function groupedSkills(
  skills: SimpleTrait[],
  columnCount = 3,
): (SimpleTrait | undefined)[][] {
  const shift = Math.ceil(skills.length / columnCount);
  const columns: (SimpleTrait | undefined)[][] = [];
  let rest = skills;
  for (let i = 0; i < columnCount; i++) {
    columns.push(rest.slice(0, shift));
    rest = rest.slice(shift);
  }
  const [first = [], second = [], third = []] = columns;
  const rows: (SimpleTrait | undefined)[][] = [];
  const height = Math.max(first.length, second.length, third.length);
  for (let i = 0; i < height; i++) rows.push([first[i], second[i], third[i]]);
  return rows;
}

/**
 * The willpower the character has, and what the printed sheet draws.
 *
 * Ports `get_willpower_total`, which sums `willpower_sources` with lodash's
 * iteratee shorthand:
 *
 *     var total = _.sum(wps, "attributes.value");
 *
 * That shorthand exists in lodash 3 and was removed in lodash 4, where the
 * second argument is ignored and `_.sumBy` took over -- so which lodash the app
 * loads decides whether this works at all. It loads the VENDORED one:
 * `public/scripts/app.js` maps the AMD name `underscore` to
 * `public/scripts/lib/lodash.js`, which is 3.10.0, and the shorthand works
 * there. Measured in the running app: `_.VERSION` is "3.10.0",
 * `_.sum([{attributes:{value:3}},{attributes:{value:4}}], "attributes.value")`
 * is 7, and `_.sumBy` does not exist.
 *
 * An earlier version of this file claimed the opposite -- that every printed
 * sheet had shown zero willpower boxes since a lodash 4 upgrade -- and added a
 * `willpowerBoxCount` returning 0 to "reproduce" it. That was measured against
 * node_modules' lodash 4 rather than the vendored 3 the browser loads, and
 * would have shipped a printable sheet with the willpower track missing.
 */
export function willpowerTotal(character: Character): number {
  const sources = (character.get('willpower_sources') as SimpleTrait[] | undefined) ?? [];
  return sources.reduce((total, source) => total + (source?.value ?? 0), 0);
}

/**
 * Kept as a name the print sheet can call, now identical to `willpowerTotal`.
 *
 * It exists because the sheet used to need a second, deliberately-wrong count;
 * see the note above for why it does not.
 */
export function willpowerBoxCount(character: Character): number {
  return willpowerTotal(character);
}

/**
 * Health levels in track order, whether or not the character has them.
 *
 * Ports `health_levels`. The order is fixed -- Healthy, Injured, Incapacitated
 * -- and comes from the hard-coded list, not from the stored traits, so a
 * character missing one still prints the label with no boxes beside it. The
 * value is `undefined` in that case, and templates/print/health-levels.html
 * feeds it to `_.range(_.parseInt(undefined))`, which is an empty range.
 */
export function healthLevels(character: Character): [string, number | undefined][] {
  const order = ['Healthy', 'Injured', 'Incapacitated'];
  const values = new Map<string, number>();
  for (const level of (character.get('health_levels') as SimpleTrait[] | undefined) ?? []) {
    if (level) values.set(level.get('name') as string, level.get('value') as number);
  }
  return order.map((name) => [name, values.get(name)]);
}

/**
 * Retire a character by taking its owner away.
 *
 * Ports `archive`. The row is not deleted: unsetting `owner` drops it out of
 * every listing, which all filter on the current user, while leaving the
 * history and the traits intact. views/CharacterDeleteView.js is the only
 * caller, and "Delete" in this application has always meant this.
 */
export async function archiveCharacter(character: Character): Promise<Character> {
  character.unset('owner');
  return character.save() as Promise<Character>;
}

/* ------------------------------------------------------ lodash, in kind -- */
/*
 * The four lodash functions `get_transformed` and its caller are written in
 * terms of. Reproduced rather than imported because their exact semantics --
 * including what they do with an `undefined` member, which is the case that
 * matters here -- are the behaviour being ported.
 */

/** `_.xor`: members of exactly one of the two arrays, unique, first array first. */
function xor<T>(left: readonly (T | undefined)[], right: readonly (T | undefined)[]): (T | undefined)[] {
  const onlyLeft = left.filter((item) => !right.includes(item));
  const onlyRight = right.filter((item) => !left.includes(item));
  return [...new Set([...onlyLeft, ...onlyRight])];
}

/** `_.without`: every member that is not this one. */
function without<T>(array: readonly T[], excluded: T | undefined): T[] {
  return array.filter((item) => item !== excluded);
}

/** `_.union`: the two arrays concatenated, uniquely. */
function union<T>(left: readonly T[], right: readonly T[]): T[] {
  return [...new Set([...left, ...right])];
}

/** `_.takeRightWhile`: the longest run at the end for which the test holds. */
function takeRightWhile<T>(array: readonly T[], test: (item: T, index: number) => boolean): T[] {
  let index = array.length;
  while (index > 0 && test(array[index - 1]!, index - 1)) index--;
  return array.slice(index);
}

/** `_.takeRight`: the last `count`, or nothing at all for a count of zero or less. */
function takeRight<T>(array: readonly T[], count: number): T[] {
  return count <= 0 ? [] : array.slice(Math.max(0, array.length - count));
}
