/**
 * The oracle's oracle, one level up.
 *
 * `diff-runs.js` answers "which tests passed then failed?" and `test/diff-runs.
 * test.js` holds it to that answer. `gate.js` answers the larger question the
 * migration actually asks -- "is it safe to proceed?" -- and the three ways
 * that question goes wrong are all ways the run itself fails rather than ways a
 * test fails. So this file is mostly about runs that did not happen.
 *
 * The headline case is the reason the gate exists at all:
 *
 *   node diff-runs.js runs/m18.json <an empty report>   ->  "No regressions.", exit 0
 *   node gate.js      ... same pair ...                 ->  "THE RUN DID NOT HAPPEN", exit 2
 *
 * Fixtures come in two kinds, deliberately.
 *
 *   test/fixtures/gate/*.json -- synthetic, committed, six tests in one serial
 *     file. These reproduce the SHAPES (serial tail, all-skipped, degraded
 *     baseline, valid-JSON-but-not-a-report) and they run on a fresh clone.
 *
 *   runs/*.json -- the real recorded artifacts, which are what the numbers in
 *     gate.js's header were measured on. `runs/` is gitignored wholesale, but
 *     the records named below were force-added past that rule exactly so these
 *     tests run on a fresh clone; every test that touches runs/ still asks
 *     needRuns() first, and the names it asks for must be ones `git ls-files
 *     runs/` returns. Name an untracked record and the test stops being a test
 *     for everyone but the machine that happens to have the file.
 *
 * `runs/gate-selftest-baseline.json` is frozen, and must stay frozen.
 *
 * These tests used to pair `runs/baseline.json` with `runs/m18.json` and assert
 * exact counts against it -- 447 same-pass, one added test. But
 * `runs/baseline.json` is the LIVE baseline: `gate.js` compares real runs
 * against it, and it is re-recorded whenever the suite legitimately changes
 * size. One file was doing two jobs, and re-recording it silently broke three
 * tests here that have nothing to do with the change that caused it.
 *
 * So the self-tests now own a copy that nothing re-records. If the numbers
 * below ever need updating, replace this file DELIBERATELY and update the
 * assertions with it -- do not point these back at `runs/baseline.json`, which
 * would put the trap back.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const gate = require('../gate');
const { flatten } = require('../diff-runs');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'gate');
const RUNS = path.join(ROOT, 'runs');

const fix = (n) => path.join(FIX, n);
const run = (n) => path.join(RUNS, n);

/**
 * Guard for the recorded-run fixtures.
 *
 * A recorded run is unrecoverable -- each one measured a stack that no longer
 * exists -- so a machine may legitimately be missing one. A test that silently
 * passed in that case would be worse than useless, and one that failed would
 * make the suite red for a reason nobody can fix, so it skips and says exactly
 * which file it wanted.
 *
 * The guard is therefore silent by design, which is how two tests here spent a
 * whole migration pointed at runs/m20.json -- a file never committed on any
 * branch -- reporting "skipped" rather than "wrong file". Keep every name a
 * caller passes in tracked: the guard is cover for a record dropped in by
 * hand, never cover for a name that no longer exists anywhere.
 */
function needRuns(t, names) {
  const missing = names.filter((n) => !fs.existsSync(run(n)));
  if (!missing.length) return false;
  t.skip(
    'needs recorded runs that are not present in runs/: ' + missing.join(', ')
  );
  return true;
}

const judge = (baseline, candidate, extra) =>
  gate.evaluate(
    Object.assign(
      { baselinePath: baseline, candidatePath: candidate, quarantine: null },
      extra
    )
  );

// A synthetic quarantine entry pinned to the synthetic fixtures, so the
// quarantine MACHINERY can be tested without depending on the two real names --
// which live in gate.js and are meant to be deleted one day.
const SYNTH_KEY = 'serial.spec.js :: Serial group :: 2 the noisy one';
const SYNTH_QUARANTINE = {
  [SYNTH_KEY]: {
    why: 'synthetic stand-in for the harness flakes',
    doc: 'test/gate.test.js',
    messageRe: /^Error: expected jQuery Mobile page "#character-rename" to become active/,
    errorLocation: { file: 'e2e/helpers/jqm-helpers.js', line: 68, column: 11 },
    tail: 4
  }
};

/**
 * The two entries `gate.QUARANTINE` carried until 2026-08-21, kept here after
 * they were retired.
 *
 * They are not decoration and this is not sentiment. Several tests below judge
 * the REAL recorded `m18` -> `m19` pair, where test 114's failure is the thing
 * being forgiven; that is the only place the forgiveness machinery is ever
 * exercised against a real Playwright failure with a real signature, real
 * `errorLocation` paths from a foreign worktree, and a real 14-test serial
 * tail. `SYNTH_QUARANTINE` cannot stand in for that -- it is a hand-written
 * object matched against a fixture built to match it.
 *
 * So when the live list was emptied, these moved here rather than being
 * deleted, and the tests that need real data now name `RETIRED_QUARANTINE`.
 * What is deliberately NOT asserted any more is that these two keys are the
 * live ones. What is still asserted is every behaviour: that a forgiven
 * NEW-FAIL never reads green, that the tail is counted and named, that the
 * blast radius cannot grow unnoticed, that a quarantined test cannot be
 * renamed away, and that `--filter` scopes forgiveness.
 *
 * If a flake ever earns quarantine again, put it in `gate.js` -- not here.
 *
 * Evidence for the retirement: 22 consecutive full eight-worker runs with both
 * passing on the first attempt. See docs/runbooks/harness-noise-floor.md.
 */
