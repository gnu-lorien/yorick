#!/usr/bin/env node
/**
 * Count how many times each Cloud Code hook ran, and diff two runs' counts.
 *
 * What this defends against
 * -------------------------
 * The dominant failure shape of this migration is not a crash, it is a
 * *silence*: a hook stops running and nothing says so. Ten of the browser
 * phase's eighteen regressions were something that had quietly stopped
 * happening. `diff-runs.js` catches that only when a spec happens to assert on
 * the hook's effect; plenty of hooks have no such assertion, and two of them --
 * `afterSave("SimpleTrait")` and `afterSave("Patronage")` -- have no E2E
 * observability at all.
 *
 * Under parse-server 9 that silence has a specific, known cause.
 * `triggers.js:838` calls before-triggers as a bare `trigger(request)`, with no
 * arity branch: the legacy `function(request, response)` handlers in `cloud/`
 * get `response === undefined`, and
 *
 *   - settling synchronously  -> save rejected, code 141
 *   - settling inside a .then -> unhandled TypeError -> the backend exits
 *
 * Either way the hook's success line stops being written. That is what this
 * tool is looking for, and a hook falling to zero is the signature.
 *
 * Where the counts come from
 * --------------------------
 * NOT from cloud code. The original plan proposed unique `console.log` markers
 * in `cloud/` counted out of `logs/parse-server.info.*`. That cannot work:
 * parse-server does not redirect `console`, so cloud `console.log` goes to
 * stdout and into Playwright's `[WebServer]` pipe, never into the log file.
 * Measured against a 31 MB verbose log: zero hits for every cloud marker.
 *
 * What IS in that file is parse-server's own structured trigger log, which
 * needs no code change in `cloud/` at all:
 *
 *   node_modules/parse-server/lib/triggers.js:273  logTriggerAfterHook
 *   node_modules/parse-server/lib/triggers.js:283  logTriggerSuccessBeforeHook
 *   node_modules/parse-server/lib/triggers.js:292  logTriggerErrorBeforeHook
 *   node_modules/parse-server/lib/Routers/FunctionsRouter.js:153 / :164
 *
 * One JSON object per line, `className` + `triggerType` for a trigger and
 * `functionName` for a Cloud function:
 *
 *   {"className":"Vampire","triggerType":"beforeSave","user":"m91umkbuQq",
 *    "level":"info","message":"beforeSave triggered for Vampire for user ...",
 *    "timestamp":"2026-08-18T23:41:55.117Z"}
 *
 * Both are `logger.info`, so they **survive `verbose:false`** -- which matters,
 * because Step 9 env-gated verbose and a 3.9 GB/day log is not something anyone
 * wants to turn back on. Verified empirically: a 400 KB stretch of
 * `logs/parse-server.info.2026-08-20` containing zero `level:"verbose"` lines
 * still carries 424 trigger records. Failures are `logger.error`, counted here
 * separately as `failed`.
 *
 * What this proves, and what it does not
 * --------------------------------------
 * It proves a hook was **reached and settled**. It does NOT prove the hook did
 * the right thing: a `beforeSave` that calls `response.success()` having
 * computed garbage logs identically to one that computed correctly. This is a
 * liveness check, not a correctness check. `diff-runs.js` remains the oracle
 * for behaviour; this one only answers "did it run at all", which is the
 * question `diff-runs.js` answers worst.
 *
 * Two finer points on what the line actually means, because they differ by kind
 * and the difference decides how much a zero is worth:
 *
 *   before-triggers (beforeSave, beforeDelete)
 *       The line is written from inside the response callback
 *       (`triggers.js:431`/`:434`), so it means the hook **settled** -- it
 *       called `response.success` or `response.error`. A hook that is entered
 *       and then hangs, or that throws before settling, logs nothing. That is
 *       exactly the parse-server 9 failure above, so for before-triggers this
 *       oracle is strong.
 *
 *   after-triggers (afterSave, afterDelete)
 *       The line is written at `triggers.js:449`, immediately after
 *       `trigger(request, response)` returns, and before the promise it
 *       returned settles -- and `triggerPromise.then(resolve, resolve)` on the
 *       next line swallows a rejection. So an afterSave count means **entered**
 *       and nothing more. An afterSave whose body rejects still counts as `ok`
 *       here. For these two hooks this is a weak oracle, and it is still the
 *       only one there is.
 *
 *   Cloud functions (`fn:` keys)
 *       `FunctionsRouter.js:153` logs from the success callback, so like a
 *       before-trigger it means settled-successfully; `:164` is the failure.
 *
 * What it can never cover
 * -----------------------
 *   - `beforeFind`. `maybeRunQueryTrigger` (`triggers.js:334`) has no logging
 *     of any kind. Nothing is registered today; if one ever is, it is invisible
 *     here. `afterFind` is fine -- it logs twice per call, entry and exit.
 *   - Any registration the suite never exercises. `afterSave("PaymentPaypal")`
 *     is the standing example: no test posts an IPN, so its count is 0 in every
 *     run and a real breakage there is indistinguishable from the status quo.
 *     Run with the registration scan on (the default) and it is listed under
 *     NOT EXERCISED rather than being silently absent.
 *   - Which worker produced a record. See the per-run note below.
 *   - Anything about a hook that is not registered at all: an accidentally
 *     deleted `Parse.Cloud.beforeSave(...)` line reads exactly like a hook that
 *     stopped being reached.
 *
 * Per-run, not per-worker, and the day-file problem
 * -------------------------------------------------
 * `logsFolder` defaults to `./logs/` resolved against `process.cwd()`
 * (`parse-server/lib/defaults.js:11`, `WinstonLogger.js:90`), and
 * `playwright.config.js` starts all N backends with `node index.js` from the
 * repo root with no `PARSE_SERVER_LOGS_FOLDER`. So **every worker appends to
 * the same `logs/parse-server.info.<date>` file** -- confirmed by
 * `logs/parse-server.info.2026-08-18`, which carries requests for all eight
 * ports 1337-1344. The trigger lines themselves carry no port, host or pid, so
 * a record cannot be attributed to a worker even in principle. The diff is
 * therefore per-run and aggregate. That is fine: a hook that dies under
 * parse-server 9 dies on all eight workers at once.
 *
 * The consequence that does bite is that the file is named by **date**, not by
 * run, so every run of a given day piles into one file and a naive count is the
 * whole day. Use `--run <report.json>`, which takes the window straight from
 * the Playwright JSON report's `stats.startTime` and `stats.duration`, or
 * `--since`/`--until` by hand. `--save` freezes the result so the next run
 * appending to the same file cannot disturb it.
 *
 * Concurrent appends can also interleave and corrupt a line. Lines that look
 * like a hook record but do not parse are counted as `malformed` and reported;
 * a non-zero malformed count means the numbers are floors, not exact.
 *
 * Pass `.info` files only. Winston's npm levels put `error` below `info`, so
 * every error record appears in BOTH `parse-server.info.*` and
 * `parse-server.err.*`; passing both double-counts the failures. Passing an
 * `.err` path is refused unless `--allow-err`.
 *
 * A note on trust
 * ---------------
 * Same bargain as `diff-runs.js`: this is a regression detector, so it gets
 * fixtures of its own. `test/fixtures/hook-counts/` holds two logs assembled
 * from real captured parse-server lines with a deliberately planted hook
 * failure, and `test/hook-counts.test.js` asserts it is found. Run
 * `npm run test:node` after changing this file.
 *
 * Usage
 * -----
 *   node hook-counts.js <log|dir>...  [--run <report.json>]
 *                                     [--since <ISO>] [--until <ISO>]
 *                                     [--save <counts.json>]
 *                                     [--no-registrations] [--json] [--quiet]
 *
 *   node hook-counts.js --diff <A> <B> [--floor N] [--tolerance F]
 *                                      [--json] [--quiet]
 *
 * A and B may each be a saved counts JSON or a raw log path. A directory
 * expands to the `parse-server.info.*` files inside it.
 *
 * Exit codes match `diff-runs.js`: 0 clean, 1 a hook fired materially less, 2
 * the tool could not run.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Records whose `level` is anything else are ignored. */
