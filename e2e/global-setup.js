/**
 * Playwright global setup.
 *
 * Fails the run up front when the database is missing something the suite
 * depends on, rather than letting it surface as a wall of confusing per-test
 * auth or empty-picker failures.
 */

const fs = require('node:fs');
const path = require('node:path');

const { ensureFixtures } = require('./helpers/images');
const { allPorts, urlForIndex, FRONTENDS, FRONTEND } = require('./ports');

const REQUIRED_USERS = ['devuser', 'sampmem', 'sampast', 'sampstranger'];

/**
 * Description categories the Werewolf and Changeling suites cannot run without.
 * These live only in data/all_dev_descriptions.csv and are backfilled by
 * seed_extra.js; if they are empty the seed did not run.
 */
const REQUIRED_CATEGORIES = [
  'clans', 'archetypes', 'sects', 'titles', 'antecedences',
  'wta_breeds', 'wta_auspices', 'wta_tribes', 'wta_camps',
  'ctdbs_kiths', 'ctdbs_fealty_courts', 'ctdbs_kith_group_types'
];

const APP_ID = process.env.APPLICATION_ID || 'APPLICATION_ID';
const MASTER_KEY = process.env.MASTER_KEY || 'MASTER_KEY';

async function parseQuery(baseUrl, className, params) {
  const url = new URL(`${baseUrl}/parse/1/classes/${className}`);
  Object.keys(params || {}).forEach((k) => url.searchParams.set(k, params[k]));
  const res = await fetch(url, {
    headers: {
      'X-Parse-Application-Id': APP_ID,
      'X-Parse-Master-Key': MASTER_KEY
    }
  });
  if (!res.ok) throw new Error(`${className} query failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Count the rows in one Description category.
 *
 * Counting must be done per category rather than by listing rows and grouping:
 * Parse caps a query at 1000 results and there are well over that many
 * Descriptions once the CSV backfill has run, so a single listing silently
 * misses whichever categories fall outside the first page — which is exactly
 * the Werewolf and Changeling ones this check exists to guard.
 */
async function countCategory(baseUrl, category) {
  const body = await parseQuery(baseUrl, 'Description', {
    where: JSON.stringify({ category }),
    count: '1',
    limit: '0'
  });
  return body.count || 0;
}

/**
 * Check one worker's backend.
 *
 * Every backend is checked, not just the first. They are separate servers over
 * separate in-memory databases, so "the seed ran" is a fact about one of them
 * and proves nothing about the rest — and a single unseeded backend would
 * surface as a third of the suite failing with empty pickers, which is exactly
 * the confusion this setup exists to prevent.
 */
async function verifyBackend(baseUrl) {
  // Users
  const usersRes = await fetch(`${baseUrl}/parse/1/users?limit=200`, {
    headers: { 'X-Parse-Application-Id': APP_ID, 'X-Parse-Master-Key': MASTER_KEY }
  });
  if (!usersRes.ok) {
    throw new Error(`Could not reach Parse at ${baseUrl} (HTTP ${usersRes.status}). Is the server running?`);
  }
  const users = (await usersRes.json()).results.map((u) => u.username);
  const missingUsers = REQUIRED_USERS.filter((u) => users.indexOf(u) === -1);
  if (missingUsers.length) {
    throw new Error(
      `${baseUrl}: missing required test users: ${missingUsers.join(', ')}.\n` +
      `Restart the server so seed_db.js can upsert them, or run: npm run seed`
    );
  }

  // Description categories
  const counts = {};
  await Promise.all(REQUIRED_CATEGORIES.map(async (category) => {
    counts[category] = await countCategory(baseUrl, category);
  }));
  const missingCategories = REQUIRED_CATEGORIES.filter((c) => !counts[c]);
  if (missingCategories.length) {
    throw new Error(
      `${baseUrl}: description categories are unseeded: ${missingCategories.join(', ')}.\n` +
      `These are backfilled from data/all_dev_descriptions.csv by seed_extra.js. ` +
      `Restart the server so seeding runs, or run: npm run seed`
    );
  }

  return { users: users.length, counts };
}

/**
/**
 * Refuse to run against the wrong front end.
 *
 * `reuseExistingServer` means Playwright will happily adopt a server already
 * listening on the port it wants, and the front ends differ only in that
 * server's document root. So a run can be handed a different app and report a
 * clean suite about it -- during the React port that produced a "legacy
 * regression check" which was really a second React run, 26 green tests against
 * the wrong app.
 *
 * `e2e/ports.js` gives each front end its own port block so this should not
 * arise. This asserts it anyway, because the failure mode is silent success.
 *
 * The markers live in that same table; see the note there on why they are what
 * they are.
 */
async function verifyServedApp(baseUrl, expected) {
  const res = await fetch(`${baseUrl}/`);
  if (!res.ok) {
    throw new Error(`Could not fetch index.html from ${baseUrl} (HTTP ${res.status}).`);
  }
  const html = await res.text();

  if (FRONTENDS[expected].marker.test(html)) return;

  const served = Object.keys(FRONTENDS).find((name) => FRONTENDS[name].marker.test(html));
  throw new Error(
    `[e2e] ${baseUrl} is serving the ${served || 'UNRECOGNISED'} front end, but this run ` +
    `asked for ${expected}. Playwright reuses a server already listening on the port it ` +
    'wants, so a leftover server from another client will be adopted silently and the ' +
    'whole run will describe the wrong app. Stop the process on that port and re-run.'
  );
}

/**
 * The newest modification time anywhere under a directory, in milliseconds.
 *
 * Returns 0 for a directory that does not exist, which the one caller reads as
 * "there is no build".
 *
 * FILE mtimes only, never directory mtimes: a directory's mtime changes when a
 * temp file is created and deleted inside it, which makes the comparison fire
 * at random for no reason a reader can see.
 */
function newestMtime(dir, skip = []) {
  let newest = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (skip.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full, skip));
    } else {
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  }
  return newest;
}

/**
 * Refuse to run a port's specs against a build older than its source.
 *
 * `playwright.config.js` serves a static document root and deliberately does
 * not build -- with N workers that would be N bundler runs. So freshness is
 * left to whoever typed the command, and the two ways of starting a run do not
 * agree: a wrapper that builds first is safe, while
 * `YORICK_E2E_CLIENT=vue npx playwright test` serves whatever is already in
 * `client/dist`. The second is what you type to re-run one spec, which is
 * exactly when you have been editing.
 *
 * There is no symptom. A green run can describe code that is no longer on
 * disk, and a red run sends you chasing a bug you already fixed. That happened
 * here: an experiment that "proved" `disableSingleInstance()` was not the cause
 * of the costs-view failures was running the unmodified bundle, and the same
 * experiment against a real build proved the opposite.
 *
 * The legacy client is deliberately NOT checked, and needs no special case to
 * say so: it is served straight out of `public/`, which is its own source, so
 * it has no `sourceDir` in the table and cannot be stale.
 *
 * Set `E2E_ALLOW_STALE_BUILD=1` to run anyway -- bisecting a build, or checking
 * a report against the artifact that produced it.
 */
function assertFreshBuild(name) {
  const frontend = FRONTENDS[name];
  if (!frontend.sourceDir) return;

  const root = path.join(__dirname, '..');
  const outDir = frontend.docRoot.join('/');
  const built = newestMtime(path.join(root, ...frontend.docRoot));
  if (built === 0) {
    throw new Error(
      `[e2e] there is no ${outDir}/ to serve. The ${name} suite runs against the ` +
      `build, not a dev server. Build it first:\n  ${frontend.rebuild}`
    );
  }

  let source = newestMtime(path.join(root, ...frontend.sourceDir), frontend.sourceIgnore);

  // Build config living outside the source tree still decides what the bundle
  // contains, so an edit to it has to count as an edit to the app. The Vue
  // build is invoked with `root: client` and its config sits at the repo root,
  // so a walk of `client/` alone would miss it.
  for (const configFile of frontend.extraSourceFiles || []) {
    try {
      source = Math.max(source, fs.statSync(path.join(root, configFile)).mtimeMs);
    } catch {
      // Absent is fine; it simply contributes nothing.
    }
  }

  if (source <= built) return;

  /*
   * Seconds under a minute. Rounding straight to minutes prints "older by 0
   * minute(s)", which reads as a bug in the check rather than as the very
   * recent edit it actually is -- and a just-edited file is the commonest way
   * to arrive here.
   */
  const gap = source - built;
  const age = gap < 60000
    ? `${Math.max(1, Math.round(gap / 1000))} second(s)`
    : `${Math.round(gap / 60000)} minute(s)`;
  const stale = `${outDir}/ is older than the ${name} source by ${age}`;

  if (process.env.E2E_ALLOW_STALE_BUILD === '1') {
    console.warn(
      `[e2e] ${stale}. E2E_ALLOW_STALE_BUILD is set, so the run continues against ` +
      'the build as it is -- its results describe that build, not the working tree.'
    );
    return;
  }
  throw new Error(
    `[e2e] ${stale}, so this run would test a stale build rather than the working ` +
    `tree. Rebuild with \`${frontend.rebuild}\`, or set E2E_ALLOW_STALE_BUILD=1 to ` +
    'run against the build as it is.'
  );
}

