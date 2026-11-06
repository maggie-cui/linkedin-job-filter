# LinkedIn Job Filter

**A Chrome extension that filters LinkedIn job search by the two criteria that
actually decide whether a posting is worth reading — required years of
experience and visa sponsorship — neither of which LinkedIn lets you filter
on.**

Both facts live in the free-text job description, so the only way to apply
them is to read every posting. This extension reads them for you: it pulls the
full description of every job on the page without you clicking into any of
them, extracts a numeric experience minimum and the employer's sponsorship
stance, and hides the ones that don't match.

---

## The problem

LinkedIn's search filters cover title, location, date posted, company,
workplace type, and an "Experience level" dropdown. That dropdown reads a
field the *employer* selects when posting — not the description — so
"Entry level" routinely returns postings whose text asks for five or more
years. Visa sponsorship isn't a filter at all; you find out in the last
paragraph, after you've read the whole thing.

The information exists. It just isn't structured, so it isn't filterable.

## What it does

- **Reads every loaded card's description in the background.** No clicking
  through postings one at a time — that was the whole point.
- **Extracts a number, not a vibe.** `"5+ years"`, `"minimum of 3 years"`,
  `"3-5 years"` all resolve to an integer you can compare against.
- **Reads the sponsorship stance.** Distinguishes "we will not sponsor" from
  the word "sponsor" appearing in some unrelated sentence.
- **Hides what doesn't match**, and keeps working as you scroll and as new
  cards load.
- **Escalates only genuine ambiguity to an LLM**, so the common cases stay
  free and instant.

Settings live in a docked side panel: minimum years of experience, a
sponsorship toggle, a lookup budget, and an optional API key.

## How it works

```
LinkedIn job search page
        │
        ▼
   content.js ── MutationObserver, throttled to 500ms
        │        finds cards via [componentkey^="job-card-component-ref-"]
        │
        ├─ seen before? ──► chrome.storage.local cache ──────────────┐
        │                                                            │
        ▼                                                            │
   description lookup                                                │
   POST /flagship-web/rsc-action/actions/component                   │
   (LinkedIn's own SDUI endpoint — sequential, 1.5s apart,           │
    30 per 5 min, aborts and backs off on HTTP 429)                  │
        │                                                            │
        ▼                                                            │
   rsc.js ── pull prose out of the React Server Components payload   │
        │                                                            │
        ▼                                                            │
   classifier.js ── regex pass ──► matched ────────────────────────┐ │
        │                                                          │ │
        └─ ambiguous ──► background.js (service worker)            │ │
                          └─► Claude API, structured output,       │ │
                              ~600-char snippet only               │ │
                                      │                            │ │
                                      ▼                            ▼ ▼
                                 llm.js merge ──────────────► hide / show
```

### The classification cascade

Every field goes through the cheapest mechanism that can settle it:

| stage | cost | handles |
| --- | --- | --- |
| regex (`classifier.js`) | free, instant | explicit requirements — `"5+ years"`, `"will not sponsor"` |
| LLM (`llm.js` + `background.js`) | ~$0.002/field | genuine ambiguity — `"5 years preferred"` with no stated minimum, or `"sponsor"` in a sentence about event sponsorship |
| neither | — | leaves the field unresolved, which **shows** the job |

In practice the regexes settle the large majority of fields; the side panel
shows the live split between pattern-resolved and LLM-resolved so the ratio is
visible rather than assumed.

The LLM stage asks **one narrow question per ambiguous field** and sends only
the ~600 characters around the match — never the whole description. Answers
come back through a Zod schema via structured outputs, so the reply is
schema-valid JSON rather than prose to parse.

## Design decisions worth reading

**Deterministic first, model only on ambiguity.** The easy path would be to
send every description to an LLM and ask for both answers. That costs real
money per page, adds latency to every card, and is less reliable on the
cases a regex handles perfectly. The cascade exists so the model is spent
only where pattern matching genuinely can't decide.

**Reading descriptions without clicking took three attempts.** Fetching each
job's own page turned out to return a client-rendered shell with no
description in it — measured, not assumed, after two implementations had
already been built on the premise. What finally worked was calling
LinkedIn's own internal component endpoint, which takes the job ID as a plain
body parameter. Full write-up, including what the first attempt cost:
[`docs/ENGINEERING-NOTES.md`](docs/ENGINEERING-NOTES.md).

**Rate limiting is a product requirement, not a nicety.** An early version
fetched ~25 jobs four at a time and got the browsing session HTTP 429'd,
degrading normal LinkedIn use. Getting rate-limited is a worse outcome for
the user than clicking into jobs manually. Lookups are now sequential, 1.5s
apart, budgeted at 30 per 5 minutes, and that budget **persists across page
reloads** — the original burst happened because a refresh reset the counter.
A 429 aborts the whole pass and starts a backoff that honors `Retry-After`.

