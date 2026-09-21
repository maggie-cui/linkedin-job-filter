import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ANSWER_SCHEMAS, buildPrompt, extractSnippet, mergeLlmAnswer } from "./llm.js";

// Runs here rather than in the content script for two reasons: a content
// script calling api.anthropic.com would be cross-origin from linkedin.com,
// and the API key never has to exist in a context that shares a page with
// LinkedIn's own JavaScript.
const MODEL = "claude-opus-5";
// Each answer is a couple of numbers/booleans — this only needs to be big
// enough for adaptive thinking plus the JSON object.
const MAX_TOKENS = 1024;

// Clicking the toolbar icon opens the side panel. Set once on install
// rather than per-click, which is what the API expects.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

let cachedClient = null;
let cachedKey = null;

function getClient(apiKey) {
  if (cachedClient && cachedKey === apiKey) return cachedClient;
  // The extension runs on the user's own machine with their own key — the
  // "browser" this warns about is a page shipping a key to other people.
  cachedClient = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  cachedKey = apiKey;
  return cachedClient;
}

async function resolveAmbiguous(kind, description) {
  const { settings } = await chrome.storage.local.get("settings");
  const apiKey = settings?.anthropicApiKey?.trim();
  if (!apiKey) return { ok: false, reason: "no-api-key" };

  const snippet = extractSnippet(description, kind);
  if (!snippet) return { ok: false, reason: "no-snippet" };

  try {
    const response = await getClient(apiKey).messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Classification doesn't repay deep reasoning, and this runs per job.
      output_config: {
        effort: "low",
        format: zodOutputFormat(ANSWER_SCHEMAS[kind]),
      },
      messages: [{ role: "user", content: buildPrompt(kind, snippet) }],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, reason: "refusal" };
    }

    // parsed_output is null when the model's output didn't satisfy the schema.
    if (!response.parsed_output) return { ok: false, reason: "unparsed" };

    return { ok: true, result: mergeLlmAnswer(kind, response.parsed_output) };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, reason: "bad-api-key" };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: "rate-limited" };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: `api-error-${error.status}` };
    }
    return { ok: false, reason: "network-error" };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "resolve-ambiguous") return false;

  resolveAmbiguous(message.kind, message.description)
    .then(sendResponse)
    // Never let a rejection strand the content script waiting on a reply;
    // every failure path resolves to "couldn't decide", which the caller
    // treats as no-mention (i.e. show the job).
    .catch(() => sendResponse({ ok: false, reason: "unexpected-error" }));

  return true; // keeps the message channel open for the async reply
});
