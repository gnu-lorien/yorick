#!/usr/bin/env node
/**
 * Compare two Playwright JSON reports and classify every test.
 *
 * This is the regression detector for the differential cutover: the same suite
 * runs against the legacy stack (parse-server 2.8.4 + Parse 1.5) and the modern
 * one (parse-server 9.x + Parse 8.x), and the difference between the two runs
 * is the answer to "did the migration break anything".
 *
 * Classification
 * --------------
 *   same-pass    passed in both            -- no signal
 *   same-fail    failed in both            -- already broken, not yours
 *   NEW-FAIL     passed then failed        -- a regression. This is the output.
 *   new-pass     failed then passed        -- fixed, or the baseline was flaky
 *   added        absent from the baseline  -- a new test
 *   removed      absent from the candidate -- a deleted or renamed test
 *
 * Only NEW-FAIL sets a non-zero exit code. `removed` is reported loudly but
 * does not fail, because renaming a test looks identical to deleting one and
 * a rename is a legitimate thing to do mid-migration.
 *
 * A note on trust
 * ---------------
 * This tool is the oracle for the whole migration, so it needs an oracle of its
 * own. `test/fixtures/diff-runs/` holds a pair of reports with a deliberately
 * planted regression; `test/diff-runs.test.js` asserts that the planted
 * regression is found and that an identical pair reports nothing. If this file
 * is ever changed, run `npm run test:node` -- a diff tool that silently stops
 * detecting regressions is worse than no diff tool, because the whole plan
 * treats a clean run as permission to proceed.
 *
 * Usage
 * -----
 *   node diff-runs.js <baseline.json> <candidate.json> [--filter <substring>]
 *                                                      [--json]
 *                                                      [--quiet]
 *
 * --filter restricts the comparison to test keys containing a substring,
 * usually a spec filename. A full two-stack diff over 397 serial tests takes
 * 40-66 minutes; filtering to one spec turns the inner loop into ~2 minutes
 * while working on a single shim.
 */

'use strict';

const fs = require('fs');

/** Spec outcome, collapsed from Playwright's per-test/per-retry detail. */
const PASSED = 'passed';
const FAILED = 'failed';
const SKIPPED = 'skipped';

/**
 * Collapse one spec's `tests[]` into a single outcome.
 *
 * Playwright reports `status` per test as expected/unexpected/skipped/flaky,
 * and `spec.ok` as the overall verdict. A flaky spec has ok === true; it is
 * treated as a pass here but counted separately, because flakiness is the main
 * source of noise in a two-run diff and it should be visible rather than
 * silently absorbed.
 */
function specOutcome(spec) {
  const tests = spec.tests || [];
  if (tests.length && tests.every((t) => t.status === SKIPPED)) {
    return { outcome: SKIPPED, flaky: false };
  }
  const flaky = tests.some((t) => t.status === 'flaky');
  return { outcome: spec.ok ? PASSED : FAILED, flaky };
}

/**
 * Flatten a report into `Map<key, {outcome, flaky}>`.
 *
 * The key is `file :: describe > path :: title`. The file is carried
 * explicitly rather than taken from the outermost suite title, because two
 * spec files can hold identically named describes and tests -- `creation-
 * vampire.spec.js` and `creation-werewolf.spec.js` in this repo are close to
 * that already.
 */
function flatten(report) {
  const out = new Map();

  function walk(suite, file, path) {
    const suiteFile = suite.file || file;
    for (const spec of suite.specs || []) {
      const key =
        (spec.file || suiteFile) +
        ' :: ' +
        (path.length ? path.join(' > ') + ' :: ' : '') +
        spec.title;
      out.set(key, specOutcome(spec));
    }
    for (const child of suite.suites || []) {
      // The outermost suite's title is the filename; deeper ones are describes.
      const isFileSuite = !path.length && child.title === (child.file || suiteFile);
      walk(child, suiteFile, isFileSuite ? path : path.concat(child.title));
    }
  }

  for (const suite of report.suites || []) {
    // A top-level suite represents a spec file: its title is the filename, so
    // it contributes the file, not a describe segment.
    walk(suite, suite.file || suite.title, []);
  }
  return out;
}