**Failures leave the job visible.** No API key, a refusal, a rate limit, a
network error — every failure path leaves the field unresolved, and an
unresolved field shows the job. A filter that silently hides postings it
failed to understand is worse than no filter. Unresolved verdicts are also
deliberately *not* cached, so they retry once the cause clears.

**A side panel, not a popup.** Chrome closes an extension popup the instant
it loses focus, with no API to prevent it. A side panel stays docked until
it's closed, which is what a settings surface you adjust mid-browse needs.

**The brittle parts are isolated and named.** LinkedIn's class names are
hashed and churn per build — they broke this project's selectors twice.
Everything now keys off `componentkey`, the one durable attribute, or off
stable visible text. The RSC payload parser is deliberately over-inclusive:
it extracts every JSON string and drops the obviously structural ones,
because the output is only ever regex-matched and scaffolding never contains
`"N years"`.

## Testing

```bash
npm test     # vitest — 39 tests
```

| suite | covers |
| --- | --- |
| `test/classifier.test.js` | experience and sponsorship regexes, including the ambiguous branches |
| `test/rsc.test.js` | payload parsing against a **real captured RSC response**, ending in an end-to-end check that the parsed text reaches the same verdict the rendered DOM did |
| `test/llm.test.js` | snippet extraction, prompt construction, schema validation, and the merge back into the regex result shape |

**What these can't prove:** none of it touches live LinkedIn. The selectors
and the SDUI endpoint are verified by hand against real pages, and they go
stale when LinkedIn ships a new build. That boundary is deliberate — the
pure logic is tested properly, and the parts that can only be checked live
are documented as such rather than covered by tests that would pass either
way.

## Install

Requires Node 18+ and Chrome.

```bash
npm install --legacy-peer-deps
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**
2. **Load unpacked** → select the **`dist/`** folder (not the repo root)
3. Open a `linkedin.com/jobs/...` search page
4. Click the toolbar icon to open the side panel and set your filters

`npm run dev` gives a watching build. After pulling changes, run
`npm run build` and hit **reload** on the extension — *reload*, not remove and
re-add, which wipes `chrome.storage.local` and with it your settings.

> `--legacy-peer-deps` works around an npm 10 arborist crash while resolving
> vitest's peer graph. It's an npm bug, not a dependency conflict.

### Optional: LLM fallback

Leave the API key blank and the extension works on pattern matching alone.
With a key from [console.anthropic.com](https://console.anthropic.com),
ambiguous fields escalate to `claude-opus-5` at `effort: "low"`.

The key is stored in `chrome.storage.local`, stays in that browser profile,
is sent only to `api.anthropic.com`, and is never committed. The API call
lives in the service worker rather than the content script — a content script
calling the API would be cross-origin from linkedin.com, and this keeps the
key out of any context sharing a page with LinkedIn's own JavaScript.

## Project layout

```
src/
  content.js      card scanning, lookup scheduling, rate limiting, hide/show
  classifier.js   pure regex classification — no DOM, no extension APIs
  rsc.js          React Server Components payload → prose
  llm.js          snippet extraction, prompts, Zod schemas, result merging
  background.js   service worker; owns the API key and the Claude call
  popup.html/js   side panel: settings and live counters
test/
  fixtures/       a real captured RSC payload
manifest.config.js  MV3 manifest, built by @crxjs/vite-plugin
```

`classifier.js`, `rsc.js`, and `llm.js` are pure functions with no browser
dependencies, which is what makes them testable — and what let the LLM stage
slot in behind an existing boundary without touching the hide/show logic.

## Troubleshooting

**Nothing is being hidden.** Open the side panel and check that a filter is
actually set. With minimum years at `0` and the sponsorship box unchecked,
every stage runs correctly and nothing can ever match — and removing and
re-adding the extension resets exactly those fields. The console says which
filters are active on every page load.

**No `LinkedIn Job Filter` entry in the DevTools context dropdown.** The
content script isn't running on that page. Reload the tab — reloading an
extension kills the content script in tabs that are already open.

**Lookups have stopped.** The console reports a spent budget or an active 429
backoff, with the time it expires.

## Limitations

- Internal, undocumented LinkedIn endpoints and hashed selectors: both can
  change without notice. When they do, lookups return nothing and the
  console says so.
- English-language postings only.
- Promoted posts and postings with no description are not special-cased yet.
- Hiding is silent — a filtered card disappears with no indication of why.

## Roadmap

| phase | | state |
| --- | --- | --- |
| 0 | project scaffold, manifest, build | done |
| 1 | job card scraping, settings surface | done |
| 2 | regex classification, hide/show wiring | done |
| 3 | LLM fallback for ambiguous postings | done |
| 4 | badges on filtered cards instead of silent hiding, refined settings UI, edge cases (promoted posts, descriptionless postings, non-English) | not started |

## License

MIT — see [LICENSE](LICENSE).
