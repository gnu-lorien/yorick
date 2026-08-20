#!/usr/bin/env node
/**
 * Run the E2E suite and refuse to call it clean unless it actually ran.
 *
 * `diff-runs.js` is the oracle: it classifies every test across two Playwright
 * JSON reports and reports NEW-FAIL. It is trustworthy -- eight self-tests in
 * `test/diff-runs.test.js` hold it to that -- and this file does not modify it,
 * does not reimplement it, and does not scrape its stdout. It requires it as a
 * module and wraps it.
 *
 * The wrapping exists because the oracle answers exactly one question ("which
 * tests passed then failed?") and the server phase of the migration can go
 * wrong in three ways that question cannot see. All three were measured on real
 * artifacts in `runs/`; the numbers are quoted so that anyone deleting an
 * assertion later can see what it cost to learn it was needed.
 *
 * Hole A -- the oracle passes when NOTHING RAN.
 *   Measured: `node diff-runs.js runs/m18.json <an empty report>` prints
 *   "No regressions." and exits 0. It reports `newFail: 0, samePass: 0,
 *   removed: 451`, and `diff-runs.js:222` keys the exit code off `newFail`
 *   alone. This is not hypothetical: an abort inside `e2e/global-setup.js`
 *   still writes a JSON report -- valid, fresh, `suites: []`, all stats zero,
 *   with the reason in `errors[0]` -- and the first thing S10 does (bumping the
 *   mongo driver under parse-server) is expected to break `seed_db.js` and
 *   produce exactly that file. The gate's INTEGRITY block is the answer, and
 *   it says "THE RUN DID NOT HAPPEN", never "no regressions".
 *
 * Hole B -- `reuseExistingServer: !CI` (playwright.config.js:129).
 *   With no CI flag, Playwright adopts a backend that is already listening
 *   instead of starting one, and `index.js` prints no version banner, so you
 *   measure yesterday's server and nothing anywhere says so. The gate sweeps
 *   every port a run will use before launching and forces `CI=1` for the child.
 *   Both, not either: the sweep is the only thing that catches a wedged
 *   listener that accepts TCP but never answers HTTP (Playwright's own
 *   availability probe has no timeout and hangs on it indefinitely), and CI=1
 *   is the only thing that closes the gap between the sweep and the launch.
 *
 * Hole C -- one NEW-FAIL can mean fifteen broken tests.
 *   17 of the 21 spec files are `test.describe.configure({ mode: 'serial' })`,
 *   so a hard failure abandons the rest of its file, and `diff-runs.js:131-134`
 *   drops any pair where either side is skipped into an undifferentiated
 *   `skipped` count that never touches the exit code. Measured, m18 -> m19:
 *
 *       1  NEW-FAIL          <- all the oracle can say
 *     433  same-pass         <- was 448
 *      17  skipped           <- was 3
 *
 *   The one NEW-FAIL is test 114, and behind it 14 tests in
 *   `assets-rename-portrait.spec.js` never ran. Those 14 are the entire Parse
 *   File surface: portrait upload, content-type, pixel decode, byte-match on
 *   eight render surfaces, replacement, rejection, troupe portraits -- which is
 *   precisely what a mongo/GridStore change is most likely to break. So the
 *   gate counts LOST separately from NEW-FAIL and prints the honest total,
 *   "tests that stopped passing", on every run.
 *
 * Quarantine
 * ----------
 * Two tests are pre-existing harness noise (see the QUARANTINE constant and
 * docs/runbooks/harness-noise-floor.md). Quarantine here may downgrade a
 * VERDICT; it may never suppress a MEASUREMENT. A forgiven NEW-FAIL yields
 * INCONCLUSIVE, not PASS, because green is reserved for runs that measured
 * everything -- and the tests stranded behind a forgiven failure are reported
 * by name with the command that re-measures them.
 *
 * Exit codes -- ONLY 0 MEANS PROCEED
 * ----------------------------------
 *   0  PASS              everything that passed in the baseline still passes
 *   1  FAIL              regressions, or coverage lost behind something unknown
 *   2  DID NOT RUN       the candidate report is missing, stale, empty or
 *                        malformed -- deliberately the same code `diff-runs.js`
 *                        uses for "I could not do my job"
 *   3  INCONCLUSIVE      only quarantined failures, but coverage was lost
 *                        behind them and has not been re-measured
 *
 * Callers branch on `exit != 0`, never on `exit == 1`. The default quarantine
 * makes the blocking m18-vs-m19 case exit 3; the same pair under
 * `--no-quarantine` exits 1. A wrapper testing for 1 alone reads a
 * stranded-coverage run as success.
 *
 * Usage
 * -----
 *   node gate.js --name m21                      run the suite, then judge it
 *   node gate.js --skip-run --name m19 \
 *                --baseline runs/m18.json        judge an already-recorded run
 *
 * Run `node gate.js --help` for the full flag list.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

// The oracle. Required, never modified, never re-implemented. If you find
// yourself wanting to change how a test is classified, change it there and let
// its eight self-tests judge you.
const { flatten, compare } = require('./diff-runs');

// Ports are derived, never hardcoded: `e2e/ports.js` is the single source both
// playwright.config.js and e2e/global-setup.js already read.
const ports = require('./e2e/ports');

const ROOT = __dirname;
const RUNS_DIR = path.join(ROOT, 'runs');

const PASSED = 'passed';
const FAILED = 'failed';
const SKIPPED = 'skipped';

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_DID_NOT_RUN = 2;
const EXIT_INCONCLUSIVE = 3;

/**
 * How far the candidate's total test count may drift from the baseline's.
 *
 * The number has to sit in a band with real edges on both sides. Below it: the
 * only legitimate drift ever observed across the 110 recorded runs in `runs/`
 * is +1 key (baseline 450 -> m18 451, one test added in
 * `lifecycle-vampire.spec.js`), which is 0.2%. Above it: the smallest serial
 * tail that matters is 14 tests (the assets-rename-portrait tail behind test
 * 114), so the band must stay well under that or a whole tail could vanish from
 * *discovery* -- not merely from execution -- inside the tolerance.
 *
 * 2% of 451 is 10. That forgives an order of magnitude more drift than has ever
 * happened and still cannot hide the smallest tail. The floor of 2 exists so
 * that a `--filter`ed comparison over a handful of tests still gets a usable
 * band instead of a zero-width one.
 *
 * This check only catches gross discovery failures. It is NOT the no-op
 * detector -- an all-skipped report has a perfect key count. The coverage
 * assertions below are what catch that.
 */
const COUNT_TOLERANCE_FRACTION = 0.02;
const COUNT_TOLERANCE_FLOOR = 2;

/**
 * How many ports to sweep even if this run would use fewer.
 *
 * `allPorts()` returns one port per worker, and worker count is
 * `E2E_WORKERS` or `min(8, cpus/4)` -- 8 on this machine. A run launched with
 * `E2E_WORKERS=2` would only sweep 1337-1338 and would happily start on top of
 * six orphaned backends from a previous eight-worker run. Sweeping the full
 * default band as well costs about 40ms and removes that hole.
 */
const MIN_SWEEP_WIDTH = 8;

/**
 * ===========================================================================
 * QUARANTINE -- two known-noisy tests, forgiven only under a pinned signature.
 * ===========================================================================
 *
 * Grep `QUARANTINE` to find this. To remove an entry, delete its block: nothing
 * else in this file names these tests, and the gate prints a loud QUARANTINE
 * section on every run precisely so that nobody forgets they are here.
 *
 * Both are pre-existing harness noise, not migration damage, and both are
 * documented in docs/runbooks/harness-noise-floor.md. The rate is roughly one
 * bad run in seven on a quiet machine and one in three on a loaded one.
 *
 * The signature pin is the load-bearing part. Forgiving a test by NAME would
 * forgive it for any reason at all, including "parse-server 9 returned a 500".
 * Forgiving it only when the failure looks exactly like the recorded harness
 * flake means a genuine server regression on the same test is still a FAIL. A
 * mongo-driver failure does not produce a jQuery Mobile transition timeout at
 * `jqm-helpers.js:68:11`.
 *
 * `messageRe` is matched against the ANSI-stripped message (Playwright's expect
 * output is full of colour codes), and `errorLocation.file` is matched as a
 * repo-relative suffix because the recorded absolute paths embed whichever
 * worktree recorded them.
 */
