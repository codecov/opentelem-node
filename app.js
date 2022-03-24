require('./lib/runtime-insights.js');

const express = require('express');
const port = 3000;
const app = express();

// OTEL setup stuff
// use codecov exporter

app.get('/', (req, res) => {
  res.send('Hello World!');
})

app.get('/hello', (req, res) => {
  if (req.query.name != undefined) {
  res.send('Hello ' + req.query.name);
  }
  else {
    res.send('Please provide your name as a query param.')
  }
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
})

module.exports = app;