const RETIRED_QUARANTINE = {
  ['admin-referendums.spec.js :: Task 3 - Referendums: Creation And Voting :: ' +
  '49 A third user votes for the same option as the first; that tally reaches 2']: {
    why: 'harness noise; byte-identical signature on the legacy stack (candidate/vendor/w4a)',
    doc: 'docs/runbooks/harness-noise-floor.md',
    messageRe: /^Error: expect\(received\)\.toBe\(expected\)[\s\S]*Expected: 2[\s\S]*Received: undefined/,
    errorLocation: { file: 'e2e/admin-referendums.spec.js', line: 452, column: 45 },
    tail: 4
  },

  ['assets-rename-portrait.spec.js :: Task 6 - Rename And Portraits, Verified Everywhere They Appear :: ' +
  '114 Renaming to collide with an existing character name succeeds - names are deliberately not unique']: {
    why: 'jQuery Mobile transition-lock flake; pre-existing, root-caused, partially healed',
    doc: 'docs/runbooks/harness-noise-floor.md',
    messageRe: /^Error: expected jQuery Mobile page "#character-rename" to become active within 20000ms/,
    errorLocation: { file: 'e2e/helpers/jqm-helpers.js', line: 68, column: 11 },
    tail: 14
  }
};

// ---------------------------------------------------------------------------
// Hole A -- the run that did not happen
// ---------------------------------------------------------------------------

test('an EMPTY candidate is "the run did not happen", not "no regressions"', (t) => {
  if (needRuns(t, ['m18.json'])) return;
  const r = judge(run('m18.json'), fix('empty-report.json'));
  assert.strictEqual(r.verdict, 'DID NOT RUN');
  assert.strictEqual(r.exitCode, gate.EXIT_DID_NOT_RUN);
  assert.notStrictEqual(r.exitCode, 0, 'diff-runs.js alone exits 0 here -- the gate must not');

  const text = r.lines.join('\n');
  assert.ok(text.includes('THE RUN DID NOT HAPPEN'), 'the verdict must say so in words');
  assert.ok(!/^\s*PASS\b/m.test(text), 'must never print a PASS banner');
  // The phrase may appear only where the gate is quoting what diff-runs.js
  // would have said on this same pair -- never as this gate's own answer.
  for (const line of r.lines) {
    if (!line.includes('No regressions')) continue;
    assert.ok(
      line.includes('diff-runs.js'),
      'the gate claimed a clean result in its own voice: ' + line
    );
  }
  assert.ok(
    r.integrityFailed.some((f) => f.includes('expected + unexpected = 0')),
    'the zero-verdict assertion is the one that has to fire: ' + r.integrityFailed.join(' | ')
  );
});

test('an ALL-SKIPPED candidate fails even though nothing was removed', () => {
  // The trap that `removed === 0` alone does not catch: every test present,
  // every test skipped, which is what an interrupted-after-load run looks like.
  const r = judge(fix('serial-baseline.json'), fix('serial-all-skipped.json'));
  assert.strictEqual(r.numbers.removed, 0, 'nothing is removed -- that check cannot save us');
  assert.strictEqual(r.verdict, 'DID NOT RUN');
  assert.strictEqual(r.exitCode, gate.EXIT_DID_NOT_RUN);
});

test('valid JSON that is not a report never reaches the oracle', () => {
  // `{}` parses, and `diff-runs.js` reports "No regressions." on it.
  const r = judge(fix('serial-baseline.json'), fix('not-a-report.json'));
  assert.strictEqual(r.exitCode, gate.EXIT_DID_NOT_RUN);
  assert.ok(
    r.integrityFailed.some((f) => f.includes('not a Playwright report')),
    r.integrityFailed.join(' | ')
  );
});

test('a missing report fails distinctly from "regressions found"', () => {
  const r = judge(fix('serial-baseline.json'), fix('no-such-file.json'));
  assert.strictEqual(r.verdict, 'DID NOT RUN');
  assert.strictEqual(r.exitCode, gate.EXIT_DID_NOT_RUN);
  assert.notStrictEqual(
    r.exitCode,
    gate.EXIT_FAIL,
    '"nothing ran" and "something broke" must not share an exit code'
  );
  assert.strictEqual(r.numbers.newFail, undefined, 'no comparison should have been attempted');
});

test('a STALE report fails -- the reporter writes once, at the very end', () => {
  // A run killed before the JSON reporter's onEnd leaves the PREVIOUS run's
  // file on disk, untouched, with its old content. Freshness is asserted on
  // stats.startTime, which lives inside the file and survives being copied.
  const fresh = judge(fix('serial-baseline.json'), fix('serial-baseline.json'));
  assert.strictEqual(fresh.verdict, 'PASS', 'sanity: this pair is clean without the check');

  const r = judge(fix('serial-baseline.json'), fix('serial-baseline.json'), {
    notBefore: Date.parse('2030-01-01T00:00:00.000Z')
  });
  assert.strictEqual(r.verdict, 'DID NOT RUN');
  assert.ok(
    r.integrityFailed.some((f) => f.includes('STALE')),
    r.integrityFailed.join(' | ')
  );
});

test('a filter that matches nothing is a no-op, not a pass', () => {
  const r = judge(fix('serial-baseline.json'), fix('serial-baseline.json'), {
    filter: 'no-such-spec'
  });
  assert.strictEqual(r.verdict, 'DID NOT RUN');
  assert.ok(
    r.integrityFailed.some((f) => f.includes('matched no tests')),
    r.integrityFailed.join(' | ')
  );
});

// ---------------------------------------------------------------------------
// Hole C -- one NEW-FAIL, fifteen broken tests
// ---------------------------------------------------------------------------

test('a serial tail is reported as LOST, separately from the NEW-FAIL', () => {
  const r = judge(fix('serial-baseline.json'), fix('serial-tail-lost.json'));
  assert.strictEqual(r.exitCode, gate.EXIT_FAIL);
  assert.strictEqual(r.numbers.newFail, 1, 'the oracle sees one failure');
  assert.strictEqual(r.numbers.lost, 4, 'and four tests behind it never ran');
  assert.strictEqual(r.numbers.stoppedPassing, 5, 'the honest total is five');
  assert.strictEqual(r.numbers.skippedDelta, 4);
});

test('a test quieted by skipping it in source still counts as stopped passing', () => {
  const r = judge(fix('serial-baseline.json'), fix('serial-deliberate-skip.json'));
  assert.strictEqual(r.exitCode, gate.EXIT_FAIL);
  assert.strictEqual(r.numbers.lost, 1);
  assert.ok(
    r.failures.some((f) => f.includes('skipped in the source')),
    'the reason must distinguish a deliberate skip from a serial tail: ' + r.failures.join(' | ')
  );
});

