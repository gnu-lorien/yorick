var express = require('express'),
    serveStatic = require('serve-static'),
    path = require('path'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    bodyParser = require('body-parser'),
    ipn = require('paypal-ipn'),
    ParseServer = require('parse-server').ParseServer;

var app = express();
var port = process.env.PORT || 1337;

/**
 * The database name this backend should use.
 *
 * Defaults to `anotherstore`, which is what a plain `node index.js` has always
 * used and what any existing local data lives in.
 *
 * The E2E suite overrides it per worker. Each worker gets its own backend on
 * its own port (see e2e/ports.js), and when nothing is listening on 27017 each
 * of those starts its own in-memory mongod, so they are isolated by having
 * separate *servers*. But if a developer happens to be running a mongod on
 * 27017, every backend connects to that one instead — and with a fixed database
 * name they would all share `anotherstore`, silently putting the admin suites
 * back in contention and reproducing exactly the cross-suite flakiness that
 * per-worker backends were introduced to remove. It would present as "flaky on
 * my machine, fine on yours", which is the worst kind of test failure to chase.
 *
 * Naming the database per worker makes the isolation hold either way.
 */
function databaseName() {
  return process.env.MONGODB_DB || 'anotherstore';
}

/**
 * Is this a deployed host rather than somebody's machine or a test run?
 *
 * TWO signals, because neither is trustworthy alone. NODE_ENV=production is
 * conventionally set by Heroku's Node buildpack, but it is an ordinary config
 * var that can be unset by hand, and nothing else in this repo branches on it,
 * so nothing else would notice if it went missing. DYNO is set by the Heroku
 * platform itself rather than by configuration.
 *
 * Neither is set anywhere in this repo's own tooling -- not by
 * playwright.config.js's webServer env, not by test_runner.js, not by any npm
 * script -- so a local run cannot trip either of the refusals that call this.
 *
 * Both callers refuse a FALLBACK, never an explicit value. The pattern is the
 * same in each: a default that is merely wrong on a developer's machine becomes
 * silent damage on a dyno, so the dyno is made to say so instead.
 */
function looksDeployed() {
  return process.env.NODE_ENV === 'production' || !!process.env.DYNO;
}

/**
 * The origin this server tells the outside world to reach it on.
 *
 * parse-server bakes this into password-reset and verification links, and it is
 * what `Parse.File#url()` resolves against -- so it is not only a link-building
 * nicety. `crop_and_thumb` in cloud/main.js reads the just-uploaded file BACK
 * over HTTP from this origin, and it is the whole body of the beforeSave for
 * both CharacterPortrait and TroupePortrait. Point this at a host that does not
 * answer and every portrait save is REFUSED -- not a broken thumbnail, no row
 * at all -- while each attempt still leaves an orphaned blob in GridFS, because
 * the browser uploads the file in one request and saves the row in another.
 *
 * The default used to be a Cloud9 host that stopped existing years ago, which
 * meant portrait uploads were broken for anyone running this locally and would
 * have been broken in production the moment PUBLIC_SERVER_URL was left unset.
 * Locally it now points at this process, which is both correct and testable;
 * on a deployed host there is no sensible guess, so it refuses.
 *
 * Note that parse-server will NOT catch a bad value for us. verifyServerUrl()
 * is reached only from startApp(), and this file calls start(), so a
 * publicServerURL pointing nowhere produces no boot warning at all.
 */
function resolvePublicServerURL(port, mountPath) {
  if (process.env.PUBLIC_SERVER_URL) {
    return process.env.PUBLIC_SERVER_URL;
  }
  if (looksDeployed()) {
    throw new Error(
      'PUBLIC_SERVER_URL is not set, and this looks like a deployed ' +
      'environment (NODE_ENV=production and/or DYNO). Refusing to guess it. ' +
      'parse-server bakes this origin into password-reset links and into ' +
      'every Parse.File URL, and cloud/main.js fetches each uploaded portrait ' +
      'back over HTTP from it -- so a wrong value does not degrade, it refuses ' +
      'every portrait save and leaves an orphaned file behind each time. Set ' +
      'PUBLIC_SERVER_URL to this deployment origin plus the mount path, e.g. ' +
      'https://<app>.herokuapp.com' + mountPath + '.'
    );
  }
  return 'http://127.0.0.1:' + port + mountPath;
}

/**
 * Resolve the database to run against.
 *
 * Returns `{ uri, ephemeral }`. `ephemeral` is true only when THIS process
 * started an in-memory MongoDB a moment ago -- an instance that holds no data,
 * is unreachable from anywhere else, and disappears when the process exits.
 * That is a stronger guarantee than "the URI looks like localhost", and it is
 * what lets seeding auto-enable for local development without weakening the
 * guard against seeding a real database. See `seedingAllowed` in seed_db.js.
 *
 * A deployed environment gets no fallback at all -- see the refusal below.
 */
async function getDatabaseURI() {
  // Two names, because the two lineages of this app disagree about which one
  // it is: the deployed dyno's config var is DB_URI, while the two things in
  // this tree that read a database URI at all -- `npm run seed` and
  // audit_db_permissions.js -- both say MONGODB_URI. (The E2E harness sets
  // neither: playwright.config.js sets MONGODB_DB, a database NAME, and lets
  // the fallback below choose the server.) Reading only one of them would
  // make the deploy depend on a hand rename of a config var -- and the day
  // that rename is forgotten is not the day the server fails to boot, it is
  // the day it boots wrong. See the refusal below for what that silence costs.
  //
  // MONGODB_URI wins when both are set, so a deployment can be moved onto the
  // name this tree uses by adding it, and moved back off by removing it,
  // without either step passing through a moment with no database configured.
  var explicitURI = process.env.MONGODB_URI || process.env.DB_URI;
  if (explicitURI) {
    return { uri: explicitURI, ephemeral: false };
  }

  // Refuse here, BEFORE the probe below, when this looks like a deployed
  // environment and nothing explicit was given.
  //
  // What is being refused is not a crash -- it is a success. On a host with no
  // mongod on 27017 the fallback chain below starts an IN-MEMORY MongoDB and
  // reports `ephemeral: true`, which seed_db.js reads as permission to seed, so
  // the process comes up listening and healthy, serving an empty database
  // holding `devuser` at a password published in this repository, while every
  // real record is simply absent. Nothing logs an error and the health check
  // passes. That is the worst outcome available here, and it is the one an
  // unset config var produces, so it gets an explicit stop.
  //
  // Ahead of the probe for two reasons: a dyno should not spend a socket
  // timeout looking for a mongod it was never going to have, and a test can
  // then exercise this branch without touching the network or the filesystem.
  //
  // See looksDeployed().
  if (looksDeployed()) {
    throw new Error(
      'No database configured: neither MONGODB_URI nor DB_URI is set, and this ' +
      'looks like a deployed environment (NODE_ENV=production and/or DYNO). ' +
      'Refusing to fall back to a local or in-memory MongoDB, because that ' +
      'fallback does not fail here -- it succeeds: the server would come up ' +
      'healthy on an empty in-memory database seeded with the test accounts, ' +
      'and every real record would be absent with nothing logged. Set ' +
      'MONGODB_URI (or DB_URI) to the database this deployment should use.'
    );
  }

  // Check if local MongoDB is reachable on 27017
  const isMongoRunning = await new Promise(function(resolve) {
    var net = require('net');
    var sock = new net.Socket();
    sock.setTimeout(1000);
    sock.on('connect', function() {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', function() {
      sock.destroy();
      resolve(false);
    });
    sock.on('timeout', function() {
      sock.destroy();
      resolve(false);
    });
    sock.connect(27017, '127.0.0.1');
  });

  if (isMongoRunning) {
    // A mongod someone else is running. It may well be a scratch database, but
    // this process cannot know that, so it does not get the ephemeral pass.
    return {
      uri: "mongodb://localhost:27017/" + databaseName(),
      ephemeral: false
    };
  }

  console.log("No local MongoDB instance detected on port 27017. Starting in-memory MongoDB server...");
  var MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
  var mongod = await MongoMemoryServer.create({
    binary: {
      version: process.env.MONGODB_BINARY_VERSION || '4.4.18'
    }
  });
  var uri = mongod.getUri() + databaseName();
  console.log("In-memory MongoDB started at " + uri);
  return { uri: uri, ephemeral: true };
}

async function startServer() {
  var database = await getDatabaseURI();
  var databaseURI = database.uri;

  // Seeding is opt-in (see `seedingAllowed` in seed_db.js). `seedTestUsers`
  // runs on every boot rather than only on a cold database, so an ungated call
  // here would upsert `devuser` -- a password published in this repo,
  // `admininterface: true` -- into whatever database this process was pointed
  // at, and overwrite any real player holding that username.
  //
  // The in-memory instance is exempt because this process created it seconds
  // ago: it is empty, unreachable from outside, and gone at exit. Everything
  // else requires YORICK_ALLOW_SEED=1. A refusal is not fatal; the server still
  // starts, it just starts without writing test accounts.
  var seed_db = require('./seed_db');
  var seedResult = await seed_db.seedDatabase(databaseURI, {
    ephemeral: database.ephemeral
  });
  if (seedResult && seedResult.seeded === false) {
    console.log('[seed] Continuing without seeding.');
  }

  // Hoisted out of the settings literal because three things need it now: the
  // setting itself, the express mount, and serverURL's path.
  var mountPath = process.env.MOUNT_PATH || "/parse/1";

  var settings = {
    "appId": process.env.APPLICATION_ID || "APPLICATION_ID",
    "appName": process.env.APPLICATION_NAME || "Yorick",
    "masterKey": process.env.MASTER_KEY || "MASTER_KEY",
    "databaseURI": databaseURI,
    "mountPath": mountPath,
    "cloud": process.env.CLOUD_CODE_MAIN || path.join(__dirname, 'cloud', 'main.js'),
    // parse-server 2.8.4 defaults this TRUE and every version from 3.0 on
    // defaults it FALSE (lib/Options/Definitions.js, "defaults to true" vs
    // "defaults to false"). Left implicit it would flip underneath the bump.
    // All 30 classes the app persists are declared in
    // database_seed/_SCHEMA.json, so a seeded database never needs it.
    //
    // Pinned PERMISSIVE, which is 2.8.4's default and not the modern one.
    //
    // Owner decision, 2026-08-20: client code is expected to extend the schema
    // in future -- new venues and the classes that come with them -- so the
    // ability to create a class from the client is kept deliberately rather
    // than lost to a default that changed underneath us.
    //
    // Pinning it matters more than which way it points. Left implicit it
    // would flip from true to false at the bump, and that flip is not the
    // write-only change it looks like: RestWrite.js:139 is the check everyone
    // expects, but RestQuery.js:234 is reached from buildRestWhere at :180 on
    // EVERY query, and throws OPERATION_FORBIDDEN (119) "not allowed to
    // access non-existent class" where the query used to return []. Any class
    // present in one deployment's _SCHEMA and absent from another's would
    // start throwing on read, on a path nobody touched, invisible to every
    // test here.
    //
    // The env var turns it OFF, for whenever the schema is settled enough to
    // want that. Note the separate lever: adding a FIELD to an existing class
    // is each class's own addField CLP in database_seed/_SCHEMA.json, not this
    // option -- currently open to "*" on 13 classes and Administrator on 8.
    "allowClientClassCreation": process.env.ALLOW_CLIENT_CLASS_CREATION !== "0",
    // Every request and response body is logged at this level. One local day
    // of E2E runs produced a 3.9 GB log, and on a dyno all of it goes to the
    // platform log drain -- character sheet bodies included. VERBOSE is
    // parse-server's own switch for it (lib/defaults.js) and reads the same
    // way in 2.8.4 and 9.10.0, so this is the gate that survives the bump.
    // parse-server.err stays at level "error" regardless
    // (Adapters/Logger/WinstonLogger.js:56), so the error log is unaffected.
    "verbose": process.env.VERBOSE ? true : false,
    "publicServerURL": resolvePublicServerURL(port, mountPath),
    // 127.0.0.1, not 0.0.0.0. `0.0.0.0` is a bind address, not a destination,
    // so anything that dials serverURL needs a real host. The path follows
    // mountPath rather than duplicating the literal it is mounted at, so the
    // two cannot disagree.
    //
    // NOTE, because the obvious assumption is wrong: parse-server does NOT
    // verify this at startup on the path we take. `verifyServerUrl()` is
    // reached only from `startApp()` (ParseServer.js:455); index.js calls
    // `start()` (:148-233), which never calls it. So a deployed serverURL that
    // points nowhere produces no boot warning at all -- it produces failures
    // later, at whatever first dials it. Do not rely on a startup check that
    // is not there.
    "serverURL": "http://127.0.0.1:" + port + mountPath,
    // 9.10.0 defaults: enableForPublic false, enableForAnonymousUser false,
    // enableForAuthenticatedUser TRUE. Portrait uploads are made by logged-in
    // players, so the defaults would already work -- these are pinned for the
    // same reason allowClientClassCreation above is: an inherited default is a
    // behaviour that can move under a later bump without appearing in a diff.
    //
    // This is a real tightening against 2.8.4, which gated POST /files not at
    // all: an unauthenticated client could upload, and `require_a_user` only
    // refused the CharacterPortrait ROW afterwards, leaving an orphan file in
    // GridFS. Nothing in the suite uploads while logged out.
    //
    // `fileExtensions` is deliberately left at its default, which reads as a
    // whitelist and is really a negative-lookahead BLACKLIST: it refuses only
    // the script-bearing markup types (html/xhtml/svg/xml/xslt/xsd/rng/rdf/
    // owl/mathml) and permits everything else. Measured against the regex
    // itself -- txt, png, jpg, jpeg and gif all pass, svg/html/xml/htm do not.
    // That matters because CharacterPortraitView.js:49 names the upload
    // "portrait" + the source file's extension, and the E2E portrait test
    // uploads a .txt to exercise the hook's rejection path. Were .txt refused,
    // the file layer would reject ahead of CharacterPortrait/beforeSave and
    // the test would still pass -- it asserts only that the upload was
    // rejected -- while the hook silently stopped running.
    "fileUpload": {
      "enableForPublic": false,
      "enableForAnonymousUser": false,
      "enableForAuthenticatedUser": true
    },
    // New in 9.x and ON by default: a CLP refusal is logged in full
    // server-side but answered to the client as the bare string
    // "Permission denied" (lib/Error.js, createSanitizedError). 2.8.4 always
    // sent the detailed message, and the suite reads it -- access-control 382
    // asserts the refusal names `bnsmetv1_ClanRule`, admin-patronage 15
    // asserts the exact "Permission denied for action create on class
    // Patronage.".
    //
    // Pinned to 2.8.4's behaviour rather than adopting the new default,
    // because which message a client sees is a product decision and this step
    // is a version bump. Turning it on is a real (small) hardening -- the
    // detailed message tells an unauthenticated caller which classes exist and
    // what it may not do to them -- and it is a two-line change here plus
    // those two assertions. It wants its own commit and its own gate, not a
    // default silently changing underneath this one.
    "enableSanitizedErrorResponse": false,
    // Pinned to 9.10.0's own default, which means this line changes NOTHING
    // about how the server behaves. It is here because the option was
    // previously absent, and an absent option is a behaviour nobody chose:
    // 2.8.4 had no such setting at all, so the bump silently adopted 9.x's
    // answer to a question this app had never been asked.
    //
    // What it does: a _User created without an explicit ACL gets no public
    // read. Only on CREATE, and only when the write supplies no ACL
    // (RestWrite.js, the _User branch). Nothing rewrites a row that already
    // exists -- which is why this degrades gradually rather than breaking on
    // day one, and why turning it OFF would not restore anyone created while
    // it was on.
    //
    // Owner decision, 2026-08-20: keep the modern default and move the
    // browser's reads of OTHER people's _User rows behind Cloud functions.
    // docs/runbooks/s11-enforce-private-users.md is that work, specified and
    // verified; none of it has landed yet. Until it does, a browser read of
    // another user's row returns nothing for anyone who signed up after the
    // bump, and an include() of a user-valued pointer drops the pointer
    // entirely rather than leaving it unfetched.
    //
    // Note for anyone reading a green suite as reassurance: it is not.
    // seed_db.js writes _rperm: ['*', u.id] straight into Mongo, bypassing the
    // layer this option lives in, so every seeded account is publicly readable
    // no matter what this says -- and no spec completes a signup. Neither
    // suite can observe this option at all, in either position.
    "enforcePrivateUsers": true
  };

  // R51. Password reset needs an `emailAdapter` as well as the `appName` and
  // `publicServerURL` above; with none configured, `requestPasswordReset`
  // rejected deterministically and the correctly-wired button could never
  // work. Choosing a mail provider is a deployment decision with credentials
  // attached, and the suite must never send real mail, so the default captures
  // outbound mail in memory and sends nothing. Set MAIL_ADAPTER_MODULE to a
  // module exporting a factory to send for real.
  if (process.env.MAIL_ADAPTER_MODULE) {
    settings.emailAdapter = require(process.env.MAIL_ADAPTER_MODULE)();
    console.log("[email] Using mail adapter from " + process.env.MAIL_ADAPTER_MODULE);
  } else {
    var MemoryEmailAdapter = require('./cloud/MemoryEmailAdapter');
    settings.emailAdapter = MemoryEmailAdapter();
    // Cloud code reads this to decide whether to expose `get_captured_emails`.
    global.__yorickCapturedEmail = settings.emailAdapter;
    console.log("[email] No MAIL_ADAPTER_MODULE set. Outbound email is captured " +
      "in memory and never sent.");
  }

  var api = new ParseServer(settings);
  // parse-server 2.8.4's `ParseServer` export was a factory that returned
  // `server.app` (lib/index.js:52-56), so `new ParseServer(settings)` handed
  // back an express app by accident of calling `new` on a factory. 9.10.0's
  // export is still a factory but returns the SERVER (lib/index.js), so this
  // is an instance and the express app is `api.app`.
  //
  // `start()` MUST be awaited before listen(). Cloud code is `require`d inside
  // it (ParseServer.js:181-198), so not one hook is registered until it
  // resolves -- and a hook that has not registered yet does not fail, it
  // silently permits. `startServer()` is already async and its caller already
  // turns a rejection into process.exit(1).
  await api.start();
  // `settings.mountPath` rather than the literal it duplicated. The setting was
  // read at :118 from MOUNT_PATH and then ignored here, so setting MOUNT_PATH
  // moved nothing and 404ed nothing. Now it does what it says.
  app.use(settings.mountPath, api.app);
  app.use(serveStatic(process.env.PUBLIC_BASE || path.join(__dirname, 'public')));
  // A second, lower-priority document root.
  //
  // The React front end is served by pointing PUBLIC_BASE at its build output,
  // and that build contains only what it imports. Several assets are referenced
  // as bare runtime strings instead -- `head_skull.png` is the portrait
  // fallback every listing falls back to -- so they live in `public/` and are
  // not bundled. Mounting `public/` behind the primary root is what lets the
  // React build be served without copying those files into it, which would make
  // them two files that have to stay identical.
  //
  // Unset in every normal run, including production: the legacy front end IS
  // `public/`, so there is nothing behind it to reach.
  if (process.env.PUBLIC_FALLBACK) {
    app.use(serveStatic(process.env.PUBLIC_FALLBACK));
  }

  app.use(bodyParser.urlencoded({extended: false}));
  app.use(bodyParser.json());

  app.post('/deez', function (req, res) {
      console.log(JSON.stringify(req.body));
      ipn.verify(req.body, {allow_sandbox: true}, function (err, msg) {
          if (err) {
              console.error(err);
          } else {
              console.log("I verified it");
              var PaymentPaypal = Parse.Object.extend("PaymentPaypal");
              var p = new PaymentPaypal;
              p.save(req.body, {useMasterKey: true}).then(function (newpaymente) {
                  console.log("Boom new payment");
              }).catch(function (error) {
                  console.error(error.message);
              })
          }
      })
      res.send("I found something");
  });

  http.createServer(app).listen(port, '0.0.0.0', function() {
    console.log("Server listening on port " + port);
  });
}

// Guarded so this file can be `require`d for its exports without standing a
// server up. Every real boot runs it as the main module and is unaffected: the
// Procfile is `web: npm start`, package.json's "start" is `node index.js`, and
// both harnesses that need a backend run the same file the same way
// (playwright.config.js's webServer `command`, and test_runner.js's spawn of
// process.execPath with 'index.js'). Remove the guard and merely importing
// getDatabaseURI in a unit test would boot Parse Server, bind a port, and seed.
if (require.main === module) {
  startServer().catch(function(err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

// Exported for test/database-uri.test.js. `getDatabaseURI` is the whole of the
// deploy's database wiring and its dangerous failure mode is a silent success,
// so it has to be reachable without booting a server to assert on.
module.exports = {
  getDatabaseURI: getDatabaseURI,
  resolvePublicServerURL: resolvePublicServerURL,
  looksDeployed: looksDeployed
};