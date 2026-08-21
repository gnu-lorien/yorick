/**
 * The deploy's database wiring, held to its contract.
 *
 * `getDatabaseURI()` in index.js decides which database the whole application
 * serves, and its dangerous failure is not an exception -- it is a success. Ask
 * it for a database on a host that has none configured and it will start an
 * in-memory MongoDB, report `ephemeral: true`, and seed_db.js will read that as
 * permission to seed: the server comes up listening, the health check passes,
 * and it serves an empty database holding only the published test accounts
 * while every real record is absent. Nothing in a log says so.
 *
 * Two behaviours stand between the deploy and that outcome, and both are here:
 *
 *   - the deployed config var name (DB_URI) is read as well as the one this
 *     tree uses everywhere else (MONGODB_URI), so a forgotten rename does not
 *     silently take the fallback path;
 *   - a deployed environment with neither set is refused outright rather than
 *     falling back.
 *
 * DELIBERATELY NOT TESTED: the case with all four variables unset. That is the
 * local-development path, and on a machine with no mongod on 27017 it downloads
 * and starts a real mongod binary -- which would make this suite slow and
 * network-dependent for no added coverage. Every case below sets at least one
 * of the four, so none of them reaches the probe.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { getDatabaseURI, resolvePublicServerURL } = require('../index');

/**
 * Every variable getDatabaseURI() reads before the probe.
 *
 * All of them are cleared before each case, not just the ones a case sets: a
 * developer whose shell already exports MONGODB_URI would otherwise turn "DB_URI
 * alone is honoured" into a test that passes without testing anything, and a CI
 * box with NODE_ENV=production would turn the fallback cases inside out.
 */
const TOUCHED = ['MONGODB_URI', 'DB_URI', 'NODE_ENV', 'DYNO', 'PUBLIC_SERVER_URL'];

/**
 * Run `fn` with exactly `vars` set among TOUCHED, then put process.env back.
 *
 * `node --test` gives each FILE its own process, so a leak here cannot reach
 * the other suites -- but it can still cross-contaminate the cases below, and
 * the ambient shell is the other way in: TOUCHED is cleared rather than merely
 * saved so a developer who already exports MONGODB_URI cannot turn "DB_URI
 * alone is honoured" into a case that passes without testing anything. The
 * restore runs from `finally` so a failed assertion still hands the
 * environment back intact.
 */
async function withEnv(vars, fn) {
  const saved = {};
  TOUCHED.forEach(function (name) {
    saved[name] = process.env[name];
    delete process.env[name];
  });
  Object.keys(vars).forEach(function (name) {
    process.env[name] = vars[name];
  });
  try {
    return await fn();
  } finally {
    TOUCHED.forEach(function (name) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    });
  }
}

test('MONGODB_URI wins when both names are set', async () => {
  // The migration path is "add MONGODB_URI to a dyno that still has DB_URI",
  // and it has to be a single step: if the two disagreed in favour of the old
  // name, adding the new one would appear to do nothing.
  const result = await withEnv(
    { MONGODB_URI: 'mongodb://new/preferred', DB_URI: 'mongodb://old/legacy' },
    getDatabaseURI
  );
  assert.strictEqual(result.uri, 'mongodb://new/preferred');
  assert.strictEqual(result.ephemeral, false);
});

test('DB_URI alone is honoured, and is not ephemeral', async () => {
  // This is the live dyno as it stands today. `ephemeral` must be false: it is
  // what seed_db.js consults, and a true here would seed the production
  // database with the test accounts on the next boot.
  const result = await withEnv({ DB_URI: 'mongodb://legacy/anotherstore' }, getDatabaseURI);
  assert.strictEqual(result.uri, 'mongodb://legacy/anotherstore');
  assert.strictEqual(result.ephemeral, false);
});

