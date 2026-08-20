/**
 * The liveness oracle's oracle.
 *
 * `hook-counts.js` answers "did this Cloud Code hook run at all", which is the
 * question `diff-runs.js` answers worst and the one the parse-server 9 bump
 * makes urgent: a legacy `function(request, response)` before-trigger gets
 * `response === undefined` under parse-server 9 and stops settling, so its log
 * line stops being written. A counter that quietly stopped counting would turn
 * "the hook died" into "nothing to report", which is the exact failure it
 * exists to prevent.
 *
 * So it gets fixtures with a planted hook failure, the same bargain
 * `diff-runs.js` makes.
 *
 * The fixtures in `test/fixtures/hook-counts/` are assembled from REAL captured
 * parse-server 2.8.4 log lines -- pulled out of `logs/parse-server.info.*` and
 * `logs/parse-server.err.*` -- with exactly one field edited, `timestamp`, so
 * records can be placed inside or outside a deliberate window. Nothing else was
 * hand-written, so the fixtures cannot drift away from the log's real shape.
 *
 *   baseline/parse-server.info.2026-08-18   a realistic DAY file: an earlier
 *                                           run (5 Vampire/beforeSave at
 *                                           20:00) followed by the baseline
 *                                           run (23:41-23:44)
 *   baseline/parse-server.err.2026-08-18    the error records again, which is
 *                                           what winston really does -- the
 *                                           double-count trap
 *   candidate/parse-server.info.2026-08-19  the candidate run, carrying:
 *
 *     Vampire/beforeSave         12 -> 0, and 1 -> 4 errors   the planted kill
 *     change_troupe_staff         5 -> 0                      a dead function
 *     SimpleTrait/beforeDelete    8 -> 3                      a material drop
 *     SimpleTrait/afterSave       8 -> 7                      noise, not a drop
 *     VampireCreation/beforeSave  2 -> 5                      a rise
 *     LongText/beforeSave     absent -> 2                      newly exercised
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  countText,
  countPaths,
  compareCounts,
  isRegression,
  scanRegistrations,
  windowFromReport,
  main,
  FN_PREFIX
} = require('../hook-counts');

const FIX = path.join(__dirname, 'fixtures', 'hook-counts');
const BASELINE_DIR = path.join(FIX, 'baseline');
const CANDIDATE_DIR = path.join(FIX, 'candidate');
const BASELINE_ERR = path.join(BASELINE_DIR, 'parse-server.err.2026-08-18');
const BASELINE_RUN = path.join(FIX, 'baseline-run.json');

const ok = (acc, key) => (acc.counts[key] || { ok: 0 }).ok;
const failed = (acc, key) => (acc.counts[key] || { failed: 0 }).failed;
const keys = (rows) => rows.map((r) => r.key).sort();

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

test('counts triggers and cloud functions out of a real log, failures apart', () => {
  const acc = countPaths([BASELINE_DIR]);
  assert.strictEqual(ok(acc, 'SimpleTrait/beforeSave'), 6);
  assert.strictEqual(ok(acc, 'SimpleTrait/afterSave'), 8);
  assert.strictEqual(ok(acc, 'SimpleTrait/beforeDelete'), 8);
  assert.strictEqual(ok(acc, 'ExperienceNotation/beforeSave'), 4);
  assert.strictEqual(ok(acc, 'Patronage/afterSave'), 2);
  assert.strictEqual(ok(acc, FN_PREFIX + 'get_my_patronage_status'), 6);
  assert.strictEqual(ok(acc, FN_PREFIX + 'change_troupe_staff'), 5);

  // A failure is a settlement too, but it is not the same event as a success
  // and collapsing them would hide a hook that flipped from working to
  // erroring on every call.
  assert.strictEqual(failed(acc, 'Vampire/beforeSave'), 1);
  assert.strictEqual(failed(acc, FN_PREFIX + 'vote_for_referendum'), 1);
  assert.strictEqual(ok(acc, FN_PREFIX + 'vote_for_referendum'), 2);
});

test('an interleaved half-line is counted as malformed, never silently dropped', () => {
  // Eight backends append to one file. A torn write must make the numbers
  // visibly untrustworthy rather than just slightly wrong.
  const acc = countPaths([BASELINE_DIR]);
  assert.strictEqual(acc.malformed, 1, 'the planted torn line must be reported');
});

test('cloud console.log contributes nothing, because it never reaches this file', () => {
  // The premise the plan got wrong: parse-server does not redirect `console`,
  // so cloud markers go to stdout. Even if such a line were somehow present it
  // carries no className/triggerType/functionName and must not be counted.
  const acc = countText(
    [
      '{"level":"info","message":"beforeSave SimpleTrait","timestamp":"2026-08-18T23:41:44.000Z"}',
      '{"level":"info","message":"Saving vampire (abc) and there are no changes we track here"}',
      'beforeSave SimpleTrait'
    ].join('\n')
  );
  assert.deepStrictEqual(acc.counts, {});
  assert.strictEqual(acc.records, 0);
  assert.strictEqual(acc.malformed, 0);
});

// ---------------------------------------------------------------------------
// Windows -- the day-file problem
// ---------------------------------------------------------------------------

test('an unwindowed count is the whole day, not one run', () => {
  // This is the trap the tool has to make visible: the file is named by date,
  // so yesterday's second run is in there too.
  const acc = countPaths([BASELINE_DIR]);
  assert.strictEqual(ok(acc, 'Vampire/beforeSave'), 17, '12 from the run + 5 from the earlier one');
});

test("a Playwright report's stats window isolates that one run", () => {
  const window = windowFromReport(BASELINE_RUN);
  const acc = countPaths([BASELINE_DIR], { window });
  assert.strictEqual(ok(acc, 'Vampire/beforeSave'), 12, 'the earlier run must fall outside');
  // Every other key belongs to the windowed run only, so nothing else moves.
  assert.strictEqual(ok(acc, 'SimpleTrait/afterSave'), 8);
});

test('an explicit since/until window works without a report', () => {
  const acc = countPaths([BASELINE_DIR], {
    window: { since: '2026-08-18T23:00:00.000Z', until: '2026-08-19T00:00:00.000Z' }
  });
  assert.strictEqual(ok(acc, 'Vampire/beforeSave'), 12);
});

// ---------------------------------------------------------------------------
// The double-count guard
// ---------------------------------------------------------------------------

test('reading parse-server.err alongside .info is refused, because it double-counts', () => {
  // winston's npm levels put error below info, so every error record is in
  // BOTH files. `logs/*` would otherwise silently double every failure.
  assert.throws(() => countPaths([BASELINE_ERR]), /refusing to read/);
});

test('a directory expands to parse-server.info.* only', () => {
  const acc = countPaths([BASELINE_DIR]);
  assert.strictEqual(acc.sources.length, 1, 'the .err sibling must not be picked up');
  assert.ok(acc.sources[0].indexOf('parse-server.info') !== -1);
});

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

test('finds the planted dead hooks, and only those', () => {
  const b = countPaths([BASELINE_DIR]);
  const c = countPaths([CANDIDATE_DIR]);
  const d = compareCounts(b, c);
  assert.deepStrictEqual(keys(d.vanished), [
    'Vampire/beforeSave',
    FN_PREFIX + 'change_troupe_staff'
  ]);
  assert.deepStrictEqual(keys(d.dropped), ['SimpleTrait/beforeDelete']);
  assert.strictEqual(isRegression(d), true);
});

test('does not cry wolf when a run is compared against itself', () => {
  const b = countPaths([BASELINE_DIR]);
  const d = compareCounts(b, b);
  assert.deepStrictEqual(d.vanished, []);
  assert.deepStrictEqual(d.dropped, []);
  assert.deepStrictEqual(d.rose, []);
  assert.deepStrictEqual(d.added, []);
  assert.deepStrictEqual(d.newFailures, []);
  assert.strictEqual(isRegression(d), false);
});

test('classifies the rest: steady, rose, added, new-fail', () => {
  const d = compareCounts(countPaths([BASELINE_DIR]), countPaths([CANDIDATE_DIR]));
  assert.deepStrictEqual(keys(d.rose), ['VampireCreation/beforeSave']);
  assert.deepStrictEqual(keys(d.added), ['LongText/beforeSave']);
  assert.deepStrictEqual(keys(d.newFailures), ['Vampire/beforeSave']);
  // 8 -> 7 is one fewer save. That is a retry, not a regression.
  assert.ok(d.steady.some((r) => r.key === 'SimpleTrait/afterSave'));
});

test('a hook that is merely a bit quieter is not a regression', () => {
  // The floor exists because one Playwright retry replays a whole spec file.
  const b = { counts: { 'X/beforeSave': { ok: 100, failed: 0 } } };
  const c = { counts: { 'X/beforeSave': { ok: 98, failed: 0 } } };
  const d = compareCounts(b, c);
  assert.deepStrictEqual(d.dropped, []);
  assert.strictEqual(isRegression(d), false);
});

test('a proportionally huge but absolutely tiny drop is not a regression', () => {
  // 2 -> 0 is caught by the zero rule below; 4 -> 2 is halved but is two
  // records, which is inside the harness noise floor.
  const d = compareCounts(
    { counts: { 'X/beforeSave': { ok: 4, failed: 0 } } },
    { counts: { 'X/beforeSave': { ok: 2, failed: 0 } } }
  );
  assert.deepStrictEqual(d.dropped, []);
});

test('a fall to zero is always reported, whatever the thresholds are set to', () => {
  // No knob may hide the parse-server 9 signature.
  const d = compareCounts(
    { counts: { 'X/beforeSave': { ok: 1, failed: 0 } } },
    { counts: { 'X/beforeSave': { ok: 0, failed: 0 } } },
    { floor: 10000, tolerance: 0.99 }
  );
  assert.deepStrictEqual(keys(d.vanished), ['X/beforeSave']);
  assert.strictEqual(isRegression(d), true);
});

test('a hook absent from the baseline is added, never a regression', () => {
  const d = compareCounts(
    { counts: {} },
    { counts: { 'X/beforeSave': { ok: 9, failed: 0 } } }
  );
  assert.deepStrictEqual(keys(d.added), ['X/beforeSave']);
  assert.strictEqual(isRegression(d), false);
});

test('a hook at zero in BOTH runs is not a regression, and cannot be one', () => {
  // PaymentPaypal's permanent state. Absence of evidence.
  const d = compareCounts(
    { counts: { 'PaymentPaypal/afterSave': { ok: 0, failed: 0 } } },
    { counts: { 'PaymentPaypal/afterSave': { ok: 0, failed: 0 } } }
  );
  assert.deepStrictEqual(d.vanished, []);
  assert.strictEqual(isRegression(d), false);
});

// ---------------------------------------------------------------------------
// Registrations -- what the oracle can never see
// ---------------------------------------------------------------------------

test('the registration scan finds every hook declared in cloud/', () => {
  const regs = scanRegistrations(path.join(__dirname, '..', 'cloud'));
  assert.ok(regs, 'cloud/ must be scannable');
  for (const k of [
    'Vampire/beforeSave',
    'SimpleTrait/afterSave',
    'SimpleTrait/beforeDelete',
    'Patronage/afterSave',
    'PaymentPaypal/afterSave',
    'TroupePortrait/beforeSave',
    'CharacterPortrait/beforeSave',
    'VampireApproval/beforeSave',
    'ExperienceNotation/beforeDelete',
    FN_PREFIX + 'vote_for_referendum',
    FN_PREFIX + 'change_troupe_staff'
  ]) {
    assert.ok(regs.includes(k), 'missing registration ' + k + '\n  got: ' + regs.join('\n       '));
  }
});

test('PaymentPaypal is registered and never exercised, which is the honest limit', () => {
  // No run posts an IPN, so this hook is at zero in every run ever recorded and
  // this tool can say nothing about it. That has to be stated, not inferred
  // from a missing row.
  const regs = scanRegistrations(path.join(__dirname, '..', 'cloud'));
  const acc = countPaths([BASELINE_DIR]);
  assert.ok(regs.includes('PaymentPaypal/afterSave'));
  assert.ok(!Object.prototype.hasOwnProperty.call(acc.counts, 'PaymentPaypal/afterSave'));
});

// ---------------------------------------------------------------------------
// Exit codes -- what a caller branches on
// ---------------------------------------------------------------------------

test('exit codes match diff-runs.js: 0 clean, 1 regression, 2 could not run', () => {
  assert.strictEqual(main(['--diff', BASELINE_DIR, CANDIDATE_DIR, '--quiet']), 1);
  assert.strictEqual(main(['--diff', BASELINE_DIR, BASELINE_DIR, '--quiet']), 0);
  assert.strictEqual(main([BASELINE_DIR, '--quiet']), 0);
  assert.strictEqual(main(['--diff', BASELINE_DIR, '--quiet']), 2, 'diff needs two sides');
  assert.strictEqual(main(['--quiet']), 2, 'no paths at all');
  assert.strictEqual(main([BASELINE_DIR, '--nonsense']), 2, 'unknown option');
  assert.strictEqual(main([path.join(FIX, 'does-not-exist'), '--quiet']), 2, 'missing path');
});