module.exports = async () => {
  /*
   * First, before fixtures and before any backend is touched. It is a
   * filesystem read and it invalidates the whole run: nothing is gained by
   * seeding databases for a run that cannot be believed.
   *
   * Skipped when PUBLIC_BASE is set by hand: someone is then pointing the suite
   * at a document root of their own choosing, and the table's idea of where
   * that front end's build lives does not apply to it.
   */
  if (!process.env.PUBLIC_BASE) assertFreshBuild(FRONTEND);

  await ensureFixtures();

  const ports = allPorts();

  /*
   * Assert the app before the data. A backend serving the wrong front end makes
   * every later result meaningless, however well seeded it is.
   */
  await Promise.all(ports.map((port, i) => verifyServedApp(urlForIndex(i), FRONTEND)));

  const results = await Promise.all(ports.map((port, i) => verifyBackend(urlForIndex(i))));

  // Portrait uploads need publicServerURL to point at the server serving them,
  // because the thumbnail beforeSave hook fetches the saved file back over HTTP.
  if (!process.env.PUBLIC_SERVER_URL) {
    console.warn(
      '[e2e] note: PUBLIC_SERVER_URL is unset in this Playwright process, which ' +
      'only means the servers were already running and were reused rather than ' +
      'started here. What matters is the setting on each *server*: portrait uploads ' +
      'fail unless its publicServerURL points at itself, because the thumbnail ' +
      'beforeSave hook fetches each upload back over HTTP. If portrait tests fail ' +
      'with an opaque "[object Object]", restart the servers via Playwright (kill ' +
      'the running node processes and re-run) rather than assuming the feature is broken.'
    );
  }

  const first = results[0];
  console.log(
    `[e2e] setup ok: ${FRONTEND} front end, ${ports.length} backend(s) on ${ports.join(', ')}, each seeded ` +
    `independently; ${first.users} users; required description categories present ` +
    `(${REQUIRED_CATEGORIES.map((c) => c + '=' + first.counts[c]).join(', ')})`
  );
};

// Exposed so the guard's four states can be exercised without a full run.
module.exports.assertFreshBuild = assertFreshBuild;
module.exports.newestMtime = newestMtime;
module.exports.verifyServedApp = verifyServedApp;
