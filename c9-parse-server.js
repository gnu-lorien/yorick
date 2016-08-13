var express = require('express'),
    serveStatic = require('serve-static'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    bodyParser = require('body-parser'),
    ipn = require('paypal-ipn'),
    ParseServer = require('parse-server').ParseServer,
    cors = require('cors');

var app = express();
app.use(cors());
app.use(serveStatic(process.env.PUBLIC_BASE));

var settings = require(process.env.CONFIG_FILE);
console.log(settings);
var api = new ParseServer(settings);
app.use('/parse/1', api);

app.get('/deez', function (req, res) {
    new Parse.Query("Vampire").first({useMasterKey: true}).then(function (v) {
        res.send("I got something named what exactly? " + v.get("name"));
    }).fail(function (error) {
        res.send(error.message);
    });
});

http.createServer(app).listen(8080, '0.0.0.0');