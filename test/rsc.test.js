import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractTextFromRscPayload } from "../src/rsc.js";
import { classifyJobDescription } from "../src/classifier.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Captured live from the aboutTheJob SDUI endpoint (job 4469543175).
const payload = readFileSync(path.join(here, "fixtures", "about-the-job.rsc.txt"), "utf8");
const text = extractTextFromRscPayload(payload);

describe("extractTextFromRscPayload", () => {
  it("extracts the sponsorship sentence", () => {
    expect(text).toContain("will not sponsor a new applicant");
  });

  it("extracts the experience requirement", () => {
    expect(text).toContain("at least 3 years of Product Management experience");
  });

  it("extracts prose from plain children arrays", () => {
    expect(text).toContain("Currently has, or is in the process of obtaining");
  });

  it("keeps unicode punctuation intact", () => {
    expect(text).toContain("Master’s Degree");
  });

  it("drops scaffolding", () => {
    expect(text).not.toContain("_1a5401c6");
    expect(text).not.toContain("text-attr-");
    expect(text).not.toMatch(/\$7|\$L\d/);
  });

  it("collapses whitespace", () => {
    expect(text).not.toMatch(/\s{2,}/);
  });
});

describe("end to end", () => {
  it("reaches the same verdict the rendered DOM did", () => {
    expect(classifyJobDescription(text)).toEqual({
      experience: { status: "matched", min: 3 },
      sponsorship: { status: "matched", sponsors: false },
    });
  });
});
