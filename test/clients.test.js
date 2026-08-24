/**
 * The client manifest that decides what a deployment contains.
 *
 * `clients.js` is what `gulpfile.js` reads to place the legacy app and each
 * port inside one `dist/`. Everything it does is pure — a list in, a list out —
 * and the failures it can produce are silent ones: a client built into the
 * wrong directory, two clients claiming the root, or a typo'd `--clients=`
 * quietly building nothing at all. That is exactly what a unit test is for,
 * and the alternative is finding out from a deployment.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { CLIENTS, SITES, DIST, resolveClients, mountToSubdirectory } = require('../clients');

const byName = (clients, name) => clients.find((c) => c.name === name);

test('the default layout puts the legacy client at the root and each port beneath it', () => {
  const clients = resolveClients();

  assert.strictEqual(byName(clients, 'legacy').mount, '/');
  assert.strictEqual(byName(clients, 'legacy').outDir, DIST);
  assert.strictEqual(byName(clients, 'react').mount, '/react/');
  assert.strictEqual(byName(clients, 'react').outDir, path.join(DIST, 'react'));
});

test('exactly one client is at the root, and it owns dist itself', () => {
  const roots = resolveClients().filter((c) => c.mount === '/');
  assert.strictEqual(roots.length, 1);
  assert.strictEqual(roots[0].outDir, DIST);
});

test('--root promotes a port and pushes the previous root into its own subdirectory', () => {
  const clients = resolveClients({ root: 'react' });

  assert.strictEqual(byName(clients, 'react').mount, '/');
  assert.strictEqual(byName(clients, 'react').outDir, DIST);
  // The flip must not leave the legacy client homeless, and must not leave it
  // at the root either -- both clients writing into `dist` would interleave
  // two apps in one directory.
  assert.strictEqual(byName(clients, 'legacy').mount, '/legacy/');
  assert.strictEqual(byName(clients, 'legacy').outDir, path.join(DIST, 'legacy'));
});

test('--clients narrows the build without moving anything', () => {
  const clients = resolveClients({ only: ['react'] });

  assert.strictEqual(clients.length, 1);
  assert.strictEqual(clients[0].name, 'react');
  // Still under /react/: narrowing says what to build, not where it goes.
  assert.strictEqual(clients[0].mount, '/react/');
});

test('a build can be narrowed to the root client alone', () => {
  const clients = resolveClients({ only: ['legacy'] });
  assert.deepStrictEqual(clients.map((c) => c.name), ['legacy']);
  assert.strictEqual(clients[0].outDir, DIST);
});

test('the two flags compose: promote a port, then build only the other one', () => {
  const clients = resolveClients({ root: 'react', only: ['legacy'] });
  assert.deepStrictEqual(clients.map((c) => c.name), ['legacy']);
  assert.strictEqual(clients[0].mount, '/legacy/');
});

test('an unknown client name is refused rather than silently building nothing', () => {
  assert.throws(() => resolveClients({ only: ['vue'] }), /Unknown client/);
  assert.throws(() => resolveClients({ root: 'svelte' }), /Unknown client/);
});

test('the error names the clients that do exist, so the typo is obvious', () => {
  try {
    resolveClients({ only: ['raect'] });
    assert.fail('expected a throw');
  } catch (error) {
    assert.match(error.message, /legacy/);
    assert.match(error.message, /react/);
  }
});

test('every client has a mount that starts and ends with a slash', () => {
  for (const client of CLIENTS) {
    assert.match(client.mount, /^\//, client.name + ' must be mounted at an absolute path');
    assert.match(client.mount, /\/$/, client.name + ' must have a trailing slash');
  }
});

test('mountToSubdirectory turns a mount into a directory name', () => {
  assert.strictEqual(mountToSubdirectory('/'), '');
  assert.strictEqual(mountToSubdirectory('/react/'), 'react');
  assert.strictEqual(mountToSubdirectory('/react'), 'react');
});

test('only the root client builds without a command; every port names one', () => {
  for (const client of CLIENTS) {
    if (client.mount === '/' && client.name === 'legacy') {
      // The legacy app has no bundler: gulp's own twelve tasks are its build.
      assert.strictEqual(client.command, null);
      continue;
    }
    assert.ok(client.command, client.name + ' must say how it is built');
  }
});

test('the site names match the gulp targets', () => {
  // These are the contract with a port's build: YORICK_SITE=greensboro must
  // select the same server that `siteconfig-greensboro` gives the legacy
  // client. A name added to one side and not the other is a deployment
  // pointed at the wrong database.
  assert.deepStrictEqual(SITES, ['pubstorm', 'patron', 'heroku', 'greensboro']);

  const gulpfile = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'gulpfile.js'), 'utf8');
  for (const site of SITES) {
    assert.ok(gulpfile.includes("gulp.task('siteconfig-" + site + "'"),
      'gulpfile has no siteconfig task for ' + site);
    assert.ok(gulpfile.includes("gulp.task('" + site + "'"),
      'gulpfile has no target named ' + site);
  }
});