test('a deliberate skip present on BOTH sides is not a coverage loss', () => {
  // The real suite carries 3 of these permanently. They must not make every
  // run fail, and they must not be confused with a serial-abort tail.
  const r = judge(
    fix('serial-baseline-deliberate-skip.json'),
    fix('serial-deliberate-skip.json')
  );
  assert.strictEqual(r.verdict, 'PASS');
  assert.strictEqual(r.numbers.lost, 0);
  assert.strictEqual(r.numbers.skippedDelta, 0);
});

test('m18 vs m19 fails, and cites the NEW-FAIL AND the 14 tests that stopped running', (t) => {
  if (needRuns(t, ['m18.json', 'm19.json'])) return;
  const r = judge(run('m18.json'), run('m19.json'));

  assert.strictEqual(r.exitCode, gate.EXIT_FAIL);
  assert.strictEqual(r.numbers.newFail, 1, 'the oracle reports exactly one regression');
  assert.strictEqual(r.numbers.lost, 14, 'and fourteen tests hide behind it');
  assert.strictEqual(r.numbers.baselinePassed, 448);
  assert.strictEqual(r.numbers.samePass, 433, 'same-pass falls 448 -> 433');
  assert.strictEqual(r.numbers.stoppedPassing, 15, 'fifteen tests stopped passing');
  assert.strictEqual(r.numbers.baselineSkipped, 3);
  assert.strictEqual(r.numbers.candidateSkipped, 17, 'skipped rises 3 -> 17');
  assert.strictEqual(r.numbers.skippedDelta, 14);

  // The failure has to say both things out loud. Reporting only the NEW-FAIL is
  // exactly what the oracle already does.
  const text = r.failures.join('\n');
  assert.ok(/1 NEW-FAIL/.test(text), 'must cite the regression: ' + text);
  assert.ok(/14 test\(s\) passed in the baseline and NEVER RAN/.test(text),
    'must cite the lost coverage: ' + text);
  assert.ok(/448 -> 433/.test(text), 'must give the same-pass drop numerically: ' + text);
  assert.ok(/3 -> 17/.test(text), 'must give the skipped rise numerically: ' + text);

  // The 14 are the Parse File surface -- the surface S10's first dependency
  // bump is most likely to break. Naming them is the point.
  assert.ok(
    r.lost.every((l) => l.key.startsWith('assets-rename-portrait.spec.js')),
    'all fourteen belong to the tail of the failing file'
  );
  assert.ok(r.lost.every((l) => l.kind === 'serial-abort'));
});

// ---------------------------------------------------------------------------
// Hole C, mirrored -- a test that never ran in the baseline hides a failure
// ---------------------------------------------------------------------------

test('a candidate FAILURE that was SKIPPED in the baseline cannot hide from the verdict', () => {
  // `compare()` drops any pair where EITHER side is skipped, so baseline-
  // skipped + candidate-failed is classified as neither newFail nor sameFail
  // and no number the verdict reads can see it. This returned PASS / exit 0.
  //
  // The fixture is the shape that will actually bite S10: a flake stranded the
  // tail when the baseline was recorded, then the dependency bump cleared the
  // flake and broke every test in the tail. All four failures are baseline-
  // skipped, so all four were invisible.
  const r = judge(
    fix('serial-baseline-degraded.json'),
    fix('serial-tail-failed-under-skipped-baseline.json')
  );
  assert.strictEqual(r.exitCode, gate.EXIT_FAIL, 'four failing tests must not be green');
  assert.strictEqual(r.numbers.unnamedFailures, 4);
  assert.strictEqual(r.numbers.statsUnexpected, 4, 'the candidate says so in its own stats');

  // The point of the test: every OTHER number stays silent, which is why the
  // assertion has to exist at all.
  assert.strictEqual(r.numbers.newFail, 0, 'the oracle reports no regression here');
  assert.strictEqual(r.numbers.lost, 0);
  assert.strictEqual(r.numbers.stoppedPassing, 0, 'even the honest headline reads zero');

  assert.ok(
    r.failures.some((f) => /CANNOT NAME/.test(f) && /unexpected = 4/.test(f)),
    r.failures.join(' | ')
  );
  assert.ok(
    r.unnamedFailures.length === 4 && r.lines.join('\n').includes(r.unnamedFailures[0]),
    'the unnamed failures must be named on the page, not just counted'
  );
});

test('the unnamed-failure assertion fires on no recorded pair', (t) => {
  // A check that blocks the migration must not fire on a good run. Measured at
  // zero across every recorded pair the gate is expected to judge.
  const names = [
    'gate-selftest-baseline.json', 'm18.json', 'm19.json', 's10-baseA.json', 's10-step13e-3.json'
  ];
  if (needRuns(t, names)) return;
  const pairs = [
    ['gate-selftest-baseline.json', 'm18.json'],
    ['m18.json', 'm19.json'],
    ['gate-selftest-baseline.json', 'm19.json'],
    // The S10 migration's own before/after: the legacy stack against the
    // first clean run on the migrated one, the widest change any recorded
    // pair spans.
    //
    // Note what this pair does and does not add. Both sides recorded
    // unexpected 0 and flaky 0, so there is no failure here for the check to
    // misname and the zero is not hard-won -- what it pins is that swapping
    // parse-server, parse and mongo underneath the suite does not by itself
    // manufacture an unnamed failure. The pairs above are the ones with real
    // failures in them (m19 recorded unexpected 1), and they are what prove
    // the check names a failure rather than merely counting it.
    ['s10-baseA.json', 's10-step13e-3.json']
  ];
  for (const [b, c] of pairs) {
    const r = judge(run(b), run(c));
    assert.strictEqual(
      r.numbers.unnamedFailures, 0,
      'false positive on ' + b + ' -> ' + c + ': ' + r.unnamedFailures.join(', ')
    );
  }
});

test('baseline vs m18 passes -- the gate does not cry wolf on the clean run', (t) => {
  if (needRuns(t, ['gate-selftest-baseline.json', 'm18.json'])) return;
  const r = judge(run('gate-selftest-baseline.json'), run('m18.json'));
  assert.strictEqual(r.verdict, 'PASS', r.failures.concat(r.integrityFailed).join(' | '));
  assert.strictEqual(r.exitCode, gate.EXIT_PASS);
  assert.strictEqual(r.numbers.samePass, 447);
  assert.strictEqual(r.numbers.lost, 0);
  assert.strictEqual(r.numbers.added, 1, 'm18 legitimately adds one test; that is not a failure');
});

