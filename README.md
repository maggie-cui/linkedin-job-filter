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

Still unverified:
- Phase 2's classification regexes (`src/classifier.js`) against real job
  description text pulled from that pane, and the hide/show behavior
  end-to-end. The regex logic itself is unit-tested (`npm test`), but that
  only proves it's correct against the hand-written sample strings in
  `test/classifier.test.js`, not against real LinkedIn phrasing.

Note on Phase 2's scope: LinkedIn only renders the full description for
whichever job is currently selected, so a card only gets classified — and
only becomes eligible to be hidden — once you've clicked into it at least
once. This mirrors the constraint already noted in Phase 1; nothing in
Phase 2 changes it.

## Load unpacked

1. Go to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select this directory
4. Visit a `linkedin.com/jobs/...` page and check the console for the load confirmation
