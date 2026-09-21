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

**Update 2026-09-21 — proactive filtering, no click required:** the
click-to-classify constraint above is gone. `enrichUnclassifiedJobs` in
`content.js` now background-fetches each unclassified card's own standalone
page (`https://www.linkedin.com/jobs/view/<jobId>/`, authenticated via the
existing session cookies) and parses the description out of the response,
so every loaded card gets classified — and hidden if it matches your
filters — without you ever clicking into it. The currently-selected job
still gets its description from the live shared pane first (free, no
network call); everything else goes through the background fetch.

This borrows its approach directly from a working sibling project
(`custom-shopping-filters`, its Amazon adapter's `enrich.ts`): fetch the
item's own real page in the background rather than either simulating UI
clicks or calling a private/undocumented API — same public URL a click
would navigate to, just requested without the visible navigation. Fetches
run through a small concurrency pool (`ENRICH_CONCURRENCY = 4`, same figure
as that sibling project) rather than one at a time or all at once, and are
cached per job ID so nothing gets fetched twice.

**Not yet verified live** (next thing to test): whether
`/jobs/view/<id>/`'s raw HTML response actually contains the description
server-rendered (LinkedIn's SEO/guest-indexing needs suggest yes, but this
hasn't been confirmed against the real site), and whether that standalone
page uses the same "About the job" heading text the search-results pane
does. `extractDescriptionFromDocument` was refactored to work against a
detached `DOMParser` document (using `textContent` instead of `innerText`,
since a document never attached to the page has no layout and `innerText`
is unreliable on it) specifically so the same extraction logic could serve
both the live pane and the fetched pages — but the heading-text assumption
itself still needs a real test.

## Load unpacked

1. Go to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select this directory
4. Visit a `linkedin.com/jobs/...` page and check the console for the load confirmation
