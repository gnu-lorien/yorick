var fs = require('fs');
var path = require('path');
var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectId;
var bcrypt = require('bcryptjs');
var seedExtra = require('./seed_extra');

function parseEJSON(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object') {
    if (val.$date) {
      return new Date(val.$date);
    }
    if (val.$oid) {
      try {
        return new ObjectID(val.$oid);
      } catch (e) {
        return val.$oid;
      }
    }
    if (Array.isArray(val)) {
      return val.map(parseEJSON);
    }
    var res = {};
    for (var k in val) {
      res[k] = parseEJSON(val[k]);
    }
    return res;
  }
  return val;
}

/**
 * Test accounts the E2E suite depends on.
 *
 * `sampstranger` shares no troupe with any test character and exists purely so
 * the access-control specs have a genuine outsider to assert against; the other
 * three all end up inside some troupe or role.
 *
 * `sampprivate` is different in kind and is the ONLY oracle the
 * `enforcePrivateUsers` work has. See `private` below.
 */
var TEST_USERS = [
  { id: 'm91umkbuQq',       username: 'devuser',      password: 'thedumbness', admin: true,  storyteller: true },
  { id: 'user_sampmem',     username: 'sampmem',      password: 'sampmem',     admin: false, storyteller: false },
  { id: 'user_sampast',     username: 'sampast',      password: 'sampast',     admin: false, storyteller: true },
  { id: 'user_sampstranger', username: 'sampstranger', password: 'sampstranger', admin: false, storyteller: false },
  // The account that is NOT publicly readable, standing in for everyone who
  // signs up from now on.
  //
  // parse-server 9 defaults `enforcePrivateUsers` true, so a real signup gets
  // no public read -- but nothing in either suite can observe that, because no
  // spec completes a signup and because the four rows above are written
  // straight into Mongo with `_rperm: ['*', id]`, bypassing the layer where the
  // option is read. Every seeded account is therefore publicly readable no
  // matter which way the option is set, and a green run proves nothing about
  // it. This entry fabricates the same end state by writing the restrictive
  // ACL directly, which is why it reproduces the whole failure class WITH THE
  // OPTION OFF and on any parse-server version.
  //
  // It carries `realname` and `email` because the other four carry neither, so
  // without them no spec could tell "the field was withheld" from "the field
  // was never set".
  {
    id: 'user_sampprivate', username: 'sampprivate', password: 'sampprivate',
    admin: false, storyteller: false,
    private: true,
    realname: 'Pat Privatelli',
    email: 'sampprivate@example.invalid'
  }
];

/** The troupe every fixture below hangs off. Created in the cold-start block. */
var SAMPLE_TROUPE_ID = 'WOad4CBTsG';

/**
 * The character owned by `sampprivate`, and what it is for.
 *
 * `mobileRouter.js`'s `get_troupe_characters` calls `q.include("owner")` and
 * then drops any row where `!character.has("owner")`. Under a private owner,
 * parse-server does not hand back an unfetched pointer -- `replacePointers`
 * removes the key outright -- so the row is SILENTLY ABSENT from the roster
 * rather than merely missing a name. This character is the thing that
 * disappears, and its reappearance is how the fix is proved.
 */
var PRIVATE_FIXTURE_CHARACTER_ID = 'char_sampprivate';

/**
 * Upsert the test accounts. Kept separate from the bulk import and run on every
 * boot, because the bulk import is skipped once the database has any users at
 * all — which previously meant a new test account could never be added to an
 * existing database.
 */
