'use strict';

const fs = require('fs');
const path = require('path');
const v8 = require('v8');

const { parseCoverageObj } = require('./parse-v8-coverage.js');

const { NodeTracerProvider } = require('@opentelemetry/node');

const covdir = process.env.NODE_V8_COVERAGE;

//TODO: Grab current dir programmatically  using a variation of 
// execute('npm prefix', p => prefix = p.trim());
const prefix = '/home/stensby/Code/opentelem-node/';
function snapshot(callback) {
    const files = fs.readdirSync(covdir);
    if (files.length !== 1) {
        return callback(new Error(`found ${files.length} coverage files, not 1`), null);
    }

    const rawdata = fs.readFileSync(path.join(covdir, files[0]));
    const covdata = JSON.parse(rawdata);
    const parsed = parseCoverageObj(covdata, prefix);

    return parsed;
}

class CodecovExporter {
    constructor(repositoryToken, code, codecovEndpoint, untrackedExportRate) {
        this.repositoryToken = repositoryToken;
        this.code = code;
        this.codecovEndpoint = codecovEndpoint;
        this.untrackedExportRate = untrackedExportRate;
    }
    export(spans) {
        let tracked_spans = [];
        let untracked_spans = [];
        console.log("Export");

        for (const span in spans) {
            console.log(span.getAttributes());
            // if (span.getAttributes().includes("coverage")) {
            //     tracked_spans.push(span);
            // }
            // else {
            //     if (Math.random() < this.untrackedExportRate){
            //         untracked_spans.push(span);
            //     } 
            // }
            // TODO: Post spans if present

        }
    }
}
class CodecovSpanProcessor {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.lock = null;
        this.tracked = false;
    }

    _isHttp(span) {
        return span.instrumentationLibrary.name == '@opentelemetry/plugin-http';
    }

    _idFromSpan(span) {
        return span.spanContext.spanId;
    }

    _shouldSampleSpan() {
        return Math.random() < this.sampleRate;
    }

    _convertCoverage(coverage) {
        //TODO: Convert coverage to correct format for upload - or do in parse-v8-coverage directly
        return coverage;
    }

    // onStart flushes the buffer (begins to capture right away) and sets the
    // lock equal to the id of this span, but only if this span represents the
    // http request.
    onStart(span, context) {
        if (this.lock == null && this._isHttp(span)) {
            this.lock = this._idFromSpan(span);
            console.info(`Lock acquired by ${this._idFromSpan(span)}`);

            if (this._shouldSampleSpan()) {
                this.tracked = true;
                v8.takeCoverage();
                fs.rmSync(covdir, { recursive: true });
            }
        }
        else {
            console.info(`Skipping ${this._idFromSpan(span)}`)
        }
    }

    // onEnd grabs coverage report. We really don't care if the buffer builds
    // up after that since we're going to clear it onStart. Also relinquish
    // the lock so we can capture another
    onEnd(span) {
        setTimeout(() => {
            if (span.spanContext.spanId == this.lock) {
                if (this.tracked) {
                    v8.takeCoverage();
                    const coverage = snapshot();
                    console.log("Setting coverage");
                    //TODO: Runtime error when trying to setAttribute in `onEnd`, need to do this sooner?
                    span.setAttribute('coverage', this._convertCoverage(coverage));
                    console.log("Coverage set");
                    fs.rmSync(covdir, { recursive: true });
                    this.tracked = false;
                }

                this.lock = null;
                console.info(`Lock relinquished by ${this._idFromSpan(span)}`);
            }
        }, 100);
    }
}
class CodeCovOpenTelemetry {
    constructor(repositoryToken, sampleRate, untrackedExportRate, code, filters = [], versionIdentifier = null, environment = null, needsVersionCreation = true, codecovEndpoint = "localhost") {
        if (needsVersionCreation && versionIdentifier && environment) {
            this._createVersion(codecovEndpoint, versionIdentifier, environment, repositoryToken);
        }
        // TODO: Add filters support

        this.provider = new NodeTracerProvider();
        this.provider.register();

        this.exporter = new CodecovExporter(repositoryToken, code, codecovEndpoint, untrackedExportRate);
        this.processor = new CodecovSpanProcessor(sampleRate, this.exporter);
        this.provider.addSpanProcessor(this.processor);
        console.log('Tracing initialized');
    }

    _createVersion(codecovEndpoint, versionIdentifier, environment, repositoryToken) {
        // Use native https to avoid requiring users to install a specific client
        const https = require('https');

        const data = JSON.stringify({
            version_identifier: versionIdentifier,
            environment: environment,
            code: code,
        });

        const options = {
            hostname: codecovEndpoint,
            path: '/profiling/versions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length,
                'Authorization': `repotoken ${repositoryToken}`
            }
        };


        const req = https.request(options, (res) => {
            //TODO: Remove this extra logging once debugging done
            let data = '';

            console.log('Status Code:', res.statusCode);

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log('Body: ', JSON.parse(data));
            });
            //TODO: End

        }).on("error", (err) => {
            console.log("Error: ", err.message);
        });

        req.write(data);
        req.end();
    }
}

module.exports = {
    CodeCovOpenTelemetry
};
