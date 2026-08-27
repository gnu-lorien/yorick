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
 * Which front ends exist, and the port block each one runs in.
 *
 * Both ports arrived at this independently and both chose "+50", which works
 * for two front ends and collides at three. It is a table now, and the offsets
 * are spaced so a run of one client cannot reach another's servers even at
 * eight workers.
 *
 * The offsets are not cosmetic. Playwright reuses a server already listening on
 * the port it wants (`reuseExistingServer`), and the front ends differ ONLY in
 * that server's `PUBLIC_BASE` -- so alternating a legacy run and a port's run on
 * one port block silently tests whichever app happened to still be up. That
 * produced a "legacy regression check" during the React port that was really a
 * second React run: 26 green tests against the wrong app.
 *
 * Separate blocks mean all three can be up at once and each run reuses its own.
 * `global-setup.js` still asserts the served app matches what was asked for,
 * because a wrong answer here has to fail loudly rather than be trusted.
 *
 * | key | | |
 * | --- | --- | --- |
 * | `offset` | added to `E2E_BASE_PORT` | |
 * | `docRoot` | what `PUBLIC_BASE` points express at; `null` means `index.js`'s own default, `public/` | |
 * | `marker` | how `global-setup.js` recognises this app in a served `index.html`. The three are mutually exclusive: the legacy client is the only one loading `scripts/lib/`, and the two ports mount on different element ids. NOT the `/assets/` module script, which both ports emit. |
 * | `sourceDir` | the tree a stale-build check walks; `null` for a client with no build | |
 * | `rebuild` | what to tell someone whose build is stale | |
 */
const FRONTENDS = {
  legacy: {
    offset: 0,
    // Served straight out of `public/`, which is its own source, so it cannot
    // be stale and has nothing to rebuild.
    docRoot: null,
    marker: /src="scripts\/lib\//,
    sourceDir: null,
    rebuild: null,
  },
  react: {
    offset: 50,
    docRoot: ['dist-react'],
    marker: /id="root"/,
    // `web/` is the whole React app -- src, index.html, the Vite config.
    sourceDir: ['web'],
    // `dist` and `dist-react` are what a build writes, not what it is built
    // from, so neither can look like a source edit.
    sourceIgnore: ['node_modules', 'dist', 'dist-react'],
    extraSourceFiles: [],
    rebuild: 'node e2e/run-react.js (it builds first), or npm run build:react',
  },
  vue: {
    offset: 100,
    docRoot: ['client', 'dist'],
    // `id="app"`, not `id="splashscreen"`: the Vue port copied the splash
    // markup from the legacy client, so that one matches both.
    marker: /id="app"/,
    sourceDir: ['client'],
    // `dist` is the build OUTPUT and lives inside the source tree, so counting
    // it would make every run look stale by definition.
    sourceIgnore: ['node_modules', 'dist'],
    // The Vue build config lives at the REPO ROOT -- vite is invoked with
    // `root: client` -- so a walk of `client/` alone would miss an edit to
    // either, and both change what the bundle contains.
    extraSourceFiles: ['vite.config.ts', 'tsconfig.json'],
    rebuild: 'npm run build:vue',
  },
};

/**
 * Which front end this run is about. `YORICK_E2E_CLIENT`, defaulting to legacy.
 *
 * The React port shipped this as `E2E_FRONTEND` and the Vue port as
 * `YORICK_E2E_CLIENT`. One name now; an unknown value is an error rather than a
 * silent fall back to legacy, because "I typed reactt and got a clean legacy
 * run" is exactly the failure this whole file exists to prevent.
 */
function currentFrontend() {
  const name = process.env.YORICK_E2E_CLIENT || 'legacy';
  if (!FRONTENDS[name]) {
    throw new Error(
      `[e2e] YORICK_E2E_CLIENT is "${name}", which is not a known front end. ` +
      `Known: ${Object.keys(FRONTENDS).join(', ')}.`
    );
  }
  return name;
}

const FRONTEND = currentFrontend();

const BASE_PORT =
  Number(process.env.E2E_BASE_PORT || 1337) + FRONTENDS[FRONTEND].offset;

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
  FRONTENDS,
  FRONTEND,
  currentFrontend,
  workerCount,
  portForIndex,
  allPorts,
  urlForIndex,
  portForThisProcess
};
