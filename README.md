# Critical paths with NODE_V8_COVERAGE

The moment we've been waiting for! Node 15.1.0 has added v8.takeCoverage(). see
[https://nodejs.org/api/v8.html#v8_v8_takecoverage](https://nodejs.org/api/v8.html#v8_v8_takecoverage).

## Setup


Install dependencies:

`npm install`

Set environment variable for coverage export. You will not need to access this directory
yourself, but the application will read coverage reports from this directory:

`export NODE_V8_COVERAGE=codecov_reports`

Run application

`node app.js`

IMPORTANT: Be sure you're running Node JS 15.1 or above. Any version beneath this one
will not have the interface to V8 that we need to collect traces.
