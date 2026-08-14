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