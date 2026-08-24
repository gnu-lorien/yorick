'use strict';

/**
 * Turn a file on disk into a replayable function.
 *
 * Two shapes are accepted, so that a raw `playwright codegen` file needs no
 * editing before its first run:
 *
 *  1. A module exporting an async function - `module.exports = async ({ page,
 *     step, expect }) => { ... }`. Use this once a recording is worth keeping;
 *     it can call `step()` at the points that actually matter.
 *
 *  2. Anything else, treated as codegen output. The body of the `test(...)`
 *     callback is extracted and compiled on its own, with `page` bound to the
 *     mirror proxy. Top-level requires are dropped - the harness supplies
 *     everything the body can reach.
 */

const fs = require('fs');
const path = require('path');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const BACKSLASH = '\\';

/** `test('name', async ({ page }) => { <body> });` -> `<body>` */
function extractTestBody(source) {
  const start = source.search(/async\s*\(\s*\{[^)]*\}\s*\)\s*=>\s*\{/);
  if (start === -1) return null;

  const braceAt = source.indexOf('{', source.indexOf('=>', start));
  if (braceAt === -1) return null;

  // Walk the braces rather than regexing to the end - object literals in
  // `getByRole('button', { name: 'x' })` make a lazy match stop far too early.
  let depth = 0;
  let inString = null;
  let escaped = false;

  for (let i = braceAt; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === BACKSLASH) { escaped = true; continue; }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(braceAt + 1, i);
    }
  }
  return null;
}

function stripTopLevelImports(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*(const|let|var)\s*\{?[^=]*\}?\s*=\s*require\(/.test(line))
    .filter((line) => !/^\s*import\s/.test(line))
    .join('\n');
}

/**
 * @param {string} file  path to a recording
 * @returns {{ run: function, kind: 'module'|'codegen', file: string }}
 */
function loadRecording(file) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    throw new Error(`mirror: no recording at ${resolved}`);
  }
  const source = fs.readFileSync(resolved, 'utf8');

  if (/module\.exports\s*=/.test(source)) {
    // eslint-disable-next-line global-require
    const exported = require(resolved);
    const run = typeof exported === 'function' ? exported : exported && exported.run;
    if (typeof run !== 'function') {
      throw new Error(
        `mirror: ${file} exports no function - expected module.exports = async ({ page }) => {...}`
      );
    }
    return { run, kind: 'module', file: resolved };
  }

  const body = extractTestBody(source) || stripTopLevelImports(source);
  if (!body.trim()) {
    throw new Error(`mirror: ${file} looks empty - nothing to replay`);
  }

  let compiled;
  try {
    compiled = new AsyncFunction('page', 'step', 'expect', 'pages', body);
  } catch (err) {
    throw new Error(`mirror: ${file} did not compile - ${err.message}`);
  }

  const run = ({ page, step, expect, pages }) => compiled(page, step, expect, pages);
  return { run, kind: 'codegen', file: resolved };
}

module.exports = { loadRecording, extractTestBody };
