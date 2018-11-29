var express = require('express'),
    serveStatic = require('serve-static'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    bodyParser = require('body-parser'),
    ipn = require('paypal-ipn'),
    ParseServer = require('parse-server').ParseServer;

var app = express()
var settings = {
  "appId": process.env.APPLICATION_ID || "APPLICATION_ID",
  "appName": process.env.APPLICATION_NAME || "Yorick",
  "masterKey": process.env.MASTER_KEY || "MASTER_KEY",
  "databaseURI": process.env.MONGODB_URI || "mongodb://localhost:27017/anotherstore",
  "mountPath": process.env.MOUNT_PATH || "/parse/1",
  "cloud": process.env.CLOUD_CODE_MAIN || "/home/ubuntu/workspace/cloud/main.js",
  "verbose": true,
  "publicServerURL": process.env.PUBLIC_SERVER_URL || "https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse/1",
  "serverURL": "http://0.0.0.0:" + process.env.PORT + "/parse/1",
  "facebookAppIds": process.env.FACEBOOK_APP_IDS || ""
}

var api = new ParseServer(settings);
app.use('/parse/1', api);

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
})

http.createServer(app).listen(process.env.PORT, '0.0.0.0');