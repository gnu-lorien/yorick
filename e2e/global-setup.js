/**
 * Playwright global setup.
 *
 * Fails the run up front when the database is missing something the suite
 * depends on, rather than letting it surface as a wall of confusing per-test
 * auth or empty-picker failures.
 */

const { ensureFixtures } = require('./helpers/images');
const { allPorts, urlForIndex } = require('./ports');

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
 * Build the Vue client before the suite drives it.
 *
 * The two front ends are NOT served the same way, and the asymmetry is a trap.
 * The legacy client is served straight out of `public/` -- RequireJS loads the
 * source files, so a legacy run always tests what is on disk. The Vue client is
 * served out of `client/dist` (see `playwright.config.js`, PUBLIC_BASE), which
 * is a build artefact, and nothing regenerated it.
 *
 * So a Vue run tested whatever `vite build` last produced, which could be any
 * age. That is not a slow feedback loop, it is a WRONG one: edit the client, run
 * the suite, and the result describes code you no longer have. It cost three
 * successive wrong conclusions before anyone noticed -- an experiment that
 * "proved" a change was not the cause was really running the unmodified bundle.
 *
 * Building here restores the property the legacy side already has: what runs is
 * what is on disk. It costs about six seconds and it is not optional.
 *
 * Set `YORICK_E2E_SKIP_BUILD=1` to skip it -- only when you have deliberately
 * built something else and want it measured, and never to save time.
 */
async function buildVueClient() {
  if (process.env.YORICK_E2E_CLIENT !== 'vue') return;
  if (process.env.PUBLIC_BASE) return; // an explicit base is the caller's business
  if (process.env.YORICK_E2E_SKIP_BUILD) {
    console.warn('[e2e] YORICK_E2E_SKIP_BUILD set: the Vue bundle is NOT being rebuilt, ' +
      'so this run measures whatever client/dist already holds.');
    return;
  }

  const { spawnSync } = require('child_process');
  const path = require('path');
  const started = Date.now();

  // `shell: true` on Windows: spawning `npx.cmd` without a shell fails with
  // EINVAL since the CVE-2024-27980 fix.
  const result = spawnSync('npx', ['vite', 'build'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    throw new Error(
      '[e2e] the Vue client failed to build, so there is nothing valid to test:\n' +
      (result.stderr || result.stdout || '(no output)')
    );
  }
  console.log(`[e2e] built the Vue client into client/dist in ${Date.now() - started}ms`);
}

module.exports = async () => {
  await buildVueClient();
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

  const first = results[0];
  console.log(
    `[e2e] setup ok: ${ports.length} backend(s) on ${ports.join(', ')}, each seeded ` +
    `independently; ${first.users} users; required description categories present ` +
    `(${REQUIRED_CATEGORIES.map((c) => c + '=' + first.counts[c]).join(', ')})`
  );
};
