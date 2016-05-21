var express = require('express'),
    serveStatic = require('serve-static'),
    fs = require('fs'),
    http = require('http'),
    https = require('https');

var app = express()

app.use(serveStatic(process.env.PUBLIC_BASE));

http.createServer(app).listen(8000, '0.0.0.0');
