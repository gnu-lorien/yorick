/**
 * Port allocation for the per-worker backends.
 *
 * The suite used to run on a single worker against a single server, because
 * several spec files mutate globally shared records (Descriptions, the five
 * game-rule classes, patronages, referendums) and two of them running at once
 * against one database produced intermittent cross-suite failures. Serialising
 * everything was the cheap fix, and it cost about 26 minutes a run.
 *
 * Giving every worker its own server removes the reason for that instead of
 * working around it. `index.js` starts an in-memory MongoDB when no local
 * mongod is listening on 27017, so each backend already gets a private,
 * fully-seeded database - measured at ~1.5s to boot and seed. Worker N talks to
 * port `BASE_PORT + N` and cannot see worker M's data at all, so the admin
 * suites are isolated by construction rather than by running last.
 *
 * Both `playwright.config.js` and `global-setup.js` derive their ports here so
 * the two cannot drift apart.
 */

const os = require('os');

/**
 * The Vue run gets its own port block, 50 above the legacy one.
 *
 * Not cosmetic. Playwright reuses an already-running server on the port it
 * wants (`reuseExistingServer`), and the two front ends differ ONLY in that
 * server's `PUBLIC_BASE` -- so alternating a legacy run and a Vue run on one
 * port silently tests whichever app happened to still be up. A "legacy
 * regression check" that is really a second Vue run looks entirely clean.
 *
 * Separate blocks mean both can be up at once and each run reuses its own.
 * `global-setup.js` still asserts the served app matches what was asked for,
 * because a wrong answer here has to fail loudly rather than be trusted.
 */
const VUE_PORT_OFFSET = 50;

const BASE_PORT =
  Number(process.env.E2E_BASE_PORT || 1337) +
  (process.env.YORICK_E2E_CLIENT === 'vue' ? VUE_PORT_OFFSET : 0);

/**
 * How many workers - and therefore how many backends - to run.
 *
 * Parallelism here is at *file* granularity: `fullyParallel: false` keeps the
 * tests inside one spec file serial, because they share `state` built up across
 * the file. There are ~21 spec files, so workers beyond that buy nothing, and
 * the floor for a whole run is the slowest single file rather than zero.
 *
 * The default leaves plenty of headroom: each worker costs a Node server, an
 * in-memory mongod and a browser. Override with `E2E_WORKERS`, or Playwright's
 * own `--workers=N` (in which case set `E2E_WORKERS` to match so the right
 * number of servers is started).
 */
function workerCount() {
  if (process.env.E2E_WORKERS) {
    return Math.max(1, parseInt(process.env.E2E_WORKERS, 10) || 1);
  }
  const cpus = (os.cpus() || []).length || 4;
  return Math.max(1, Math.min(8, Math.floor(cpus / 4)));
}

/** The port worker `index` (Playwright's `TEST_PARALLEL_INDEX`) talks to. */
function portForIndex(index) {
  return BASE_PORT + Number(index || 0);
}

/** Every port a run will start a backend on. */
function allPorts() {
  return Array.from({ length: workerCount() }, (_, i) => portForIndex(i));
}

/** The base URL for one worker index. */
function urlForIndex(index) {
  return `http://127.0.0.1:${portForIndex(index)}`;
}

/**
 * The port for the *current* process.
 *
 * Playwright evaluates the config file once in the main process (where
 * `TEST_PARALLEL_INDEX` is unset, so this is `BASE_PORT`) and again inside each
 * worker process, where it is set. That is what lets `use.baseURL` differ per
 * worker without any spec file having to know about it.
 */
function portForThisProcess() {
  return portForIndex(process.env.TEST_PARALLEL_INDEX);
}

module.exports = {
  BASE_PORT,
  VUE_PORT_OFFSET,
  workerCount,
  portForIndex,
  allPorts,
  urlForIndex,
  portForThisProcess
};
