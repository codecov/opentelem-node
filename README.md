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

```
node examples/app.js
```

IMPORTANT: Be sure you're running Node JS 15.1 or above. Any version beneath this one
will not have the interface to V8 that we need to collect traces.

## Things that could possibly improve in the long term

1. Due to the nature of node coverage profiling (essentially calling `takeCoverage` again and again and using snapshots), there doesn't seem to be a pause/resume method on collecting coverage. This makes it so, even on logic we don't want to track coverage on, coverage tracking is still running. This can have a bad impact on performance.
    - Calling `stopCoverage` is not a possibility, because once `stopCoverage` is called, `takeCoverage` starts raising errors
    - It doesn't seem (or at least first experiments don't seem to show) this has a bad impact on performance. Probably because it's native. The imaect from this is way less than the impact of saving and reading data from disk
2. There seems to be no way to avoid the disk-write in a naive way
    - If we can map `NODE_V8_COVERAGE` to memory, that could be more performant
3. For problems 1. and 2. we might be able to go one level lower with the profiler. But it involved calling C code more directly, which I don't understand enough to do.
3. Getting the saved filename is a bit error-prone. We can't know for sure what the filename will be because it's generated on the fly: https://github.com/nodejs/node/blob/c18ad4b01297548582a04000aae5ba7d862377f5/src/inspector_profiler.cc#L172 So there is the possibility that at some point we will use the wrong filename in some race condition.
4. There seems to be a bug in node opentelem in that is calls spancontext as a function, but that is not a function. We have to solve it before people use this.
    - https://github.com/open-telemetry/opentelemetry-js/blob/610808d3b64b9f660f4dd640ad961b8c9f67be66/packages/opentelemetry-sdk-trace-base/src/export/BatchSpanProcessorBase.ts#L83
    - There was one more place. But I can't find it now
5. The output from the profiler is in the format:
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
which shows byte ranges (1062 to 1107 in this case). This means that coverage is more on the statement block level, rather than line coverage. To convert to line coverage, we need to make some smart analysis to tell which lines are being executed. Otherwise the best we can do is say: bytes A to B involves lines C to D, therefore all lines from C to D are covered (and some easy removals like empty lines). But this is not really exact and we might need some static analysis to tell which lines are actually lines. For now we are doing the naive thing, in the hopes this is enough for this version.
6. We are assuming that the "byte intervals" that show up in node coverage are presented in pre-order when looking at the interval tree. If that is correct, we don't need to reorder the intervals. If that is not, we need to reorder to avoid one interval wrongly overwriting its subintervals data.
    - We are reordering it, but we are still assuming they are tree intervals and that there will be no unusual overlaps (as in, two intervals that overlap but are not contained one inside another)
7. Due to the nature of async js, opentelemetry tracks the request from the moment it comes until the moment it is responded. So for example, on:
```
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

The opentelemetry will execute `onEnd` right after `res.send` happens. Which means that it won't wait for the extra logic to run. I don't know if the extra logic post-response is a common practice at Node, but we have no way of checking if coverage is run there, even though it does run.

8. Connected to the above point, but a different problem: there is the fact that js coverage output doesn't seem to split a 'stataments block' into two when needed. The idea is that two consecutive statements, unless separated by an if/while/return or whatnot, are always either both be executed or neither (which makes sense on its own)
    - So, still on the above example, lines 69 (`let a ...;`) and 70 (`let b = ...;`) are in the same statement block as line 67 (`console.log("WE...")`). Due to the async nature of js, coverage stopped tracking before they were executed, so they should not show up on the coverage result. But they do, because since line 67 was executed, and they are part of the same statement block, it doesn't make sense for them to not have been executed.
    - One might think "Great, this undoes the problem from item 7.". But the issue is inside the `if`, for example. Line 72 (`console.log("It's higher...")`) also clearly runs on some cases (where a > 10), but is always considered not covered on the reports, because it is on a separate statement block and happens after a res.send.
    - It's almost like the coverage tooling static analysis that produces the execution tree is not considering the dynamic possibilities of the code.
9. It's not clear to me that the callbacks on export are working. We set it seemingly right, but it's hard to tell if the tool expects something else.