test('the count tolerance forgives the one added test but not a lost tail', (t) => {
  if (needRuns(t, ['gate-selftest-baseline.json', 'm18.json'])) return;
  const r = judge(run('gate-selftest-baseline.json'), run('m18.json'));
  const band = Math.max(
    gate.COUNT_TOLERANCE_FLOOR,
    Math.ceil(r.numbers.baselineKeys * gate.COUNT_TOLERANCE_FRACTION)
  );
  assert.strictEqual(Math.abs(r.numbers.candidateKeys - r.numbers.baselineKeys), 1,
    'the only drift ever observed is +1 key');
  assert.ok(band >= 2, 'the band must have a usable floor');
  assert.ok(band < 14,
    'the band must stay under the smallest serial tail (14), or a whole tail ' +
    'could vanish from discovery inside the tolerance');
});

test('a worker-count difference warns without failing', () => {
  // Not an integrity failure -- an eight-worker run is still a run -- but
  // worker count is the biggest influence on this suite's flake rate (test 54
  // passes at four workers and fails at eight), so comparing across it is
  // comparing two different experiments and the report must say so.
  const r = judge(fix('serial-baseline-4-workers.json'), fix('serial-baseline.json'));
  assert.strictEqual(r.verdict, 'PASS', 'a warning must not become a failure');
  assert.ok(
    r.warnings.some((w) => w.includes('4 worker(s)') && w.includes('with 8')),
    r.warnings.join(' | ')
  );
  assert.ok(r.lines.join('\n').includes('WARNING'), 'and it has to be printed');
});

// ---------------------------------------------------------------------------
// Quarantine -- may downgrade a verdict, may never suppress a measurement
// ---------------------------------------------------------------------------

test('quarantine cannot launder a real regression: m18 vs m19 still fails', (t) => {
  if (needRuns(t, ['m18.json', 'm19.json'])) return;
  // Test 114 is quarantined in gate.js and its failure here matches the pinned
  // signature exactly, so the NEW-FAIL is forgiven -- and the run is still not
  // green, because the 14 tests behind it never ran.
  const r = judge(run('m18.json'), run('m19.json'), { quarantine: RETIRED_QUARANTINE });

  assert.notStrictEqual(r.exitCode, gate.EXIT_PASS, 'a forgiven failure must never be green');
  assert.strictEqual(r.verdict, 'INCONCLUSIVE');
  assert.strictEqual(r.exitCode, gate.EXIT_INCONCLUSIVE);
  assert.strictEqual(r.numbers.forgiven, 1, 'exactly the one quarantined failure is forgiven');
  assert.strictEqual(r.numbers.newFailUnforgiven, 0);
  assert.strictEqual(r.numbers.lostBehindQuarantine, 14, 'the tail is still counted and named');
  assert.strictEqual(r.numbers.stoppedPassing, 15,
    'forgiving the verdict must not change the measurement');

  const text = r.lines.join('\n');
  assert.ok(text.includes('QUARANTINE'), 'the quarantine section prints on every run');
  assert.ok(/deferred, NOT waived/.test(text), 'the tail must be shown as deferred');
  assert.ok(/115 Portrait upload/.test(text), 'the lost tests must be named, not counted');
});

test('the quarantine section prints even when the quarantined tests passed', (t) => {
  if (needRuns(t, ['gate-selftest-baseline.json', 'm18.json'])) return;
  const r = judge(run('gate-selftest-baseline.json'), run('m18.json'), { quarantine: RETIRED_QUARANTINE });
  assert.strictEqual(r.verdict, 'PASS');
  const text = r.lines.join('\n');
  assert.ok(text.includes('QUARANTINE'), 'nobody should be able to forget these exist');
  assert.strictEqual(r.quarantineStatus.length, 2);
  assert.ok(r.quarantineStatus.every((q) => q.state === 'PASSED'));
  assert.ok(
    r.quarantineStatus.every((q) => q.doc.includes('harness-noise-floor')),
    'each entry must point at the evidence'
  );
});

test('every live quarantine key is well-formed and matches a real test', (t) => {
  // Transcription guard, and it applies to whatever is in the live list --
  // which since 2026-08-21 is nothing. It used to pin the list to exactly the
  // two retired entries by name; that pin is gone, because the point of it was
  // to make an ADDITION visible in the diff, and against an empty list any
  // addition is visible in the diff by definition.
  //
  // What has to keep holding is the shape. The keys are 150 and 200 characters
  // and the file segment is the BARE basename -- writing
  // `e2e/admin-referendums.spec.js` would produce a quarantine that looks
  // configured, prints its section every run, and matches nothing. This is
  // vacuous while the list is empty and becomes load-bearing the moment it is
  // not, which is exactly when somebody is hand-transcribing a 200-character
  // key out of a Playwright report.
  const keys = Object.keys(gate.QUARANTINE);
  assert.ok(keys.every((k) => !k.startsWith('e2e/')), 'keys carry the basename, not the path');
  assert.ok(
    keys.every((k) => k.includes('.spec.js :: ')),
    'a key is "<basename>.spec.js :: <suite path> :: <title>"'
  );
  for (const k of keys) {
    const e = gate.QUARANTINE[k];
    assert.ok(e.why && e.doc, 'every entry says why, and where the evidence is: ' + k);
    assert.ok(e.messageRe instanceof RegExp, 'forgiveness is by signature, never by name: ' + k);
    assert.ok(e.errorLocation && e.errorLocation.file, 'and by location: ' + k);
    assert.strictEqual(typeof e.tail, 'number', 'the stranded-test cost must be measured: ' + k);
  }

  // The same check against the retired pair, on real recorded runs, so the
  // lesson those keys taught is still enforced somewhere. m19 is where test
  // 114's pinned failure was actually recorded, so it proves the key matches
  // the test the signature was taken from; s10-step13e-3 proves the same key
  // still matches after the stack moved.
  if (needRuns(t, ['m19.json', 's10-step13e-3.json'])) return;
  const inLegacy = flatten(JSON.parse(fs.readFileSync(run('m19.json'), 'utf8')));
  const inMigrated = flatten(JSON.parse(fs.readFileSync(run('s10-step13e-3.json'), 'utf8')));
  const retired = Object.keys(RETIRED_QUARANTINE);
  assert.strictEqual(retired.length, 2);
  for (const k of retired) {
    assert.ok(
      inLegacy.has(k) && inMigrated.has(k),
      'retired quarantine key matches no real test: ' + k
    );
  }
});

