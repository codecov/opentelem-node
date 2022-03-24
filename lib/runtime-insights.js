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
  export(spans, done) {}
}

class CodecovSpanProcessorSimple {
    lock = null;

    _isHttp(span) {
        return span.instrumentationLibrary.name == '@opentelemetry/plugin-http';
    }

    _idFromSpan(span) {
        return span.spanContext.spanId;
    }

    // onStart flushes the buffer (begins to capture right away) and sets the
    // lock equal to the id of this span, but only if this span represents the
    // http request.
    onStart(span, context) {
        if (this.lock == null && this._isHttp(span)) {
            this.lock = this._idFromSpan(span);;
            console.info(`locked acquired by ${this._idFromSpan(span)}`);
            
            v8.takeCoverage();
            fs.rmSync(covdir, { recursive: true });
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
                console.info(`locked relinquished by ${this._idFromSpan(span)}`);
            }
        }, 100);
    }
}
class CodeCovOpenTelemetry {
    constructor(repositoryToken, sampleRate, untrackedExportRate, code, filters = [], versionIdentifier = null, environment = null, needsVersionCreation = true, codecovEndpoint = "localhost") {
        // if (needsVersionCreation && versionIdentifier && environment) {
        //     createVersion(codecovEndpoint, versionIdentifier, environment, repositoryToken);
        // }
        // TODO: Add filters support

        this.provider = new NodeTracerProvider();
        this.provider.register();
        
        // this.exporter = new CodecovExporter(repositoryToken, code, codecovEndpoint, untrackedExportRate);
        // this.processor = new CodecovSpanProcessor(sampleRate, this.exporter);
        this.processor = new CodecovSpanProcessorSimple(new CodecovExporterSimple());
        this.provider.addSpanProcessor(this.processor);
        console.log('Tracing initialized');    
    }
}

module.exports = {
    CodeCovOpenTelemetry
};