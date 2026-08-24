#!/usr/bin/env node
'use strict';

/**
 * Replay one recorded session against every target at once and diff the result.
 *
 *   node e2e/mirror/run.js e2e/mirror/recordings/login.js
 *
 * Each target gets its own browser process rather than its own context inside
 * one browser, because Playwright has no API for positioning a context's
 * window and the whole point of headed mode is watching the windows do the
 * same thing side by side. `--window-position` is a launch argument, so one
 * launch per target is what buys the tiling.
 */

const fs = require('fs');
const path = require('path');
const { chromium, expect } = require('@playwright/test');

const { fanout, MirrorActionError } = require('./fanout');
const { parseTargets, checkReachable, originsOf, rebasedPage } = require('./targets');
const { captureStep } = require('./compare');
const { loadRecording } = require('./load-recording');
const { writeReport } = require('./report');

const MAX_STEPS = 500;

const DEFAULTS = {
  out: 'mirror-out',
  settle: 300,
  tolerance: 0.005,
  threshold: 0.15,
  window: '640x1000',
  slowMo: 0,
  headless: false,
  fullPage: false,
  // Deliberately shorter than the E2E suite's 20s. Here a missing element is
  // usually the finding, not a flake, and waiting 30s for Playwright's default
  // to expire on every divergence makes a long recording unwatchable.
  timeout: 10000
};

function parseArgs(argv) {
  const opts = Object.assign({}, DEFAULTS, { recording: null, targets: null });
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--targets': opts.targets = next(); break;
      case '--out': opts.out = next(); break;
      case '--settle': opts.settle = Number(next()); break;
      case '--tolerance': opts.tolerance = Number(next()); break;
      case '--threshold': opts.threshold = Number(next()); break;
      case '--window': opts.window = next(); break;
      case '--slow-mo': opts.slowMo = Number(next()); break;
      case '--timeout': opts.timeout = Number(next()); break;
      case '--headless': opts.headless = true; break;
      case '--full-page': opts.fullPage = true; break;
      case '-h':
      case '--help': opts.help = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`mirror: unknown option ${arg}`);
        rest.push(arg);
    }
  }
  opts.recording = rest[0] || null;
  return opts;
}

function usage() {
  return [
    'Drive several builds of the app from one recorded session and diff them.',
    '',
    '  node e2e/mirror/run.js <recording> [options]',
    '',
    '  --targets   name=url,name=url  builds to drive; the first is the reference',
    '                                 (default: MIRROR_TARGETS, see e2e/mirror/targets.js)',
    `  --out       <dir>              where runs are written       (default ${DEFAULTS.out})`,
    `  --settle    <ms>               pause before each screenshot (default ${DEFAULTS.settle})`,
    `  --tolerance <ratio>            differing-pixel ratio still called a match (default ${DEFAULTS.tolerance})`,
    `  --threshold <0..1>             per-pixel colour sensitivity (default ${DEFAULTS.threshold})`,
    `  --window    <WxH>              size of each tiled window    (default ${DEFAULTS.window})`,
    '  --slow-mo   <ms>               pause between actions, to watch along',
    `  --timeout   <ms>               how long an action may wait      (default ${DEFAULTS.timeout})`,
    '  --headless                     no windows; still screenshots and diffs',
    '  --full-page                    capture whole scroll height, not just viewport',
    '',
    'Record a session first with:  node e2e/mirror/record.js',
    ''
  ].join('\n');
}