test('the quarantine is empty, and that is a decision with evidence behind it', () => {
  // Not a style assertion. While test 114 was forgiven, a run in which it
  // failed was INCONCLUSIVE rather than FAIL, and the 14 tests behind it -- the
  // whole Parse File surface -- went unmeasured. Emptying the list is what puts
  // those back under the gate.
  //
  // If you are re-adding an entry, this test is the one that will stop you, and
  // it should: say so out loud in the diff, and record the evidence in
  // docs/runbooks/harness-noise-floor.md the way the retirement of these two
  // was recorded (22 consecutive full runs, both passing on first attempt).
  assert.deepStrictEqual(
    Object.keys(gate.QUARANTINE),
    [],
    'nothing is forgiven; if you added an entry, document it and update this test'
  );
});

test('an unrecognised error on a quarantined test is NOT forgiven', () => {
  // The load-bearing defence for S10. A mongo or parse-server failure on the
  // same test will not produce the recorded jQuery Mobile timeout.
  const r = judge(fix('serial-baseline.json'), fix('serial-tail-unrecognised.json'), {
    quarantine: SYNTH_QUARANTINE
  });
  assert.strictEqual(r.exitCode, gate.EXIT_FAIL);
  assert.strictEqual(r.numbers.forgiven, 0);
  assert.strictEqual(r.numbers.newFailUnforgiven, 1);
  assert.ok(
    r.failures.some((f) => f.includes('unrecognised error')),
    r.failures.join(' | ')
  );
});

test('a matching signature is forgiven, but only to INCONCLUSIVE', () => {
  const r = judge(fix('serial-baseline.json'), fix('serial-tail-lost.json'), {
    quarantine: SYNTH_QUARANTINE
  });
  assert.strictEqual(r.verdict, 'INCONCLUSIVE');
  assert.strictEqual(r.numbers.forgiven, 1);
  assert.strictEqual(r.numbers.lostBehindQuarantine, 4);
  assert.ok(
    r.lines.join('\n').includes('--filter serial.spec.js'),
    'the remedy must be a runnable command that re-measures the file'
  );
});

test('a quarantined test that already failed in the baseline is a hard fail', () => {
  // sameFail is never printed and never non-zero, and the tail is dark on both
  // sides, so a degraded baseline would hide the whole file with no output at
  // all. That is why Step 2 needs a CLEAN baseline, not merely a fresh one.
  const r = judge(fix('serial-baseline-degraded.json'), fix('serial-tail-lost.json'), {
    quarantine: SYNTH_QUARANTINE
  });
  assert.strictEqual(r.exitCode, gate.EXIT_FAIL);
  assert.ok(
    r.failures.some((f) => f.includes('failed in the baseline')),
    r.failures.join(' | ')
  );
});

test('a degraded baseline is refused whether or not the failure is quarantined', () => {
  // The asymmetry that made this worth fixing: the SAME shape was a hard fail
  // when the failing key happened to be on the quarantine list and a PASS when
  // it was not. An unknown failure is the more dangerous of the two, and it was
  // the one being forgiven. Measured before the fix: `PASS -- all 433 tests
  // that passed in the baseline still pass`, exit 0, with 1 test permanently
  // failing and 14 permanently dark -- while printing a warning saying so.
  const quarantined = judge(
    fix('serial-baseline-degraded.json'), fix('serial-tail-lost.json'),
    { quarantine: SYNTH_QUARANTINE }
  );
  const unquarantined = judge(fix('serial-baseline-degraded.json'), fix('serial-tail-lost.json'));

  assert.strictEqual(quarantined.exitCode, gate.EXIT_FAIL);
  assert.strictEqual(
    unquarantined.exitCode, gate.EXIT_FAIL,
    'an UNKNOWN baseline failure must not be forgiven where a known one is refused'
  );

  // And the tail is measured, not asserted. The old warning claimed "their
  // serial tails never ran on either side" without checking whether one
  // existed; citing the real number is what makes the refusal actionable.
  assert.strictEqual(unquarantined.numbers.darkBehindBaselineFailure, 4);
  assert.ok(
    unquarantined.failures.some((f) => /4 test\(s\) stranded behind them/.test(f)),
    unquarantined.failures.join(' | ')
  );
  assert.ok(
    unquarantined.lines.join('\n').includes('DARK ON BOTH SIDES'),
    'the dark tests must be named on the page'
  );
});

test('a baseline failure with nothing stranded behind it warns rather than refusing', () => {
  // The other side of the line: a baseline failure hides coverage only when
  // something is dark behind it. Test 6 is last in the file, so nothing is.
  const r = judge(fix('serial-baseline-last-failed.json'), fix('serial-baseline-last-failed.json'));
  assert.strictEqual(r.verdict, 'PASS', r.failures.join(' | '));
  assert.strictEqual(r.numbers.baselineFailed, 1);
  assert.strictEqual(r.numbers.darkBehindBaselineFailure, 0, 'nothing is dark behind it');
  assert.ok(
    r.warnings.some((w) => /Nothing is stranded behind them/.test(w)),
    r.warnings.join(' | ')
  );
});

