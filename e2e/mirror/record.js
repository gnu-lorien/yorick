#!/usr/bin/env node
'use strict';

/**
 * Record a session by clicking through the app, for `run.js` to replay.
 *
 * This is a thin wrapper over `playwright codegen`, and exists for three
 * reasons rather than one:
 *
 *  - It forces `--target=playwright-test`. Codegen's default JavaScript target
 *    emits library-mode code that launches its own browser, which `run.js`
 *    cannot replay. The test target emits a bare `async ({ page }) => {...}`
 *    body, which is exactly what the mirror wants.
 *  - It records against target 0, the reference build, so the selectors it
 *    picks come from the build you trust.
 *  - It defaults the output into `recordings/` and then prints the replay
 *    command, so there is no gap between recording and running.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { parseTargets } = require('./targets');

const RECORDINGS = path.join(__dirname, 'recordings');

function parseArgs(argv) {
  const opts = { url: null, out: null, targets: null, storage: null, saveStorage: null };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--url': opts.url = next(); break;
      case '--out': opts.out = next(); break;
      case '--targets': opts.targets = next(); break;
      case '--load-storage': opts.storage = next(); break;
      case '--save-storage': opts.saveStorage = next(); break;
      case '-h':
      case '--help': opts.help = true; break;
      default:
        if (!opts.out && !argv[i].startsWith('-')) opts.out = argv[i];
        else if (argv[i].startsWith('-')) throw new Error(`mirror: unknown option ${argv[i]}`);
    }
  }
  return opts;
}

function usage() {
  return [
    'Record a click-through for the mirror to replay.',
    '',
    '  node e2e/mirror/record.js [name] [options]',
    '',
    '  --url          <url>   what to record against (default: the first target)',
    '  --out          <file>  where to write        (default: recordings/<name>.js)',
    '  --targets      name=url,...',
    '  --save-storage <file>  save cookies + localStorage when the window closes',
    '  --load-storage <file>  start already logged in, from a previous --save-storage',
    '',
    'Logging in is the slow part of every recording. Do it once:',
    '',
    '  node e2e/mirror/record.js --save-storage e2e/mirror/.auth.json',
    '  node e2e/mirror/record.js flow --load-storage e2e/mirror/.auth.json',
    ''
  ].join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(usage());
    return;
  }

  const url = opts.url || parseTargets(opts.targets)[0].url;

  let out = opts.out || `session-${new Date().toISOString().slice(0, 10)}`;
  if (!out.endsWith('.js')) out = path.join(RECORDINGS, `${out}.js`);
  out = path.resolve(out);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const args = ['playwright', 'codegen', '--target=playwright-test', `--output=${out}`];
  if (opts.storage) args.push(`--load-storage=${path.resolve(opts.storage)}`);
  if (opts.saveStorage) args.push(`--save-storage=${path.resolve(opts.saveStorage)}`);
  args.push(url);

  console.log(`\nmirror: recording against ${url}`);
  console.log(`mirror: writing ${path.relative(process.cwd(), out)}`);
  console.log('mirror: click through the flow, then close the browser window.\n');

  const result = spawnSync('npx', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);

  if (!fs.existsSync(out)) {
    console.error('\nmirror: codegen produced nothing - was anything recorded?\n');
    process.exit(1);
  }

  console.log('\nmirror: recorded. Replay it across every target with:\n');
  console.log(`  node e2e/mirror/run.js ${path.relative(process.cwd(), out).split(path.sep).join('/')}\n`);
}

try {
  main();
} catch (err) {
  console.error(`\n${(err && err.message) || err}\n`);
  process.exit(1);
}