async function seedTestUsers(db) {
  for (var i = 0; i < TEST_USERS.length; i++) {
    var u = TEST_USERS[i];
    var hashed = await bcrypt.hash(u.password, 10);
    // `private` accounts get NO '*' entry, in either _rperm or _acl -- which is
    // exactly the shape RestWrite produces for a signup under
    // `enforcePrivateUsers`. Everyone else keeps public read, so the four
    // original accounts behave exactly as they always have and no existing
    // spec changes meaning.
    var rperm = u.private ? [u.id] : ['*', u.id];
    var acl = {};
    acl[u.id] = { w: true, r: true };
    if (!u.private) {
      acl['*'] = { r: true };
    }
    var fields = {
      username: u.username,
      _hashed_password: hashed,
      _wperm: [u.id],
      _rperm: rperm,
      _acl: acl,
      _updated_at: new Date(),
      admininterface: u.admin,
      storytellerinterface: u.storyteller
    };
    // Only set when present, so the four accounts that have never carried these
    // fields keep not carrying them.
    if (u.realname) { fields.realname = u.realname; }
    if (u.email) { fields.email = u.email; }
    await db.collection('_User').updateOne(
      { username: u.username },
      {
        $set: fields,
        $setOnInsert: {
          _id: u.id,
          _created_at: new Date()
        }
      },
      { upsert: true }
    );
  }
}

/**
 * One character owned by the private account, inside the sample troupe.
 *
 * Runs on every boot rather than only on a cold database, for the same reason
 * `seedTestUsers` does: a fixture that only reaches new databases is a fixture
 * nobody's existing working copy ever gets.
 *
 * The ACL mirrors what `Character.get_me_acl` would have produced -- owner and
 * Administrator read/write, plus the troupe's LST and AST roles, and no public
 * access. Writing it by hand matters: `get_me_acl` is itself one of the things
 * the private owner breaks, so deriving the fixture's ACL from it would make
 * the fixture agree with the bug.
 */
async function seedPrivateFixtureCharacter(db) {
  var ownerId = 'user_sampprivate';
  var readers = [
    ownerId,
    'role:Administrator',
    'role:LST_' + SAMPLE_TROUPE_ID,
    'role:AST_' + SAMPLE_TROUPE_ID
  ];
  var acl = {};
  readers.forEach(function (who) { acl[who] = { r: true, w: true }; });

  await db.collection('Vampire').updateOne(
    { _id: PRIVATE_FIXTURE_CHARACTER_ID },
    {
      $set: {
        name: 'Private Owner Test Character',
        player_name: 'Pat Privatelli',
        type: 'Vampire',
        // Parse stores a pointer as `_p_<field>` = "<className>$<objectId>".
        _p_owner: '_User$' + ownerId,
        _rperm: readers,
        _wperm: readers,
        _acl: acl,
        _updated_at: new Date()
      },
      $setOnInsert: {
        _id: PRIVATE_FIXTURE_CHARACTER_ID,
        _created_at: new Date()
      }
    },
    { upsert: true }
  );

  // `troupes` is a relation, so membership lives in a join collection rather
  // than on the row. Without this the character exists but is in no troupe,
  // and the roster query it is meant to appear in never selects it.
  await db.collection('_Join:troupes:Vampire').updateOne(
    { owningId: PRIVATE_FIXTURE_CHARACTER_ID, relatedId: SAMPLE_TROUPE_ID },
    { $set: { owningId: PRIVATE_FIXTURE_CHARACTER_ID, relatedId: SAMPLE_TROUPE_ID } },
    { upsert: true }
  );
}

/**
 * Assert the accounts the E2E suite requires are present and usable. Called by
 * the Playwright global setup so a misseeded database fails loudly and early
 * rather than as a wall of confusing per-test auth failures.
 */
async function verifyTestUsers(databaseURI) {
  var client = await MongoClient.connect(databaseURI);
  var missing = [];
  try {
    var db = client.db();
    for (var i = 0; i < TEST_USERS.length; i++) {
      var found = await db.collection('_User').findOne({ username: TEST_USERS[i].username });
      if (!found) missing.push(TEST_USERS[i].username);
    }
  } finally {
    await client.close();
  }
  if (missing.length > 0) {
    throw new Error('Missing required test users: ' + missing.join(', ') +
      '. Reseed the database (npm run seed) before running the E2E suite.');
  }
  return TEST_USERS.map(function (u) { return u.username; });
}

/**
 * Strip credentials from a Mongo URI so the skip message can name the target
 * without printing a password into a log or a CI transcript.
 */
