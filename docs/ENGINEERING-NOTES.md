# Engineering notes

A record of what broke, what was measured, and what the measurements changed.
Kept because the dead ends are more informative than the final code — and
because two of them were expensive.

---

## Getting descriptions without clicking: three approaches

The product requirement was fixed from the start: classify every card on the
page without the user opening each posting. Clicking through jobs one at a
time is the thing the extension exists to avoid.

### Attempt 1 — fetch each job's own page, unthrottled

Borrowed from a sibling project whose Amazon adapter does exactly this and
works fine: fetch the item's real page with `credentials: 'include'`, parse
with `DOMParser`, through a 4-wide concurrency pool.

**It got the browsing session rate-limited on the first test.** One page load's
worth of fetches — roughly 25 jobs, 4 concurrent — and LinkedIn started
returning **HTTP 429** for ordinary page navigations, making the site partly
unusable until the limit decayed. A single fetch returns 200 fine; the limit
is volume-based, not categorical. LinkedIn is far more aggressive about this
than Amazon.

Reverted immediately (`17ad0a1`, reverted in `9deddf9`).

The failure was predictable and had in fact been flagged as a risk before
shipping — and then shipped with no 429 handling at all: errors were
swallowed, the empty result was cached, and the next page load would have
re-burst. Identifying a risk and defending against it are separate pieces of
work.

### Attempt 2 — the same thing, rate-limited properly

Rebuilt with a persistent budget and 429 backoff (`f3356c5`). Safe this time.

Then the actual data source was measured, for the first time:

| check on `/jobs/view/<jobId>/` | result |
| --- | --- |
| HTTP status | 200 |
| response size | ~860 KB |
| contains `"About the job"` | no |
| contains `sponsor` (on a job whose description definitely does) | no |
| embedded `<code>` JSON blocks | 0 |
| any `description` / `descriptionText` / `jobDescription` key | no |

**The page contains no description.** It's a client-rendered shell; company
name and metadata are present, but the description arrives via a separate XHR
after the app boots. The rate-limit-safe implementation would have worked
perfectly and classified nothing. Reverted (`366a7a6`).

> **Lesson, recorded in the commit that killed it:** measure the data source
> before building the delivery mechanism around it. A single console `fetch`
> would have ruled this out in thirty seconds. Two implementations and one
> rate-limited session were spent on a premise nobody had checked.

### Attempt 3 — LinkedIn's own component endpoint

Opening a posting with the Network tab recording showed the app fetching the
description through its SDUI (Server-Driven UI) layer:

```
POST /flagship-web/rsc-action/actions/component
     ?componentId=com.linkedin.sdui.generated.jobseeker.dsl.impl.aboutTheJob
     &sduiid=<same>
body: {"clientArguments":{"payload":{"jobId":"<id>","renderAsCard":false}, ...}}
```

The `jobId` is a plain body parameter, which is the whole trick: **any job's
description can be pulled without selecting it.** The `csrf-token` header is
just the `JSESSIONID` cookie value. `parentSpanId` in the captured request
turned out to be tracing only and isn't required. ~14 KB per lookup, versus
~860 KB for the full page.

Because it's a background request, it touches neither selection, scroll
position, nor the detail pane — it keeps working while you scroll, and newly
loaded cards join the queue as they appear.

**Caveat:** this is internal and undocumented. It can change without notice,
and if it does, lookups will silently return nothing. Clicking into a job
still works in that case, since that path reads the rendered DOM.

### What the 429 changed permanently

- Rolling budget, default 30 lookups per 5 minutes, **persisted across
  reloads** so a refresh can't reset it and re-burst
- Sequential, 1.5s apart — never concurrent
- Aborts the entire pass on the first 429 and backs off, honoring
  `Retry-After` and falling back to 30 minutes, persisted too
- Adjustable in the side panel; **0 disables lookups entirely**

"Flake" was not an acceptable diagnosis here and neither was "it works on my
machine" — the cost of being wrong was the user's own LinkedIn access.

---

## Parsing React Server Components payloads

The SDUI endpoint returns an RSC "flight" payload, not HTML. Rows look like:

```
["$","em","text-attr-9",{"children":["At this time, Capital One will not sponsor..."]}]
```

Parsing the RSC row/reference format properly would mean implementing an
undocumented wire format that breaks the moment React changes it. Instead
`src/rsc.js` pulls **every JSON string literal** out of the payload and drops
the obviously structural ones — `$`-prefixed references, `text-attr-N` keys,
bare tag names, hashed class names, 32-hex module IDs.

Over-inclusion is deliberately safe here: the output is only ever regex-matched
for `"N years"` and sponsorship phrasing, and scaffolding never contains
either. The tradeoff is that a logged preview of the extracted text often
opens with scaffolding, which looks alarming and isn't — addressed by logging
the parsed *verdict* instead of the raw text.

