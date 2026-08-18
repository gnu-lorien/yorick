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

async function getDatabaseURI() {
  if (process.env.MONGODB_URI) {
    return process.env.MONGODB_URI;
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
    return "mongodb://localhost:27017/anotherstore";
  }

  console.log("No local MongoDB instance detected on port 27017. Starting in-memory MongoDB server...");
  var MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
  var mongod = await MongoMemoryServer.create({
    binary: {
      version: '4.4.18'
    }
  });
  var uri = mongod.getUri() + "anotherstore";
  console.log("In-memory MongoDB started at " + uri);
  return uri;
}

async function startServer() {
  var databaseURI = await getDatabaseURI();

  // Seeding is opt-in via YORICK_ALLOW_SEED=1 (see seedingAllowed in
  // seed_db.js). `seedTestUsers` runs on every boot rather than only on a cold
  // database, so an ungated call here would upsert `devuser` -- a public
  // password, `admininterface: true` -- into whatever DATABASE this process was
  // pointed at, and overwrite any real player holding that username. A refusal
  // is not fatal; the server still starts, it just starts without writing test
  // accounts.
  var seed_db = require('./seed_db');
  var seedResult = await seed_db.seedDatabase(databaseURI);
  if (seedResult && seedResult.seeded === false) {
    console.log('[seed] Continuing without seeding.');
  }

  var settings = {
    "appId": process.env.APPLICATION_ID || "APPLICATION_ID",
    "appName": process.env.APPLICATION_NAME || "Yorick",
    "masterKey": process.env.MASTER_KEY || "MASTER_KEY",
    "databaseURI": databaseURI,
    "mountPath": process.env.MOUNT_PATH || "/parse/1",
    "cloud": process.env.CLOUD_CODE_MAIN || path.join(__dirname, 'cloud', 'main.js'),
    "verbose": true,
    "publicServerURL": process.env.PUBLIC_SERVER_URL || "https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse/1",
    "serverURL": "http://0.0.0.0:" + port + "/parse/1",
    "oauth": {
        "facebook": {
            "appIds": process.env.FACEBOOK_APP_IDS || ""
        }
    }
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
  app.use('/parse/1', api);
  app.use(serveStatic(process.env.PUBLIC_BASE || path.join(__dirname, 'public')));

  app.get('/deez', function (req, res) {
      new Parse.Query("Vampire").first({useMasterKey: true}).then(function (v) {
          res.send("I got something named what exactly? " + v.get("name"));
      }).fail(function (error) {
          res.send(error.message);
      });
  });

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
              }).fail(function (error) {
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