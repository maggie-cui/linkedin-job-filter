import { z } from "zod";

// Only the text around the ambiguous match is sent, never the whole
// description — it keeps each call to a few hundred tokens and gives the
// model exactly the passage the regex couldn't decide.
const SNIPPET_RADIUS = 300;

const MATCH_PATTERNS = {
  experience: /\d{1,2}\s*\+?\s*years?/i,
  sponsorship: /sponsor/i,
};

export const ANSWER_SCHEMAS = {
  // null = no required minimum stated.
  experience: z.object({
    minYears: z.number().int().min(0).max(50).nullable(),
  }),
  // false = explicitly will not sponsor; true = explicitly will; null = unclear.
  sponsorship: z.object({
    sponsors: z.boolean().nullable(),
  }),
};

const PROMPTS = {
  experience: (snippet) =>
    `Here is an excerpt from a job posting:\n\n${snippet}\n\n` +
    `Does this state a REQUIRED minimum number of years of experience for this role? ` +
    `A number that is only "preferred", "nice to have", "a plus", or that describes the ` +
    `company/team rather than a requirement for the candidate, is NOT a required minimum. ` +
    `Report the required minimum in years, or null if there is no required minimum.`,

  sponsorship: (snippet) =>
    `Here is an excerpt from a job posting:\n\n${snippet}\n\n` +
    `Does the employer state whether they sponsor work visas for this role? ` +
    `Report false if they say they will NOT sponsor, true if they say they WILL sponsor, ` +
    `and null if it is unclear or the text is not actually about visa sponsorship for ` +
    `this role (for example, a corporate sponsorship of an event).`,
};

// Grabs the passage around the term the regex tripped on, snapped outward to
// whitespace so the model never sees a word cut in half.
export function extractSnippet(text, kind) {
  if (!text) return "";

  const match = text.match(MATCH_PATTERNS[kind]);
  if (!match) return text.slice(0, SNIPPET_RADIUS * 2).trim();

  const start = Math.max(0, match.index - SNIPPET_RADIUS);
  const end = Math.min(text.length, match.index + match[0].length + SNIPPET_RADIUS);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = snippet.replace(/^\S*\s/, "");
  if (end < text.length) snippet = snippet.replace(/\s\S*$/, "");

  return snippet.trim();
}

export function buildPrompt(kind, snippet) {
  return PROMPTS[kind](snippet);
}

// Folds the model's answer back into the exact shape Phase 2 established, so
// shouldHideJob() needs no knowledge of where a verdict came from. resolvedBy
// is additive — it only rides along on LLM-resolved results.
export function mergeLlmAnswer(kind, answer) {
  if (!answer) return { status: "no-mention", resolvedBy: "llm" };

  if (kind === "experience") {
    return typeof answer.minYears === "number"
      ? { status: "matched", min: answer.minYears, resolvedBy: "llm" }
      : { status: "no-mention", resolvedBy: "llm" };
  }

  return typeof answer.sponsors === "boolean"
    ? { status: "matched", sponsors: answer.sponsors, resolvedBy: "llm" }
    : { status: "no-mention", resolvedBy: "llm" };
}
