/**
 * Playwright global setup.
 *
 * Fails the run up front when the database is missing something the suite
 * depends on, rather than letting it surface as a wall of confusing per-test
 * auth or empty-picker failures.
 */

const { ensureFixtures } = require('./helpers/images');
const { allPorts, urlForIndex } = require('./ports');
const fs = require('node:fs');
const path = require('node:path');

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
 * The newest modification time anywhere under a directory, in milliseconds.
 *
 * Returns 0 for a directory that does not exist, which the one caller reads as
 * "there is no build".
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
 * Refuse to run React specs against a build older than the source.
 *
 * The suite serves `dist-react/` as a static document root; it does not build,
 * and it does not run Vite's dev server. So `E2E_FRONTEND=react npx playwright
 * test` tests whatever happens to be sitting in that directory -- which, after
 * an afternoon of editing, is the app as it was that morning. Nothing about the
 * run says so. The tests pass or fail against code no longer on disk.
 *
 * `node e2e/run-react.js` builds first and is the reason this is usually fine.
 * This makes it fine either way.
 *
 * Set `E2E_ALLOW_STALE_BUILD=1` to run anyway -- bisecting a build, or checking
 * a report against the artifact that produced it.
 */
function assertFreshReactBuild() {
  const root = path.join(__dirname, '..');
  const built = newestMtime(path.join(root, 'dist-react'));
  if (built === 0) {
    throw new Error(
      '[e2e] there is no dist-react/ to serve. The React suite runs against the ' +
      'build, not a dev server: run `node e2e/run-react.js` (which builds first) ' +
      'or `npm run build:react`.'
    );
  }
  // `web/` is the whole React app -- src, index.html, the Vite config. Skip
  // the directories a build writes into or reads from rather than is built
  // from, so neither one can look like a source edit.
  const source = newestMtime(path.join(root, 'web'), ['node_modules', 'dist', 'dist-react']);
  if (source <= built) return;

  const age = Math.round((source - built) / 60000);
  const stale = `dist-react/ is older than web/ by ${age} minute(s)`;
  if (process.env.E2E_ALLOW_STALE_BUILD === '1') {
    console.warn(
      `[e2e] ${stale}. E2E_ALLOW_STALE_BUILD is set, so the run continues against ` +
      'the build as it is -- its results describe that build, not the working tree.'
    );
    return;
  }
  throw new Error(
    `[e2e] ${stale}, so this run would test a stale build rather than the working ` +
    'tree. Run `node e2e/run-react.js` (it builds first), or set ' +
    'E2E_ALLOW_STALE_BUILD=1 to run against the build as it is.'
  );
}

module.exports = async () => {
  // First, because it is a filesystem read and it invalidates the whole run.
  // Nothing is gained by seeding databases for a run that cannot be believed.
  if (process.env.E2E_FRONTEND === 'react') assertFreshReactBuild();

  await ensureFixtures();

  const ports = allPorts();
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

  // Which front end each backend is actually serving.
  //
  // The two differ only in the server's document root, so nothing about a run
  // says which one answered -- and a stale server on the right port is reused
  // rather than replaced. Getting this wrong is not a visible failure, it is a
  // clean-looking run of the wrong app, so it is asserted rather than assumed.
  const wanted = process.env.E2E_FRONTEND === 'react' ? 'react' : 'legacy';
  for (const [i, port] of ports.entries()) {
    const html = await fetch(`${urlForIndex(i)}/index.html`).then((r) => r.text());
    const served = html.includes('id="root"') ? 'react' : 'legacy';
    if (served !== wanted) {
      throw new Error(
        `[e2e] the backend on ${port} is serving the ${served} front end, but this run ` +
        `asked for ${wanted}. Playwright reuses a server already listening on the port ` +
        `it wants, so stop that process and run again.`
      );
    }
  }

  const first = results[0];
  console.log(
    `[e2e] setup ok: ${wanted} front end, ${ports.length} backend(s) on ${ports.join(', ')}, each seeded ` +
    `independently; ${first.users} users; required description categories present ` +
    `(${REQUIRED_CATEGORIES.map((c) => c + '=' + first.counts[c]).join(', ')})`
  );
};