const OK = 'ok';
const FAILED = 'failed';

/** Cloud function keys are namespaced so they cannot collide with a class. */
const FN_PREFIX = 'fn:';

/** Defaults for "materially fewer". See `compareCounts`. */
const DEFAULT_FLOOR = 3;
const DEFAULT_TOLERANCE = 0.25;

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/**
 * The cheap pre-filter.
 *
 * A verbose day-log is gigabytes of REQUEST/RESPONSE bodies and a few thousand
 * hook records. `JSON.parse` on every line would take minutes; a substring test
 * rejects >99.9% of them for the cost of the read we are doing anyway.
 */
function looksLikeHookRecord(line) {
  return line.indexOf('"triggerType":') !== -1 || line.indexOf('"functionName":') !== -1;
}

/** The counted key for one parsed record, or null if it is not a hook record. */
function keyFor(rec) {
  if (typeof rec.functionName === 'string' && rec.functionName) {
    return FN_PREFIX + rec.functionName;
  }
  if (typeof rec.className === 'string' && typeof rec.triggerType === 'string') {
    return rec.className + '/' + rec.triggerType;
  }
  return null;
}

/** An empty tally, so callers never have to check for undefined. */
function emptyTally() {
  return { ok: 0, failed: 0 };
}

/**
 * Fold one line into `acc`.
 *
 * `acc.counts` is key -> {ok, failed}; `acc.malformed` counts lines that look
 * like hook records but do not parse, which on this log means an interleaved
 * write from one of the eight concurrent backends.
 */
