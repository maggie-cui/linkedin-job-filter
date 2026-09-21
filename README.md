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

Note on Phase 2's scope: LinkedIn only renders the full description for
whichever job is currently selected, so a card only gets classified — and
only becomes eligible to be hidden — once you've clicked into it at least
once. This mirrors the constraint already noted in Phase 1; nothing in
Phase 2 changes it.

## Background description lookups (rate-limited retry, 2026-09-21)

Jobs you haven't clicked into get their description fetched in the
background from the job's own page (`/jobs/view/<jobId>/`), so they can be
classified and filtered without manual clicking. A first attempt at this
got the session HTTP 429'd (see the postmortem below); this is the
rebuilt, deliberately conservative version:

- **Rolling budget, persisted across reloads** — `maxLookupsPerWindow`
  (default 6) lookups per 5 minutes, with the timestamps stored in
  `chrome.storage`. Persisting is the important part: the reverted version
  reset its counter every page load, so each reload re-burst. Adjustable in
  the popup; **set it to 0 to disable background lookups entirely.**
- **Sequential, 2.5s apart** — never concurrent.
- **Abort + back off on 429** — the whole pass stops on the first 429 and
  no further lookups run until the backoff expires (honors `Retry-After`,
  else 30 min). The backoff is persisted too, so reloading doesn't clear it.
- **Top of the list first** — a small budget is spent on the results you're
  most likely to be looking at.
- Already-classified jobs are never re-fetched (classifications persist in
  `chrome.storage`), so the cost is one-time per job, not per page load.

Because of the budget, a fresh page of ~25 results won't all be classified
at once — it fills in over a few minutes of browsing, and cards you click
into are classified instantly and for free. Raising the budget raises the
429 risk; that tradeoff is yours to make via the popup.

## Failed experiment: unthrottled background-fetching (2026-09-21)

An attempt to remove the click-to-classify constraint by background-fetching
each card's own page (`/jobs/view/<jobId>/`) and parsing the description out
of the response was **tried and reverted the same day** (commits `17ad0a1`,
reverted in `9deddf9`).

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
