import { Parse } from '../init';

/**
 * The `Description` class and the five rule classes that share its editor.
 *
 * Ports models/Description.js, models/BNSMETV1_ClanRule.js,
 * models/BNSCTDBS_KithRule.js and the data half of views/DescriptionsView.js
 * and views/EditRules.js.
 *
 * `Description` is the app's lookup table: 1587 rows, keyed by
 * (`category`, `name`), read through `helpers/DescriptionFetcher.js` by every
 * picker in the character sheet. The five `bnsmetv1_*` / `bnsctdbs_*` rule
 * classes are separate tables with the same shape, and six admin routes edit
 * all six through one bulk-CSV screen.
 *
 * The legacy collections are not ported. `DescriptionCollection` is a
 * Parse.Collection with an incremental `fetch` (ask only for rows newer than
 * the newest one held) and a `fetch_avoiding_wait` that returns immediately
 * when anything is cached -- that is a query cache written by hand, and React
 * has one. `BNSMETV1_ClanRules.get_in_clan_disciplines` and
 * `BNSCTDBS_KithRules.get_arts_affinities` are character-sheet lookups, not
 * admin-screen code; they belong with whichever screen ports the sheet.
 */

export class Description extends Parse.Object {
  constructor() {
    super('Description');
  }
}

Parse.Object.registerSubclass('Description', Description);

/**
 * The Parse class each of the six admin handlers edits.
 *
 * `administration_descriptions` goes through DescriptionsView, the other five
 * through EditRules with `update_rule_name(...)`. One page, six tables.
 */
export const CLASS_FOR_HANDLER: Record<string, string> = {
  administration_descriptions: 'Description',
  administration_bnsctdbs_kith_rules: 'bnsctdbs_KithRule',
  administration_bnsmetv1_clan_rules: 'bnsmetv1_ClanRule',
  administration_bnsmetv1_elder_discipline_rules: 'bnsmetv1_ElderDisciplineRule',
  administration_bnsmetv1_technique_rules: 'bnsmetv1_TechniqueRule',
  administration_bnsmetv1_ritual_rules: 'bnsmetv1_RitualRule',
};

/**
 * The columns that actually identify a row, per class. EditRules.js:35.
 *
 * The comment there explains why this is not `["category", "name"]` for every
 * class, and it is worth repeating: `bnsmetv1_ClanRule` rows carry neither
 * column, so that query resolved to "category does not exist AND name does not
 * exist", which every row matches -- an edit landed on whichever row Parse
 * happened to return first.
 */
export const IDENTITY_COLUMNS: Record<string, string[]> = {
  bnsmetv1_ClanRule: ['clan'],
  bnsctdbs_KithRule: ['category', 'name'],
  bnsmetv1_ElderDisciplineRule: ['name'],
  bnsmetv1_TechniqueRule: ['name'],
  bnsmetv1_RitualRule: ['name'],
  Description: ['category', 'name'],
};

export function identityColumns(className: string): string[] {
  return IDENTITY_COLUMNS[className] ?? ['category', 'name'];
}

/** One CSV row: every cell is a string, because it came out of a textarea. */
export type CsvRow = Record<string, string>;

/** A row as the editor loads it: whatever Parse holds, minus the ACL. */
export type LoadedRow = Record<string, unknown>;

/**
 * The public-read / Administrator-write ACL both submit handlers stamp on
 * every row they touch, new or existing.
 */
export function adminAcl(): Parse.ACL {
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(true);
  acl.setPublicWriteAccess(false);
  acl.setRoleReadAccess('Administrator', true);
  acl.setRoleWriteAccess('Administrator', true);
  return acl;
}

