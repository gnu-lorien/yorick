const { defineConfig, devices } = require('@playwright/test');
const { workerCount, allPorts, urlForIndex, portForThisProcess } = require('./e2e/ports');

/**
 * Playwright E2E configuration for Yorick.
 *
 * Projects are split along the task boundaries in testing_implementation_plan.md
 * so a single area can be run, sharded, or retried in isolation.
 *
 * Every worker gets its own backend on its own port, each with its own
 * in-memory MongoDB - see `e2e/ports.js` for why and for how many. That is what
 * makes running in parallel safe: the admin suites mutate globally shared
 * records, but "global" now means "global to one worker's database", so two of
 * them running at once cannot see each other.
 */

const CI = !!process.env.CI;
const WORKERS = workerCount();

/**
 * Suites that mutate records shared across a whole database.
 *
 * These no longer need to be kept away from the others - per-worker databases
 * isolate them by construction - but the split is kept because it is still the
 * useful way to run, shard or retry one area on its own.
 */
const ADMIN_TESTS = [
  /admin-patronage\.spec\.js/,
  /admin-rules\.spec\.js/,
  /admin-referendums\.spec\.js/,
  /access-control\.spec\.js/
];

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.js/,
  globalSetup: require.resolve('./e2e/global-setup.js'),

  timeout: 120000,
  expect: { timeout: 15000 },

  fullyParallel: false,
  forbidOnly: CI,

  // One retry, locally as well as on CI.
  //
  // Running eight workers puts eight browsers, eight Node servers and eight
  // mongods on the box at once, and the tests that lose that race are the ones
  // waiting on a jQuery Mobile popup animation or a Marionette re-render to
  // land inside 20s. Measured: `xp-history` 75 and `lifecycle-werewolf` 355b
  // each failed one run in three and passed in isolation every time.
  //
  // This is not the silent-absorption trap that `navigateToHash`'s fallback
  // tiers were: a test that only passes on the retry is reported as **flaky**
  // in the run summary, so it stays visible and countable instead of looking
  // clean. If a name shows up as flaky repeatedly, that is a real signal and
  // the answer is to fix its wait, not to raise this.
  retries: 1,

  // One worker per backend.
  //
  // `fullyParallel: false` above still serialises the tests *within* a file,
  // which the specs rely on — they build up shared `state` across a file. What
  // runs in parallel is whole spec files, one per worker.
  //
  // This used to be pinned to 1 because every worker shared one server and one
  // database, so two suites touching Descriptions or the game-rule classes at
  // once produced intermittent cross-suite failures. Each worker now gets its
  // own server and its own in-memory database (`e2e/ports.js`), so that no
  // longer applies.
  //
  // Note that `workers` is a top-level option only — setting it inside a
  // `projects[]` entry is silently ignored. If you override it on the command
  // line, set `E2E_WORKERS` to the same number so the matching count of backends
  // is started.
  workers: WORKERS,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],

  use: {
    // Playwright evaluates this config once per worker process, with
    // `TEST_PARALLEL_INDEX` set, so each worker resolves its own backend here
    // and no spec file has to know that more than one exists.
    baseURL: `http://127.0.0.1:${portForThisProcess()}`,
    // Full capture on every test produced gigabytes of artefacts and dominated
    // the run time; keep it for the runs that actually need diagnosis.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
    actionTimeout: 20000,
    navigationTimeout: 30000
  },

  projects: [
    {
      name: 'admin',
      testMatch: ADMIN_TESTS,
      // `workers` is not a project-level option; concurrency is controlled by
      // the top-level `workers` setting above.
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'chromium',
      testIgnore: ADMIN_TESTS,
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  // One backend per worker, each on its own port with its own in-memory
  // MongoDB. Started and torn down by Playwright in the main process only —
  // workers re-evaluate this file but never start servers from it.
  webServer: allPorts().map((port, index) => ({
    command: 'node index.js',
    url: urlForIndex(index),
    reuseExistingServer: !CI,
    timeout: 180000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(port),
      // The thumbnail beforeSave hook in cloud/main.js fetches each uploaded
      // portrait back over HTTP from publicServerURL. The default points at a
      // long-dead Cloud9 host, so every portrait upload fails with an opaque
      // "[object Object]" error until this is pointed at the local server — and
      // it has to be *this* server, not worker 0's, or the fetch crosses
      // databases.
      PUBLIC_SERVER_URL: `${urlForIndex(index)}/parse/1`,

      // Seeding is opt-in (see `seedingAllowed` in seed_db.js). Each backend
      // normally starts its own in-memory MongoDB, which is exempt on its own
      // merits — but if a developer happens to have a mongod listening on
      // 27017, `index.js` uses that instead and the exemption does not apply.
      // Setting this explicitly means the suite seeds either way. Deployed
      // environments must never set it.
      YORICK_ALLOW_SEED: '1'
    }
  }))
});
