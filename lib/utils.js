"use strict";

const fs = require("fs");
const path = require("path");
const v8 = require("v8");
const https = require("https");

const { ExportResult } = require("@opentelemetry/core");
const covdir = process.env.NODE_V8_COVERAGE;

function parseCoverageObj(covdata) {
    const nodeModules = "node_modules";
    let coverage = {};

    for (const result of covdata.result) {
        if (
            result.url.indexOf(nodeModules) === -1 &&
            result.url.indexOf("file:///") !== -1 &&
            result.url.indexOf("runtime-insights.js") === -1
        ) {
            const relativeFile = result.url.slice("file://".length);
            if (!coverage[relativeFile]) coverage[relativeFile] = [];
            for (const fn of result.functions) {
                if (fn.isBlockCoverage) {
                    for (const r of fn.ranges) {
                        coverage[relativeFile].push([
                            r.startOffset,
                            r.endOffset,
                            r.count,
                        ]);
                    }
                }
            }
        }
    }
    return coverage;
}

class CoverageStorageManager {
    constructor() {
        this.data = {};
        this.fileMapping = {};
    }

    startCoverageForId(spanId) {
        v8.takeCoverage();
    }

    takeCoverageAndFindFile() {
        const before = fs.readdirSync(covdir);
        v8.takeCoverage();
        const after = fs.readdirSync(covdir);
        const newFiles = after.filter((x) => !before.includes(x));
        if (newFiles.length !== 1) {
            console.log(`ERROR: Found ${newFiles.length} coverage files, not 1`);
        }
        return newFiles[0];
    }

    getCoverageFromFile(filename) {
        if (typeof filename !== "string") {
            return null
        }
        const rawdata = fs.readFileSync(path.join(covdir, filename), { encoding: "utf8" });
        const covdata = JSON.parse(rawdata);
        return parseCoverageObj(covdata);
    }

    stopCollectingAndSaveCoverage(spanId) {
        const fileToUse = this.takeCoverageAndFindFile();
        if (fileToUse) {
            this.data[spanId] = fileToUse;
        }
    }

    popSpanCoverage(spanId) {
        let filename = this.data[spanId];
        delete this.data[spanId];
        return this.getCoverageFromFile(filename);
    }
}

class CoverageMappingManager {
    constructor() {
        this.exactLineMemoizer = {};
        this.lineLengthMemoizer = {};
    }

    getFileLineLengthMapper(filename) {
        if (!this.lineLengthMemoizer[filename]) {
            let indices = [];
            let lastLineBreak = 0;
            const bytes = fs.readFileSync(filename);
            let lineBreaks = [];
            for (const [index, element] of bytes.entries()) {
                if (element == 10) {
                    indices.push(index - lastLineBreak);
                    lastLineBreak = index;
                }
            }
            indices.push(bytes.length - lastLineBreak);
            this.lineLengthMemoizer[filename] = indices;
        }
        return this.lineLengthMemoizer[filename];
    }

    fetchLineArrayFromBytesRange(filename, byteStart, byteEnd) {
        const key = `${byteStart}:${byteEnd}`;
        if (!this.exactLineMemoizer[filename])
            this.exactLineMemoizer[filename] = {};
        if (!this.exactLineMemoizer[filename][key]) {
            const lengthMapper = this.getFileLineLengthMapper(filename);
            let current = 0;
            let currentInd = 0;
            while (current <= byteStart + 2) {
                current += lengthMapper[currentInd];
                currentInd += 1;
            }
            this.exactLineMemoizer[filename][key] = [currentInd];
            while (current < byteEnd - 2) {
                current += lengthMapper[currentInd];
                currentInd += 1;
                this.exactLineMemoizer[filename][key].push(currentInd);
            }
        }
        return this.exactLineMemoizer[filename][key];
    }

    processCoverage(coverageData) {
        let newCoverage = {};
        for (const filename in coverageData) {
            newCoverage[filename] = {};
            let pointer = newCoverage[filename];
            let filenameCoverageData = coverageData[filename];
            filenameCoverageData.sort((a, b) =>
                a[0] != b[0] ? a[0] - b[0] : b[1] - a[1]
            );
            for (const rangeInd in filenameCoverageData) {
                const range = filenameCoverageData[rangeInd];
                let byteStart, byteEnd, count;
                [byteStart, byteEnd, count] = range;
                let lineArray = this.fetchLineArrayFromBytesRange(
                    filename,
                    byteStart,
                    byteEnd
                );
                for (const lineNumberInd in lineArray) {
                    const lineNumber = lineArray[lineNumberInd];
                    pointer[lineNumber] = count;
                }
            }
        }
        return newCoverage;
    }
}

