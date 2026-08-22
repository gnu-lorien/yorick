/**
 * How much of the front end has been ported.
 *
 * Run: npm run migration:status
 *
 * Counts the handlers registered in web/src/screens/index.ts against the ones
 * the legacy router actually dispatches to, and lists what is left with the
 * legacy view files that implement it. Reads the registration file as text
 * rather than importing it, so it needs no bundler and cannot be thrown off by
 * a screen that fails to import.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

const screenMapSrc = fs.readFileSync(REPO + 'web/src/router/screenMap.ts', 'utf8');
const handlers = [...screenMapSrc.matchAll(/^\s{2}([a-z_0-9]+):\s*\{\s*pageId:\s*(null|"[^"]*")/gm)].map(
  (m) => ({ handler: m[1], pageId: m[2] === 'null' ? null : m[2].slice(1, -1) }),
);

// Screens self-register, so scan the screen files rather than one index.
// Reading them as text, not importing them, keeps this free of a bundler and
// immune to one broken screen hiding the status of all the others.
const screensDir = REPO + 'web/src/screens';
const done = new Set();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.tsx')) continue;
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(/^registerScreen\(\s*'([^']+)'/gm)) done.add(m[1]);
  }
};
walk(screensDir);

// The legacy view files, so the remaining work names its own source.
const viewsDir = REPO + 'public/scripts/app/views';
const views = fs.readdirSync(viewsDir).filter((f) => f.endsWith('.js'));
const viewLines = Object.fromEntries(
  views.map((f) => [f, fs.readFileSync(path.join(viewsDir, f), 'utf8').split('\n').length]),
);

const remaining = handlers.filter((h) => !done.has(h.handler));
const complete = handlers.length - remaining.length;
const pct = ((complete / handlers.length) * 100).toFixed(0);

console.log(`Screens: ${complete}/${handlers.length} handlers ported (${pct}%)\n`);

if (remaining.length) {
  console.log('Remaining, grouped by the page they render:');
  const byPage = new Map();
  for (const h of remaining) {
    const key = h.pageId ?? '(no page transition)';
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(h.handler);
  }
  for (const [page, hs] of [...byPage].sort()) {
    console.log(`  #${page}`);
    for (const h of hs) console.log(`      ${h}`);
  }
}

const totalViewLines = Object.values(viewLines).reduce((a, b) => a + b, 0);
console.log(`\nLegacy views still to translate: ${views.length} files, ${totalViewLines} lines`);
console.log('Largest:');
for (const [file, lines] of Object.entries(viewLines).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(lines).padStart(5)}  ${file}`);
}
