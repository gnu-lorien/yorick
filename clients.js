/**
 * The clients this repository can deploy, and where each one is mounted.
 *
 * There is more than one front end now. The legacy Backbone app and every port
 * of it are the same application against the same server, so they can be
 * deployed together and compared side by side rather than swapped one for the
 * other. This file is the only place that says which clients exist and where
 * each one lives; `gulpfile.js` reads it, and nothing else hard-codes a path.
 *
 * Adding a port is one entry:
 *
 *   { name: 'vue', mount: '/vue/', command: 'npm run build:vue' }
 *
 * ...plus that build honouring the three environment variables below. There is
 * no list of known clients anywhere else to update, and no task to add.
 *
 * ## What a port's build command is given
 *
 * | | |
 * | --- | --- |
 * | `YORICK_BASE` | the mount, e.g. `/react/`. Asset URLs must be built against it, or a client under a subdirectory asks for its bundle at the root and gets the legacy app's index.html back. |
 * | `YORICK_OUT_DIR` | absolute path to write into. Already emptied by `gulp clean`, and the build must NOT empty it itself: a client at the root is handed `dist`, and emptying that deletes every other client. |
 * | `YORICK_SITE` | which Parse server this build talks to: one of the site names below. The legacy client resolves the same choice through gulp-replace on `siteconfig.js`. |
 *
 * A build that ignores them still produces files; it produces files that only
 * work at the root and only against the development server. Honour all three.
 *
 * ## Which client is at the root
 *
 * `mount: '/'` marks it, and exactly one client may claim it. It is a value
 * here rather than an assumption anywhere else, so the eventual flip -- a port
 * at the root, the legacy app underneath -- is `--root=react` on the command
 * line, or a two-character edit here. Nothing else moves.
 */

const path = require('node:path');

/** Where the built site is assembled. Netlify serves this directory. */
const DIST = 'dist';

/**
 * The Parse servers a build can be pointed at, by name.
 *
 * These are the four `gulp` targets that have always existed. The names are
 * the contract with a port's build: `YORICK_SITE=greensboro` must select the
 * same server that `siteconfig-greensboro` selects for the legacy client.
 */
const SITES = ['pubstorm', 'patron', 'heroku', 'greensboro'];

const CLIENTS = [
  {
    name: 'legacy',
    mount: '/',
    // Built by the gulp pipeline in this repository rather than by a command
    // of its own: it has no bundler, and its twelve tasks ARE the build.
    command: null,
  },
  {
    name: 'react',
    mount: '/react/',
    command: 'npx vite build --config web/vite.config.ts',
  },
];

/** `/react/` -> `react`; `/` -> `''`. */
function mountToSubdirectory(mount) {
  return mount.replace(/^\/+|\/+$/g, '');
}

/**
 * Resolve the manifest for one build.
 *
 * `only` narrows the set (`--clients=legacy,react`); `root` moves a client to
 * the root and pushes whoever was there down to `/<their name>/`.
 */
function resolveClients({ only, root } = {}) {
  let clients = CLIENTS.map((client) => ({ ...client }));

  if (root) {
    const promoted = clients.find((c) => c.name === root);
    if (!promoted) {
      throw new Error(
        `Unknown client "${root}" for --root. Known clients: ${CLIENTS.map((c) => c.name).join(', ')}.`,
      );
    }
    for (const client of clients) {
      if (client.mount === '/') client.mount = `/${client.name}/`;
    }
    promoted.mount = '/';
  }

  if (only && only.length) {
    const unknown = only.filter((name) => !clients.some((c) => c.name === name));
    if (unknown.length) {
      throw new Error(
        `Unknown client(s) ${unknown.join(', ')}. Known clients: ${CLIENTS.map((c) => c.name).join(', ')}.`,
      );
    }
    clients = clients.filter((c) => only.includes(c.name));
  }

  const roots = clients.filter((c) => c.mount === '/');
  if (roots.length > 1) {
    throw new Error(
      `More than one client is mounted at the root: ${roots.map((c) => c.name).join(', ')}.`,
    );
  }

  return clients.map((client) => ({
    ...client,
    subdirectory: mountToSubdirectory(client.mount),
    // Where this client's files go. The root client writes into `dist` itself.
    outDir: path.join(DIST, mountToSubdirectory(client.mount)),
  }));
}

module.exports = { CLIENTS, SITES, DIST, resolveClients, mountToSubdirectory };
