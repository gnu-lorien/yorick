/**
 * The front-end layout: which app is served at `/`, where the others are
 * mounted, and what that means for asset URLs.
 *
 * Worth testing without a build because the build is slow and the failures are
 * silent. Getting `base` wrong ships a page whose assets 404 and whose console
 * says nothing useful; getting the default wrong ships the other app entirely.
 * Both are cheap to assert here and expensive to notice in a deploy.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const path = require('node:path');

const {
  FRONTENDS,
  layout,
  defaultFrontend,
  allMountDirs,
  assertNoCollisions,
  redirectStub,
} = require('../build/frontends');

const TWO = [
  { id: 'legacy', label: 'legacy', build: null },
  { id: 'vue', label: 'vue', build: 'vue' },
];

const THREE = [
  { id: 'legacy', label: 'legacy', build: null },
  { id: 'react', label: 'react', build: 'react' },
  { id: 'vue', label: 'vue', build: 'vue' },
];

const byId = (entries, id) => entries.find((f) => f.id === id);

test('the default front end is served from the root of the output', () => {
  const entries = layout({ frontends: TWO, defaultId: 'legacy', outDir: 'dist' });
  const root = defaultFrontend(entries);

  assert.equal(root.id, 'legacy');
  assert.equal(root.dir, 'dist');
  assert.equal(root.base, '/');
});

test('every other front end is mounted under its own id', () => {
  const entries = layout({ frontends: TWO, defaultId: 'legacy', outDir: 'dist' });
  const vue = entries.find((f) => f.id === 'vue');

  assert.equal(vue.isDefault, false);
  // Trailing slash on both ends: Vite writes this straight into asset URLs.
  assert.equal(vue.base, '/vue/');
  assert.ok(vue.dir.endsWith('vue'), 'built inside the output tree, not beside it');
});

test('changing the default moves the apps without touching anything else', () => {
  const entries = layout({ frontends: TWO, defaultId: 'vue', outDir: 'dist' });
  const vue = entries.find((f) => f.id === 'vue');
  const legacy = entries.find((f) => f.id === 'legacy');

  assert.equal(vue.dir, 'dist');
  assert.equal(vue.base, '/');
  assert.equal(legacy.base, '/legacy/');
  assert.ok(legacy.dir.endsWith('legacy'));
});

test('the default front end also answers at its own path', () => {
  // The point of the alias: a link to /vue keeps meaning the Vue app after the
  // default changes, instead of quietly becoming "whichever is default now".
  const entries = layout({ frontends: TWO, defaultId: 'legacy', outDir: 'dist' });

  assert.ok(defaultFrontend(entries).aliasDir.endsWith('legacy'));
  // Only the default needs one; the others are real directories.
  assert.equal(entries.find((f) => f.id === 'vue').aliasDir, null);
});

test('an unknown default is refused, by name', () => {
  assert.throws(
    () => layout({ frontends: TWO, defaultId: 'react', outDir: 'dist' }),
    /react.*not a known front end/s,
  );
});

test('an id that would collide with the root app is refused', () => {
  // `scripts/` is written by the Backbone build, so a front end called
  // `scripts` would be mounted on top of it.
  assert.throws(
    () => layout({
      frontends: [{ id: 'legacy' }, { id: 'scripts' }],
      defaultId: 'legacy',
      outDir: 'dist',
    }),
    /Reserved/,
  );
});

test('an id that is not a usable URL segment is refused', () => {
  assert.throws(
    () => layout({
      frontends: [{ id: 'legacy' }, { id: 'Vue 3' }],
      defaultId: 'legacy',
      outDir: 'dist',
    }),
    /URL path segment/,
  );
});

test('duplicate ids are refused', () => {
  assert.throws(
    () => layout({
      frontends: [{ id: 'vue' }, { id: 'vue' }],
      defaultId: 'vue',
      outDir: 'dist',
    }),
    /duplicate/,
  );
});

test('a mount directory that already exists is a collision, unless we built it', () => {
  const entries = layout({ frontends: TWO, defaultId: 'vue', outDir: 'dist' });
  const fakeFs = { existsSync: () => true };

  // `legacy` is built in place by the gulp pipeline before this check runs, so
  // its directory existing is expected rather than a clash.
  assert.doesNotThrow(() => assertNoCollisions(entries, fakeFs, ['legacy']));

  // Nothing built it, so something else owns that directory.
  assert.throws(() => assertNoCollisions(entries, fakeFs, []), /already/);
});

test('the redirect stub carries the fragment', () => {
  // Every route in both apps is a hash, so a redirect that drops it lands on
  // the front page instead of the character someone was sent a link to.
  const html = redirectStub('/');

  assert.match(html, /location\.replace\("\/" \+ location\.hash\)/);
  // And degrades without script, even though that loses the fragment.
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /<a href="\/">/);
});

// ---------------------------------------------------------------------------
// Narrowing a build, and the real table
// ---------------------------------------------------------------------------
//
// These came from `clients.test.js`, which tested the React port's separate
// copy of this machinery before the two were merged into one table.

test('changing the default pushes the previous root into its own subdirectory', () => {
  const entries = layout({ frontends: THREE, defaultId: 'react', outDir: 'dist' });

  assert.strictEqual(byId(entries, 'react').mount, '/');
  assert.strictEqual(byId(entries, 'react').dir, 'dist');
  // The flip must not leave the Backbone client homeless, and must not leave
  // it at the root either -- two front ends writing into `dist` would
  // interleave two apps in one directory.
  assert.strictEqual(byId(entries, 'legacy').mount, '/legacy/');
  assert.strictEqual(byId(entries, 'legacy').dir, path.join('dist', 'legacy'));
});

test('--frontends narrows the build without moving anything', () => {
  const entries = layout({
    frontends: THREE, defaultId: 'legacy', outDir: 'dist', only: ['react'],
  });

  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].id, 'react');
  // Still under /react/: narrowing says what to build, not where it goes. If
  // it moved the only selected front end to the root, `--frontends=react`
  // would quietly change the layout of a deployment tree it is meant to patch.
  assert.strictEqual(entries[0].mount, '/react/');
  assert.strictEqual(entries[0].isDefault, false);
});

test('a build can be narrowed to the default front end alone', () => {
  const entries = layout({
    frontends: THREE, defaultId: 'legacy', outDir: 'dist', only: ['legacy'],
  });
  assert.deepStrictEqual(entries.map((f) => f.id), ['legacy']);
  assert.strictEqual(entries[0].dir, 'dist');
});

test('the two choices compose: promote a port, then build only another one', () => {
  const entries = layout({
    frontends: THREE, defaultId: 'react', outDir: 'dist', only: ['legacy'],
  });
  assert.deepStrictEqual(entries.map((f) => f.id), ['legacy']);
  assert.strictEqual(entries[0].mount, '/legacy/');
});

test('an unknown name is refused rather than silently building nothing', () => {
  assert.throws(
    () => layout({ frontends: THREE, only: ['svelte'] }),
    /unknown front end/,
  );
});

test('the error names the front ends that do exist, so the typo is obvious', () => {
  try {
    layout({ frontends: THREE, only: ['raect'] });
    assert.fail('expected a throw');
  } catch (error) {
    assert.match(error.message, /legacy/);
    assert.match(error.message, /react/);
    assert.match(error.message, /vue/);
  }
});

test('allMountDirs ignores the narrowing, because clean has to', () => {
  // `clean` spares the mount directories of front ends it is NOT building. If
  // this honoured `only` it would return nothing for `--frontends=vue`, and
  // rebuilding one port would delete the other two.
  assert.deepStrictEqual(
    allMountDirs({ frontends: THREE, defaultId: 'legacy', outDir: 'dist' }),
    ['react', 'vue'],
  );
});

test('a narrowed build without the default has no root and no alias to write', () => {
  const entries = layout({
    frontends: THREE, defaultId: 'legacy', outDir: 'dist', only: ['vue'],
  });
  assert.strictEqual(defaultFrontend(entries), undefined);
  // The collision check has to tolerate that rather than throw on it.
  assert.doesNotThrow(() => assertNoCollisions(entries, { existsSync: () => true }, []));
});

test('only the Backbone client builds without a command; every port names one', () => {
  for (const frontend of FRONTENDS) {
    if (frontend.id === 'legacy') {
      // It has no bundler: gulp's own twelve tasks are its build.
      assert.strictEqual(frontend.build, null);
      continue;
    }
    assert.ok(frontend.build, frontend.id + ' must say how it is built');
  }
});

test('the real table lays all three out without colliding', () => {
  const entries = layout({ outDir: 'dist' });
  const dirs = entries.map((f) => f.dir);
  assert.strictEqual(new Set(dirs).size, dirs.length, 'two front ends share a directory');
  assert.strictEqual(entries.filter((f) => f.isDefault).length, 1);
});

test('the gulp site targets are the site names a port build is handed', () => {
  // `YORICK_SITE=greensboro` must select the same server `siteconfig-greensboro`
  // gives the Backbone client. A name on one side and not the other is a
  // deployment pointed at the wrong database.
  const gulpfile = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'gulpfile.js'), 'utf8');

  for (const site of ['pubstorm', 'patron', 'heroku', 'greensboro']) {
    assert.ok(
      gulpfile.includes(`gulp.task('siteconfig-${site}'`),
      `gulpfile has no siteconfig task for ${site}`);
    assert.ok(
      gulpfile.includes(`gulp.task('${site}', site('${site}'))`),
      `gulpfile has no ${site} target built from the shared series`);
  }
});
