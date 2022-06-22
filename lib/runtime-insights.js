"use strict";

const https = require("http");
const {
    CoverageStorageManager,
    CoverageMappingManager,
    CodecovExporter,
    CodecovSpanProcessor,
} = require("./utils.js");

class CodeCovOpenTelemetry {
    constructor(config) {
        console.log('i am a banana');
        const code = config.code;
        const codecovEndpoint = config.codecovEndpoint || "api.codecov.io";
        const environment = config.environment || null;
        const filters = config.filters || [];
        const needsVersionCreation = config.needsVersionCreation || true;
        const repositoryToken = config.repositoryToken;
        const sampleRate = config.sampleRate;
        const untrackedExportRate = config.untrackedExportRate;
        const versionIdentifier = config.versionIdentifier || null;
        if (needsVersionCreation && versionIdentifier && environment && code) {
            this._createVersion(
                codecovEndpoint,
                versionIdentifier,
                environment,
                repositoryToken,
                code
            );
        }
        let storageManager = new CoverageStorageManager();
        let mappingManager = new CoverageMappingManager();
        this.exporter = new CodecovExporter({
            mappingManager,
            storageManager,
            repositoryToken,
            code,
            codecovEndpoint,
            untrackedExportRate,
        });
        this.processor = new CodecovSpanProcessor({
            storageManager,
            sampleRate,
            filters: config.filters,
        });
    }

    _createVersion(
        codecovEndpoint,
        versionIdentifier,
        environment,
        repositoryToken,
        code
    ) {
        const data = JSON.stringify({
            version_identifier: versionIdentifier,
            environment: environment,
            code: code,
        });

        const options = {
            hostname: codecovEndpoint,
            path: "/profiling/versions",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": data.length,
                Authorization: `Repotoken ${repositoryToken}`,
            },
        };

        const req = https
            .request(options, (res) => {
                let responseData = "";
                res.on("data", (chunk) => {
                    responseData += chunk;
                });

                res.on("end", () => {
                    if (res.statusCode >= 300) {
                        console.log(
                            `Unable to create version at codecov: Status code ${res.statusCode} - ${responseData}`
                        );
                        throw "Unable to create version at codecov: bad status code";
                    }
                });
            })
            .on("error", (err) => {
                console.log(
                    "Unable to create version at codecov: ",
                    err.message
                );
                throw "Unable to create version at codecov";
            });

        req.write(data);
        req.end();
    }
}

module.exports = {
    CodeCovOpenTelemetry,
};