function foldLine(acc, line, window) {
  if (!looksLikeHookRecord(line)) return;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch (e) {
    acc.malformed++;
    return;
  }
  const key = keyFor(rec);
  if (!key) return;

  const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null;
  if (window && (window.since || window.until)) {
    // A record with no timestamp cannot be placed in the window, so a windowed
    // count drops it rather than guessing. Reported as `undated`.
    if (!ts) {
      acc.undated++;
      return;
    }
    if (window.since && ts < window.since) return;
    if (window.until && ts > window.until) return;
  }

  const outcome = rec.level === 'error' ? FAILED : OK;
  if (rec.level !== 'error' && rec.level !== 'info') {
    // triggers.js and FunctionsRouter only ever emit info and error. Anything
    // else is a shape this tool was not written against; count it, but say so.
    acc.unexpectedLevels[rec.level] = (acc.unexpectedLevels[rec.level] || 0) + 1;
  }
  if (!acc.counts[key]) acc.counts[key] = emptyTally();
  acc.counts[key][outcome]++;
  acc.records++;

  if (ts) {
    if (!acc.firstTimestamp || ts < acc.firstTimestamp) acc.firstTimestamp = ts;
    if (!acc.lastTimestamp || ts > acc.lastTimestamp) acc.lastTimestamp = ts;
  }
}

/** A fresh accumulator. */
function emptyAcc() {
  return {
    counts: {},
    records: 0,
    lines: 0,
    malformed: 0,
    undated: 0,
    unexpectedLevels: {},
    firstTimestamp: null,
    lastTimestamp: null,
    sources: [],
    bytes: 0
  };
}

/**
 * Count hook records in a string. Exposed for the tests, which should not have
 * to go through the filesystem to exercise the parsing.
 */
function countText(text, window, acc) {
  const out = acc || emptyAcc();
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line) continue;
    out.lines++;
    foldLine(out, line, window);
  }
  return out;
}