/** Compare two flattened runs. */
function compare(baseline, candidate, filter) {
  const keep = (k) => !filter || k.includes(filter);
  const result = {
    samePass: [],
    sameFail: [],
    newFail: [],
    newPass: [],
    added: [],
    removed: [],
    skipped: [],
    flaky: [],
  };

  for (const [key, b] of baseline) {
    if (!keep(key)) continue;
    const c = candidate.get(key);
    if (!c) {
      result.removed.push(key);
      continue;
    }
    if (b.flaky || c.flaky) result.flaky.push(key);
    if (b.outcome === SKIPPED || c.outcome === SKIPPED) {
      result.skipped.push(key);
      continue;
    }
    if (b.outcome === PASSED && c.outcome === PASSED) result.samePass.push(key);
    else if (b.outcome === FAILED && c.outcome === FAILED) result.sameFail.push(key);
    else if (b.outcome === PASSED && c.outcome === FAILED) result.newFail.push(key);
    else result.newPass.push(key);
  }

  for (const key of candidate.keys()) {
    if (!keep(key)) continue;
    if (!baseline.has(key)) result.added.push(key);
  }

  for (const k of Object.keys(result)) result[k].sort();
  return result;
}

function render(r, opts) {
  const lines = [];
  const n = (a) => String(a.length).padStart(5);
  lines.push('');
  lines.push('  DIFFERENTIAL RUN COMPARISON');
  if (opts.filter) lines.push('  filter: ' + JSON.stringify(opts.filter));
  lines.push('  ' + '-'.repeat(52));
  lines.push('  ' + n(r.newFail) + '  NEW-FAIL   regressions');
  lines.push('  ' + n(r.newPass) + '  new-pass   fixed, or baseline was flaky');
  lines.push('  ' + n(r.samePass) + '  same-pass');
  lines.push('  ' + n(r.sameFail) + '  same-fail  already broken');
  lines.push('  ' + n(r.added) + '  added');
  lines.push('  ' + n(r.removed) + '  removed    renamed or deleted');
  lines.push('  ' + n(r.skipped) + '  skipped');
  lines.push('  ' + n(r.flaky) + '  flaky      present in at least one run');
  lines.push('');

  if (r.newFail.length) {
    lines.push('  REGRESSIONS:');
    r.newFail.forEach((k) => lines.push('    - ' + k));
    lines.push('');
  }
  if (r.removed.length) {
    lines.push('  REMOVED (renamed or deleted -- confirm this was deliberate):');
    r.removed.forEach((k) => lines.push('    - ' + k));
    lines.push('');
  }
  if (!r.newFail.length) {
    lines.push('  No regressions.');
    lines.push('');
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const positional = [];
  const opts = { filter: null, json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--filter') opts.filter = argv[++i];
    else if (a.startsWith('--filter=')) opts.filter = a.slice('--filter='.length);
    else if (a === '--json') opts.json = true;
    else if (a === '--quiet') opts.quiet = true;
    else positional.push(a);
  }
  return { positional, opts };
}

function diffFiles(baselinePath, candidatePath, filter) {
  const b = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const c = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
  return compare(flatten(b), flatten(c), filter);
}

if (require.main === module) {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  if (positional.length !== 2) {
    console.error(
      'usage: node diff-runs.js <baseline.json> <candidate.json> ' +
        '[--filter <substring>] [--json] [--quiet]'
    );
    process.exit(2);
  }
  let result;
  try {
    result = diffFiles(positional[0], positional[1], opts.filter);
  } catch (err) {
    console.error('diff-runs: ' + err.message);
    process.exit(2);
  }
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else if (!opts.quiet) console.log(render(result, opts));
  process.exit(result.newFail.length > 0 ? 1 : 0);
}

module.exports = { flatten, compare, diffFiles, specOutcome };
