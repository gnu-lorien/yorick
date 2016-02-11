var express = require('express'),
    serveStatic = require('serve-static'),
    fs = require('fs'),
    privateKey = fs.readFileSync('key.pem'),
    certificate = fs.readFileSync('cert.pem'),
    http = require('http'),
    https = require('https');

var credentials = {key: privateKey, cert: certificate};
var app = express()

app.use(serveStatic('public'));

http.createServer(app).listen(8000, '0.0.0.0');
//https.createServer(credentials, app).listen(8000, '0.0.0.0');