var express = require('express')
var serveStatic = require('serve-static')

var app = express()

app.use(serveStatic('public'));
app.listen(8000, '0.0.0.0');