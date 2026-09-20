# LinkedIn Job Filter

Chrome extension (Manifest V3) for custom filtering of LinkedIn job search results.

## Status

Phase 0 and Phase 1 (job card scraping, settings popup) are built. Phase 2
(regex classification + hide/show wiring) is built but **untested against
real LinkedIn markup** — testing has been blocked by an unrelated issue
where LinkedIn's job search page fails to render (a React hydration error)
in the environment used so far. Once that's sorted out, re-verify:

- Phase 1's card selectors (`JOB_CARD_SELECTOR` etc. in `src/content.js`) —
  LinkedIn's current build uses hashed/obfuscated class names, so these are
  likely stale and may need to be rewritten against the real DOM.
- Phase 2's classification regexes (`src/classifier.js`) against real job
  description text, and the hide/show behavior end-to-end.

Note on Phase 2's scope: LinkedIn only renders the full description for
whichever job is currently selected (see the comment on
`extractActiveDescription` in `content.js`), so a card only gets classified
— and only becomes eligible to be hidden — once you've clicked into it at
least once. This mirrors the constraint already noted in Phase 1; nothing
in Phase 2 changes it.

## Load unpacked

1. Go to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select this directory
4. Visit a `linkedin.com/jobs/...` page and check the console for the load confirmation
