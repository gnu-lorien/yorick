const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright E2E configuration for Yorick.
 *
 * Projects are split along the task boundaries in testing_implementation_plan.md
 * so a single area can be run, sharded, or retried in isolation. The admin
 * projects mutate globally shared records (Descriptions, game rules, patronages,
 * referendums), so they are kept serial and separated from the rest; everything
 * else operates on characters and troupes it created itself and can run in
 * parallel.
 */

const CI = !!process.env.CI;

/** Suites that mutate global state and must not run concurrently with each other. */
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
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 4,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],

  use: {
    baseURL: 'http://127.0.0.1:1337',
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
      workers: 1,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'chromium',
      testIgnore: ADMIN_TESTS,
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  webServer: {
    command: 'node index.js',
    url: 'http://127.0.0.1:1337',
    reuseExistingServer: !CI,
    timeout: 180000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // The thumbnail beforeSave hook in cloud/main.js fetches each uploaded
      // portrait back over HTTP from publicServerURL. The default points at a
      // long-dead Cloud9 host, so every portrait upload fails with an opaque
      // "[object Object]" error until this is pointed at the local server.
      PUBLIC_SERVER_URL: 'http://127.0.0.1:1337/parse/1'
    }
  }
});