function replacer(key, value) {
    if (key.startsWith("_")) return undefined;
    else return value;
}

class CodecovExporter {
    constructor(options) {
        this.mappingManager = options.mappingManager;
        this.storageManager = options.storageManager;
        this.repositoryToken = options.repositoryToken;
        this.code = options.code;
        this.codecovEndpoint = options.codecovEndpoint;
        this.untrackedExportRate = options.untrackedExportRate;
    }
    export(spans, callback) {
        let trackedSpans = [];
        let untracked_spans = [];
        for (const spanKey in spans) {
            const span = spans[spanKey];
            let coverageData = this.storageManager.popSpanCoverage(
                span.spanContext().spanId
            );
            if (coverageData) {
                let processedCoverageData =
                    this.mappingManager.processCoverage(coverageData);
                trackedSpans.push({
                    ...span,
                    codecov: {
                        type: "bytes",
                        coverage: Buffer.from(
                            JSON.stringify({
                                coverage: processedCoverageData,
                            })
                        ).toString("base64"),
                    },
                });
            }
        }
        // Choosing to delete the coverage folder here, out of the
        // processing loop
        // It's arguable what benefit moving it does.
        // We don't even know if we need to call this
        fs.rmSync(covdir, { recursive: true });
        if (trackedSpans) {
            this.submitCoverageData(
                trackedSpans,
                this.code,
                (data) => {
                    // Done on purpose to check that we are calling
                    // this callback right
                    callback(data);
                }
            );
        }
    }

    postToStorage(location, finalString, callback) {
        const options = {
            method: "PUT",
            headers: {
                "Content-Type": "application/text",
                "Content-Length": finalString.length,
            },
        };
        const req = https
            .request(location, options, (res) => {
                let responseData = "";
                res.on("data", (chunk) => {
                    responseData += chunk;
                });
                res.on("end", () => {
                    callback({ code: ExportResult.SUCCESS });
                });
            })
            .on("error", (err) => {
                console.log("Error: ", err.message);
                callback({ code: ExportResult.FAILED_NOT_RETRYABLE });
            });

        req.write(finalString);
        req.end();
    }

    submitCoverageData(trackedSpans, code, callback) {
        const data = JSON.stringify({
            profiling: code,
        });

        const options = {
            hostname: this.codecovEndpoint,
            path: "/profiling/uploads",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": data.length,
                Authorization: `Repotoken ${this.repositoryToken}`,
            },
        };

        const req = https
            .request(options, (res) => {
                let responseData = "";
                res.on("data", (chunk) => {
                    responseData += chunk;
                });

                res.on("end", () => {
                    const parsedResponse = JSON.parse(responseData);
                    this.postToStorage(
                        parsedResponse.raw_upload_location,
                        JSON.stringify({ spans: trackedSpans }, replacer),
                        callback
                    );
                });
                //TODO: End
            })
            .on("error", (err) => {
                console.log("Error: ", err.message);
                callback({ code: ExportResult.FAILED_NOT_RETRYABLE });
            });

        req.write(data);
        req.end();
    }
}
class CodecovSpanProcessor {
    constructor(options) {
        this.storageManager = options.storageManager;
        this.sampleRate = options.sampleRate;
        this.filters = options.filters;
        this.lock = null;
        this.tracked = false;
    }

    _idFromSpan(span) {
        return span.spanContext().spanId;
    }

    _shouldSampleSpan(span) {
        if (this.filters) {
            if (
                this.filters.allowedSpanKinds &&
                !this.filters.allowedSpanKinds.includes(span.kind)
            ) {
                return false;
            }
        }
        return Math.random() < this.sampleRate;
    }

    // onStart flushes the buffer (begins to capture right away) and sets the
    // lock equal to the id of this span, but only if this span represents the
    // http request.
    onStart(span, context) {
        if (this.lock == null) {
            this.lock = this._idFromSpan(span);
            if (this._shouldSampleSpan(span)) {
                this.tracked = true;
                this.storageManager.startCoverageForId(this.lock);
            } else {
                this.lock = null;
            }
        }
    }

    // onEnd grabs coverage report. We really don't care if the buffer builds
    // up after that since we're going to clear it onStart. Also relinquish
    // the lock so we can capture another
    onEnd(span) {
        if (span.spanContext().spanId == this.lock) {
            if (this.tracked) {
                this.storageManager.stopCollectingAndSaveCoverage(
                    span.spanContext().spanId
                );
                this.tracked = false;
            }

            this.lock = null;
        }
    }
}

module.exports = {
    CodecovExporter,
    CoverageStorageManager,
    CoverageMappingManager,
    CodecovSpanProcessor,
    parseCoverageObj
};