test('a quarantined test that FAILED is never reported as passed', () => {
  // Precondition: it was SKIPPED in the baseline, so `compare()` drops the pair
  // and the key is not in newFail. The old ternary read "not SKIPPED" as
  // "PASSED" and printed
  //
  //   [PASSED] ... 2 the noisy one
  //       now:  passed this run -- consider removing the quarantine
  //
  // over a MongoServerError, with VERDICT PASS -- the loud section stating the
  // opposite of the truth and inviting deletion of the pin that would have
  // caught it next time. `signatureMatches` was never consulted at all.
  const r = judge(
    fix('serial-baseline-quarantined-skipped.json'), fix('serial-quarantined-failed.json'),
    { quarantine: SYNTH_QUARANTINE }
  );
  const q = r.quarantineStatus.find((s) => s.key === SYNTH_KEY);
  assert.ok(q, 'the quarantined key must be judged');
  assert.notStrictEqual(q.state, 'PASSED', 'a test that failed must never be labelled PASSED');
  assert.strictEqual(q.state, 'FAILED (UNCOMPARED)');
  assert.ok(/signature pin was never consulted/.test(q.detail), q.detail);
  assert.strictEqual(r.exitCode, gate.EXIT_FAIL, 'and it must not be forgiven');
  assert.strictEqual(r.numbers.forgiven, 0);

  // Reported once, under the quarantine heading -- not twice, once here and
  // once as an unnamed failure.
  assert.strictEqual(r.numbers.unnamedFailures, 0);
  assert.strictEqual(
    r.failures.filter((f) => f.includes(SYNTH_KEY)).length, 1,
    r.failures.join(' | ')
  );
});

test('a forgiven flake may not grow its blast radius past the recorded tail', () => {
  // `tail` was declared on every QUARANTINE entry, documented as part of the
  // pin, and read by nothing -- so an INCONCLUSIVE stranding 25 tests printed
  // byte-identically in shape to one stranding 14, and noticing the growth
  // relied on a human diffing two runs by eye.
  const atCost = (tail) =>
    judge(fix('serial-baseline.json'), fix('serial-tail-lost.json'), {
      quarantine: { [SYNTH_KEY]: Object.assign({}, SYNTH_QUARANTINE[SYNTH_KEY], { tail: tail }) }
    });

  const asRecorded = atCost(4);
  assert.strictEqual(asRecorded.verdict, 'INCONCLUSIVE', 'the known cost is still forgiven');
  assert.strictEqual(asRecorded.numbers.lostBehindQuarantine, 4);

  const grown = atCost(2);
  assert.strictEqual(grown.exitCode, gate.EXIT_FAIL, 'a cost of 4 against a recorded 2 must fail');
  assert.ok(
    grown.failures.some((f) => /blast radius GREW/.test(f) && /stranded 4 test\(s\)/.test(f)),
    grown.failures.join(' | ')
  );

  // Only growth fires -- a --filter'ed heal run legitimately sees less.
  assert.strictEqual(atCost(9).verdict, 'INCONCLUSIVE', 'a shorter tail than recorded is fine');
});

test('the real quarantine tails match what the recorded runs actually strand', (t) => {
  // The pin is only worth asserting if the recorded numbers are the true ones.
  if (needRuns(t, ['m18.json', 'm19.json'])) return;
  const r = judge(run('m18.json'), run('m19.json'), { quarantine: RETIRED_QUARANTINE });
  const entry = RETIRED_QUARANTINE[
    Object.keys(RETIRED_QUARANTINE).find((k) => k.startsWith('assets-rename-portrait'))
  ];
  assert.strictEqual(entry.tail, 14, 'the recorded cost of forgiving test 114');
  assert.strictEqual(r.numbers.lostBehindQuarantine, 14, 'and what it actually strands');
  assert.ok(
    !r.failures.some((f) => /blast radius/.test(f)),
    'the assertion must not fire on the pair it was measured on: ' + r.failures.join(' | ')
  );
});

test('a quarantined test cannot be renamed away to quiet the gate', () => {
  const r = judge(fix('serial-quarantined-removed.json'), fix('serial-baseline.json'), {
    quarantine: SYNTH_QUARANTINE
  });
  assert.strictEqual(r.exitCode, gate.EXIT_FAIL);
  assert.ok(
    r.failures.some((f) => f.includes('may not be renamed or deleted')),
    r.failures.join(' | ')
  );
});

test('--filter scopes quarantine too, so the healing re-run is possible', (t) => {
  // The heal loop is: INCONCLUSIVE -> re-run one spec file -> gate that file
  // against the same baseline with --filter. A single-file report legitimately
  // does not contain the quarantined test that lives in another file, and if
  // quarantine ignored the filter the "may not be renamed or deleted" check
  // would fire on it and make the cheap targeted re-run impossible.
  const outOfScope = Object.assign(
    { 'other.spec.js :: a test in a file this filter excludes': SYNTH_QUARANTINE[SYNTH_KEY] },
    SYNTH_QUARANTINE
  );
  const r = judge(fix('serial-baseline.json'), fix('serial-baseline.json'), {
    quarantine: outOfScope,
    filter: 'serial.spec.js'
  });
  assert.strictEqual(r.verdict, 'PASS', r.failures.join(' | '));
  assert.strictEqual(r.quarantineStatus.length, 1, 'only the in-scope entry is judged');
  assert.strictEqual(r.quarantineStatus[0].key, SYNTH_KEY);

  if (needRuns(t, ['m18.json', 'm19.json'])) return;
  const real = judge(run('m18.json'), run('m19.json'), {
    quarantine: RETIRED_QUARANTINE,
    filter: 'assets-rename-portrait.spec.js'
  });
  assert.strictEqual(real.quarantineStatus.length, 1, 'the referendums entry is out of scope');
  assert.strictEqual(real.verdict, 'INCONCLUSIVE');
  assert.strictEqual(real.numbers.lostBehindQuarantine, 14);
});

test('--no-quarantine forgives nothing', (t) => {
  if (needRuns(t, ['m18.json', 'm19.json'])) return;
  const r = judge(run('m18.json'), run('m19.json'), { quarantine: null });
  assert.strictEqual(r.exitCode, gate.EXIT_FAIL);
  assert.strictEqual(r.numbers.newFailUnforgiven, 1);
  assert.strictEqual(r.quarantineStatus.length, 0);
});

// ---------------------------------------------------------------------------
// The pieces the judgement is built on
// ---------------------------------------------------------------------------

