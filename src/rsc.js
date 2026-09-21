// LinkedIn serves job descriptions as React Server Components "flight"
// payloads, not HTML — rows like:
//   ["$","em","text-attr-9",{"children":["At this time, Capital One will not sponsor..."]}]
// The prose sits in ordinary JSON string literals, interleaved with
// scaffolding (tag names, hashed classNames, "$"-prefixed RSC references).
// Rather than parse the RSC row/reference format — which is undocumented and
// would break the moment React changes it — this pulls every JSON string out
// of the payload and drops the ones that are obviously structural. Over-
// inclusion is safe here: the output is only ever regex-matched for "N years"
// and sponsorship phrasing, and scaffolding never contains either.

const MODULE_ID_RE = /^[0-9a-f]{32}$/;
const HASHED_CLASSNAMES_RE = /^_?[0-9a-f]{6,}(\s+_?[0-9a-f]{6,})*$/;
const TAG_NAME_RE = /^[a-z][a-z0-9]{0,5}$/;
const RSC_KEY_RE = /^text-attr-\d+$/;

function isProse(value) {
  if (!value) return false;
  if (value.startsWith("$")) return false; // RSC refs: $L2, $7, $undefined
  if (RSC_KEY_RE.test(value)) return false;
  if (TAG_NAME_RE.test(value)) return false; // li, ul, em, br, div…
  if (HASHED_CLASSNAMES_RE.test(value)) return false;
  if (MODULE_ID_RE.test(value)) return false;
  return /\s/.test(value) || value.length > 12;
}

// Text arrives split across chunks (bold/line breaks fragment a sentence), so
// joining in payload order reconstructs the reading flow well enough for the
// classifier's patterns, which tolerate arbitrary whitespace.
function extractTextFromRscPayload(payload) {
  if (!payload) return "";

  const strings = [];
  const stringLiteral = /"((?:[^"\\]|\\.)*)"/g;
  let match;

  while ((match = stringLiteral.exec(payload)) !== null) {
    let value;
    try {
      value = JSON.parse(`"${match[1]}"`);
    } catch {
      continue;
    }
    if (isProse(value)) strings.push(value);
  }

  return strings.join(" ").replace(/\s+/g, " ").trim();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractTextFromRscPayload };
}