const QUARANTINE = {
  // Test 49. Fails with a BYTE-IDENTICAL signature on both stacks:
  // runs/candidate.json, runs/vendor.json and runs/w4a.json were recorded on
  // the legacy parse-server 2.8.4 / Parse 1.5 stack and carry exactly the same
  // string that runs/m17.json and runs/m20.json produce under parse@8. So it is
  // the harness and the migration did not change it.
  //
  // Cost of forgiving it: a serial tail of 4 -- tests 50-53 -- of which 50 and
  // 51 are the two AUTHORIZATION tests in that file ("a non-patron is prevented
  // from voting", "an unauthenticated visitor cannot reach #referendum/:id").
  // That is why a forgiven failure is INCONCLUSIVE and not PASS.
  ['admin-referendums.spec.js :: Task 3 - Referendums: Creation And Voting :: ' +
  '49 A third user votes for the same option as the first; that tally reaches 2']: {
    why: 'harness noise; byte-identical signature on the legacy stack (candidate/vendor/w4a)',
    doc: 'docs/runbooks/harness-noise-floor.md',
    messageRe: /^Error: expect\(received\)\.toBe\(expected\)[\s\S]*Expected: 2[\s\S]*Received: undefined/,
    errorLocation: { file: 'e2e/admin-referendums.spec.js', line: 452, column: 45 },
    tail: 4
  },

  // Test 114. The jQuery Mobile transition-lock flake root-caused in
  // harness-noise-floor.md ("What the bug was"): a stuck `isPageTransitioning`
  // leaves every subsequent changePage queued and undrained, so the hash moves
  // and the active page never does. `c5f8d5e` added an 8s self-heal; the test
  // still loses the race under eight-worker load.
  //
  // The `active page is` value varies (#splashscreen in m18/m19/vendor,
  // #character-log in candidate/w4a) and the hash embeds a random objectId, so
  // the pin is a PREFIX on the message plus an exact errorLocation -- never a
  // string equality.
  //
  // Cost of forgiving it: a serial tail of 14 -- tests 115-128, the entire
  // Parse File surface. This is the most expensive quarantine in the file and
  // the one most likely to hide S10 damage; see the header's Hole C.
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
// Reading reports
// ---------------------------------------------------------------------------

/** Strip the SGR colour codes Playwright bakes into expect() messages. */
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Index a report as `Map<key, spec>`, in emission order.
 *
 * `diff-runs.js`'s `flatten()` returns only the collapsed outcome, and the gate
 * needs the spec itself: the error messages for the signature pin, the
 * annotations that separate a deliberate `test.skip()` from a serial-abort
 * tail, and the ordering that says which tests sit *behind* a failure.
 *
 * The walk is a deliberate duplicate of `flatten()`'s. That is a drift risk, so
 * `test/gate.test.js` asserts the two produce identical key sets over the real
 * reports and the diff-runs fixtures. If you change one, the test will tell you
 * about the other.
 */
function specIndex(report) {
  const out = new Map();

  function walk(suite, file, p) {
    const suiteFile = suite.file || file;
    for (const spec of suite.specs || []) {
      const key =
        (spec.file || suiteFile) +
        ' :: ' +
        (p.length ? p.join(' > ') + ' :: ' : '') +
        spec.title;
      out.set(key, spec);
    }
    for (const child of suite.suites || []) {
      const isFileSuite = !p.length && child.title === (child.file || suiteFile);
      walk(child, suiteFile, isFileSuite ? p : p.concat(child.title));
    }
  }

  for (const suite of report.suites || []) {
    walk(suite, suite.file || suite.title, []);
  }
  return out;
}

/**
 * Why a spec was skipped.
 *
 * Playwright distinguishes the two cleanly and the distinction is the whole of
 * Hole C. Verified across every skip in m18/m19/m20/candidate with no
 * exceptions:
 *
 *   deliberate `test.skip()`  ->  expectedStatus 'skipped', annotation {type:'skip'}
 *   serial-abort tail         ->  expectedStatus 'passed',  no skip annotation
 *
 * The annotation is the stable discriminator: `expectedStatus` on a
 * `test.fail()` test reads 'failed' when it runs and 'passed' when it is
 * serial-abort-skipped, so it is not a stable property of a test across runs.
 * It is still correct for the skip question, so both are checked.
 *
 * `spec.ok` is useless here -- it is `true` for a test that never ran.
 */
function skipKind(spec) {
  for (const t of spec.tests || []) {
    if (t.expectedStatus === SKIPPED) return 'deliberate';
    if ((t.annotations || []).some((a) => a.type === 'skip')) return 'deliberate';
  }
  return 'serial-abort';
}

/** The spec file a key belongs to -- everything before the first ' :: '. */
function fileOf(key) {
  const i = key.indexOf(' :: ');
  return i === -1 ? key : key.slice(0, i);
}

/** Does a failed result look like the recorded harness flake? */
function signatureMatches(spec, entry) {
  const failures = [];
  for (const t of spec.tests || []) {
    for (const res of t.results || []) {
      if (res.status === PASSED || res.status === SKIPPED) continue;
      failures.push(res);
    }
  }
  // No failed result at all means we are not looking at what we think we are
  // looking at. Refuse rather than forgive.
  if (!failures.length) return false;

  for (const res of failures) {
    const err = res.error || (res.errors || [])[0];
    if (!err || !err.message) return false;
    if (!entry.messageRe.test(stripAnsi(err.message))) return false;

    const loc = res.errorLocation;
    if (!loc || !loc.file) return false;
    const seen = String(loc.file).replace(/\\/g, '/');
    const want = entry.errorLocation.file;
    if (seen !== want && !seen.endsWith('/' + want)) return false;
    if (loc.line !== entry.errorLocation.line) return false;
    if (loc.column !== entry.errorLocation.column) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The judgement
// ---------------------------------------------------------------------------

/**
 * Judge a candidate report against a baseline.
 *
 * Pure: reads two files and returns a verdict. Everything that touches the
 * network, the clock or a child process lives in the CLI half below, which is
 * what lets `test/gate.test.js` exercise the whole judgement without burning a
 * five-minute suite run.
 *
 * opts: { baselinePath, candidatePath, filter, quarantine, notBefore }
 *   quarantine  an object shaped like QUARANTINE, or null to forgive nothing
 *   notBefore   epoch ms; the candidate's own recorded start time must be at or
 *               after this or the report is stale. Null skips the check.
 */
function evaluate(opts) {
  const filter = opts.filter || null;
  const quarantine = opts.quarantine || {};
  const result = {
    verdict: null,
    exitCode: null,
    baselinePath: opts.baselinePath,
    candidatePath: opts.candidatePath,
    filter: filter,
    integrity: [],
    integrityFailed: [],
    failures: [],
    warnings: [],
    numbers: {},
    newFail: [],
    forgiven: [],
    lost: [],
    lostBehindQuarantine: [],
    lostUnexplained: [],
    unnamedFailures: [],
    darkBehindBaselineFailure: [],
    quarantineStatus: [],
    quarantineEvaluated: false,
    lines: []
  };

  const fail = (why) => {
    result.integrityFailed.push(why);
  };
  const ok = (what) => {
    result.integrity.push(what);
  };

  // ---- 1. the baseline must be readable; a broken baseline is a tool error --
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(opts.baselinePath, 'utf8'));
  } catch (err) {
    result.verdict = 'DID NOT RUN';
    result.exitCode = EXIT_DID_NOT_RUN;
    result.integrityFailed.push('baseline unreadable: ' + err.message);
    result.lines = render(result);
    return result;
  }

  // ---- 2. the candidate must exist and parse ------------------------------
  //
  // This is the first place Hole A can be caught, and the message has to say
  // "the run did not happen". `diff-runs.js` exits 2 on a missing file already,
  // but only when the file is genuinely absent -- and the stale-report trap
  // (below) is exactly the case where it is not.
  let candidate = null;
  let parsed = false;
  if (!fs.existsSync(opts.candidatePath)) {
    fail('the candidate report does not exist: ' + opts.candidatePath);
  } else {
    try {
      candidate = JSON.parse(fs.readFileSync(opts.candidatePath, 'utf8'));
      parsed = true;
      ok('candidate report exists and parses');
    } catch (err) {
      fail('the candidate report is not valid JSON: ' + err.message);
    }
  }

  // `parsed`, not `candidate`, because `JSON.parse('null')` succeeds and
  // returns a falsy value. Gating this block on the value itself let `null`
  // skip every check silently and drop through to the bottom, where the
  // refusal printed the THE RUN DID NOT HAPPEN banner with an EMPTY reason
  // list -- a tool whose entire job is explaining why a run cannot be trusted
  // going wordless on the most degenerate input there is.
  if (parsed) {
    // ---- 3. it must be shaped like a Playwright report --------------------
    //
    // `{}` is valid JSON, and `node diff-runs.js runs/m18.json` against it
    // exits 0 with "No regressions." Valid-but-not-a-report is the gap
    // truncation detection does not cover, because a truncated file is already
    // invalid JSON and fails loudly at step 2. `null`, `[]` and `7` are the
    // same gap wearing a smaller hat, so the object test is explicit and comes
    // first rather than being implied by a property access on a truthy value.
    const isObject =
      candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
    const stats = isObject ? candidate.stats : null;
    const shapeOk =
      isObject &&
      candidate.config && typeof candidate.config === 'object' &&
      Array.isArray(candidate.suites) &&
      Array.isArray(candidate.errors) &&
      stats && typeof stats === 'object' &&
      typeof stats.startTime === 'string' &&
      ['duration', 'expected', 'skipped', 'unexpected', 'flaky'].every(
        (k) => typeof stats[k] === 'number'
      );
    if (!shapeOk) {
      fail('the candidate is valid JSON but is not a Playwright report ' +
        '(missing config/suites/errors/stats)');
      candidate = null;
    } else {
      ok('candidate is shaped like a Playwright report');
    }
  }

  if (candidate) {
    const stats = candidate.stats;

    // ---- 4. freshness -----------------------------------------------------
    //
    // The stale-report trap: the JSON reporter writes ONCE, at the very end of
    // the process. Anything that kills Playwright before that -- a config load
    // error, a hard kill, the `pretest:e2e` syntax gate, or CI=1 finding a port
    // busy -- leaves the PREVIOUS run's report on disk, with its old content
    // and its old mtime, and a gate that just reads that path diffs yesterday's
    // verdict as though it were today's.
    //
    // `stats.startTime` is set at onConfigure, i.e. at the start of the process
    // that wrote the file, so it is a freshness token that travels INSIDE the
    // report and survives being copied, touched or restored. mtime is a
    // secondary and is reported but not trusted.
    if (opts.notBefore != null) {
      const started = Date.parse(stats.startTime);
      if (!(started >= opts.notBefore)) {
        fail(
          'the candidate report is STALE: it records a start time of ' +
          stats.startTime + ', which is before this run began (' +
          new Date(opts.notBefore).toISOString() + '). ' +
          'The suite died before it could write a report and you are looking at ' +
          'the previous one.'
        );
      } else {
        ok('candidate is fresh (recorded start ' + stats.startTime + ')');
      }
    }

    // ---- 5. the run did not abort ----------------------------------------
    //
    // The cheapest, most specific abort detector in the file, and it carries
    // the reason. Every recorded run in `runs/` has `errors: []`. A globalSetup
    // throw -- which is what a broken `seed_db.js` produces -- writes a report
    // with `suites: []`, all stats zero, and the reason sitting right here.
    if (candidate.errors.length) {
      fail(
        'the run ABORTED: ' + candidate.errors.length + ' top-level error(s), first is:\n' +
        '      ' + stripAnsi(candidate.errors[0].message || '').split('\n')[0]
      );
    } else {
      ok('no top-level errors in the report');
    }

    // ---- 6. the run produced verdicts ------------------------------------
    //
    // Hole A, stated directly. An aborted run, a --grep that matched nothing,
    // and a globalSetup failure all land on zero here.
    const verdicted = stats.expected + stats.unexpected;
    if (verdicted <= 0) {
      fail(
        'THE RUN DID NOT HAPPEN: expected + unexpected = 0. Not one test ' +
        'returned a verdict. ' +
        '(diff-runs.js on its own reports "No regressions." here and exits 0 -- ' +
        'that is the single reason this gate exists.)'
      );
    } else {
      ok('expected + unexpected = ' + verdicted + ' (the run produced verdicts)');
    }

    // ---- 7. the stats agree with the tests -------------------------------
    //
    // `expected + skipped + unexpected + flaky` equals the flattened key count
    // on every recorded run, because testMatch/testIgnore make the `admin` and
    // `chromium` projects disjoint so every spec contributes exactly one test
    // entry. A candidate where those disagree is malformed or is double-counting
    // projects, and must not reach the oracle: the oracle's "clean" answer on
    // garbage is indistinguishable from its "clean" answer on a good run.
    const declared = stats.expected + stats.skipped + stats.unexpected + stats.flaky;
    const actual = specIndex(candidate).size;
    if (declared !== actual) {
      fail(
        'the candidate is internally inconsistent: stats sum to ' + declared +
        ' but the report contains ' + actual + ' tests'
      );
    } else {
      ok('stats sum (' + declared + ') matches the tests in the report');
    }
  }

  // Without a usable candidate there is nothing left to judge.
  if (!candidate) {
    result.verdict = 'DID NOT RUN';
    result.exitCode = EXIT_DID_NOT_RUN;
    result.lines = render(result);
    return result;
  }

  // ---- the comparison itself, delegated ----------------------------------
  const bFlat = flatten(baseline);
  const cFlat = flatten(candidate);
  const diff = compare(bFlat, cFlat, filter);

  const bSpecs = specIndex(baseline);
  const cSpecs = specIndex(candidate);
  const order = [...cSpecs.keys()];
  const ordinal = new Map(order.map((k, i) => [k, i]));

  const keep = (k) => !filter || k.includes(filter);
  const baselineKeys = [...bFlat.keys()].filter(keep);
  const candidateKeys = [...cFlat.keys()].filter(keep);
  const baselinePassed = baselineKeys.filter((k) => bFlat.get(k).outcome === PASSED);

  const n = result.numbers;
  n.baselineKeys = baselineKeys.length;
  n.candidateKeys = candidateKeys.length;
  n.baselinePassed = baselinePassed.length;
  n.baselineFailed = baselineKeys.filter((k) => bFlat.get(k).outcome === FAILED).length;
  n.samePass = diff.samePass.length;
  n.newFail = diff.newFail.length;
  n.newPass = diff.newPass.length;
  n.sameFail = diff.sameFail.length;
  n.added = diff.added.length;
  n.removed = diff.removed.length;
  // The COVERAGE block prints a PARTITION of `baselinePassed`, so its removed
  // row has to count only the removed tests that actually passed in the
  // baseline. `n.removed` counts every removed key regardless of outcome, and
  // printing that in the partition made the column visibly not add up: m18 vs
  // an empty report showed 0 + 0 + 0 + 451 under a heading of 448, because the
  // 3 deliberate `test.skip()`s never passed. In the one output that has to be
  // maximally credible -- THE RUN DID NOT HAPPEN -- arithmetic that does not
  // close is what makes a reader stop believing the rest of the page. The raw
  // count stays on `n.removed`, where the integrity failure above quotes it.
  n.removedPassing = diff.removed.filter((k) => bFlat.get(k).outcome === PASSED).length;
  n.flaky = diff.flaky.length;
  n.baselineSkipped = baselineKeys.filter((k) => bFlat.get(k).outcome === SKIPPED).length;
  n.candidateSkipped = candidateKeys.filter((k) => cFlat.get(k).outcome === SKIPPED).length;
  n.skippedDelta = n.candidateSkipped - n.baselineSkipped;
  n.statsExpected = candidate.stats.expected;
  n.statsUnexpected = candidate.stats.unexpected;
  n.statsSkipped = candidate.stats.skipped;
  n.statsFlaky = candidate.stats.flaky;
  // Seeded here so the COVERAGE block still renders real numbers when the run
  // bails out at INTEGRITY -- an empty report has 451 removed and 0 lost, and
  // printing "undefined" next to that would undercut the one message that has
  // to land.
  n.lost = 0;
  n.stoppedPassing = n.baselinePassed - n.samePass;
  n.newFailUnforgiven = n.newFail;
  n.forgiven = 0;
  n.lostBehindQuarantine = 0;
  n.lostUnexplained = 0;
  n.unnamedFailures = 0;
  n.darkBehindBaselineFailure = 0;

  // ---- 8. the filter must select something -------------------------------
  //
  // A filter that matches nothing produces a perfectly clean, entirely
  // meaningless PASS: zero removed, zero newFail, zero everything. That is a
  // no-op wearing a green hat.
  if (!baselineKeys.length) {
    fail(
      filter
        ? 'the filter ' + JSON.stringify(filter) + ' matched no tests in the baseline; ' +
          'there is nothing to compare'
        : 'the baseline contains no tests'
    );
  }

  // ---- 9. discovery ------------------------------------------------------
  const band = Math.max(
    COUNT_TOLERANCE_FLOOR,
    Math.ceil(n.baselineKeys * COUNT_TOLERANCE_FRACTION)
  );
  if (Math.abs(n.candidateKeys - n.baselineKeys) > band) {
    fail(
      'the candidate discovered ' + n.candidateKeys + ' tests, the baseline ' +
      n.baselineKeys + ' (tolerance +/-' + band + '). The suite that ran is not ' +
      'the suite the baseline recorded.'
    );
  } else if (n.baselineKeys) {
    ok('discovered ' + n.candidateKeys + ' tests vs baseline ' + n.baselineKeys +
      ' (within +/-' + band + ')');
  }

  // ---- 10. removed -------------------------------------------------------
  //
  // `diff-runs.js` deliberately does not fail on `removed`, because a rename is
  // indistinguishable from a deletion and renaming a test mid-migration is
  // legitimate. The gate does fail on it, because the same signal is what an
  // empty report looks like: m18 vs an empty report is `removed: 451`. If this
  // fires on a genuine rename, the answer is to re-record the baseline through
  // the gate -- which is what Step 2 of the plan asks for anyway -- not to
  // loosen this.
  if (n.removed > 0) {
    fail(
      n.removed + ' test(s) present in the baseline are absent from the candidate. ' +
      'Either the run did not discover them, or they were renamed or deleted -- ' +
      'if renamed, re-record the baseline through this gate.'
    );
  } else if (n.baselineKeys) {
    ok('removed = 0 (every baseline test is present in the candidate)');
  }

  if (result.integrityFailed.length) {
    result.verdict = 'DID NOT RUN';
    result.exitCode = EXIT_DID_NOT_RUN;
    result.lines = render(result);
    return result;
  }
  // Past this point the report is trustworthy enough to judge, so the
  // quarantine block below was genuinely evaluated rather than skipped.
  result.quarantineEvaluated = true;

  // ---- 11. coverage: what stopped passing --------------------------------
  //
  // The category `diff-runs.js` has no name for. Every key that PASSED in the
  // baseline is accounted for exactly once:
  //
  //   still passing   -> same-pass
  //   now failing     -> NEW-FAIL
  //   never ran       -> LOST        <- this one is invisible to the oracle
  //   not present     -> removed     (already a hard fail above)
  //
  // and `baselinePassed - samePass` is the honest headline: tests that stopped
  // passing. For m18 -> m19 that is 15, against a reported NEW-FAIL of 1.
  for (const key of baselinePassed) {
    const c = cFlat.get(key);
    if (!c || c.outcome !== SKIPPED) continue;
    const spec = cSpecs.get(key);
    const kind = spec ? skipKind(spec) : 'serial-abort';
    result.lost.push({ key: key, kind: kind });
  }
  n.lost = result.lost.length;
  n.stoppedPassing = n.baselinePassed - n.samePass;

  // ---- 12. quarantine ----------------------------------------------------
  //
  // Applied to NEW-FAIL only, one exact key at a time, under a signature pin.
  // No substring, no regex over keys, no file-level or describe-level
  // forgiveness: `--filter assets-rename-portrait` would silence all 30 tests
  // in that file including the tail, which is the opposite of the point.
  const forgivenKeys = new Set();
  // Keys the quarantine block has already pushed a failure for, so the
  // unnamed-failure assertion below does not report the same test twice under
  // two different headings.
  const quarantineClaimed = new Set();
  for (const key of Object.keys(quarantine)) {
    // The filter defines the scope of the whole comparison -- `compare()`
    // applies it to both sides -- so it has to scope quarantine as well. A
    // healing run over one spec file legitimately does not contain the
    // quarantined test that lives in a different file, and demanding it there
    // would make the cheap targeted re-run impossible.
    if (!keep(key)) continue;
    const entry = quarantine[key];
    const status = { key: key, why: entry.why, doc: entry.doc, state: null, detail: '' };

    const inBaseline = bFlat.has(key);
    const inCandidate = cFlat.has(key);
    if (!inBaseline || !inCandidate) {
      // R9: a quarantined key that has gone missing is a hard fail. Renaming or
      // deleting a noisy test to quiet the gate must not work.
      status.state = 'MISSING';
      status.detail = 'not present in ' + (!inBaseline ? 'the baseline' : 'the candidate') +
        ' -- a quarantined test may not be renamed or deleted while it is quarantined';
      result.failures.push('quarantined test ' + JSON.stringify(key) + ' is ' + status.detail);
    } else if (bFlat.get(key).outcome === FAILED) {
      // A quarantined test that ALREADY failed in the baseline is classified
      // `sameFail` by the oracle -- never printed, never non-zero -- and its
      // tail is skipped on both sides, so the whole tail disappears with no
      // output at all. That is how a degraded baseline bakes in a permanent
      // blind spot.
      status.state = 'BAD BASELINE';
      status.detail = 'failed in the BASELINE too, so its serial tail never ran on ' +
        'either side and the oracle prints nothing at all. Record a clean baseline.';
      result.failures.push(
        'quarantined test ' + JSON.stringify(key) + ' failed in the baseline: ' + status.detail
      );
    } else if (!diff.newFail.includes(key)) {
      // Three-way, never a boolean. This branch is reached whenever the pair is
      // not a NEW-FAIL, and "not a NEW-FAIL" is NOT the same as "did not fail":
      // `compare()` drops any pair where either side is skipped, so a
      // quarantined test that was SKIPPED in the baseline and FAILED in the
      // candidate lands here too. Reading "not SKIPPED" as "PASSED" printed
      //
      //   [PASSED] ... 114 Renaming to collide ...
      //       now:  passed this run -- consider removing the quarantine
      //
      // over a MongoServerError, and returned PASS/exit 0 -- the loud section
      // stating the exact opposite of the truth, and inviting the reader to
      // delete the pin that would have caught the same test next time.
      const outcome = cFlat.get(key).outcome;
      if (outcome === FAILED) {
        status.state = 'FAILED (UNCOMPARED)';
        status.detail =
          'FAILED this run, but it was SKIPPED in the baseline, so the oracle never ' +
          'classified the pair and the signature pin was never consulted. The pin is the ' +
          'whole defence here -- unapplied, it forgives nothing. Not forgiven.';
        result.failures.push(
          'quarantined test ' + JSON.stringify(key) + ' FAILED on a run whose baseline ' +
          'never measured it (baseline SKIPPED, candidate FAILED), so the recorded ' +
          'signature could not be checked against it'
        );
        quarantineClaimed.add(key);
      } else if (outcome === SKIPPED) {
        status.state = 'NOT RUN';
        status.detail = 'did not run this run';
      } else {
        status.state = 'PASSED';
        status.detail = 'passed this run -- consider removing the quarantine';
      }
    } else {
      const spec = cSpecs.get(key);
      if (spec && signatureMatches(spec, entry)) {
        status.state = 'FORGIVEN';
        status.detail = 'failed with the recorded signature (' +
          entry.errorLocation.file + ':' + entry.errorLocation.line + ':' +
          entry.errorLocation.column + ') -- known noise, not counted as a regression';
        forgivenKeys.add(key);
        result.forgiven.push(key);
      } else {
        // The whole reason the pin exists. An unrecognised error on a
        // quarantined key is a full FAIL: a mongo or parse-server failure will
        // not produce the recorded harness signature.
        status.state = 'UNRECOGNISED';
        status.detail = 'failed with an error that does NOT match the recorded ' +
          'harness signature. This is not the known flake. Not forgiven.';
        result.failures.push(
          'quarantined test ' + JSON.stringify(key) + ' failed with an unrecognised error ' +
          '(expected ' + entry.errorLocation.file + ':' + entry.errorLocation.line + ')'
        );
      }
    }
    result.quarantineStatus.push(status);
  }

  result.newFail = diff.newFail.filter((k) => !forgivenKeys.has(k));
  n.newFailUnforgiven = result.newFail.length;
  n.forgiven = result.forgiven.length;

  // ---- 12b. every failure in the candidate must be NAMED -----------------
  //
  // The mirror image of Hole C. Hole C is "a failure hides tests that never
  // ran"; this is "a test that never ran in the baseline hides a failure".
  //
  // `compare()` drops any pair where EITHER side is skipped into the untyped
  // `skipped` bucket (diff-runs.js:131-134), so baseline-SKIPPED plus
  // candidate-FAILED is classified as neither newFail nor sameFail. The
  // verdict keys entirely off newFail / lostUnexplained / skippedDelta, and
  // none of the three can see it. Measured, two ways:
  //
  //   Un-skip one of runs/baseline.json's three deliberate `test.skip()`s into
  //   a MongoServerError and the gate returned PASS / exit 0 on a report whose
  //   own `stats.unexpected` was 1.
  //
  //   The shape that will actually bite S10: record the Step 2 baseline on a
  //   run where a non-quarantined flake fires (one bad run in seven quiet, one
  //   in three loaded) and strands its serial tail. Then the mongo bump clears
  //   the flake and breaks all 22 stranded tests. Every one of them is
  //   baseline-skipped, so every one is invisible: the gate printed
  //   "0 NEW-FAIL / 0 LOST / 0 TESTS THAT STOPPED PASSING" and exit 0 beside a
  //   candidate whose own stats said `unexpected: 22`.
  //
  // `n.statsUnexpected` was computed and then read by nothing. This is what
  // reads it -- but the check works off `candidateKeys`, not off stats, so
  // `--filter` still scopes it correctly. Measured at 0 on baseline->m18,
  // m18->m19, baseline->m19 and m19->m20: no false positives on any recorded
  // pair.
  const named = new Set(diff.newFail.concat(diff.sameFail));
  result.unnamedFailures = candidateKeys.filter(
    (k) => cFlat.get(k).outcome === FAILED && !named.has(k) && !quarantineClaimed.has(k)
  );
  n.unnamedFailures = result.unnamedFailures.length;
  if (result.unnamedFailures.length) {
    result.failures.push(
      result.unnamedFailures.length + ' test(s) FAILED in the candidate that the comparison ' +
      'CANNOT NAME, because they were SKIPPED in the baseline. The oracle drops any pair ' +
      'where either side is skipped, so these sit in no category the verdict reads -- ' +
      'without this check the run reports PASS. The candidate\'s own stats say ' +
      'unexpected = ' + n.statsUnexpected + '.'
    );
  }

  // ---- 13. attribute the lost tests --------------------------------------
  //
  // A lost test is "behind" a forgiven failure when it is in the same spec file
  // AND later in the report's emission order, which is the file's serial order.
  // Same-file alone would be too generous (a test before the failure did run);
  // requiring the ordinal makes the attribution exact.
  //
  // Deliberate `test.skip()` tests are not lost -- they never ran in the
  // baseline either, so they cannot be in `baselinePassed`. If one shows up
  // here it means a test that used to run has been skipped in source, which is
  // a real coverage loss and is reported as unexplained.
  const forgivenPositions = new Map();
  for (const key of forgivenKeys) {
    forgivenPositions.set(fileOf(key), ordinal.has(key) ? ordinal.get(key) : -1);
  }
  for (const l of result.lost) {
    const at = ordinal.has(l.key) ? ordinal.get(l.key) : Infinity;
    const cut = forgivenPositions.get(fileOf(l.key));
    if (l.kind === 'serial-abort' && cut !== undefined && at > cut) {
      result.lostBehindQuarantine.push(l.key);
    } else {
      result.lostUnexplained.push(l.key);
    }
  }
  n.lostBehindQuarantine = result.lostBehindQuarantine.length;
  n.lostUnexplained = result.lostUnexplained.length;

  // ---- 13b. a forgiven flake may not grow its blast radius ---------------
  //
  // `tail` on each QUARANTINE entry is the cost that was MEASURED when the
  // entry was justified: 4 tests behind test 49, 14 behind test 114. It was
  // declared, documented as part of the pin, and then read by nothing -- so an
  // INCONCLUSIVE stranding 25 tests printed byte-identically in shape to one
  // stranding 14, and noticing the 79% growth relied on a human diffing two
  // runs by eye. A quarantine is an argument that a known cost is acceptable;
  // when the cost changes, the argument has not been made.
  //
  // Attribution is per FILE, matching step 13 above -- `forgivenPositions` is
  // already keyed by file, so per-key attribution would over-count whenever two
  // forgiven keys share a file and could fire on nothing. Only GROWTH fires: a
  // `--filter`ed heal run legitimately observes a shorter tail.
  const recordedTailByFile = new Map();
  for (const key of forgivenKeys) {
    const entry = quarantine[key];
    if (!entry || typeof entry.tail !== 'number') continue;
    const f = fileOf(key);
    recordedTailByFile.set(f, (recordedTailByFile.get(f) || 0) + entry.tail);
  }
  const observedTailByFile = new Map();
  for (const k of result.lostBehindQuarantine) {
    const f = fileOf(k);
    observedTailByFile.set(f, (observedTailByFile.get(f) || 0) + 1);
  }
  for (const [f, recorded] of recordedTailByFile) {
    const observed = observedTailByFile.get(f) || 0;
    if (observed > recorded) {
      result.failures.push(
        'the quarantined failure(s) in ' + f + ' stranded ' + observed + ' test(s), but the ' +
        'recorded cost of that quarantine is ' + recorded + '. The blast radius GREW, so ' +
        'this is not the quarantine that was justified -- something later in the file ' +
        'started failing too, or the file grew. Re-measure the file, then update `tail` in ' +
        'gate.js only if the new cost is genuinely acceptable.'
      );
    }
  }

  // ---- 14. the verdict ---------------------------------------------------
  if (result.newFail.length) {
    result.failures.push(
      result.newFail.length + ' NEW-FAIL: test(s) that passed in the baseline now fail'
    );
  }

  // Hole C, stated as the plan states it: samePass must not drop and skipped
  // must not rise. Both deltas are reported numerically whether or not they
  // fire, because the numbers are the argument.
  if (result.lostUnexplained.length) {
    const lostKinds = new Set(
      result.lost
        .filter((l) => result.lostUnexplained.includes(l.key))
        .map((l) => l.kind)
    );
    const because = lostKinds.has('deliberate')
      ? lostKinds.size > 1
        ? 'some behind a failure that is not quarantined, some now skipped in source'
        : 'they are now skipped in the source -- a test quieted by skipping it is ' +
          'still a test that stopped passing'
      : 'behind a failure that is not quarantined';
    result.failures.push(
      result.lostUnexplained.length + ' test(s) passed in the baseline and NEVER RAN in the ' +
      'candidate, ' + because + '. same-pass ' +
      n.baselinePassed + ' -> ' + n.samePass + ' (' + fmtDelta(n.samePass - n.baselinePassed) +
      '), skipped ' + n.baselineSkipped + ' -> ' + n.candidateSkipped +
      ' (' + fmtDelta(n.skippedDelta) + ')'
    );
  }

  // A skip rise with no lost baseline-passing test behind it still means tests
  // stopped running; it is caught here rather than being absorbed silently.
  if (n.skippedDelta > 0 && !result.lost.length) {
    result.failures.push(
      'skipped rose from ' + n.baselineSkipped + ' to ' + n.candidateSkipped +
      ' (' + fmtDelta(n.skippedDelta) + ') with no failure to explain it'
    );
  }

  // Worker count is not an integrity failure, but it is the single biggest
  // influence on the flake rate this suite has: the runbook records test 54
  // passing at four workers and failing at eight, and the noise floor measured
  // at one bad run in seven on a quiet box and one in three on a loaded one.
  // Comparing an eight-worker candidate against a four-worker baseline is
  // comparing two different experiments, so say so.
  const bw = (baseline.config || {}).workers;
  const cw = (candidate.config || {}).workers;
  if (bw && cw && bw !== cw) {
    result.warnings.push(
      'the baseline was recorded with ' + bw + ' worker(s) and the candidate with ' +
      cw + '. Worker count drives this suite\'s flake rate; a difference here ' +
      'means the two runs are not the same experiment.'
    );
  }

  // A test that FAILED in the baseline is classified `sameFail` by the oracle:
  // never printed, never non-zero. If it aborted a serial file, every test
  // behind it is skipped on BOTH sides, so `compare()` drops those pairs too
  // and the whole tail is dark with no output anywhere. That is a permanent
  // blind spot baked into every run from here on.
  //
  // The quarantine block above (see 'BAD BASELINE') already calls exactly this
  // situation a hard fail when the failing key happens to be on the quarantine
  // list. This used to be a WARNING and exit 0 when it was not -- so a known,
  // documented flake was refused and an UNKNOWN failure was forgiven, which is
  // precisely backwards. Measured: take m19 as a baseline and re-judge the same
  // shape and the gate printed `PASS -- all 433 tests that passed in the
  // baseline still pass.` with 1 test permanently failing and 14 permanently
  // dark, while printing the warning that says so.
  //
  // The tail is MEASURED, not asserted. The old warning claimed "their serial
  // tails never ran on either side" unconditionally, without checking whether a
  // tail existed or how big it was; citing the real number is what makes the
  // refusal actionable. A baseline failure with nothing stranded behind it
  // hides no coverage -- the failing test itself is visible in the same-fail
  // row -- so that stays a warning.
  if (n.baselineFailed > 0) {
    const failedAt = new Map();
    for (const k of baselineKeys) {
      if (bFlat.get(k).outcome !== FAILED) continue;
      const f = fileOf(k);
      const at = ordinal.has(k) ? ordinal.get(k) : -1;
      if (!failedAt.has(f) || at < failedAt.get(f)) failedAt.set(f, at);
    }
    for (const k of baselineKeys) {
      if (bFlat.get(k).outcome !== SKIPPED) continue;
      const c = cFlat.get(k);
      if (!c || c.outcome !== SKIPPED) continue;
      const cut = failedAt.get(fileOf(k));
      if (cut === undefined) continue;
      if ((ordinal.has(k) ? ordinal.get(k) : Infinity) <= cut) continue;
      // A deliberate `test.skip()` is not stranded -- the real suite carries 3
      // of them permanently and they never ran on either side by design.
      const bSpec = bSpecs.get(k);
      if (bSpec && skipKind(bSpec) === 'deliberate') continue;
      result.darkBehindBaselineFailure.push(k);
    }
    n.darkBehindBaselineFailure = result.darkBehindBaselineFailure.length;

    if (result.darkBehindBaselineFailure.length) {
      result.failures.push(
        n.baselineFailed + ' test(s) FAILED in the BASELINE, and ' +
        n.darkBehindBaselineFailure + ' test(s) stranded behind them never ran on EITHER ' +
        'side. The oracle calls those pairs same-fail and skipped; neither is ever printed ' +
        'and neither touches an exit code, so this baseline makes ' +
        (n.baselineFailed + n.darkBehindBaselineFailure) + ' test(s) permanently invisible ' +
        'to every run compared against it. Record a clean baseline -- a baseline this gate ' +
        'would not itself certify is not a baseline.'
      );
    } else {
      result.warnings.push(
        n.baselineFailed + ' test(s) already failed in the baseline. Nothing is stranded ' +
        'behind them, so no coverage is dark -- but the oracle calls them same-fail on ' +
        'every run from here, which forgives them permanently. Record a clean baseline.'
      );
    }
  }

  if (result.failures.length) {
    result.verdict = 'FAIL';
    result.exitCode = EXIT_FAIL;
  } else if (result.forgiven.length || result.lostBehindQuarantine.length) {
    // R6: a forgiven failure never yields PASS. Green is reserved for runs that
    // measured everything, and a forgiven failure means at minimum that one
    // test did not pass -- usually with a tail of others that did not run.
    result.verdict = 'INCONCLUSIVE';
    result.exitCode = EXIT_INCONCLUSIVE;
  } else {
    result.verdict = 'PASS';
    result.exitCode = EXIT_PASS;
  }

  result.lines = render(result);
  return result;
}

function fmtDelta(d) {
  return (d > 0 ? '+' : '') + d;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(r) {
  const L = [];
  const n = r.numbers;
  const num = (v) => String(v).padStart(5);

  L.push('');
  L.push('  E2E GATE');
  L.push('  ' + '-'.repeat(68));
  L.push('  baseline   ' + rel(r.baselinePath));
  L.push('  candidate  ' + rel(r.candidatePath));
  if (r.filter) L.push('  filter     ' + JSON.stringify(r.filter));
  L.push('');

  L.push('  INTEGRITY  -- did a run actually happen?');
  for (const line of r.integrity) L.push('    ok    ' + line);
  for (const line of r.integrityFailed) L.push('    FAIL  ' + line);
  L.push('');

  if (n.baselineKeys !== undefined) {
    L.push('  COVERAGE  -- what stopped passing?');
    L.push('  ' + num(n.baselinePassed) + '  passed in the baseline');
    L.push('  ' + num(n.samePass) + '  still passing');
    L.push('  ' + num(n.newFail) + '  NEW-FAIL   passed in the baseline, fails now');
    L.push('  ' + num(n.lost) + '  LOST       passed in the baseline, never ran');
    L.push('  ' + num(n.removedPassing) + '  removed    passed in the baseline, absent now');
    L.push('  ' + '-'.repeat(66));
    L.push('  ' + num(n.stoppedPassing) + '  TESTS THAT STOPPED PASSING');
    L.push('');
    L.push('  ' + num(n.candidateSkipped) + '  skipped    baseline had ' + n.baselineSkipped +
      ' (' + fmtDelta(n.skippedDelta) + ')');
    L.push('  ' + num(n.newPass) + '  new-pass');
    L.push('  ' + num(n.sameFail) + '  same-fail  already broken');
    L.push('  ' + num(n.added) + '  added');
    L.push('  ' + num(n.removed) + '  removed    absent from the candidate entirely');
    L.push('  ' + num(n.statsUnexpected) + '  unexpected the candidate\'s OWN stats. If this ' +
      'is non-zero and nothing');
    L.push('                  above accounts for it, the comparison is not seeing a failure.');
    L.push('  ' + num(n.flaky) + '  flaky      in at least one run');
    L.push('');
  }

  if (r.quarantineStatus.length) {
    L.push('  ' + '='.repeat(68));
    L.push('  QUARANTINE -- ' + r.quarantineStatus.length +
      ' test(s) are forgiven on a pinned signature.');
    L.push('  These are NOT clean. Grep gate.js for QUARANTINE to see or remove them.');
    L.push('  ' + '='.repeat(68));
    for (const q of r.quarantineStatus) {
      L.push('    [' + q.state + '] ' + q.key);
      L.push('        why:  ' + q.why);
      L.push('        doc:  ' + q.doc);
      L.push('        now:  ' + q.detail);
    }
    L.push('');
  } else if (r.quarantineEvaluated) {
    L.push('  QUARANTINE -- none (--no-quarantine, or the list is empty).');
    L.push('');
  }

  if (r.newFail.length) {
    L.push('  REGRESSIONS:');
    r.newFail.forEach((k) => L.push('    - ' + k));
    L.push('');
  }
  if (r.lostUnexplained.length) {
    L.push('  LOST -- passed in the baseline, never ran in the candidate:');
    r.lostUnexplained.forEach((k) => L.push('    - ' + k));
    L.push('');
  }
  if (r.lostBehindQuarantine.length) {
    L.push('  LOST behind a quarantined failure -- deferred, NOT waived:');
    r.lostBehindQuarantine.forEach((k) => L.push('    - ' + k));
    L.push('');
  }
  if (r.unnamedFailures.length) {
    L.push('  FAILED in the candidate but SKIPPED in the baseline -- the comparison has');
    L.push('  no category for these, so nothing else on this page counts them:');
    r.unnamedFailures.forEach((k) => L.push('    - ' + k));
    L.push('');
  }
  if (r.darkBehindBaselineFailure.length) {
    L.push('  DARK ON BOTH SIDES -- skipped in the baseline and skipped again now,');
    L.push('  behind a failure the baseline already carried:');
    r.darkBehindBaselineFailure.forEach((k) => L.push('    - ' + k));
    L.push('');
  }
  for (const w of r.warnings) {
    L.push('  WARNING: ' + w);
    L.push('');
  }

  L.push('  ' + '='.repeat(68));
  if (r.verdict === 'PASS') {
    L.push('  PASS -- all ' + n.baselinePassed + ' tests that passed in the baseline ' +
      'still pass.');
  } else if (r.verdict === 'DID NOT RUN') {
    L.push('  THE RUN DID NOT HAPPEN.');
    L.push('');
    L.push('  This is NOT "no regressions". Nothing was measured, so nothing is known.');
    for (const f of r.integrityFailed) L.push('    - ' + f);
  } else if (r.verdict === 'INCONCLUSIVE') {
    L.push('  INCONCLUSIVE -- ' + n.forgiven + ' quarantined failure(s), and ' +
      n.lostBehindQuarantine + ' test(s) stranded behind them never ran.');
    L.push('');
    L.push('  Coverage is deferred, not waived. Re-measure the affected file only:');
    for (const file of uniq(r.lostBehindQuarantine.concat(r.forgiven).map(fileOf))) {
      L.push(
        '    node gate.js --name heal-' + file.replace(/\.spec\.js$/, '') +
        ' --baseline ' + rel(r.baselinePath) +
        ' --filter ' + file +
        ' -- e2e/' + file
      );
    }
    L.push('');
    L.push('  Everything after `--` restricts what Playwright runs; --filter restricts');
    L.push('  what is compared, on BOTH sides, so the comparison stays honest. One spec');
    L.push('  file is a fraction of the full suite.');
  } else {
    L.push('  FAIL');
    for (const f of r.failures) L.push('    - ' + f);
  }
  L.push('  ' + '='.repeat(68));
  L.push('');
  return L;
}

function uniq(a) {
  return [...new Set(a)];
}

function rel(p) {
  if (!p) return '(none)';
  const r = path.relative(ROOT, p);
  return r.startsWith('..') ? p : r.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Pre-flight: the port sweep (Hole B)
// ---------------------------------------------------------------------------

/**
 * Is something listening on 127.0.0.1:port?
 *
 * `127.0.0.1` as a literal, never `localhost`. `index.js` binds `0.0.0.0`,
 * which is IPv4-only; a `::1`-first resolution reports a busy port as free,
 * which is the exact false negative this sweep exists to prevent.
 *
 * Measured on this box: a closed loopback port refuses in 0.07-4ms, so the
 * timeout is a backstop for a black-holed port and never fires normally. A
 * timeout is NOT treated as free -- nothing answered, which is not the same as
 * safe to use, and a socket that accepts but never speaks HTTP is exactly the
 * case that hangs Playwright's own availability probe forever.
 *
 * This mirrors the idiom `index.js:50-68` already uses to detect mongod.
 */
function probePort(port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    const done = (listening, why) => {
      sock.destroy();
      resolve({ port: port, listening: listening, ms: Date.now() - t0, why: why });
    };
    sock.setTimeout(timeoutMs || 1000);
    sock.once('connect', () => done(true, 'connect'));
    sock.once('timeout', () => done(true, 'timeout'));
    sock.once('error', (e) => done(e.code !== 'ECONNREFUSED', e.code || String(e)));
    sock.connect(port, '127.0.0.1');
  });
}

/**
 * Best-effort owning PID, so the refusal is actionable rather than annoying.
 *
 * Parsed by COLUMN, not by a regex over the raw line: a raw-line regex also
 * matches the foreign-address column, so an outbound connection to 1337 -- or
 * the TIME_WAIT rows the sweep itself just created -- gets reported as the
 * owner of 1337.
 */
function pidOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
      const cols = out
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        // [proto, local, foreign, state, pid]; local is `0.0.0.0:1337` or
        // `[::]:1337`, so take the tail after the last colon.
        .find(
          (c) =>
            c.length >= 5 &&
            c[0] === 'TCP' &&
            c[3] === 'LISTENING' &&
            c[1].slice(c[1].lastIndexOf(':') + 1) === String(port)
        );
      return cols ? cols[4] : null;
    }
    return (
      execFileSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' })
        .trim()
        .split(/\s+/)[0] || null
    );
  } catch (err) {
    return null;
  }
}