test('specIndex agrees with diff-runs flatten on every key', (t) => {
  // gate.js walks the report a second time to reach the spec objects that
  // flatten() collapses away. That duplication is a drift risk, and this is the
  // thing that catches it: if someone changes one walk, this fails and names
  // the other.
  const files = [
    fix('serial-baseline.json'),
    fix('serial-tail-lost.json'),
    path.join(__dirname, 'fixtures', 'diff-runs', 'baseline.json'),
    path.join(__dirname, 'fixtures', 'diff-runs', 'candidate.json')
  ].concat(['gate-selftest-baseline.json', 'm18.json', 'm19.json'].map(run).filter(fs.existsSync));

  for (const f of files) {
    const report = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.deepStrictEqual(
      [...gate.specIndex(report).keys()].sort(),
      [...flatten(report).keys()].sort(),
      'specIndex and flatten disagree on ' + path.basename(f)
    );
  }
  if (!fs.existsSync(run('m18.json'))) {
    t.diagnostic('recorded runs absent; checked synthetic and diff-runs fixtures only');
  }
});

test('skipKind separates a deliberate skip from a serial-abort tail', () => {
  // Playwright distinguishes them cleanly and the distinction is the whole of
  // Hole C. `spec.ok` does not: it is true for a test that never ran.
  assert.strictEqual(
    gate.skipKind({ tests: [{ expectedStatus: 'skipped', annotations: [{ type: 'skip' }] }] }),
    'deliberate'
  );
  assert.strictEqual(
    gate.skipKind({ tests: [{ expectedStatus: 'passed', annotations: [] }] }),
    'serial-abort'
  );
  // A `test.fail()` test reads expectedStatus 'passed' when it is
  // serial-abort-skipped, so the annotation is the stable discriminator.
  assert.strictEqual(
    gate.skipKind({ tests: [{ expectedStatus: 'passed', annotations: [{ type: 'fail' }] }] }),
    'serial-abort'
  );
});

test('signatureMatches ignores ANSI colour and the recording worktree path', () => {
  // Playwright's expect() output is full of SGR codes and errorLocation.file is
  // an absolute path embedding whichever worktree recorded the run, so an exact
  // string comparison on either would never match anywhere but this machine.
  const entry = RETIRED_QUARANTINE[
    Object.keys(RETIRED_QUARANTINE).find((k) => k.startsWith('admin-referendums'))
  ];
  const coloured =
    'Error: \u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22m' +
    'toBe\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m) // Object.is equality' +
    '\u001b[22m\n\nExpected: \u001b[32m2\u001b[39m\nReceived: \u001b[31mundefined\u001b[39m';
  const at = (file) => ({ file: file, line: 452, column: 45 });
  const spec = (file, message) => ({
    tests: [{ results: [{ status: 'failed', error: { message: message }, errorLocation: at(file) }] }]
  });

  assert.ok(
    gate.signatureMatches(
      spec('C:\\some\\other\\worktree\\e2e\\admin-referendums.spec.js', coloured),
      entry
    ),
    'a different worktree recording the same flake must still match'
  );
  assert.ok(
    !gate.signatureMatches(spec('C:\\w\\e2e\\admin-referendums.spec.js', 'Error: 500 from parse'), entry),
    'a server error at the same line must NOT match'
  );
  assert.ok(
    !gate.signatureMatches(spec('C:\\w\\e2e\\other.spec.js', coloured), entry),
    'the same message from a different file must NOT match'
  );
  assert.ok(
    !gate.signatureMatches({ tests: [{ results: [{ status: 'passed' }] }] }, entry),
    'no failed result means we are not looking at what we think we are'
  );
});

test('the port sweep is derived from e2e/ports.js and covers the default band', () => {
  // Never a hardcoded 1337-1344: `e2e/ports.js` is what playwright.config.js and
  // global-setup.js already read. But an E2E_WORKERS=2 run must still refuse to
  // start on top of six orphaned backends from a previous eight-worker run.
  const ports = require('../e2e/ports');
  const swept = gate.portsToSweep();

  for (const p of ports.allPorts()) {
    assert.ok(swept.includes(p), 'a port this run will use is not swept: ' + p);
  }
  for (let i = 0; i < gate.MIN_SWEEP_WIDTH; i++) {
    assert.ok(
      swept.includes(ports.BASE_PORT + i),
      'the default eight-worker band must be swept whatever this run uses'
    );
  }
  assert.deepStrictEqual(swept, [...swept].sort((a, b) => a - b));
  assert.strictEqual(new Set(swept).size, swept.length, 'no port swept twice');
});

// ---------------------------------------------------------------------------
// The launch path -- the one region no test could reach, and the one that
// contained a blocking defect
// ---------------------------------------------------------------------------

test('the Playwright CLI specifier actually resolves', () => {
  // This was `require.resolve('@playwright/test/cli.js')`, and it was the FIRST
  // statement of the only function that launches the suite. The package
  // declares an exports map -- {".", "./cli", "./package.json", "./reporter"} --
  // so Node refused the './cli.js' subpath with ERR_PACKAGE_PATH_NOT_EXPORTED
  // even though cli.js is right there on disk. Every real `npm run gate` died
  // on a raw stack trace after passing every pre-flight check.
  //
  // Costs no suite run, and would have caught it.
  assert.doesNotThrow(() => gate.resolvePlaywrightCli());
  assert.ok(
    /[\\/]cli\.js$/.test(gate.resolvePlaywrightCli()),
    'expected the Playwright CLI entry point, got ' + gate.resolvePlaywrightCli()
  );
  assert.ok(fs.existsSync(gate.resolvePlaywrightCli()), 'and the file must exist');
});

