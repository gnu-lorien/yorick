/**
 * Diff the React front end's markup against the legacy app's, screen by screen.
 *
 * Run: npm run compare:dom -- [hash ...]
 *
 * The migration's promise is that nothing looks different. That is not
 * something to check by eye across 59 screens, and a screenshot diff would
 * report every antialiasing difference as a failure. So this compares the thing
 * the stylesheet actually keys off: the tree of tags, ids and classes.
 *
 * Text content, inline styles and attribute order are ignored on purpose --
 * jQuery Mobile computes page padding and popup positions at runtime, and the
 * two apps hold different data in the same shape. What is left is the shape.
 *
 * Both servers must be running:
 *   .claude/dev-react.js   legacy app + Parse API on 41500
 *   npm run dev:react      React app on 41501
 *
 * Exits non-zero if any requested screen differs, so it can gate a commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const LEGACY = process.env.LEGACY_URL || 'http://localhost:41500';
const REACT = process.env.REACT_URL || 'http://localhost:41501';
const USERNAME = process.env.COMPARE_USER || 'devuser';
const PASSWORD = process.env.COMPARE_PASSWORD || 'thedumbness';

/**
 * The URLs to compare, collected from the screens themselves.
 *
 * A screen file declares the URLs it should be checked at with `@compare`
 * lines in a comment:
 *
 *     // @compare #characters?all
 *
 * Collecting them per-file rather than from one list here is what lets several
 * screens be written at once: a new screen brings its own coverage and touches
 * no shared line. Use `@compare (home)` for the empty hash.
 */
/**
 * URLs whose difference is deliberate, and why.
 *
 * Declared with `@compare-known <url> -- <reason>` in the screen's doc comment.
 * These still run and still print their diff -- the point is not to stop
 * looking, it is to stop a known difference drowning out a new one. They are
 * counted separately in the summary so the list cannot quietly grow.
 */
const known = new Map();

function declaredHashes() {
  const REPO = fileURLToPath(new URL('../..', import.meta.url));
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.tsx')) continue;
      // The target must be a hash or the literal `(home)`. Screens that have
      // no URL say so in prose -- "No `@compare` marker: ..." -- and a looser
      // pattern picks the next word out of that sentence and tries to visit
      // "marker:" as a URL.
      const src = fs.readFileSync(full, 'utf8');
      for (const m of src.matchAll(/@compare\s+(#\S+|\(home\))/g)) {
        found.push(m[1] === '(home)' ? '' : m[1]);
      }
      // A screen that is *known* to differ says so, with a reason on the same
      // line. See knownDivergences() below for why these still run.
      for (const m of src.matchAll(/@compare-known\s+(#\S+|\(home\))\s+--\s+(.+)/g)) {
        const url = m[1] === '(home)' ? '' : m[1];
        found.push(url);
        known.set(url, m[2].trim());
      }
    }
  };
  walk(REPO + 'web/src/screens');
  return [...new Set(found)];
}

const hashes = process.argv.slice(2).length ? process.argv.slice(2) : declaredHashes();
if (!hashes.length) {
  console.log('No @compare URLs declared in web/src/screens. Nothing to check.');
  process.exit(0);
}

/**
 * Reduce a subtree to tag + id + sorted classes, nested.
 *
 * `ui-page-active` is dropped because the legacy app marks one of 59 resident
 * pages with it while React renders only the active one, so it is always
 * present in React and only sometimes in the legacy DOM.
 */
function skeletonSource() {
  return (selector) => {
    const walk = (el, depth) => {
      if (depth > 14) return '';
      const classes = [...el.classList]
        .filter((c) => c !== 'ui-page-active')
        .sort()
        .join('.');
      // jQuery Mobile mints ids from a per-enhancement counter when the source
      // element has none -- `this.selectId = this.select.attr("id") ||
      // ("select-" + this.uuid)` at jquery.mobile-1.4.5.js:10096. Those cannot
      // be reproduced by a second run of anything, and nothing keys off them:
      // not the stylesheet, not the E2E suite. Normalised away on both sides,
      // for the same reason inline styles are ignored -- they are runtime
      // artefacts, not markup.
      const rawId = el.id && /^(select|collapsible|slider|radio|checkbox)-\d+(-button|-menu)?$/.test(el.id)
        ? ''
        : el.id;
      const id = rawId ? `#${rawId}` : '';
      const self = '  '.repeat(depth) + el.tagName.toLowerCase() + id + (classes ? '.' + classes : '');
      const kids = [...el.children]
        .filter((c) => !c.matches('script, style, link'))
        .map((c) => walk(c, depth + 1))
        .filter(Boolean);
      return [self, ...kids].join('\n');
    };
    const el = document.querySelector(selector);
    return el ? walk(el, 0) : null;
  };
}

/**
 * Wait until the app can answer questions about the session.
 *
 * `Parse.applicationId` being set is not enough on the legacy app: the SDK
 * installs its storage controller during the same bootstrap, and calling
 * `Parse.User.current()` before that lands throws inside the bundle rather
 * than returning null. The legacy app is ready when jQuery Mobile is, which is
 * the condition e2e/helpers/jqm-helpers.js waits on; the React app has no
 * jQuery at all, so it is ready when the SDK answers without throwing.
 */
async function ready(page) {
  await page.waitForFunction(
    () => {
      if (!(window.Parse && window.Parse.applicationId)) return false;
      if (window.jQuery && !window.jQuery.mobile) return false;
      try {
        window.Parse.User.current();
        return true;
      } catch {
        return false;
      }
    },
    { timeout: 30000 },
  );
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/');
  await ready(page);
  const already = await page.evaluate(
    () => (window.Parse.User.current() ? window.Parse.User.current().get('username') : null),
  );
  if (already === USERNAME) return;
  await page.evaluate(
    async ([u, p]) => {
      await window.Parse.User.logIn(u, p);
    },
    [USERNAME, PASSWORD],
  );
  await page.goto(baseUrl + '/');
  await ready(page);
}

/**
 * Land on a hash and wait for the app to settle there.
 *
 * The legacy app needs a nudge: it disables jQuery Mobile's own hash listening
 * (`$.mobile.hashListeningEnabled = false` in app/main.js) and dispatches
 * through Backbone's history instead, so setting `location.hash` from outside
 * does not always start a route. Reloading at the target URL always does.
 */
async function show(page, baseUrl, hash) {
  await page.goto(baseUrl + '/' + hash);
  await ready(page);
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.ui-page-active');
        if (!el) return false;
        const main = el.querySelector('div[role="main"]') || el;
        return main.textContent.trim().length > 0 || main.children.length > 0;
      },
      { timeout: 20000 },
    )
    .catch(() => {});
  // Let a second render or a late fetch land before measuring.
  await page.waitForTimeout(1200);
}

