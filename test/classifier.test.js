const assert = require("node:assert/strict");
const { extractExperience, extractSponsorship, classifyJobDescription } = require("../src/classifier.js");

const experienceCases = [
  ["5+ years of experience required", { status: "matched", min: 5 }],
  ["3-5 years of relevant experience", { status: "matched", min: 3 }],
  ["minimum of 4 years experience", { status: "matched", min: 4 }],
  ["at least 2 years experience", { status: "matched", min: 2 }],
  ["6 years required", { status: "matched", min: 6 }],
  ["5 years preferred", { status: "ambiguous", min: 5, reason: "preferred-only" }],
  ["experience: 3 years in a related field", { status: "ambiguous", min: 3, reason: "unrecognized-pattern" }],
  ["we are looking for a great teammate", { status: "no-mention" }],
  ["", { status: "no-mention" }],
];

const sponsorshipCases = [
  ["We are unable to sponsor visas at this time.", { status: "matched", sponsors: false }],
  ["No visa sponsorship is available for this role.", { status: "matched", sponsors: false }],
  ["This role does not sponsor employment visas.", { status: "matched", sponsors: false }],
  ["You must be authorized to work in the US without sponsorship.", { status: "matched", sponsors: false }],
  ["We are happy to discuss sponsor opportunities with candidates.", { status: "ambiguous" }],
  ["Great benefits and a fun team culture.", { status: "no-mention" }],
  ["", { status: "no-mention" }],
];

const combinedCases = [
  [
    "We're looking for someone with 5+ years of experience. Unfortunately we are unable to sponsor visas for this role.",
    { experience: { status: "matched", min: 5 }, sponsorship: { status: "matched", sponsors: false } },
  ],
];

let passed = 0;
let failed = 0;

function run(label, cases, fn) {
  for (const [input, expected] of cases) {
    const actual = fn(input);
    try {
      assert.deepEqual(actual, expected);
      passed++;
    } catch {
      failed++;
      console.error(`FAIL [${label}] ${JSON.stringify(input)}`);
      console.error(`  expected: ${JSON.stringify(expected)}`);
      console.error(`  actual:   ${JSON.stringify(actual)}`);
    }
  }
}

run("extractExperience", experienceCases, extractExperience);
run("extractSponsorship", sponsorshipCases, extractSponsorship);
run("classifyJobDescription", combinedCases, classifyJobDescription);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