/**
 * The distinct `category` values in a class, as the select's options.
 *
 * `update_categories` accumulates them into a plain object keyed by the value,
 * so a class whose rows have no `category` at all -- all five rule classes
 * except `bnsctdbs_KithRule` -- yields the single string key `"undefined"`.
 * That option is then unusable, because picking it queries for the literal
 * string; "All" is the only one that shows anything. Reproduced, because it is
 * what the screen does today and e2e/helpers/rules.js documents it as the
 * reason its own helpers always select "All".
 *
 * Sorted by label with lodash's default comparator -- bare `<`/`>` on the
 * strings, so code-unit order -- and then "All" is appended, which is why it
 * sorts last rather than first.
 */
export async function loadCategories(className: string): Promise<string[]> {
  const categories = new Set<string>();
  const query = new Parse.Query<Parse.Object>(className);
  query.select('category');
  await query.each((row) => {
    categories.add(String(row.get('category')));
  });
  const sorted = [...categories].sort((l, r) => (l > r ? 1 : l < r ? -1 : 0));
  sorted.push('All');
  return sorted;
}

/**
 * Every row of a category, in the order the CSV shows them.
 *
 * `filterwith` in both views: query the class (unfiltered for "All"), page
 * through it with `each`, keep `attributes` minus the ACL, then sort by
 * category, order, name.
 */
export async function loadRows(className: string, category: string): Promise<LoadedRow[]> {
  const query = new Parse.Query<Parse.Object>(className);
  if (category !== 'All') query.equalTo('category', category);

  const rows: LoadedRow[] = [];
  await query.each((row) => {
    const { ACL: _acl, ...rest } = row.attributes as LoadedRow;
    rows.push(rest);
  });

  return rows.sort(
    (l, r) => compare(l.category, r.category) || compare(l.order, r.order) || compare(l.name, r.name),
  );
}

/**
 * lodash 3's `compareAscending`, which is what `_.sortByAll` uses.
 *
 * The part that is not obvious: a missing value sorts *after* every present
 * one, and null sorts after everything except undefined. Rule rows have no
 * `category` and usually no `order`, so nearly every comparison here is
 * between two undefineds and the sort falls through to `name`.
 */
function compare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left as number) > (right as number) ? 1 : (left as number) < (right as number) ? -1 : 0;
}

/** The column order of the CSV: every key any row has, first-seen first. */
export function columnsOf(rows: LoadedRow[]): string[] {
  const fields: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!fields.includes(key)) fields.push(key);
    }
  }
  return fields;
}

export type FieldType = 'number' | 'boolean' | 'string';

/**
 * Column name -> type, learned from rows that already exist. EditRules.js:22.
 *
 * Everything arrives from the textarea as a string, and sending a string to a
 * Number column is a 400. Parse Server's schema endpoint needs the master key,
 * so it is not reachable from a browser; sampling live rows is. Columns no
 * sampled row has a value for stay strings.
 *
 * DescriptionsView has no equivalent -- it coerces the literal column `order`
 * and nothing else -- so this is only used by the five rule editors.
 */
export async function learnFieldTypes(className: string): Promise<Record<string, FieldType>> {
  const types: Record<string, FieldType> = {};
  const rows = await new Parse.Query<Parse.Object>(className).limit(200).find();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.attributes as LoadedRow)) {
      if (key in types) continue;
      const type = typeOf(value);
      if (type) types[key] = type;
    }
  }
  return types;
}

function typeOf(value: unknown): FieldType | undefined {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return undefined;
}

/** EditRules' `coerce_field`. `undefined` means "do not write this column". */
export function coerceField(
  key: string,
  value: string,
  types: Record<string, FieldType>,
  existing: Parse.Object | undefined,
): unknown {
  if (value === undefined || value === null || value === '') return undefined;

  // What the row itself already holds beats the sample.
  let type = typeOf(existing?.get(key)) ?? types[key];
  if (key === 'order') type = 'number';

  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'boolean') {
    const s = String(value).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return value;
}