/** Every port this run could collide with. */
function portsToSweep() {
  const wanted = ports.allPorts();
  const band = [];
  for (let i = 0; i < MIN_SWEEP_WIDTH; i++) band.push(ports.BASE_PORT + i);
  return uniq(wanted.concat(band)).sort((a, b) => a - b);
}

async function preflightPorts() {
  const list = portsToSweep();
  const results = await Promise.all(list.map((p) => probePort(p)));
  const busy = results.filter((r) => r.listening);
  if (!busy.length) {
    return { ok: true, swept: list };
  }
  for (const b of busy) b.pid = pidOnPort(b.port);
  const how =
    process.platform === 'win32'
      ? busy.map((b) => 'taskkill /PID ' + (b.pid || '<pid>') + ' /F').join(' ; ')
      : 'kill ' + busy.map((b) => b.pid || '<pid>').join(' ');
  return {
    ok: false,
    swept: list,
    busy: busy,
    message:
      'REFUSING TO RUN: backend ports are already in use, so this run would measure\n' +
      'a server it did not start (playwright.config.js:129 -- reuseExistingServer).\n' +
      busy
        .map((b) => '  ' + b.port + ' busy (' + b.why + ') pid=' + (b.pid || 'unknown'))
        .join('\n') +
      '\nClear them and re-run:\n  ' +
      how
  };
}

