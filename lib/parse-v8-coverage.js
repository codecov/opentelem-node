const fs = require('fs');
const path = require('path');

// getLineNo returns one-index line number given
// filename and zero-indexed character number
function getLineNo(filename, cNo) {
    const bytes = fs.readFileSync(filename);

    let line = 1; // count lines
    let ctr = 0;  // count characters
    for (const b of bytes) {
        if (ctr == cNo) {
            return line;
        }

        if (b == 10) {
            line += 1;
        }
        ctr += 1;
    }

    throw new Error("bad character index")
}

function parseCoverageObj(covdata, prefix) {
    const nodeModules = path.join(prefix, 'node_modules');
    const coverage = {};

    for (const result of covdata.result) {
        if ((result.url.indexOf(nodeModules) === -1) && (result.url.indexOf('file:///') !== -1)) {
            const relativeFile = result.url.slice("file://".length + prefix.length)

            for (const fn of result.functions) {
                for (const r of fn.ranges) {
                    if (r.count > 0) {
                        const startLn = getLineNo(relativeFile, r.startOffset);
                        const endLn = getLineNo(relativeFile, r.endOffset);

                        if (!coverage[relativeFile]) coverage[relativeFile] = {};

                        const lines = `${startLn}:${endLn}`;
                        coverage[relativeFile][lines] = r.count;
                    }
                }
            }
        }
    }

    return coverage;
}

module.exports = {
    getLineNo,
    parseCoverageObj,
};