test('an explicit URI is enough on a deployed host -- the refusal is only about the fallback', async () => {
  const result = await withEnv(
    { DB_URI: 'mongodb://legacy/anotherstore', NODE_ENV: 'production', DYNO: 'web.1' },
    getDatabaseURI
  );
  assert.strictEqual(result.uri, 'mongodb://legacy/anotherstore');
  assert.strictEqual(result.ephemeral, false);
});

test('NODE_ENV=production with no URI configured is refused, not fallen back on', async () => {
  await assert.rejects(
    () => withEnv({ NODE_ENV: 'production' }, getDatabaseURI),
    /No database configured/
  );
});

test('DYNO with no URI configured is refused, even with NODE_ENV unset', async () => {
  // NODE_ENV is an ordinary config var and can be unset by hand; DYNO is set by
  // the platform. Either one alone has to be enough, or the guard is only as
  // reliable as the weaker signal.
  await assert.rejects(
    () => withEnv({ DYNO: 'web.1' }, getDatabaseURI),
    /No database configured/
  );
});

test('the refusal names both variables, so the fix is in the message', async () => {
  // Whoever reads this is looking at a dyno that will not boot, and the two
  // names are the entire remedy. Losing either from the message turns a
  // one-minute fix into an archaeology session in index.js.
  await assert.rejects(
    () => withEnv({ NODE_ENV: 'production' }, getDatabaseURI),
    function (err) {
      assert.ok(err instanceof Error);
      assert.match(err.message, /MONGODB_URI/);
      // Anchored on a word boundary on purpose: "DB_URI" is a substring of
      // "MONGODB_URI", so a bare /DB_URI/ would pass on a message that had
      // dropped the legacy name entirely.
      assert.match(err.message, /\bDB_URI\b/);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// publicServerURL
//
// Same shape of hazard as the database URI above, and the same two-signal
// guard, which is why it lives in this file. parse-server bakes this origin
// into password-reset links and every Parse.File URL, and cloud/main.js fetches
// each uploaded portrait back over HTTP from it -- so a wrong value does not
// degrade, it REFUSES every portrait save and orphans a GridFS blob each time.
//
// The old default was a Cloud9 host that stopped existing years ago, which made
// that failure the out-of-the-box behaviour for anyone running this locally.
// ---------------------------------------------------------------------------

test('an explicit PUBLIC_SERVER_URL is used verbatim', async () => {
  await withEnv({ PUBLIC_SERVER_URL: 'https://example.test/parse/1' }, () => {
    assert.strictEqual(
      resolvePublicServerURL(1337, '/parse/1'),
      'https://example.test/parse/1');
  });
});

test('locally it points at this process, not at a dead host', async () => {
  // The value has to be reachable, because the server dials it itself.
  await withEnv({}, () => {
    assert.strictEqual(
      resolvePublicServerURL(1337, '/parse/1'),
      'http://127.0.0.1:1337/parse/1');
  });
});

test('the local default follows the mount path rather than duplicating it', async () => {
  // Two places must not be able to disagree about where the API is mounted.
  await withEnv({}, () => {
    assert.match(resolvePublicServerURL(9999, '/parse'), /:9999\/parse$/);
  });
});

test('a deployed host with nothing set is refused, not guessed', async () => {
  for (const deployed of [{ NODE_ENV: 'production' }, { DYNO: 'web.1' }]) {
    await withEnv(deployed, () => {
      assert.throws(() => resolvePublicServerURL(1337, '/parse/1'), /PUBLIC_SERVER_URL/);
    });
  }
});

test('a deployed host WITH the value set is fine', async () => {
  // The refusal is about the fallback, never about the explicit value.
  await withEnv({ DYNO: 'web.1', PUBLIC_SERVER_URL: 'https://live.test/parse/1' }, () => {
    assert.strictEqual(
      resolvePublicServerURL(1337, '/parse/1'),
      'https://live.test/parse/1');
  });
});

test('no code path can reach the dead Cloud9 host', async () => {
  // The literal is gone; this fails loudly if anyone reinstates it as a default.
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
  assert.ok(!source.includes('c9users.io'),
    'index.js still references the dead Cloud9 host');
});
