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

const {
  layout,
  defaultFrontend,
  assertNoCollisions,
  redirectStub,
} = require('../build/frontends');

const TWO = [
  { id: 'legacy', label: 'legacy', build: null },
  { id: 'vue', label: 'vue', build: 'vue' },
];

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
