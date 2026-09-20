// Pure regex-based classification of job description text — no DOM or
// extension APIs here, so it stays testable in isolation and gives Phase 3's
// LLM fallback a stable function boundary to slot into.

const NO_SPONSORSHIP_PATTERNS = [
  /\bnot\s+(?:able|eligible)\s+to\s+(?:provide|offer)?\s*sponsor(?:ship)?\b/i,
  /\bunable\s+to\s+(?:provide|offer)?\s*sponsor(?:ship)?\b/i,
  /\b(?:cannot|can't|will not|won't|does not|doesn't)\s+sponsor\b/i,
  /\bno\s+(?:visa\s+)?sponsorship\b/i,
  /\bsponsorship\s+(?:is\s+)?not\s+(?:available|provided|offered)\b/i,
  /\bwithout\s+sponsorship\b/i,
  /\bmust\s+be\s+authorized\s+to\s+work[^.]{0,40}without\s+(?:the\s+need\s+for\s+)?sponsorship\b/i,
];

function extractExperience(text) {
  if (!text) return { status: "no-mention" };

  const range = text.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\+?\s*years?/i);
  if (range) return { status: "matched", min: Number(range[1]) };

  const plusYears = text.match(/(\d{1,2})\s*\+\s*years?/i);
  if (plusYears) return { status: "matched", min: Number(plusYears[1]) };

  const minimumOf = text.match(/(?:minimum(?: of)?|at least)\s*(\d{1,2})\s*years?/i);
  if (minimumOf) return { status: "matched", min: Number(minimumOf[1]) };

  const requiredAfter = text.match(/(\d{1,2})\s*years?\s*(?:of experience)?\s*(?:required|minimum)\b/i);
  if (requiredAfter) return { status: "matched", min: Number(requiredAfter[1]) };

  const preferred = text.match(/(\d{1,2})\s*\+?\s*years?[^.]{0,20}preferred/i);
  if (preferred) return { status: "ambiguous", min: Number(preferred[1]), reason: "preferred-only" };

  const anyYears = text.match(/(\d{1,2})\s*\+?\s*years?/i);
  if (anyYears) return { status: "ambiguous", min: Number(anyYears[1]), reason: "unrecognized-pattern" };

  return { status: "no-mention" };
}

function extractSponsorship(text) {
  if (!text) return { status: "no-mention" };

  if (NO_SPONSORSHIP_PATTERNS.some((re) => re.test(text))) {
    return { status: "matched", sponsors: false };
  }

  if (/sponsor/i.test(text)) return { status: "ambiguous" };

  return { status: "no-mention" };
}

// Stable return shape — Phase 3's LLM fallback plugs into this boundary.
function classifyJobDescription(text) {
  return {
    experience: extractExperience(text),
    sponsorship: extractSponsorship(text),
  };
}

// Loaded as a plain global-scope script by manifest.json's content_scripts,
// where `module` doesn't exist — this only runs under Node (the test file).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractExperience, extractSponsorship, classifyJobDescription };
}
