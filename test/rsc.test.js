const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractTextFromRscPayload } = require("../src/rsc.js");
const { classifyJobDescription } = require("../src/classifier.js");

// Captured live from the aboutTheJob SDUI endpoint (job 4469543175).
const payload = fs.readFileSync(
  path.join(__dirname, "fixtures", "about-the-job.rsc.txt"),
  "utf8"
);

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const text = extractTextFromRscPayload(payload);

check("extracts the sponsorship sentence", text.includes("will not sponsor a new applicant"));
check("extracts the experience requirement", text.includes("at least 3 years of Product Management experience"));
check("extracts prose from plain children arrays", text.includes("Currently has, or is in the process of obtaining"));
check("keeps unicode punctuation intact", text.includes("Master’s Degree"));

check("drops hashed classNames", !text.includes("_1a5401c6"), text.slice(0, 200));
check("drops RSC key names", !text.includes("text-attr-"));
check("drops RSC references", !/\$7|\$L\d/.test(text));
check("collapses whitespace", !/\s{2,}/.test(text));

// The point of the whole exercise: the classifier must reach the same verdict
// from this payload as it did from the rendered DOM.
const classification = classifyJobDescription(text);
check(
  "classifies sponsorship as matched/false",
  classification.sponsorship.status === "matched" && classification.sponsorship.sponsors === false,
  JSON.stringify(classification.sponsorship)
);
check(
  "classifies experience as matched with min 3",
  classification.experience.status === "matched" && classification.experience.min === 3,
  JSON.stringify(classification.experience)
);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