// ---------------------------------------------------------------------------
// Running the suite
// ---------------------------------------------------------------------------

/**
 * Launch Playwright, streaming its output straight through.
 *
 * Two environment decisions:
 *
 *   CI=1  -- the only two things it changes here are `forbidOnly` (a guard we
 *            want; there are zero `.only` in e2e/) and `reuseExistingServer`
 *            (Hole B). Nothing server-side reads CI: not index.js, seed_db.js,
 *            cloud/, parse-server or mongodb-memory-server. It does not change
 *            what is measured.
 *
 *   PLAYWRIGHT_JSON_OUTPUT_FILE -- points the JSON reporter at a sentinel path
 *            OUTSIDE runs/, which this gate created and knows was empty. This
 *            is what makes "the report is missing" a detectable event at all:
 *            the reporter writes once, at the very end, so a run that dies
 *            earlier leaves whatever was at the config path untouched, and a
 *            gate reading that path would diff the previous run's verdict.
 *            It also means the gate never deletes anything in runs/ -- the
 *            recorded runs are the only evidence this migration has.
 */
/**
 * Where is the Playwright CLI?
 *
 * `'@playwright/test/cli'`, NOT `'@playwright/test/cli.js'`. The package
 * declares an exports map -- `{".", "./cli", "./package.json", "./reporter"}`
 * -- so Node refuses the `./cli.js` subpath with ERR_PACKAGE_PATH_NOT_EXPORTED
 * even though `cli.js` is sitting right there on disk and the two specifiers
 * resolve to the same file.
 *
 * This is a function, and exported, for one reason: it used to be an inline
 * `require.resolve` and it was the FIRST statement of `runSuite()`, which is
 * the first thing on the only path that launches the suite. It threw
 * synchronously, escaped into main()'s rejection handler, and every real
 * `npm run gate` died on a raw stack trace after passing every pre-flight
 * check. It failed safe -- exit 2, never a false PASS -- but the gate's primary
 * function was unreachable and no test could see it, because nothing in this
 * launch path was reachable from `test/gate.test.js` at all. Now it is.
 */
