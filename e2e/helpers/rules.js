/**
 * Game-rule editor helpers (`#administration/bnsmetv1_clan_rules` and its
 * four siblings).
 *
 * These five classes are edited through the exact same bulk-CSV admin
 * mechanism as the Description class - see the file-level comment in
 * descriptions.js for how that mechanism works and the cross-route staleness
 * defect it requires guarding against. This module adds only what is
 * specific to the five rule classes: which class backs which route, and two
 * confirmed defects specific to *this* class of admin view (as opposed to
 * DescriptionsView.js, which does not share them).
 *
 * ---
 *
 * **DEFECT (blocks every "add a new rule" test in admin-rules.spec.js).**
 * `EditRules.js`'s `DataForm.events.submit` handler, in the branch that runs
 * when the update-vs-insert lookup finds nothing (i.e. every genuine "add a
 * new row"):
 *
 * ```js
 * if (!toupdate) {
 *     toupdate = new Parse.Object(self.ruleName, {
 *         name: d.name,
 *         category: d.category
 *     });
 * ```
 *
 * `self` here is the `DataForm` Backform view (`this` inside the submit
 * handler). It never has a `.ruleName` property - the correctly-populated
 * value lives in the *module-scoped* `ruleName` variable declared at the top
 * of the file, set by `View.update_rule_name()`, and used correctly two lines
 * earlier in this same function for the lookup query
 * (`new Parse.Query(ruleName)...`). The create branch should read that same
 * `ruleName`, not `self.ruleName`.
 *
 * Because `self.ruleName` is `undefined`, and the base `Parse.Object`
 * constructor's actual signature is `(attributes, options)` - the
 * `new Parse.Object("ClassName", data)` shorthand only works when the first
 * argument is a *string*, via an explicit `_.isString(attributes)` check that
 * delegates to `Parse.Object._create` - passing `undefined` skips that
 * shortcut entirely. The call is instead interpreted positionally against the
 * real constructor signature: the first argument (`undefined`) becomes
 * `attributes`, defaulting to `{}`, and the second argument (the row's real
 * data - name, category, and everything else) is bound to `options` instead
 * and never applied. No class name is ever set anywhere. Saving a class-less
 * object produces a malformed REST call - confirmed live via the
 * network log: `POST /parse/1/classes` (no class-name segment) -> `404`.
 * `DataForm`'s own `.fail(function (e) { console.log(e); ... })` swallows
 * that error and the outer `Parse.Promise.when(promises).then(...)` still
 * logs "Saved all of that" - nothing is surfaced anywhere in the DOM. A test
 * that only checks "did the form look like it submitted" would be fooled.
 *
 * This reproduces identically for all five rule classes (the code path has
 * no per-class branching) - confirmed live for `bnsmetv1_ClanRule`,
 * `bnsctdbs_KithRule`, and `bnsmetv1_TechniqueRule` via direct before/after
 * Parse counts and REST-log inspection.
 *
 * ---
 *
 * **SEPARATE DEFECT (blocks edits of most numeric fields).** The same submit
 * handler sets every CSV column verbatim as the string Papa Parse produces
 * (`Papa.parse(..., { header: true })` is never given `dynamicTyping: true`),
 * special-casing only the literal column name `"order"` for `_.parseInt`.
 * Any *other* schema field typed `"number"` - `bnsmetv1_ClanRule`'s
 * `default_cost`/`camarilla_cost`/`sabbat_cost`, `bnsmetv1_TechniqueRule`'s
 * `prerequisite_N_level`, `bnsmetv1_RitualRule`'s `level`, etc. - fails
 * server-side with a schema-mismatch 400 ("expected Number but got String",
 * Parse error code 111) the moment an edit that includes it is submitted.
 * Confirmed live. Editing a row via a CSV row that only touches string-typed
 * fields (or the specially-handled `order`) is unaffected.
 *
 * ---
 *
 * **THIRD DEFECT, specific to `bnsmetv1_ClanRule` only.** Unlike the other
 * four classes, `bnsmetv1_ClanRule` has neither a `name` nor a `category`
 * field in its schema (confirmed against `database_seed/_SCHEMA.json` and
 * live data: 0 of 42 seeded rows have either). The submit handler's
 * update-vs-insert lookup is unconditionally `.equalTo("category",
 * d.category).equalTo("name", d.name)`. Since Parse's `equalTo(key,
 * undefined)` becomes `doesNotExist(key)`, and *every* ClanRule row satisfies
 * `doesNotExist("category") AND doesNotExist("name")` identically, this query
 * cannot distinguish between clans at all - `.first()` deterministically
 * returns whichever row Parse's default ordering happens to put first
 * (empirically and stably "Assamite: Sorcerer" against this seed) no matter
 * which clan the submitted row is actually about. There is no way, through
 * this UI, to choose *which* clan rule an edit targets.
 */

