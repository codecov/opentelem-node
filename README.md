# Node Codecov OpenTelementry

This package is intended to support Codecov's [Impact Analysis](https://docs.codecov.com/docs/impact-analysis) feature. 

Note that this packaged requires, at minimum, Node 15.1.0 due to the inclusion of v8.takeCoverage(). See
[https://nodejs.org/api/v8.html#v8_v8_takecoverage](https://nodejs.org/api/v8.html#v8_v8_takecoverage).

## Setup


Install dependencies:

`npm install @codecov/node-codecov-opentelemetry`

Set environment variable for coverage export. You will not need to access this directory
yourself, but the application will read coverage reports from this directory:

`export NODE_V8_COVERAGE=codecov_reports`

An example application is included in this repository, it can be run as follows:

```
node examples/app.js
```

**IMPORTANT:** Be sure you're running Node JS 15.1 or above. Any version beneath this one
will not have the interface to V8 required to collect traces.

## Basic Setup

The following code should be used in the startup of your application, typically this is `app.js`. For a basic express app, it would look as follows:

```js
// Include Dependencies
const { CodeCovOpenTelemetry }  = require('@codecov/node-codecov-opentelemetry');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const { SpanKind } = require("@opentelemetry/api");

// Setup OpenTelemetry
const sampleRate = 1;
const untrackedExportRate = 1;
const code = 'production::v0.0.1' //<environment>::<versionIdentifier>
const provider = new NodeTracerProvider();
provider.register();

// Setup Codecov OTEL
const codecov = new CodeCovOpenTelemetry(
  {
    repositoryToken: "your-impact-analysis-token", //from repository settings page on Codecov.
    environment: "production", //or others as appropriate
    versionIdentifier: "v0.0.1", //semver, commit SHA, etc
    filters: {
      allowedSpanKinds: [SpanKind.SERVER],
    },
    codecovEndpoint: "https://api.codecov.io",
    sampleRate,
    untrackedExportRate,
    code
  }
)

provider.addSpanProcessor(codecov.processor);
provider.addSpanProcessor(new BatchSpanProcessor(codecov.exporter))

```
Once initialized, your application can continue as expected:

```js
//...example express setup
const express = require('express');
const port = 3000;
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
})

```

## Current Caveats and Limitations

### NodeJS and `takeCoverage`
This package relies heavily on the `takeCoverage` and other supporting methods added to with Node 15.1.0. While these methods are generally useful and allow Impact Analysis to function properly, there are some caveats to consider:

1. Due to the nature of node coverage profiling (essentially calling `takeCoverage` again and again and using snapshots), coverage tracking cannot be paused, and may run in a way that poses an impact on performance.
    - On approach to address this problem, calling `stopCoverage` is not a possibility, because once `stopCoverage` is called, `takeCoverage` raises errors.
    - Initial experiments do not indicate a significant hit to performance, likely due to `takeCoverage()` _et al_ being native. 
2. There seems to be no way to avoid the disk-write in a naive way
    - If `NODE_V8_COVERAGE` could be mapped to memory, that could be more performant solution.
3. Getting the saved filename is a bit error-prone. We can't know for sure what the filename will be because it's generated on the fly. See: [https://github.com/nodejs/node/.../src/inspector_profiler.cc#L172](https://github.com/nodejs/node/blob/c18ad4b01297548582a04000aae5ba7d862377f5/src/inspector_profiler.cc#L172) So there is the possibility that at some point race conditions may occur, although this is not likely.
4. There seems to be a bug in node opentelem in that calls `spancontext` as a function, but that is not a function. Before fielding this in a production context, opentelemetry-js will need a fix.
    - example of incorrect use: [https://github.com/open-telemetry/opentelemetry-js/.../src/export/BatchSpanProcessorBase.ts#L83](https://github.com/open-telemetry/opentelemetry-js/blob/610808d3b64b9f660f4dd640ad961b8c9f67be66/packages/opentelemetry-sdk-trace-base/src/export/BatchSpanProcessorBase.ts#L83)
    
5. There are some minor concerns with block coverage versus line coverage. For example, the output from the profiler is in the format:
```
        // ...
        {
            "scriptId": "115",
            "url": "file:///Users/thiagorramos/Projects/opentelem-node/examples/app.js",
            "functions": [
                {
                    "functionName": "",
                    "ranges": [
                        {
                            "startOffset": 1062,
                            "endOffset": 1107,
                            "count": 1
                        }
                    ],
                    "isBlockCoverage": true
                }
            ]
        }
        // ...
```

which shows byte ranges (1062 to 1107 in this case). This means that coverage is on the statement block level, rather than line coverage. To compensate for this discrepancy, for now, this package assumes that if bytes A to B involve lines C to D, then all lines from C to D are covered. 
6. This package assumes that the "byte intervals" that show up in node coverage are presented in pre-order when looking at the interval tree. This package makes no assumption that byte intervals are presented in pre-order, and thus will reorder if needed, However, the package still assumes they are tree intervals and that there will be no unusual overlaps (as in, two intervals that overlap but are not contained one inside another).

### OpenTelemetry Caveats
1. Due to the nature of async js, opentelemetry tracks the request from the moment it is received until the moment of response. So for example, on:

```js
app.get('/hello', (req, res) => {
  console.log("WE ARE INSIDE THE REQUEST")
  res.send('SPECIAL Hello ' + req.query.name + req.query.value);
  let a = parseInt(req.query.value);
  let b = a + b;
  if (a > 10) {
    console.log("It's higher than 10")
    // some extra logic
  }
}
```

Opentelemetry will execute `onEnd` right after `res.send` happens. Which means that it won't wait for the extra logic to run.
2. JS coverage output doesn't seem to split a 'stataments block' into two when needed. The idea is that two consecutive statements, unless separated by an if/while/return/etc, are always either both executed or neither.
    - So, still on the above example, lines 68 (`let a ...;`) and 69 (`let b = ...;`) are in the same statement block as line 66 (`console.log("WE...")`). Due to the async nature of js, coverage stopped tracking before they were executed, so they should not show up on the coverage result. But they do, because since line 66 was executed, and they are part of the same statement block, it doesn't make sense for them to not have been executed.
    - While this is generally preferred, problems do arise in some cases. Consider the `if` statement on line 70, for example. Line 71 (`console.log("It's higher...")`) also clearly runs on some cases (where `a > 10`), but is always considered not covered on the reports, because it is on a separate statement block and happens after a `res.send`.