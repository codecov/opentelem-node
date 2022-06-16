const utils = require("../lib/utils.js");

test("parseCoverageObj works", () => {
  const subject = {
    result: [
      {
        scriptId: "115",
        url: "file:///Users/thiagorramos/Projects/opentelem-node/examples/app.js",
        functions: [
          {
            functionName: "",
            ranges: [
              {
                startOffset: 1062,
                endOffset: 1107,
                count: 1,
              },
            ],
            isBlockCoverage: true,
          },
        ],
      },
    ],
  };
  const expectedResult = {
    "/Users/thiagorramos/Projects/opentelem-node/examples/app.js": [
      [1062, 1107, 1],
    ],
  };
  expect(utils.parseCoverageObj(subject)).toStrictEqual(expectedResult);
});