This is the one piece of LinkedIn integration that is genuinely unit-tested,
against a real captured payload (`test/fixtures/about-the-job.rsc.txt`),
ending in an end-to-end assertion that the parsed text reaches the same
verdict the rendered DOM did.

---

## Selectors go stale, twice

LinkedIn ships fully hashed, per-build class names. Every class-based
selector written in Phase 1 was dead within weeks — not degraded, dead,
matching zero elements and producing an extension that loaded successfully
and did nothing.

Two rewrites followed, both keyed on something durable instead:

- **Job cards** → `componentkey="job-card-component-ref-<jobId>"`, the one
  stable attribute found by inspecting a live search page. Confirmed against
  25 real postings.
- **The description pane** → no equivalent attribute exists, so it anchors on
  the pane's stable visible heading text (`"About the job"`) and walks up to
  the nearest ancestor whose text is long enough to be the real description.

A third rewrite should be assumed, not hoped against. The console now reports
how many cards the selector matched, so the next failure announces itself
instead of presenting as silence.

---

## Two silent failures, and what made them silent

Both of these presented identically to "the extension is dead," and between
them cost more debugging time than every real bug in the project.

### 1. Hide/show acting on a detached DOM node

`applyFilter` cached a card's DOM element on first scan and mutated that
reference later. LinkedIn *replaces* a card's node when a different job gets
selected, so the cached reference went stale: the filter logic was computing
the correct answer and setting `display: none` successfully — on an element
no longer in the document.

Confirmed with `document.contains(job.cardEl) === false` while
`shouldHideJob()` returned `true`. Fixed by looking the element up live by
job ID every time (`findCardElement`) instead of storing it.

### 2. The persisted cache was never read on page load

`processCard` left `classification` null for every card, so
`enrichUnclassifiedJobs()` re-fetched and re-classified jobs **already stored
on disk**. With a budget of 30 lookups per 5 minutes, persisted across
reloads, a single page of 25 cards could spend the entire budget re-deriving
verdicts it already had — leaving everything scrolled to afterwards
unclassified and therefore unfiltered.

This got progressively worse the more the extension was used, which is the
worst shape a bug can have: it looks like the software decaying rather than a
single wrong line. `hydrateFromCache()` now applies a stored verdict the
moment a card is seen, with no network call.

### What both had in common

Nothing in the UI or the console distinguished "working correctly, nothing
matched" from "completely broken." That is now treated as a defect in its own
right:

- Active filters are logged on load and on every settings change, with an
  explicit warning when **no filter is set** — the state a reinstall leaves
  behind, since removing an unpacked extension wipes `chrome.storage.local`,
  and the state in which `shouldHideJob()` correctly returns `false` for
  everything
- A spent lookup budget or an active 429 backoff is logged, once per state
  change rather than per mutation tick
- Each classified card logs its **verdict and the resulting decision**
  (`HIDDEN` / `shown`, years matched, sponsorship stance) rather than a
  snippet of input text

An observability gap is a bug. These cost two rounds of "it's not working"
with nothing to go on.

---

## Why the LLM stage is shaped the way it is

- **Only the ambiguous field escalates**, never the whole classification, and
  only the ~600-character window around the match is sent — not the full
  description.
- **One narrow question per case**, answered through structured outputs
  against a Zod schema, so the reply is schema-valid JSON rather than prose to
  parse.
- **The call lives in the service worker.** A content script calling
  `api.anthropic.com` would be cross-origin from linkedin.com, and this keeps
  the key out of any context sharing a page with LinkedIn's own JavaScript.
- **`claude-opus-5` at `effort: "low"`** — classification doesn't repay deeper
  reasoning, and this runs per job.
- **Failures never block the UI.** No key, refusal, rate limit, network error:
  all leave the field unresolved, which shows the job. Unlike rewriting it to
  `no-mention`, that stays honest about what is actually known, and unresolved
  verdicts are deliberately *not* cached so they retry later.
- **Resolved verdicts join the per-job cache**, so any posting is only ever
  sent to the API once.

A build warning caught a version mismatch that would otherwise have thrown at
runtime on the first escalation: `zodOutputFormat` calls `z.toJSONSchema()`,
a Zod 4 API, against what was then a Zod 3 dependency. The failure would have
appeared only on the first ambiguous posting, well after install. Pinned to
Zod 4.

---

## Settings live in a side panel

Chrome closes an extension *popup* the instant it loses focus, and provides no
API to prevent it. For a settings surface that gets adjusted mid-browse, that
is unusable. A side panel stays docked until explicitly closed.

Because it stays open, the counters update live via `chrome.storage.onChanged`
— but only the stats re-render. The inputs are deliberately left alone, since
settings save on every keystroke and that save comes straight back through the
same listener; re-rendering the inputs would fight the user mid-edit.
