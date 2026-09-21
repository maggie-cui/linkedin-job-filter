import { describe, expect, it } from "vitest";
import { extractExperience, extractSponsorship, classifyJobDescription } from "../src/classifier.js";

describe("extractExperience", () => {
  it.each([
    ["5+ years of experience required", { status: "matched", min: 5 }],
    ["3-5 years of relevant experience", { status: "matched", min: 3 }],
    ["minimum of 4 years experience", { status: "matched", min: 4 }],
    ["at least 2 years experience", { status: "matched", min: 2 }],
    ["6 years required", { status: "matched", min: 6 }],
    ["5 years preferred", { status: "ambiguous", min: 5, reason: "preferred-only" }],
    ["experience: 3 years in a related field", { status: "ambiguous", min: 3, reason: "unrecognized-pattern" }],
    ["we are looking for a great teammate", { status: "no-mention" }],
    ["", { status: "no-mention" }],
  ])("%s", (input, expected) => {
    expect(extractExperience(input)).toEqual(expected);
  });
});

describe("extractSponsorship", () => {
  it.each([
    ["We are unable to sponsor visas at this time.", { status: "matched", sponsors: false }],
    ["No visa sponsorship is available for this role.", { status: "matched", sponsors: false }],
    ["This role does not sponsor employment visas.", { status: "matched", sponsors: false }],
    ["You must be authorized to work in the US without sponsorship.", { status: "matched", sponsors: false }],
    ["We are happy to discuss sponsor opportunities with candidates.", { status: "ambiguous" }],
    ["Great benefits and a fun team culture.", { status: "no-mention" }],
    ["", { status: "no-mention" }],
  ])("%s", (input, expected) => {
    expect(extractSponsorship(input)).toEqual(expected);
  });
});

describe("classifyJobDescription", () => {
  it("combines both extractors", () => {
    expect(
      classifyJobDescription(
        "We're looking for someone with 5+ years of experience. Unfortunately we are unable to sponsor visas for this role."
      )
    ).toEqual({
      experience: { status: "matched", min: 5 },
      sponsorship: { status: "matched", sponsors: false },
    });
  });
});
