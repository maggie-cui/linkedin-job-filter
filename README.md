# LinkedIn Job Filter

Chrome extension (Manifest V3) for custom filtering of LinkedIn job search results.

## Status

Phase 0, Phase 1 (job card scraping, settings popup), and Phase 2 (regex
classification + hide/show wiring) are built.

Card scraping (`JOB_CARD_ATTR_SELECTOR`, `extractTitle`, `extractCompany`,
`getJobId` in `src/content.js`) has been re-verified against LinkedIn's
live DOM as of 2026-09-20, confirmed against 25 real postings on a search
page — the old class-based selectors from Phase 1 had gone stale (LinkedIn
now uses fully hashed/obfuscated classnames that churn per build) and were
rewritten to key off the one durable attribute found by inspecting a real
search-results page: `componentkey="job-card-component-ref-<jobId>"`.

`extractActiveDescription` (the shared description pane a card's full text
is read from once selected) was also found stale the same way and fixed the
same day: there's no durable attribute for it like `componentkey`, so it
anchors on the pane's stable visible heading text ("About the job") and
walks up to the nearest ancestor whose text is long enough to be the real
description, rather than a guessed classname.

Phase 2's classification (`src/classifier.js`) has also been confirmed
live as of 2026-09-20: clicking into real postings produces correct
description extraction and correct classification-tally increments (one
per newly-viewed job, no double-counting on repeat views thanks to the
per-job-ID cache). `npm test` still only proves the regex logic against
the hand-written strings in `test/classifier.test.js`, not real LinkedIn
phrasing — but real phrasing has now been spot-checked live and behaves
as expected.

Hide/show itself had a real bug, also found and fixed live the same day:
`applyFilter` used to cache the job card's DOM element on first scan and
mutate that reference later. LinkedIn replaces a card's DOM node (at
least when a different job gets selected), so the cached reference went
stale — the filter logic was computing the correct answer and setting
`display: none` successfully, just on a detached element nobody could
see. `applyFilter` now looks up the live element by jobId
(`findCardElement`) every time instead of storing it, confirmed via
`document.contains()` before and after the fix, and confirmed to hide
correctly for a posting with explicit no-sponsorship language.

## Proactive classification without clicking (2026-09-21)

Cards you haven't opened are classified automatically. The description
comes from LinkedIn's own SDUI component endpoint:

```
POST /flagship-web/rsc-action/actions/component
     ?componentId=com.linkedin.sdui.generated.jobseeker.dsl.impl.aboutTheJob
     &sduiid=<same>
body: {"clientArguments":{"payload":{"jobId":"<id>","renderAsCard":false}, ...}}
```

Verified live: the `jobId` is a plain body parameter, so any job's
description can be pulled without selecting it. The `csrf-token` header is
just the `JSESSIONID` cookie value. `parentSpanId` from the captured
request was only tracing and is not required. ~14KB per lookup.

Because it's a background request, it doesn't touch selection, scroll
position, or the detail pane — it keeps working while you scroll, and
newly loaded cards join the queue as they appear.

The response is a React Server Components flight payload, not HTML, so
`src/rsc.js` extracts the prose from it (`extractTextFromRscPayload`):
it pulls every JSON string literal and drops the structural ones (tag
names, hashed classNames, `text-attr-N` keys, `$`-prefixed RSC refs).
Deliberately over-inclusive — the output is only regex-matched, and
scaffolding never contains "N years" or sponsorship phrasing. This is the
one piece of LinkedIn integration that's genuinely unit-tested
(`test/rsc.test.js`, against a real captured payload).

Rate limiting, learned the hard way (see postmortem below):
- Rolling budget, default 30 lookups per 5 min, **persisted across
  reloads** so reloading can't reset it and re-burst
- Sequential, 1.5s apart — never concurrent
- Aborts the whole pass on the first 429 and backs off (honors
  `Retry-After`, else 30 min), persisted too
- Adjustable in the popup; **0 disables lookups entirely**

Caveat: this is an internal, undocumented endpoint. It can change without
notice, and if it does, lookups will silently return nothing (clicking
into a job still works, since that path reads the rendered DOM).

## Failed experiment: background-fetching descriptions (2026-09-21)

**Conclusion first: `/jobs/view/<jobId>/` does not contain the job
description, so fetch-and-parse cannot work at any rate.** Measured
directly (status 200, not redirected, no authwall):

| check | result |
| --- | --- |
| HTTP status | 200 |
| response size | ~860 KB |
| contains `"About the job"` | no |
| contains `sponsor` (on a job whose description definitely does) | no |
| embedded `<code>` JSON blocks | 0 |
| any `description` / `descriptionText` / `jobDescription` key | no |

The page is a client-rendered shell — company name and metadata are there,
but the description arrives via a separate XHR after the app boots. Two
implementations were built and reverted before this was measured:
`17ad0a1` (unthrottled, reverted in `9deddf9`) and `f3356c5` (rate-limited
with persistent budget + 429 backoff, reverted in `366a7a6`). The second
one would have been safe but would have classified nothing.

Lesson: measure the data source before building the delivery mechanism
around it. A single console `fetch` would have ruled this out in 30 seconds.

### The rate limiting, separately

Before the above was known, the unthrottled version also got the session
**HTTP 429'd** on ordinary page navigation after ~25 fetches, 4 concurrent.
So even had the description been present, volume would have needed to be
tiny. A single fetch returns 200 fine — the limit is volume-based, not
categorical.

It borrowed the approach from the `custom-shopping-filters` sibling project,
whose Amazon adapter does exactly this successfully (`src/sites/amazon/enrich.ts`):
fetch the item's own real page with `credentials: 'include'`, parse with
`DOMParser`, through a 4-wide concurrency pool. That works fine on Amazon.

**It does not work on LinkedIn.** On the very first test, a single page load's
worth of fetches (~25 jobs, 4 concurrent) got the session rate-limited:
LinkedIn started returning **HTTP 429** for ordinary page navigations, making
the site partly unusable until the limit decayed. LinkedIn is far more
aggressive about this than Amazon.

Takeaways if this is ever revisited:
- Any retry needs *drastically* lower volume — think single-digit fetches per
  page load, seconds apart, not 25 in a burst
- 429 handling is mandatory: abort the whole pass on the first 429, honor
  `Retry-After`, and back off persistently rather than re-firing on the next
  page load (the reverted code had none of this — it swallowed errors, cached
  the empty result, and would happily re-burst on the next reload)
- Even then, the risk/benefit is questionable. Getting rate-limited degrades
  real LinkedIn usage, which is a worse outcome than clicking into jobs
  manually. Phase 3's LLM fallback and Phase 4's badges are better places to
  spend effort.

## Load unpacked

1. Go to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select this directory
4. Visit a `linkedin.com/jobs/...` page and check the console for the load confirmation