const {
  openAdminBulkEditor,
  submitBulkEditorRow,
  readBulkEditorRows,
  selectBulkEditorCategory
} = require('./descriptions');

/** Route hash and backing Parse class for each of the five rule editors. */
const RULE_CLASSES = {
  clan: {
    hash: 'administration/bnsmetv1_clan_rules',
    className: 'bnsmetv1_ClanRule',
    // Neither field exists on this class - see the third defect above.
    hasNameAndCategory: false
  },
  kith: {
    hash: 'administration/bnsctdbs_kith_rules',
    className: 'bnsctdbs_KithRule',
    hasNameAndCategory: true
  },
  elderDiscipline: {
    hash: 'administration/bnsmetv1_elder_discipline_rules',
    className: 'bnsmetv1_ElderDisciplineRule',
    hasNameAndCategory: false // has `name`, no `category`
  },
  technique: {
    hash: 'administration/bnsmetv1_technique_rules',
    className: 'bnsmetv1_TechniqueRule',
    hasNameAndCategory: false // has `name`, no `category`
  },
  ritual: {
    hash: 'administration/bnsmetv1_ritual_rules',
    className: 'bnsmetv1_RitualRule',
    hasNameAndCategory: false // has `name`, no `category`
  }
};

function resolveRuleKey(ruleKey) {
  const cfg = RULE_CLASSES[ruleKey];
  if (!cfg) {
    throw new Error(`Unknown rule key "${ruleKey}". Expected one of: ${Object.keys(RULE_CLASSES).join(', ')}`);
  }
  return cfg;
}

/** Navigate to one of the five rule editors (always a fresh reload - see descriptions.js). */
async function openRuleEditor(page, ruleKey) {
  const cfg = resolveRuleKey(ruleKey);
  await openAdminBulkEditor(page, cfg.hash);
  return cfg;
}

/** Select a category in the currently-open rule editor (e.g. "All"). */
async function selectRuleCategory(page, label) {
  await selectBulkEditorCategory(page, label);
}

/** Read the currently-open rule editor's textarea as structured rows. */
async function readRuleTableRows(page) {
  return readBulkEditorRows(page);
}

/**
 * Type a single minimal row into a rule editor and submit it - real UI
 * interaction end to end. Navigates first. `fields` becomes exactly one CSV
 * data row; nothing else in the class is touched (see the file-level comment
 * for why resubmitting a whole "All" listing is unsafe for these classes).
 */
async function submitRuleRow(page, ruleKey, fields) {
  const cfg = resolveRuleKey(ruleKey);
  await submitBulkEditorRow(page, cfg.hash, fields);
  return cfg;
}

/** Count rows in a rule class. Assertion-side read-back. */
async function countRuleRows(page, ruleKey) {
  const cfg = resolveRuleKey(ruleKey);
  return page.evaluate((className) => new window.Parse.Query(className).count(), cfg.className);
}

/** Fetch one row of a rule class by an arbitrary field. Assertion-side read-back. */
async function findRuleRowByField(page, ruleKey, field, value) {
  const cfg = resolveRuleKey(ruleKey);
  return page.evaluate(({ className, field, value }) => {
    return new window.Parse.Query(className).equalTo(field, value).first().then((r) => (
      r ? Object.assign({ id: r.id }, r.attributes) : null
    ));
  }, { className: cfg.className, field, value });
}

/** Fetch one row of a rule class by its real Parse object id. Assertion-side read-back. */
async function getRuleRowById(page, ruleKey, id) {
  const cfg = resolveRuleKey(ruleKey);
  return page.evaluate(({ className, id }) => {
    return new window.Parse.Query(className).get(id).then((r) => Object.assign({ id: r.id }, r.attributes));
  }, { className: cfg.className, id });
}

/**
 * Resolve the one `bnsmetv1_ClanRule` row this admin UI's own lookup
 * mechanism can ever reach for an edit (see the third defect above): the
 * query the submit handler itself runs when neither `category` nor `name` is
 * supplied. Stable across repeated calls as long as the collection is not
 * modified in between (confirmed live).
 */
async function resolveOnlyReachableClanRule(page) {
  return page.evaluate(() => {
    return new window.Parse.Query('bnsmetv1_ClanRule')
      .doesNotExist('category')
      .doesNotExist('name')
      .first()
      .then((r) => (r ? Object.assign({ id: r.id }, r.attributes) : null));
  });
}

module.exports = {
  RULE_CLASSES,
  openRuleEditor,
  selectRuleCategory,
  readRuleTableRows,
  submitRuleRow,
  countRuleRows,
  findRuleRowByField,
  getRuleRowById,
  resolveOnlyReachableClanRule
};
