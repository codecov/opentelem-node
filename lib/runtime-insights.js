'use strict';

const fs = require('fs');
const path = require('path');
const v8 = require('v8');

const { parseCoverageObj } = require('./parse-v8-coverage.js');

const { NodeTracerProvider } = require('@opentelemetry/node');

const covdir = process.env.NODE_V8_COVERAGE;

// NOTE: The prefix is best obtained using the line below, but for brevity
// I'm just going to assume, for this project, that the prefix will always
// be this current directory (this will be the case 99% of the time)
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

class CodecovExporterSimple {
    export(spans, done) { }
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

        for (const span in spans) {
            // if span.getAttributes()
            console.log(span.getAttributes())

        }
    }
    //     def export(self, spans):
    //         tracked_spans = []
    //         untracked_spans = []
    //         for span in spans:
    //             cov = self._cov_storage.pop_cov_for_span(span)
    //             s = json.loads(span.to_json())
    //             if cov is not None:
    //                 s["codecov"] = self._load_codecov_dict(span, cov)
    //                 tracked_spans.append(s)
    //             else:
    //                 if random.random() < self._untrackedExportRate:
    //                     untracked_spans.append(s)
    //         if not tracked_spans and not untracked_spans:
    //             return SpanExportResult.SUCCESS
    //         url = urllib.parse.urljoin(self._codecovEndpoint, "/profiling/uploads")
    //         try:
    //             res = requests.post(
    //                 url,
    //                 headers={"Authorization": f"repotoken {self._repositoryToken}"},
    //                 json={"profiling": self._code},
    //             )
    //             res.raise_for_status()
    //         except requests.RequestException:
    //             log.warning(
    //                 "Unable to send profiling data to codecov",
    //                 extra=dict(response_data=res.json())
    //             )
    //             return SpanExportResult.FAILURE
    //         location = res.json()["raw_upload_location"]
    //         requests.put(
    //             location,
    //             headers={"Content-Type": "text/plain"},
    //             data=json.dumps(
    //                 {"spans": tracked_spans, "untracked": untracked_spans}
    //             ).encode(),
    //         )
    //         return SpanExportResult.SUCCESS
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

    // onStart flushes the buffer (begins to capture right away) and sets the
    // lock equal to the id of this span, but only if this span represents the
    // http request.
    onStart(span, context) {
        console.log('onStart')
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
                    console.log(coverage);
                    span.setAttribute('coverage', convertCoverage(coverage));
                    fs.rmSync(covdir, { recursive: true });
                    this.tracked = false;
                }

                this.lock = null;
                console.info(`Lock relinquished by ${this._idFromSpan(span)}`);
            }
        }, 100);
    }
}

function createVersion(codecovEndpoint, versionIdentifier, environment, repositoryToken) {
    // use native https to avoid requiring users to install a specific client
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

function initOpenTelemetry(repositoryToken, sampleRate, untrackedExportRate, code, filters = [], versionIdentifier = null, environment = null, needsVersionCreation = true, codecovEndpoint = "localhost") {
    if (needsVersionCreation && versionIdentifier && environment) {
        createVersion(codecovEndpoint, versionIdentifier, environment, repositoryToken);
    }
    //TODO: Add filters support

    const exporter = new CodecovExporter(repositoryToken, code, codecovEndpoint, untrackedExportRate);
    const processor = new CodecovSpanProcessor(sampleRate, exporter);
    const provider = new NodeTracerProvider();
    provider.register();
    provider.addSpanProcessor(processor);
    console.log("provider setup")
    return provider
}


module.exports = {
    initOpenTelemetry,
};



