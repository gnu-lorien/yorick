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
import { chromium } from '@playwright/test';

const LEGACY = process.env.LEGACY_URL || 'http://localhost:41500';
const REACT = process.env.REACT_URL || 'http://localhost:41501';
const USERNAME = process.env.COMPARE_USER || 'devuser';
const PASSWORD = process.env.COMPARE_PASSWORD || 'thedumbness';

/** Screens compared when none are named on the command line. */
const DEFAULT_HASHES = ['', '#about', '#privacy', '#signup', '#reset'];

const hashes = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_HASHES;

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
      const id = el.id ? `#${el.id}` : '';
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

function diff(a, b) {
  const left = (a ?? '(missing)').split('\n');
  const right = (b ?? '(missing)').split('\n');
  const out = [];
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    if (left[i] !== right[i]) {
      if (left[i] !== undefined) out.push(`  legacy: ${left[i]}`);
      if (right[i] !== undefined) out.push(`  react : ${right[i]}`);
    }
  }
  return out;
}

const browser = await chromium.launch();
const legacyPage = await browser.newPage();
const reactPage = await browser.newPage();

let failures = 0;
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
      failures++;
      console.log(`DIFF  ${label}  different page`);
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
    failures++;
    console.log(`DIFF  ${label}  ${selector}`);
    for (const line of diff(legacySkeleton, reactSkeleton)) console.log(line);
    console.log();
  }
} finally {
  await browser.close();
}

console.log(`\n${hashes.length - failures}/${hashes.length} screens match`);
process.exit(failures ? 1 : 0);