/**
 * Report the difference between two skeletons.
 *
 * A naive line-by-line comparison is close to unreadable here: one extra row in
 * a list shifts every following line, so a single inserted `<li>` prints as
 * forty differing lines with legacy and react interleaved out of phase. This
 * finds the first genuine divergence and then reports the *sets* of lines each
 * side has that the other does not, which for the common cases -- an extra row,
 * a missing wrapper, a renamed class -- says what actually changed.
 */
function diff(a, b) {
  const left = (a ?? '(missing)').split('\n');
  const right = (b ?? '(missing)').split('\n');

  let firstDivergence = 0;
  while (
    firstDivergence < left.length &&
    firstDivergence < right.length &&
    left[firstDivergence] === right[firstDivergence]
  ) {
    firstDivergence++;
  }

  const out = [];
  out.push(`  lines: legacy ${left.length}, react ${right.length}; first differ at ${firstDivergence + 1}`);
  if (left[firstDivergence] !== undefined) out.push(`    legacy: ${left[firstDivergence]}`);
  if (right[firstDivergence] !== undefined) out.push(`    react : ${right[firstDivergence]}`);

  // Multiset difference, so a row that simply repeats is not reported as new.
  const tally = (lines) => {
    const counts = new Map();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  };
  const leftCounts = tally(left);
  const rightCounts = tally(right);
  const onlyIn = (mine, theirs) => {
    const found = [];
    for (const [line, count] of mine) {
      const extra = count - (theirs.get(line) ?? 0);
      for (let i = 0; i < extra; i++) found.push(line);
    }
    return found;
  };

  const onlyLegacy = onlyIn(leftCounts, rightCounts);
  const onlyReact = onlyIn(rightCounts, leftCounts);
  const show = (label, lines) => {
    if (!lines.length) return;
    out.push(`  only in ${label} (${lines.length}):`);
    for (const line of lines.slice(0, 25)) out.push(`    ${line.trim()}`);
    if (lines.length > 25) out.push(`    ... and ${lines.length - 25} more`);
  };
  show('legacy', onlyLegacy);
  show('react', onlyReact);
  return out;
}

const browser = await chromium.launch();
const legacyPage = await browser.newPage();
const reactPage = await browser.newPage();

let failures = 0;
let knownCount = 0;
try {
  await login(legacyPage, LEGACY);
  await login(reactPage, REACT);

  for (const hash of hashes) {
    await show(legacyPage, LEGACY, hash);
    await show(reactPage, REACT, hash);

    const activeOf = (page) =>
      page.evaluate(() => (document.querySelector('.ui-page-active') || {}).id || null);
    const legacyActive = await activeOf(legacyPage);
    const reactActive = await activeOf(reactPage);
    const label = hash || '(home)';

    // Landing on different pages is a routing difference, not a markup one,
    // and comparing the same id across the two apps would hide it -- the
    // legacy app keeps all 59 pages in the document, so the element exists
    // whether or not it is the one on screen.
    if (legacyActive !== reactActive) {
      if (known.has(hash)) knownCount++;
      else failures++;
      console.log(`${known.has(hash) ? 'KNOWN' : 'DIFF '} ${label}  different page`);
      console.log(`  legacy: #${legacyActive}`);
      console.log(`  react : #${reactActive}`);
      console.log();
      continue;
    }

    const selector = reactActive ? `#${reactActive}` : '.ui-page-active';
    const legacySkeleton = await legacyPage.evaluate(skeletonSource(), selector);
    const reactSkeleton = await reactPage.evaluate(skeletonSource(), selector);

    if (legacySkeleton === reactSkeleton) {
      console.log(`OK    ${label}  ${selector}`);
      continue;
    }
    const reason = known.get(hash);
    if (reason) {
      knownCount++;
      console.log(`KNOWN ${label}  ${selector}  -- ${reason}`);
    } else {
      failures++;
      console.log(`DIFF  ${label}  ${selector}`);
    }
    for (const line of diff(legacySkeleton, reactSkeleton)) console.log(line);
    console.log();
  }
} finally {
  await browser.close();
}

// Deliberate divergences are counted apart from matches, never folded into
// them. A migration whose scoreboard says "20/20" while three screens quietly
// differ is a scoreboard nobody should trust.
const matched = hashes.length - failures - knownCount;
console.log(
  `\n${matched}/${hashes.length} screens match` +
    (knownCount ? `, ${knownCount} differ deliberately` : '') +
    (failures ? `, ${failures} differ unexpectedly` : ''),
);
process.exit(failures ? 1 : 0);
