/**
 * Playwright global setup.
 *
 * Fails the run up front when the database is missing something the suite
 * depends on, rather than letting it surface as a wall of confusing per-test
 * auth or empty-picker failures.
 */

const { ensureFixtures } = require('./helpers/images');

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

module.exports = async (config) => {
  const baseUrl = (config.projects[0] && config.projects[0].use && config.projects[0].use.baseURL) ||
    'http://127.0.0.1:1337';

  await ensureFixtures();

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
      `Missing required test users: ${missingUsers.join(', ')}.\n` +
      `Restart the server so seed_db.js can upsert them, or run: npm run seed`
    );
  }

  // Description categories
  const counts = {};
  for (const category of REQUIRED_CATEGORIES) {
    counts[category] = await countCategory(baseUrl, category);
  }
  const missingCategories = REQUIRED_CATEGORIES.filter((c) => !counts[c]);
  if (missingCategories.length) {
    throw new Error(
      `Description categories are unseeded: ${missingCategories.join(', ')}.\n` +
      `These are backfilled from data/all_dev_descriptions.csv by seed_extra.js. ` +
      `Restart the server so seeding runs, or run: npm run seed`
    );
  }

  // Portrait uploads need publicServerURL to point at this server, because the
  // thumbnail beforeSave hook fetches the saved file back over HTTP.
  if (!process.env.PUBLIC_SERVER_URL) {
    console.warn(
      '[e2e] note: PUBLIC_SERVER_URL is unset in this Playwright process, which ' +
      'only means the server was already running and was reused rather than ' +
      'started here. What matters is the setting on the *server*: portrait uploads ' +
      'fail unless its publicServerURL points at itself, because the thumbnail ' +
      'beforeSave hook fetches each upload back over HTTP. If portrait tests fail ' +
      'with an opaque "[object Object]", restart the server via Playwright (kill ' +
      'the running node process and re-run) rather than assuming the feature is broken.'
    );
  }

  console.log(`[e2e] setup ok: ${users.length} users; required description categories present ` +
    `(${REQUIRED_CATEGORIES.map((c) => c + '=' + counts[c]).join(', ')})`);
};