function resolvePlaywrightCli() {
  return require.resolve('@playwright/test/cli');
}

function runSuite(runName, sentinel, extraArgs) {
  const cli = resolvePlaywrightCli();
  const env = Object.assign({}, process.env, {
    CI: '1',
    E2E_RUN_NAME: runName,
    PLAYWRIGHT_JSON_OUTPUT_FILE: sentinel
  });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, 'test'].concat(extraArgs || []), {
      cwd: ROOT,
      env: env,
      stdio: 'inherit'
    });
    child.on('close', (code) => resolve(code == null ? 1 : code));
    child.on('error', () => resolve(1));
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  '',
  'usage: node gate.js [options]',
  '',
  'Runs the E2E suite and compares it against a baseline, refusing to report',
  'success unless the run demonstrably happened. Wraps diff-runs.js.',
  '',
  '  --name <run>        candidate run name; the report lands in runs/<run>.json',
  '                      (default: gate-<timestamp>)',
  '  --baseline <path>   baseline report (default: runs/baseline.json)',
  '  --candidate <path>  judge this exact file instead of runs/<name>.json',
  '                      (implies --skip-run)',
  '  --filter <substr>   restrict the comparison to keys containing a substring,',
  '                      applied to BOTH sides. Use a spec filename to re-measure',
  '                      one file after an INCONCLUSIVE verdict.',
  '  --skip-run          do not run the suite; judge an already-recorded report.',
  '                      This is what makes the gate testable without five minutes.',
  '  --no-quarantine     forgive nothing. Every failure counts.',
  '  --not-before <iso>  assert the candidate recorded a start time at or after',
  '                      this instant. --skip-run ONLY: when the gate runs the',
  '                      suite it stamps the launch instant itself.',
  '  --help              this text',
  '',
  'exit codes -- ONLY 0 MEANS PROCEED. Branch on `exit != 0`, never on `exit == 1`:',
  '  0  PASS          everything that passed in the baseline still passes',
  '  1  FAIL          regressions, or coverage lost behind an unknown failure',
  '  2  DID NOT RUN   report missing, stale, empty or malformed -- nothing measured',
  '  3  INCONCLUSIVE  only quarantined failures, but tests behind them never ran',
  '',
  'A run that strands coverage behind a QUARANTINED failure exits 3, not 1, even',
  'though it is blocking -- `--no-quarantine` on the same pair exits 1. Any wrapper',
  'that tests for 1 alone treats a stranded-coverage run as success.',
  '',
  'Anything after `--` is passed straight to `playwright test`.',
  ''
].join('\n');

