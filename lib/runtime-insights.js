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

class CodecovExporter {
    export(spans, done) { }
}

class CodecovSpanProcessor {
    constructor(sample_rate) {
        this.sample_rate = sample_rate;
        this.lock = null;
    }

    _isHttp(span) {
        return span.instrumentationLibrary.name == '@opentelemetry/plugin-http';
    }

    _idFromSpan(span) {
        return span.spanContext.spanId;
    }

    _shouldSampleSpan() {
        return Math.random() < this.sample_rate;
    }

    // onStart flushes the buffer (begins to capture right away) and sets the
    // lock equal to the id of this span, but only if this span represents the
    // http request.
    onStart(span, context) {
        if (this.lock == null && this._isHttp(span) && this._shouldSampleSpan()) {
            this.lock = this._idFromSpan(span);
            console.info(`locked acquired by ${this._idFromSpan(span)}`);

            v8.takeCoverage();
            fs.rmSync(covdir, { recursive: true });
        }
        else {
            console.info(`lock ${this.lock} already present, skipping ${this._idFromSpan(span)}`)
        }
    }

    // onEnd grabs coverage report. We really don't care if the buffer builds
    // up after that since we're going to clear it onStart. Also relinquish
    // the lock so we can capture another
    onEnd(span) {
        setTimeout(() => {
            if (span.spanContext.spanId == this.lock) {
                v8.takeCoverage();
                const coverage = snapshot();
                console.log(coverage);
                fs.rmSync(covdir, { recursive: true });

                this.lock = null;
                console.info(`lock relinquished by ${this._idFromSpan(span)}`);
            }
        }, 100);
    }
}

const provider = new NodeTracerProvider();

provider.register();

const processor = new CodecovSpanProcessor(1, new CodecovExporter());
provider.addSpanProcessor(processor);
console.log('tracing initialized');