/**
 * Both submit handlers' `_.omit(d, predicate)`.
 *
 * lodash 3's `_.omit` predicate is `(value, key)`, and both views named the
 * parameter `key` and then compared it against `["name", "category"]` and
 * `""`. So what is actually dropped is any cell whose *value* is the empty
 * string or the literal text "name" or "category" -- not the name and category
 * columns, which is plainly what was meant.
 *
 * EditRules.js:186 spells this out and keeps it, because dropping blank cells
 * is what stops an empty column from clearing a field or 400ing a numeric one.
 * That accident is now load-bearing, so it stays here too.
 */
export function omitBlankish(row: CsvRow): CsvRow {
  const kept: CsvRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === '' || value === 'name' || value === 'category') continue;
    kept[key] = value;
  }
  return kept;
}

/**
 * The query that decides update-vs-insert, or `undefined` when the submitted
 * row carries no usable identity -- in which case it is a new row, not a
 * licence to overwrite an arbitrary existing one. EditRules.js:52.
 */
function identityQuery(className: string, row: CsvRow): Parse.Query<Parse.Object> | undefined {
  const query = new Parse.Query<Parse.Object>(className);
  let usable = true;
  for (const column of identityColumns(className)) {
    const value = row[column];
    if (value === undefined || value === null || value === '') {
      usable = false;
      continue;
    }
    query.equalTo(column, value);
  }
  return usable ? query : undefined;
}

/**
 * Save one submitted CSV row into one of the five rule classes.
 *
 * EditRules' DataForm submit, per row. Rejects if the save does; the caller
 * reports once for the whole submission, which is the point of EditRules.js:203
 * -- swallowing the failure here is what made a 404ing save look like a
 * successful one.
 */
export async function saveRuleRow(
  className: string,
  row: CsvRow,
  types: Record<string, FieldType>,
): Promise<void> {
  const columns = identityColumns(className);
  const label = columns.map((c) => row[c]).join(' ');
  const query = identityQuery(className, row);
  let target = query ? await query.first() : undefined;

  if (!target) {
    target = new Parse.Object(className);
    for (const column of columns) {
      if (row[column] !== undefined) target.set(column, row[column]);
    }
    console.log("Didn't find existing object for " + label);
  } else {
    console.log('Found existing object for ' + label);
  }

  target.setACL(adminAcl());
  for (const [key, value] of Object.entries(omitBlankish(row))) {
    const coerced = coerceField(key, value, types, target);
    if (coerced !== undefined) target.set(key, coerced);
  }
  await target.save();
}

/**
 * Save one submitted CSV row into `Description`.
 *
 * DescriptionsView's own submit handler, which was never given EditRules'
 * repairs and is deliberately left as it is:
 *
 * - the lookup is built unconditionally, so a row with no `category` or `name`
 *   queries for "that column does not exist" and can adopt an unrelated row;
 * - only `order` is coerced, with `_.parseInt`, so every other column is sent
 *   as a string;
 * - a failed save is logged and swallowed, so the submission as a whole always
 *   looks like it worked.
 *
 * Fixing any of these is a behaviour change, not a port, and the Description
 * table is the one every character-sheet picker reads.
 */
export async function saveDescriptionRow(row: CsvRow): Promise<void> {
  const query = new Parse.Query<Parse.Object>('Description')
    .equalTo('category', row.category)
    .equalTo('name', row.name);
  let target = await query.first();

  if (!target) {
    target = new Description();
    target.set('name', row.name);
    target.set('category', row.category);
    console.log("Didn't find existing object for " + row.category + ' ' + row.name);
  } else {
    console.log('Found existing object for ' + row.category + ' ' + row.name);
  }

  target.setACL(adminAcl());
  for (const [key, value] of Object.entries(omitBlankish(row))) {
    target.set(key, key === 'order' ? parseInt(value, 10) : value);
  }

  try {
    await target.save();
  } catch (error) {
    // `.fail(function (e) { console.log(e); ... })` with no rethrow, in
    // DescriptionsView.js:92. The chain resolves either way.
    console.log(error);
    console.log('Error on saving disguy? ' + target.id + ' ' + row.name);
  }
}