function parseArgs(argv) {
  const opts = {
    name: null,
    baseline: null,
    candidate: null,
    filter: null,
    skipRun: false,
    quarantine: true,
    notBefore: null,
    help: false,
    passthrough: []
  };
  /**
   * Take the next token as this flag's value, or refuse.
   *
   * Consuming it unconditionally meant a value-taking flag could swallow the
   * flag after it: `node gate.js --name --skip-run --baseline runs/m18.json`
   * set `name` to the string "--skip-run", left `skipRun` false, and fell
   * straight through to spawning the full 4-5 minute suite -- precisely the
   * resource this tool exists to protect. A trailing `--filter` with no value
   * was worse and quieter: `undefined` became `null` downstream, silently
   * turning an intended one-file heal run into a whole-suite comparison.
   */
  const takeValue = (flag, next) => {
    if (next === undefined || next.startsWith('--')) {
      console.error('gate: ' + flag + ' needs a value');
      console.error(USAGE);
      process.exit(EXIT_DID_NOT_RUN);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts.passthrough = argv.slice(i + 1);
      break;
    } else if (a === '--name') opts.name = takeValue(a, argv[++i]);
    else if (a === '--baseline') opts.baseline = takeValue(a, argv[++i]);
    else if (a === '--candidate') opts.candidate = takeValue(a, argv[++i]);
    else if (a === '--filter') opts.filter = takeValue(a, argv[++i]);
    else if (a.startsWith('--filter=')) opts.filter = a.slice('--filter='.length);
    else if (a === '--not-before') opts.notBefore = takeValue(a, argv[++i]);
    else if (a === '--skip-run') opts.skipRun = true;
    else if (a === '--no-quarantine') opts.quarantine = false;
    else if (a === '--help' || a === '-h') opts.help = true;
    else {
      console.error('gate: unknown argument ' + JSON.stringify(a));
      console.error(USAGE);
      process.exit(EXIT_DID_NOT_RUN);
    }
  }

  // Validate here, not at the point of use. `Date.parse('yesterday')` is NaN,
  // NaN is not null, so the freshness check ran against it and the gate
  // reported "the candidate report is STALE" -- diagnosing a typo in an
  // argument as a dead suite and sending the reader after the wrong bug. On
  // current Node it is worse than that: `new Date(NaN).toISOString()` throws,
  // so the run died on a raw RangeError stack trace instead.
  if (opts.notBefore !== null && Number.isNaN(Date.parse(opts.notBefore))) {
    console.error('gate: --not-before is not a parseable instant: ' + JSON.stringify(opts.notBefore));
    console.error('  expected something Date.parse understands, e.g. 2026-08-19T00:00:00Z');
    process.exit(EXIT_DID_NOT_RUN);
  }
  return opts;
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return EXIT_PASS;
  }

  const name = opts.name || 'gate-' + new Date().toISOString().replace(/[:.]/g, '-');
  const baselinePath = path.resolve(ROOT, opts.baseline || path.join('runs', 'baseline.json'));
  const skipRun = opts.skipRun || !!opts.candidate;
  let candidatePath = opts.candidate
    ? path.resolve(ROOT, opts.candidate)
    : path.join(RUNS_DIR, name + '.json');
  let notBefore = opts.notBefore ? Date.parse(opts.notBefore) : null;

  // `--not-before` only ever meant anything under `--skip-run`. On a real run
  // the gate stamps the launch instant itself, which is a strictly better
  // freshness token than anything a caller can type -- and the old code
  // overwrote the flag with it unconditionally, so the flag was silently
  // DISCARDED on exactly the invocation people would reach for it on. Silently
  // ignoring an argument is worse than not accepting it, so say so.
  if (opts.notBefore && !skipRun) {
    console.error('');
    console.error('gate: --not-before only applies to --skip-run.');
    console.error('  When the gate runs the suite it stamps the launch instant itself, which');
    console.error('  is a better freshness token than any value passed here. Drop the flag,');
    console.error('  or add --skip-run to re-check an already-recorded report.');
    console.error('');
    return EXIT_DID_NOT_RUN;
  }

  if (!fs.existsSync(baselinePath)) {
    console.error('');
    console.error('gate: baseline not found: ' + rel(baselinePath));
    console.error('');
    console.error('  runs/ is gitignored, so a fresh clone has no baseline. Record one:');
    console.error('    node gate.js --name s10-baseline --skip-run   (after a manual run)');
    console.error('  or point --baseline at a report you kept.');
    console.error('');
    return EXIT_DID_NOT_RUN;
  }

  if (!skipRun) {
    // --- refuse to clobber a recorded run --------------------------------
    //
    // `runs/` is gitignored and is the only evidence the migration has. The
    // gate never deletes or overwrites anything in it; if the name is taken,
    // pick another. This also removes the reuse-the-same-name variant of the
    // stale-report trap, where a second attempt silently reports the first
    // attempt's verdict.
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    if (fs.existsSync(candidatePath)) {
      console.error('');
      console.error('gate: ' + rel(candidatePath) + ' already exists.');
      console.error('  runs/ is gitignored and unrecoverable, so the gate will not');
      console.error('  overwrite it. Pick another --name.');
      console.error('');
      return EXIT_DID_NOT_RUN;
    }

    // --- the syntax gate --------------------------------------------------
    //
    // `pretest:e2e` runs this before `npm run test:e2e`; invoking Playwright
    // directly would skip it, and a stray brace in a spec takes the whole run
    // down with an error that points at the collection phase rather than the
    // file -- and, worse, before the reporter exists, so no report is written
    // at all.
    console.log('gate: checking e2e syntax...');
    const syn = spawnSync(process.execPath, [path.join(ROOT, 'e2e', 'check-syntax.js')], {
      cwd: ROOT,
      stdio: 'inherit'
    });
    if (syn.status !== 0) {
      console.error('');
      console.error('gate: the e2e syntax check failed. Fix it before running the suite --');
      console.error('  a collection-phase failure produces no report at all.');
      console.error('');
      return EXIT_DID_NOT_RUN;
    }

    // --- the port sweep ---------------------------------------------------
    const sweep = await preflightPorts();
    console.log(
      'gate: swept ports ' + sweep.swept[0] + '-' + sweep.swept[sweep.swept.length - 1] +
      ' (' + sweep.swept.length + ' ports, ' + ports.workerCount() + ' workers)'
    );
    if (!sweep.ok) {
      console.error('');
      console.error(sweep.message);
      console.error('');
      return EXIT_DID_NOT_RUN;
    }

    // --- the sentinel -----------------------------------------------------
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yorick-gate-'));
    const sentinel = path.join(tmp, name + '.json');

    notBefore = Date.now();
    console.log('gate: running the suite as ' + JSON.stringify(name) + ' with CI=1');
    console.log('');
    const code = await runSuite(name, sentinel, opts.passthrough);
    console.log('');
    console.log('gate: playwright exited ' + code);
    // A non-zero exit is NOT fatal on its own. A run with genuine failures
    // exits 1 and still produced a report worth diffing -- that is the whole
    // point of a differential. A run that produced NO report is the fatal case,
    // and that is judged below.

    if (fs.existsSync(sentinel)) {
      // Copy, never move-over: this is a create into runs/, and the
      // already-exists check above guarantees nothing is lost.
      fs.copyFileSync(sentinel, candidatePath);
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch (err) {
        /* a leftover temp dir is not worth failing a run over */
      }
      console.log('gate: report -> ' + rel(candidatePath));
    } else if (fs.existsSync(candidatePath)) {
      // Fallback: if PLAYWRIGHT_JSON_OUTPUT_FILE were ever ignored, the config's
      // own `runs/${E2E_RUN_NAME}.json` is where the report went. We know it is
      // ours because the path did not exist before the run.
      console.log(
        'gate: sentinel absent; using the config path ' + rel(candidatePath) +
        ' (created by this run)'
      );
    }
    // If neither exists, `evaluate` reports it as "the run did not happen",
    // which is exactly right: Playwright died before its reporter's onEnd.
  }

  const result = evaluate({
    baselinePath: baselinePath,
    candidatePath: candidatePath,
    filter: opts.filter,
    quarantine: opts.quarantine ? QUARANTINE : null,
    notBefore: notBefore
  });

  console.log(result.lines.join('\n'));
  return result.exitCode;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error('gate: ' + (err && err.stack ? err.stack : err));
      process.exit(EXIT_DID_NOT_RUN);
    }
  );
}

module.exports = {
  QUARANTINE,
  COUNT_TOLERANCE_FRACTION,
  COUNT_TOLERANCE_FLOOR,
  MIN_SWEEP_WIDTH,
  EXIT_PASS,
  EXIT_FAIL,
  EXIT_DID_NOT_RUN,
  EXIT_INCONCLUSIVE,
  evaluate,
  specIndex,
  skipKind,
  signatureMatches,
  stripAnsi,
  probePort,
  pidOnPort,
  portsToSweep,
  preflightPorts,
  resolvePlaywrightCli,
  main
};