function redactUri(uri) {
  if (typeof uri !== 'string') return String(uri);
  return uri.replace(/\/\/[^@/]*@/, '//<credentials>@');
}

/**
 * Whether this process is allowed to write seed data.
 *
 * Seeding is opt-in because `seedTestUsers` runs on EVERY boot, not only on a
 * cold database (see the comment above its call site). That is deliberate — it
 * is how a newly added test account reaches a database seeded before it
 * existed — but it means `seedDatabase` will happily upsert `devuser`, whose
 * password is in this public repository and whose `admininterface` is true,
 * into whatever `databaseURI` names. Against the production URI that plants a
 * known-password administrator, and because the upsert matches on `username`
 * alone it would overwrite the password hash and ACL of any real player who
 * happens to hold that name.
 *
 * Nothing in the connection string reliably distinguishes "a test database
 * that was seeded last week" from "production", so the decision is made
 * explicitly instead of inferred:
 *
 *   YORICK_ALLOW_SEED=1            environments that want seeding (CI)
 *   seedDatabase(uri, {force})     the explicit `npm run seed` command
 *   seedDatabase(uri, {ephemeral}) an in-memory instance the caller just made
 *
 * The `ephemeral` pass is deliberately narrow. It is NOT "the URI looks like
 * localhost" -- a localhost URI can name a real database someone cares about.
 * It means the calling process created a MongoMemoryServer moments ago: empty,
 * bound to a random port, unreachable from another machine, and discarded at
 * exit. There is no database there to damage, so requiring a flag would be
 * ceremony that only trains people to set the flag everywhere.
 *
 * Refusing is not an error. `index.js` still starts; it just starts without
 * writing test accounts into a database that never asked for them.
 */
function seedingAllowed(options) {
  if (options && options.force === true) return true;
  if (options && options.ephemeral === true) return true;
  return process.env.YORICK_ALLOW_SEED === '1';
}