function parseWindow(spec) {
  const match = /^(\d+)x(\d+)$/.exec(String(spec).trim());
  if (!match) throw new Error(`mirror: --window expects WxH, got "${spec}"`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.recording) {
    process.stdout.write(usage());
    process.exit(opts.help ? 0 : 1);
  }

  const targets = parseTargets(opts.targets);
  const names = targets.map((t) => t.name);
  const recording = loadRecording(opts.recording);
  const win = parseWindow(opts.window);

  const reachability = await checkReachable(targets);
  const down = reachability.filter((t) => !t.reachable);
  if (down.length) {
    console.error('\nmirror: these targets are not answering - start them first:\n');
    for (const t of down) console.error(`  ${t.name.padEnd(12)} ${t.url}   (${t.reason})`);
    console.error('');
    process.exit(1);
  }

  const runDir = path.resolve(opts.out, timestamp());
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`\nmirror: replaying ${path.relative(process.cwd(), recording.file)} (${recording.kind})`);
  targets.forEach((t, i) => {
    console.log(`  ${i === 0 ? '*' : ' '} ${t.name.padEnd(12)} ${t.url}${i === 0 ? '   [reference]' : ''}`);
  });
  console.log('');

  const browsers = [];
  const pages = [];
  const consoleErrors = names.map(() => []);

  try {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const browser = await chromium.launch({
        headless: opts.headless,
        slowMo: opts.slowMo,
        args: opts.headless ? [] : [
          `--window-position=${i * win.width},0`,
          `--window-size=${win.width},${win.height}`
        ]
      });
      browsers.push(browser);

      const context = await browser.newContext({
        baseURL: target.url,
        // With a real window, let the window drive the viewport so what gets
        // screenshotted is what you are watching. Headless has no window.
        viewport: opts.headless ? { width: win.width, height: win.height } : null
      });
      context.setDefaultTimeout(opts.timeout);
      context.setDefaultNavigationTimeout(Math.max(opts.timeout, 30000));
      const page = await context.newPage();

      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors[i].push(msg.text());
      });
      page.on('pageerror', (err) => consoleErrors[i].push(String((err && err.message) || err)));

      pages.push(page);
    }

    const steps = [];
    let stepIndex = 0;

    const capture = async (label) => {
      if (stepIndex >= MAX_STEPS) return null;
      stepIndex += 1;
      const step = await captureStep({
        pages,
        names,
        label,
        index: stepIndex,
        outDir: runDir,
        settleMs: opts.settle,
        threshold: opts.threshold,
        tolerance: opts.tolerance,
        fullPage: opts.fullPage
      });
      steps.push(step);
      const mark = step.diverged ? 'DIFF' : ' ok ';
      const amount = step.maxRatio ? ` ${(step.maxRatio * 100).toFixed(2)}%` : '';
      console.log(`  [${mark}] ${String(stepIndex).padStart(3, '0')} ${label}${amount}`);
      return step;
    };

    // The recording drives rebased pages so that a recorded absolute URL sends
    // each window to its own build; everything else - screenshots, console
    // capture - works off the real pages.
    const origins = originsOf(targets);
    const driven = pages.map((p, i) => rebasedPage(p, targets[i].url, origins));
    const page = fanout(driven, { names, onAction: (label) => capture(label) });

    const startedAt = new Date().toISOString();
    let failure = null;

    try {
      await recording.run({ page, pages, step: capture, expect });
    } catch (err) {
      failure = err instanceof MirrorActionError
        ? `${err.message}\n${err.outcomes.map((o) => `    ${o.name}: ${o.ok ? 'ok' : o.error}`).join('\n')}`
        : String((err && err.stack) || err);
      console.error(`\nmirror: replay stopped - ${err && err.message}`);
      // Shoot anyway: the state at the moment one build refused to do what the
      // others just did is the most informative frame in the run.
      await capture('after failure').catch(() => {});
      if (steps.length) steps[steps.length - 1].failure = failure;
    }

    if (!failure) await capture('final');

    const run = {
      recording: recording.file,
      targets,
      startedAt,
      finishedAt: new Date().toISOString(),
      tolerance: opts.tolerance,
      threshold: opts.threshold,
      timeout: opts.timeout,
      fullPage: opts.fullPage,
      consoleErrors: names.reduce((acc, n, i) => Object.assign(acc, { [n]: consoleErrors[i] }), {}),
      error: failure,
      steps
    };

    const reportFile = writeReport(run, runDir);
    const divergent = steps.filter((s) => s.diverged);

    console.log('');
    console.log(`mirror: ${steps.length} step(s), ${divergent.length} diverged`);
    names.forEach((name, i) => {
      if (consoleErrors[i].length) {
        console.log(`  ${name}: ${consoleErrors[i].length} console error(s), first: ${consoleErrors[i][0].split('\n')[0]}`);
      }
    });
    console.log(`mirror: report ${path.relative(process.cwd(), reportFile)}`);
    console.log('');

    process.exitCode = (failure || divergent.length) ? 1 : 0;
  } finally {
    for (const browser of browsers) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error(`\n${(err && err.message) || err}\n`);
  process.exit(1);
});
