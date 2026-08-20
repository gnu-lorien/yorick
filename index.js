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
 * Resolve the database to run against.
 *
 * Returns `{ uri, ephemeral }`. `ephemeral` is true only when THIS process
 * started an in-memory MongoDB a moment ago -- an instance that holds no data,
 * is unreachable from anywhere else, and disappears when the process exits.
 * That is a stronger guarantee than "the URI looks like localhost", and it is
 * what lets seeding auto-enable for local development without weakening the
 * guard against seeding a real database. See `seedingAllowed` in seed_db.js.
 */
async function getDatabaseURI() {
  if (process.env.MONGODB_URI) {
    return { uri: process.env.MONGODB_URI, ephemeral: false };
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
    "publicServerURL": process.env.PUBLIC_SERVER_URL || "https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse/1",
    // 127.0.0.1, not 0.0.0.0. `0.0.0.0` is a bind address, not a destination,
    // and modern parse-server FETCHES serverURL at startup to verify it. The
    // path follows mountPath rather than duplicating the literal it is mounted
    // at, so the two cannot disagree.
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
    "enableSanitizedErrorResponse": false
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

startServer().catch(function(err) {
  console.error("Failed to start server:", err);
  process.exit(1);
});