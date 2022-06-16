const { CodeCovOpenTelemetry }  = require('../lib/runtime-insights.js');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const { SpanKind } = require("@opentelemetry/api");

// OTEL setup logic
const sampleRate = 1;
const untrackedExportRate = 1;
const code = 'production::v2'

const provider = new NodeTracerProvider();
provider.register();

const codecov = new CodeCovOpenTelemetry(
  {
    repositoryToken: "c9efdfba42b1209a855071a32672c9017989c01e", // local key, no security risk
    environment: "production",
    versionIdentifier: "v2",
    filters: {
      allowedSpanKinds: [SpanKind.SERVER],
    },
    codecovEndpoint: "localhost",
    sampleRate,
    untrackedExportRate,
    code
  }
)

provider.addSpanProcessor(codecov.processor);
provider.addSpanProcessor(new BatchSpanProcessor(codecov.exporter))
console.log("Tracing initialized");

const express = require('express');
const port = 3000;
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
})

app.get('/hello', (req, res) => {
  // console.dir(provider);
  if (req.query.name != undefined) {
    let a = parseInt(req.query.value);
    console.log(a);
    let b = 45;
    if (a == 0) {
      console.log("bananas");
    }
    if (a > 10) {
      b = b + 1;
      if (a < 50) {
        a = a + 2;
        res.send('SPECIAL Hello ' + req.query.name + req.query.value);
        return;
      }
    }
    res.send('Hello ' + req.query.name + req.query.value);
    let c = 1;
    c = a + b;
    c = c * c;
    if (a > 0) {
      c = a + b;
      c = c * c;
    }
    c = a + b + 1;
    c = c * c;
  }
  else {
    res.send('Please provide your name as a query param.')
  }
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
})

module.exports = app;