test('a candidate that is valid JSON but not an object says WHY', () => {
  // `JSON.parse('null')` succeeds and returns a falsy value, so gating the
  // shape checks on the value itself let `null` skip all of them and fall
  // through to a refusal with an EMPTY reason list -- a tool whose whole job is
  // explaining why a run cannot be trusted going wordless on the most
  // degenerate input there is.
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'yorick-gate-test-'));
  try {
    for (const body of ['null', '[]', '7', '"a string"']) {
      const p = path.join(tmp, 'x.json');
      fs.writeFileSync(p, body);
      const r = judge(fix('serial-baseline.json'), p);
      assert.strictEqual(r.exitCode, gate.EXIT_DID_NOT_RUN, 'must refuse ' + body);
      assert.ok(
        r.integrityFailed.some((f) => f.includes('not a Playwright report')),
        'refused ' + body + ' with no reason: ' + JSON.stringify(r.integrityFailed)
      );
      assert.ok(
        r.lines.some((l) => l.includes('not a Playwright report')),
        'the reason must reach the page for ' + body
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the COVERAGE partition adds up to the total printed under it', (t) => {
  // The four labelled rows are a partition of `baselinePassed`. `n.removed`
  // counts every removed key regardless of its baseline outcome, so printing it
  // there made the column visibly not close: m18 vs an empty report showed
  // 0 + 0 + 0 + 451 under a heading of 448, because the 3 deliberate
  // `test.skip()`s never passed. In THE RUN DID NOT HAPPEN -- the one output
  // that has to be maximally credible -- arithmetic that does not close is what
  // makes a reader stop believing the rest of the page.
  if (needRuns(t, ['m18.json'])) return;
  const r = judge(run('m18.json'), fix('empty-report.json'));
  const n = r.numbers;
  assert.strictEqual(n.baselinePassed, 448);
  assert.strictEqual(n.removed, 451, 'the raw count is still available for the integrity message');
  assert.strictEqual(n.removedPassing, 448, 'but the partition row counts only passing tests');
  assert.strictEqual(
    n.samePass + n.newFail + n.lost + n.removedPassing,
    n.baselinePassed,
    'the partition must close'
  );
  assert.ok(
    r.integrityFailed.some((f) => f.includes('451 test(s) present in the baseline')),
    'the raw count belongs in the integrity failure: ' + r.integrityFailed.join(' | ')
  );
});

// ---------------------------------------------------------------------------
// Argument parsing -- a bad flag must never cost a five-minute suite run
// ---------------------------------------------------------------------------

/**
 * Run the gate as a child process and capture its refusal.
 *
 * Every invocation here is deliberately shaped so that a REGRESSION of the fix
 * under test still cannot launch Playwright: either --skip-run is present, or
 * the baseline path does not exist, so the worst case is a different exit-2
 * message rather than four minutes of eight browsers.
 */
function runGate(args) {
  const res = require('child_process').spawnSync(
    process.execPath, [path.join(ROOT, 'gate.js')].concat(args),
    { cwd: ROOT, encoding: 'utf8' }
  );
  return { code: res.status, err: res.stderr || '', out: res.stdout || '' };
}

test('a value-taking flag refuses to swallow the flag after it', () => {
  // `--name --skip-run --baseline ...` set name to the string "--skip-run",
  // left skipRun false, and fell straight through to spawning the full suite --
  // precisely the resource this tool exists to protect.
  const r = runGate(['--name', '--skip-run', '--baseline', 'no-such-baseline.json']);
  assert.strictEqual(r.code, gate.EXIT_DID_NOT_RUN);
  assert.ok(/--name needs a value/.test(r.err), r.err.split('\n')[0]);
  assert.ok(!/running the suite/.test(r.out), 'it must not have launched anything');
});

test('a trailing --filter with no value is refused, not read as "compare everything"', () => {
  // `undefined` became `null` downstream, silently turning an intended one-file
  // heal run into a whole-suite comparison.
  const r = runGate(['--skip-run', '--baseline', 'runs/m18.json', '--filter']);
  assert.strictEqual(r.code, gate.EXIT_DID_NOT_RUN);
  assert.ok(/--filter needs a value/.test(r.err), r.err.split('\n')[0]);
});

test('--not-before rejects an unparseable instant instead of calling the run stale', () => {
  // Date.parse('yesterday') is NaN, NaN != null, so the freshness check ran
  // against it and reported "the candidate report is STALE" -- diagnosing a
  // typo in an argument as a dead suite. On current Node it was worse:
  // new Date(NaN).toISOString() throws, so it died on a RangeError stack trace.
  const r = runGate([
    '--skip-run', '--baseline', 'runs/m18.json', '--candidate', 'runs/m19.json',
    '--not-before', 'yesterday'
  ]);
  assert.strictEqual(r.code, gate.EXIT_DID_NOT_RUN);
  assert.ok(/--not-before is not a parseable instant/.test(r.err), r.err.split('\n')[0]);
  assert.ok(!/STALE/.test(r.out + r.err), 'a bad argument is not a dead suite');
  assert.ok(!/RangeError/.test(r.err), 'and it must not be a stack trace');
});

test('--not-before is refused on a real run rather than silently discarded', () => {
  // It was overwritten with Date.now() inside the !skipRun branch, so the flag
  // did nothing on exactly the invocation someone would reach for it on.
  // Silently ignoring an argument is worse than not accepting it.
  const r = runGate(['--name', 'never-created', '--not-before', '2026-08-19T00:00:00Z']);
  assert.strictEqual(r.code, gate.EXIT_DID_NOT_RUN);
  assert.ok(/--not-before only applies to --skip-run/.test(r.err), r.err.split('\n')[0]);
  assert.ok(!/running the suite/.test(r.out), 'and it must refuse before launching anything');
  assert.ok(
    !fs.existsSync(run('never-created.json')),
    'the refusal must happen before any report path is claimed'
  );
});

test('--help states that only exit 0 means proceed', () => {
  // The default quarantine makes the blocking m18-vs-m19 case exit 3, not 1;
  // only --no-quarantine on that pair exits 1. Any wrapper testing for 1 alone
  // reads a stranded-coverage run as success, so the contract has to say so
  // where a caller will actually look.
  const r = runGate(['--help']);
  assert.strictEqual(r.code, gate.EXIT_PASS);
  assert.ok(/ONLY 0 MEANS PROCEED/.test(r.out), r.out);
  assert.ok(/exit != 0/.test(r.out), 'and it must name the test callers should use');
});

test('a free port probes as free and an occupied one as occupied', async () => {
  const net = require('net');
  const server = net.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const busy = await gate.probePort(port, 1000);
    assert.strictEqual(busy.listening, true, 'a live listener must read as busy');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const free = await gate.probePort(port, 1000);
  assert.strictEqual(free.listening, false, 'the same port must read as free once closed');
  assert.strictEqual(free.why, 'ECONNREFUSED');
});