async function seedDatabase(databaseURI, options) {
  if (!seedingAllowed(options)) {
    console.log(
      '[seed] Skipped. Seeding writes test accounts (including an admin whose\n' +
      '[seed] password is public in this repo) and would target:\n' +
      '[seed]   ' + redactUri(databaseURI) + '\n' +
      '[seed] Set YORICK_ALLOW_SEED=1 to allow it, or run `npm run seed`\n' +
      '[seed] to seed explicitly. Never enable this against production.'
    );
    return { seeded: false, reason: 'not-allowed' };
  }

  var client = await MongoClient.connect(databaseURI);
  var db = client.db();

  try {
    var userCount = await db.collection('_User').find({}).toArray().then(function(docs) { return docs.length; });

    if (userCount === 0) {
      console.log('Seeding database from database_seed directory...');
      var seedDir = path.join(__dirname, 'database_seed');
      var files = fs.readdirSync(seedDir);

      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file.endsWith('.json')) continue;

        var colName = file.replace(/\.json$/, '');
        // Handle join filenames like "_Join changes ExperienceNotation.json" -> "_Join:changes:ExperienceNotation"
        if (colName.startsWith('_Join ')) {
          var parts = colName.split(' ');
          colName = parts[0] + ':' + parts[1] + ':' + parts[2];
        }

        var filePath = path.join(seedDir, file);
        var content = fs.readFileSync(filePath, 'utf8').trim();
        if (!content) continue;

        var lines = content.split('\n');
        var docs = [];
        for (var j = 0; j < lines.length; j++) {
          var line = lines[j].trim();
          if (!line) continue;
          try {
            var rawDoc = JSON.parse(line);
            var parsedDoc = parseEJSON(rawDoc);
            docs.push(parsedDoc);
          } catch (err) {
            console.warn('Could not parse line in ' + file + ':', err.message);
          }
        }

        if (docs.length > 0) {
          try {
            await db.collection(colName).insertMany(docs);
          } catch (e) {
            // If already exists or error, continue
          }
        }
      }

      // Ensure test sample troupe exists
      await db.collection('Troupe').updateOne(
        { _id: 'WOad4CBTsG' },
        {
          $set: {
            name: 'Sample Troupe',
            _rperm: ['*'],
            _wperm: ['role:Administrator'],
            _acl: { '*': { r: true }, 'role:Administrator': { r: true, w: true } },
            _updated_at: new Date()
          },
          $setOnInsert: {
            _id: 'WOad4CBTsG',
            _created_at: new Date()
          }
        },
        { upsert: true }
      );

      // Ensure Administrator and SiteAdministrator roles exist
      var adminRoles = ['Administrator', 'SiteAdministrator'];
      for (var a = 0; a < adminRoles.length; a++) {
        var aRoleName = adminRoles[a];
        var aRoleId = 'role_' + aRoleName;
        await db.collection('_Role').updateOne(
          { name: aRoleName },
          {
            $set: {
              name: aRoleName,
              _rperm: ['*'],
              _wperm: ['role:Administrator'],
              _acl: { '*': { r: true }, 'role:Administrator': { r: true, w: true } },
              _updated_at: new Date()
            },
            $setOnInsert: {
              _id: aRoleId,
              _created_at: new Date()
            }
          },
          { upsert: true }
        );
      }

      // Add devuser to Administrator role using actual role _id
      var adminRole = await db.collection('_Role').findOne({ name: 'Administrator' });
      if (adminRole) {
        await db.collection('_Join:users:_Role').updateOne(
          { owningId: adminRole._id, relatedId: 'm91umkbuQq' },
          {
            $set: {
              owningId: adminRole._id,
              relatedId: 'm91umkbuQq'
            }
          },
          { upsert: true }
        );
      }

      // Ensure Troupe roles exist
      var troupeRoles = ['LST_WOad4CBTsG', 'AST_WOad4CBTsG', 'Narrator_WOad4CBTsG'];
      for (var r = 0; r < troupeRoles.length; r++) {
        var roleName = troupeRoles[r];
        var roleId = 'role_' + roleName;
        await db.collection('_Role').updateOne(
          { name: roleName },
          {
            $set: {
              name: roleName,
              _rperm: ['*'],
              _wperm: ['role:Administrator'],
              _acl: { '*': { r: true }, 'role:Administrator': { r: true, w: true } },
              _updated_at: new Date()
            },
            $setOnInsert: {
              _id: roleId,
              _created_at: new Date()
            }
          },
          { upsert: true }
        );
      }

      // Add sampast to AST_WOad4CBTsG role
      await db.collection('_Join:users:_Role').updateOne(
        { owningId: 'role_AST_WOad4CBTsG', relatedId: 'user_sampast' },
        {
          $set: {
            owningId: 'role_AST_WOad4CBTsG',
            relatedId: 'user_sampast'
          }
        },
        { upsert: true }
      );

      console.log('Database seeding complete.');
    }

    // The remaining steps run on every boot, not only on a cold database.
    // Upserts keep them idempotent, and running them unconditionally is what
    // lets a new test account or a new description category reach a database
    // that was seeded before they existed.
    await seedTestUsers(db);
    await seedPrivateFixtureCharacter(db);

    var descResult = await seedExtra.seedDescriptions(db);
    if (descResult.inserted > 0) {
      console.log('Backfilled ' + descResult.inserted + ' Description rows (' +
        descResult.categories.join(', ') + ')');
    }

    var kithResult = await seedExtra.seedKithRules(db);
    if (kithResult.inserted > 0) {
      console.log('Backfilled ' + kithResult.inserted + ' bnsctdbs_KithRule rows');
    }
  } finally {
    await client.close();
  }

  return { seeded: true };
}

module.exports = {
  seedDatabase: seedDatabase,
  seedTestUsers: seedTestUsers,
  seedPrivateFixtureCharacter: seedPrivateFixtureCharacter,
  TEST_USERS: TEST_USERS,
  PRIVATE_FIXTURE_CHARACTER_ID: PRIVATE_FIXTURE_CHARACTER_ID,
  SAMPLE_TROUPE_ID: SAMPLE_TROUPE_ID,
  verifyTestUsers: verifyTestUsers,
  seedingAllowed: seedingAllowed,
  TEST_USERS: TEST_USERS
};
