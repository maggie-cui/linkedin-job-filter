import { describe, expect, it } from "vitest";
import { ANSWER_SCHEMAS, buildPrompt, extractSnippet, mergeLlmAnswer } from "../src/llm.js";

const LONG_PREFIX = "Filler sentence about the company. ".repeat(40);
const LONG_SUFFIX = " Trailing boilerplate about benefits.".repeat(40);

describe("extractSnippet", () => {
  it("returns only the region around the experience match", () => {
    const text = `${LONG_PREFIX}We want 5 years preferred for this role.${LONG_SUFFIX}`;
    const snippet = extractSnippet(text, "experience");

    expect(snippet).toContain("5 years preferred");
    // The point of snippeting: a fraction of the description, not all of it.
    expect(snippet.length).toBeLessThan(text.length / 2);
  });

  it("returns only the region around the sponsorship match", () => {
    const text = `${LONG_PREFIX}We proudly sponsor the local marathon.${LONG_SUFFIX}`;
    const snippet = extractSnippet(text, "sponsorship");

    expect(snippet).toContain("sponsor the local marathon");
    expect(snippet.length).toBeLessThan(text.length / 2);
  });

  it("does not cut words in half at either edge", () => {
    const text = `${LONG_PREFIX}needs 7 years minimum${LONG_SUFFIX}`;
    const snippet = extractSnippet(text, "experience");

    expect(text).toContain(snippet);
    expect(snippet).toMatch(/^\S/);
    expect(snippet).toMatch(/\S$/);
  });

  it("falls back to the head of the text when nothing matches", () => {
    expect(extractSnippet("no numbers here at all", "experience")).toBe("no numbers here at all");
  });

  it("handles empty input", () => {
    expect(extractSnippet("", "experience")).toBe("");
  });
});

describe("buildPrompt", () => {
  it("embeds the snippet and asks a single narrow question", () => {
    const prompt = buildPrompt("experience", "5 years preferred");
    expect(prompt).toContain("5 years preferred");
    expect(prompt).toMatch(/required minimum/i);
  });

  it("tells the model to ignore non-visa uses of 'sponsor'", () => {
    const prompt = buildPrompt("sponsorship", "we sponsor a 5k race");
    expect(prompt).toContain("we sponsor a 5k race");
    expect(prompt).toMatch(/not actually about visa sponsorship/i);
  });
});

describe("mergeLlmAnswer", () => {
  it("maps a stated minimum into the Phase 2 matched shape", () => {
    expect(mergeLlmAnswer("experience", { minYears: 5 })).toEqual({
      status: "matched",
      min: 5,
      resolvedBy: "llm",
    });
  });

  it("maps 'no required minimum' to no-mention", () => {
    expect(mergeLlmAnswer("experience", { minYears: null })).toEqual({
      status: "no-mention",
      resolvedBy: "llm",
    });
  });

  it("maps a refusal to sponsor into the matched shape", () => {
    expect(mergeLlmAnswer("sponsorship", { sponsors: false })).toEqual({
      status: "matched",
      sponsors: false,
      resolvedBy: "llm",
    });
  });

  it("keeps 'will sponsor' as matched so it is never hidden", () => {
    expect(mergeLlmAnswer("sponsorship", { sponsors: true })).toEqual({
      status: "matched",
      sponsors: true,
      resolvedBy: "llm",
    });
  });

  it("maps an unclear answer to no-mention", () => {
    expect(mergeLlmAnswer("sponsorship", { sponsors: null })).toEqual({
      status: "no-mention",
      resolvedBy: "llm",
    });
  });

  it("treats a missing answer as no-mention rather than throwing", () => {
    expect(mergeLlmAnswer("experience", null)).toEqual({
      status: "no-mention",
      resolvedBy: "llm",
    });
  });
});

describe("ANSWER_SCHEMAS", () => {
  it("accepts the shapes the prompts ask for", () => {
    expect(ANSWER_SCHEMAS.experience.parse({ minYears: 3 })).toEqual({ minYears: 3 });
    expect(ANSWER_SCHEMAS.experience.parse({ minYears: null })).toEqual({ minYears: null });
    expect(ANSWER_SCHEMAS.sponsorship.parse({ sponsors: false })).toEqual({ sponsors: false });
  });

  it("rejects out-of-range or wrong-typed answers", () => {
    expect(() => ANSWER_SCHEMAS.experience.parse({ minYears: 999 })).toThrow();
    expect(() => ANSWER_SCHEMAS.experience.parse({ minYears: "five" })).toThrow();
    expect(() => ANSWER_SCHEMAS.sponsorship.parse({ sponsors: "no" })).toThrow();
  });
});
