# Critical paths with NODE_V8_COVERAGE

The moment we've been waiting for! Node 15.1.0 has added v8.takeCoverage(). see
[https://nodejs.org/api/v8.html#v8_v8_takecoverage](https://nodejs.org/api/v8.html#v8_v8_takecoverage).

## Objective

This express app is being written to show that we can handle a high volume of requests in a _relatively_ performant way, and output execution paths that exactly correspond to those within the scope of a single request.

## Setup

Clone this repo to your local machine:

`git clone git@github.com:codecov/critical-path-research.git`

Enter the correct sub-directory:

`cd critical-path-research/lang/js/NODE_V8_COVERAGE`

Install dependencies:

`npm install`

Set environment variable for coverage export. You will not need to access this directory
yourself, but the application will read coverage reports from this directory:

`export NODE_V8_COVERAGE=<something very random>`

Run application

`node app.js`

IMPORTANT: Be sure you're running Node JS 15.1 or above. Any version beneath this one
will not have the interface to V8 that we need to collect traces.

## Performance benchmarking

Benchmarking was performed using Apache Benchmark. We used Docker to run an AB container
against a locally-running web server to avoid measuring irrelevant network latency:

`docker run --rm jordi/ab -v 2 -n 100 -c 10 http://host.docker.internal:3000/`

Benchmarking line execution using V8 and exporting using the Node JS api interface is
actually a combination of two pieces that need to be taken into consideration separately.

First, the actual tracing, which we refer to here as "NODE_V8_COVERAGE set", is the scenario
where we've told V8 to trace execution, but we do not request coverage during the lifetime
of the process.

Second, actual tracing plus per-request coverage disk write is the scenario that we refer to
as "coverage write". As illustrated in the table below, this scenario is unfortunately not
terribly performant due to file IO operations.

### NODE_V8_COVERAGE set

The column named "NODE_V8_COVERAGE enabled" measures the scenario where execution
tracing is enabled, but no coverage reports are written. So it's a theoretical performance
that we actually have no way of achieving at the moment.

### coverage write

This column shows that the performance we can acieve at the moment is actually quite poor,
but not due to the tracing mechanism itself. Because V8 writes to disk for each invocation
of `v8.takeCoverage`, we're constrained by the speed at which we can synchronously read
and write to disk.

It might be possible to achieve _some_ operations asynchronously, but `v8.takeCoverage`
itself is a synchronous call so we can only make incremental improvements there.

A future task might be to create a pull request to V8 to actually pass the coverage results
back via memory or offload the file write to another process. This seems like a lot of
effort for a v0 product.


| metric                   | No tracing | NODE_V8_COVERAGE set | coverage write |
|--------------------------|------------|----------------------|----------------|
| Time taken for tests (s) | 0.295      | 0.365                | 2.758          |
| Requests per second      | 338        | 273                  | 36             |
| Time per request (ms)    | 29         | 36                   | 275            |