/**
 * Count one file, streaming.
 *
 * Read synchronously in 4 MB chunks rather than with `readline`: the files this
 * runs against reach 3.9 GB and readline's per-line overhead dominates. The
 * carry handles a record split across a chunk boundary.
 */
function countFile(file, window, acc) {
  const out = acc || emptyAcc();
  const stat = fs.statSync(file);
  out.sources.push(file);
  out.bytes += stat.size;

  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1 << 22);
  let carry = '';
  let pos = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      const chunk = carry + buf.toString('utf8', 0, n);
      const lines = chunk.split('\n');
      carry = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        out.lines++;
        foldLine(out, line, window);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  if (carry) {
    out.lines++;
    foldLine(out, carry, window);
  }
  return out;
}

/**
 * Expand a path into the log files to read.
 *
 * A directory expands to its `parse-server.info.*` entries -- deliberately not
 * `parse-server.err.*`, which is a strict subset (see the header).
 */
function expandPath(p) {
  const stat = fs.statSync(p);
  if (!stat.isDirectory()) return [p];
  return fs
    .readdirSync(p)
    .filter((f) => f.indexOf('parse-server.info') === 0)
    .sort()
    .map((f) => path.join(p, f));
}

/** Count every given path (files or directories) into one tally. */
function countPaths(paths, opts) {
  const o = opts || {};
  const files = [];
  for (const p of paths) files.push(...expandPath(p));

  if (!o.allowErr) {
    const err = files.find((f) => path.basename(f).indexOf('parse-server.err') === 0);
    if (err) {
      throw new Error(
        'refusing to read ' + err + ': error records also appear in ' +
          'parse-server.info.*, so counting both double-counts every failure. ' +
          'Pass --allow-err if you really mean to.'
      );
    }
  }

  const acc = emptyAcc();
  for (const f of files) countFile(f, o.window, acc);
  acc.window = o.window || null;
  return acc;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * The time window of one Playwright run, from its JSON report.
 *
 * `stats.startTime` and `stats.duration` are written by the JSON reporter, so
 * this is exact rather than a guess. `slackMs` covers the gap between a hook
 * firing and winston flushing the line, and between the last test finishing and
 * the reporter stamping the duration.
 */
function windowFromReport(reportPath, slackMs) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const stats = report && report.stats;
  if (!stats || !stats.startTime) {
    throw new Error(reportPath + ': no stats.startTime; is this a Playwright JSON report?');
  }
  const slack = typeof slackMs === 'number' ? slackMs : 30000;
  const start = new Date(stats.startTime).getTime();
  const end = start + (Number(stats.duration) || 0) + slack;
  return {
    since: new Date(start - slack).toISOString(),
    until: new Date(end).toISOString(),
    source: reportPath
  };
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

const TRIGGER_RE =
  /Parse\.Cloud\.(beforeSave|afterSave|beforeDelete|afterDelete|beforeFind|afterFind)\s*\(\s*["']([^"']+)["']/g;
const DEFINE_RE = /Parse\.Cloud\.define\s*\(\s*["']([^"']+)["']/g;

/**
 * Every hook key registered under `dir`.
 *
 * This exists so the report can distinguish "this hook stopped running" from
 * "this hook has never run in any recorded run", which are the same absence in
 * the log and very different facts. It is a regex over source, not an
 * evaluation, so a registration built from a computed name would be missed --
 * there are none today.
 */
function scanRegistrations(dir) {
  const keys = new Set();
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  } catch (e) {
    return null;
  }
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    let m;
    TRIGGER_RE.lastIndex = 0;
    while ((m = TRIGGER_RE.exec(src))) keys.add(m[2] + '/' + m[1]);
    DEFINE_RE.lastIndex = 0;
    while ((m = DEFINE_RE.exec(src))) keys.add(FN_PREFIX + m[1]);
  }
  return [...keys].sort();
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/**
 * Classify every key across two tallies.
 *
 * "Materially fewer" needs two guards, because E2E counts are not stable to the
 * record: one retry adds a whole spec file's worth of saves, and
 * docs/runbooks/harness-noise-floor.md puts the residual flake rate at
 * something rather than zero.
 *
 *   floor      an absolute drop this small is noise, whatever the ratio.
 *              Default 3: enough to absorb a retried test, small enough that a
 *              hook firing 7 times and then 3 is still caught.
 *   tolerance  a proportional drop under this is noise. Default 0.25.
 *
 * A drop must clear BOTH to be reported. A fall to exactly zero is reported
 * regardless -- that is the parse-server 9 signature and no threshold should be
 * able to hide it.
 */
function compareCounts(baseline, candidate, opts) {
  const o = opts || {};
  const floor = typeof o.floor === 'number' ? o.floor : DEFAULT_FLOOR;
  const tolerance = typeof o.tolerance === 'number' ? o.tolerance : DEFAULT_TOLERANCE;

  const bc = baseline.counts || {};
  const cc = candidate.counts || {};
  const keys = [...new Set([...Object.keys(bc), ...Object.keys(cc)])].sort();

  const result = {
    vanished: [],
    dropped: [],
    steady: [],
    rose: [],
    added: [],
    newFailures: [],
    floor,
    tolerance
  };

  for (const key of keys) {
    const b = bc[key] || emptyTally();
    const c = cc[key] || emptyTally();
    const row = { key, before: b.ok, after: c.ok, beforeFailed: b.failed, afterFailed: c.failed };

    if (c.failed > b.failed) result.newFailures.push(row);

    if (!bc[key]) {
      if (c.ok > 0 || c.failed > 0) result.added.push(row);
      continue;
    }
    if (b.ok > 0 && c.ok === 0) {
      result.vanished.push(row);
      continue;
    }
    const drop = b.ok - c.ok;
    if (drop >= floor && c.ok <= b.ok * (1 - tolerance)) {
      result.dropped.push(row);
      continue;
    }
    if (c.ok > b.ok) result.rose.push(row);
    else result.steady.push(row);
  }
  return result;
}

/** True when the diff should fail the caller. */
function isRegression(diff) {
  return diff.vanished.length > 0 || diff.dropped.length > 0;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function splitKeys(keys) {
  return {
    triggers: keys.filter((k) => k.indexOf(FN_PREFIX) !== 0).sort(),
    functions: keys.filter((k) => k.indexOf(FN_PREFIX) === 0).sort()
  };
}

/** `fn:vote_for_referendum` -> `vote_for_referendum`; triggers unchanged. */
function displayKey(k) {
  return k.indexOf(FN_PREFIX) === 0 ? k.slice(FN_PREFIX.length) : k;
}

function renderCounts(acc, registrations) {
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);

  lines.push('');
  lines.push('  CLOUD HOOK COUNTS');
  for (const s of acc.sources) lines.push('  ' + s);
  lines.push('  ' + fmtBytes(acc.bytes) + ', ' + acc.lines.toLocaleString('en-US') +
    ' lines, ' + acc.records.toLocaleString('en-US') + ' hook records');
  if (acc.window && (acc.window.since || acc.window.until)) {
    lines.push('  window: ' + (acc.window.since || '-') + '  ..  ' + (acc.window.until || '-') +
      (acc.window.source ? '   (' + acc.window.source + ')' : ''));
  }
  if (acc.firstTimestamp) {
    lines.push('  records span: ' + acc.firstTimestamp + '  ..  ' + acc.lastTimestamp);
  }
  lines.push('  ' + '-'.repeat(58));

  const { triggers, functions } = splitKeys(Object.keys(acc.counts));
  const emit = (title, keys) => {
    lines.push('  ' + pad(title, 44) + num('ok', 7) + num('failed', 8));
    if (!keys.length) lines.push('    (none)');
    for (const k of keys) {
      const t = acc.counts[k];
      lines.push('    ' + pad(displayKey(k), 42) + num(t.ok, 7) + num(t.failed, 8));
    }
    lines.push('');
  };
  emit('TRIGGERS', triggers);
  emit('CLOUD FUNCTIONS', functions);

  if (registrations) {
    const seen = new Set(Object.keys(acc.counts));
    const unexercised = registrations.filter((k) => !seen.has(k));
    lines.push('  NOT EXERCISED  (registered in cloud/, zero records here --');
    lines.push('                  this oracle can say nothing about these)');
    if (!unexercised.length) lines.push('    (none -- every registration fired)');
    for (const k of unexercised) {
      lines.push('    - ' + (k.indexOf(FN_PREFIX) === 0
        ? 'function ' + k.slice(FN_PREFIX.length)
        : k));
    }
    lines.push('');
    const unregistered = [...seen].filter((k) => registrations.indexOf(k) === -1);
    if (unregistered.length) {
      lines.push('  LOGGED BUT NOT REGISTERED IN cloud/  (a built-in, or a stale log)');
      for (const k of unregistered) lines.push('    - ' + k);
      lines.push('');
    }
  }

  if (acc.malformed) {
    lines.push('  ' + acc.malformed + ' MALFORMED hook lines -- concurrent appends from the ' +
      'per-worker backends');
    lines.push('  interleaved. Every count above is a FLOOR, not an exact figure.');
    lines.push('');
  }
  if (acc.undated) {
    lines.push('  ' + acc.undated + ' records had no timestamp and were dropped by the window.');
    lines.push('');
  }
  const odd = Object.keys(acc.unexpectedLevels);
  if (odd.length) {
    lines.push('  Unexpected log levels (counted as ok): ' +
      odd.map((l) => l + '=' + acc.unexpectedLevels[l]).join(', '));
    lines.push('');
  }
  return lines.join('\n');
}

function renderDiff(d) {
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  const n = (a) => String(a.length).padStart(5);

  lines.push('');
  lines.push('  CLOUD HOOK COUNT COMPARISON');
  lines.push('  material drop = at least ' + d.floor + ' fewer AND at least ' +
    Math.round(d.tolerance * 100) + '% fewer; any fall to zero always counts');
  lines.push('  ' + '-'.repeat(58));
  lines.push('  ' + n(d.vanished) + '  VANISHED   fired before, never fires now');
  lines.push('  ' + n(d.dropped) + '  DROPPED    materially fewer');
  lines.push('  ' + n(d.steady) + '  steady');
  lines.push('  ' + n(d.rose) + '  rose');
  lines.push('  ' + n(d.added) + '  added      absent from the baseline');
  lines.push('  ' + n(d.newFailures) + '  new-fail   more error records than before');
  lines.push('');

  const table = (title, rows) => {
    if (!rows.length) return;
    lines.push('  ' + title);
    lines.push('    ' + pad('hook', 42) + num('before', 8) + num('after', 8));
    for (const r of rows) {
      lines.push('    ' + pad(displayKey(r.key), 42) + num(r.before, 8) + num(r.after, 8));
    }
    lines.push('');
  };
  table('VANISHED:', d.vanished);
  table('DROPPED:', d.dropped);
  if (d.newFailures.length) {
    lines.push('  NEW FAILURES (error records):');
    lines.push('    ' + pad('hook', 42) + num('before', 8) + num('after', 8));
    for (const r of d.newFailures) {
      lines.push('    ' + pad(displayKey(r.key), 42) +
        num(r.beforeFailed, 8) + num(r.afterFailed, 8));
    }
    lines.push('');
  }
  table('ADDED:', d.added);

  if (!isRegression(d)) {
    lines.push('  No hook fired materially less.');
    lines.push('  Remember what that is worth: every hook was REACHED, not that any');
    lines.push('  of them did the right thing. diff-runs.js is the correctness oracle.');
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Load one side of a diff: either a counts JSON written by `--save`, or a raw
 * log path to count now.
 */
function loadSide(p, opts) {
  const stat = fs.statSync(p);
  if (!stat.isDirectory() && p.endsWith('.json')) {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (parsed && parsed.counts) return parsed;
    throw new Error(p + ': a .json without a `counts` key; expected output of --save');
  }
  return countPaths([p], opts);
}

function parseArgs(argv) {
  const positional = [];
  const opts = {
    diff: false,
    json: false,
    quiet: false,
    save: null,
    since: null,
    until: null,
    run: null,
    slack: 30000,
    registrations: 'cloud',
    allowErr: false,
    floor: DEFAULT_FLOOR,
    tolerance: DEFAULT_TOLERANCE
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--diff') opts.diff = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--allow-err') opts.allowErr = true;
    else if (a === '--no-registrations') opts.registrations = null;
    else if (a === '--registrations') opts.registrations = argv[++i];
    else if (a === '--save') opts.save = argv[++i];
    else if (a === '--since') opts.since = argv[++i];
    else if (a === '--until') opts.until = argv[++i];
    else if (a === '--run') opts.run = argv[++i];
    else if (a === '--slack') opts.slack = Number(argv[++i]);
    else if (a === '--floor') opts.floor = Number(argv[++i]);
    else if (a === '--tolerance') opts.tolerance = Number(argv[++i]);
    else if (a.startsWith('--')) throw new Error('unknown option ' + a);
    else positional.push(a);
  }
  return { positional, opts };
}

const USAGE =
  'usage:\n' +
  '  node hook-counts.js <log|dir>... [--run <report.json>] [--since ISO] [--until ISO]\n' +
  '                                   [--save <counts.json>] [--no-registrations]\n' +
  '                                   [--json] [--quiet] [--allow-err]\n' +
  '  node hook-counts.js --diff <A> <B> [--floor N] [--tolerance F] [--json] [--quiet]\n' +
  '\n' +
  '  A and B may be saved counts JSON or raw logs. Counts prove a hook was\n' +
  '  reached, never that it was correct.';

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error('hook-counts: ' + err.message + '\n' + USAGE);
    return 2;
  }
  const { positional, opts } = parsed;

  if (opts.diff) {
    if (positional.length !== 2) {
      console.error(USAGE);
      return 2;
    }
    let diff;
    try {
      const a = loadSide(positional[0], opts);
      const b = loadSide(positional[1], opts);
      diff = compareCounts(a, b, opts);
    } catch (err) {
      console.error('hook-counts: ' + err.message);
      return 2;
    }
    if (opts.json) console.log(JSON.stringify(diff, null, 2));
    else if (!opts.quiet) console.log(renderDiff(diff));
    return isRegression(diff) ? 1 : 0;
  }

  if (!positional.length) {
    console.error(USAGE);
    return 2;
  }

  let acc;
  let registrations = null;
  try {
    let window = null;
    if (opts.run) window = windowFromReport(opts.run, opts.slack);
    if (opts.since || opts.until) {
      window = Object.assign({}, window, {
        since: opts.since || (window && window.since) || null,
        until: opts.until || (window && window.until) || null
      });
    }
    acc = countPaths(positional, Object.assign({}, opts, { window }));
    if (opts.registrations) registrations = scanRegistrations(opts.registrations);
  } catch (err) {
    console.error('hook-counts: ' + err.message);
    return 2;
  }

  if (opts.save) {
    fs.writeFileSync(opts.save, JSON.stringify(acc, null, 2));
    if (!opts.quiet) console.error('hook-counts: wrote ' + opts.save);
  }
  if (opts.json) console.log(JSON.stringify(acc, null, 2));
  else if (!opts.quiet) console.log(renderCounts(acc, registrations));
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  countText,
  countFile,
  countPaths,
  compareCounts,
  isRegression,
  scanRegistrations,
  windowFromReport,
  renderCounts,
  renderDiff,
  parseArgs,
  loadSide,
  main,
  emptyAcc,
  FN_PREFIX,
  DEFAULT_FLOOR,
  DEFAULT_TOLERANCE
};
