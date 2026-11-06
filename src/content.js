import { classifyJobDescription } from "./classifier.js";
import { extractTextFromRscPayload } from "./rsc.js";

console.log("LinkedIn Job Filter: content script loaded");

// LinkedIn's card classnames are hashed per-build and churn constantly, so
// this hooks the one durable attribute found by inspecting the live DOM:
// componentkey="job-card-component-ref-<jobId>". It's stamped on both an
// outer role="button" wrapper and an inner div — scanForJobCards() keeps
// only the outer one.
const JOB_CARD_ATTR_SELECTOR = '[componentkey^="job-card-component-ref-"]';
const JOB_CARD_ID_RE = /job-card-component-ref-(\d+)/;

// Same hashed-classname problem as the job cards (.jobs-description__content
// etc. are all dead) — verified live 2026-09-20. There's no durable
// attribute here like componentkey, so this anchors on the pane's stable
// visible heading text instead and climbs to the nearest ancestor whose
// combined text is long enough to be the actual description.
const DESCRIPTION_HEADING_TEXT = "About the job";
const DESCRIPTION_MIN_LENGTH = 200;

// LinkedIn's own SDUI endpoint for a job's description component. Verified
// live 2026-09-21: the jobId is a plain parameter in the POST body, so this
// works for any job without selecting it — unlike /jobs/view/<id>/, which is
// a client-rendered shell containing no description at all (see README).
// parentSpanId in the captured request was only tracing; it's not required.
const ABOUT_THE_JOB_COMPONENT = "com.linkedin.sdui.generated.jobseeker.dsl.impl.aboutTheJob";
const ABOUT_THE_JOB_URL =
  "https://www.linkedin.com/flagship-web/rsc-action/actions/component" +
  `?componentId=${ABOUT_THE_JOB_COMPONENT}&sduiid=${ABOUT_THE_JOB_COMPONENT}`;
const JOB_DETAILS_SCREEN_ID = "com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails";

const DEFAULT_SETTINGS = {
  minYearsExperience: 0,
  excludeNoSponsorship: false,
  // Description lookups allowed per ENRICH_WINDOW_MS. An earlier attempt that
  // fetched the full job *page* ~25 times per load, 4 at a time, got the
  // session HTTP 429'd. This endpoint is ~14KB rather than ~860KB and is the
  // app's own call, but the limit is real — keep this modest. 0 disables
  // lookups entirely (only jobs you click get classified).
  maxLookupsPerWindow: 30,
};

const ENRICH_WINDOW_MS = 5 * 60 * 1000;
const ENRICH_DELAY_MS = 1500;
// Fallback pause when a 429 arrives without a usable Retry-After.
const ENRICH_BACKOFF_MS = 30 * 60 * 1000;

const jobsById = new Map();
let settings = { ...DEFAULT_SETTINGS };
let classificationCache = {};
const tally = {
  experience: { matched: 0, ambiguous: 0, "no-mention": 0 },
  sponsorship: { matched: 0, ambiguous: 0, "no-mention": 0 },
};
// Surfaced in the popup so it's visible how much traffic actually needs the
// LLM versus what the regexes settle for free.
const stats = { regexResolved: 0, llmResolved: 0, llmFailed: 0 };

// Not a debounce: LinkedIn's DOM never really goes quiet (ads, chat badges,
// notification counters keep mutating in the background), so a debounce here
// can end up perpetually deferred and never actually run. This guarantees
// fn fires at least once every waitMs regardless of ongoing mutation noise.
function throttle(fn, waitMs) {
  let lastRun = 0;
  let timeoutId = null;
  return (...args) => {
    const now = Date.now();
    const remaining = waitMs - (now - lastRun);
    if (remaining <= 0) {
      lastRun = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastRun = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  };
}

function getText(el) {
  return el ? el.textContent.trim().replace(/\s+/g, " ") : "";
}

function getJobId(card) {
  return card.getAttribute("componentkey")?.match(JOB_CARD_ID_RE)?.[1] || null;
}

function getActiveJobId() {
  return new URLSearchParams(location.search).get("currentJobId");
}

// The card has no <a> tags — it's a role="button" div with a click handler,
// not a real link — and no title/company classnames survive LinkedIn's
// hashing, so this reads by position: the first <p> is the title line (its
// innerText also carries a hidden a11y prefix like "Selected, X (Verified
// job)" joined by a newline — the last line is the actual visible title),
// the second <p> is the company name.
function extractTitle(card) {
  const titleEl = card.querySelectorAll("p")[0];
  if (!titleEl) return "";
  const lines = titleEl.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
  return lines[lines.length - 1] || "";
}

function extractCompany(card) {
  return getText(card.querySelectorAll("p")[1]);
}

// LinkedIn renders the full description into one shared pane for whichever
// job is currently selected — it isn't present inline on each card — so this
// only returns text for the job that matches the page's currentJobId.
function extractActiveDescription() {
  const heading = Array.from(document.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent.trim() === DESCRIPTION_HEADING_TEXT
  );
  if (!heading) return "";

  let el = heading.parentElement;
  while (el && el.innerText.trim().length < DESCRIPTION_MIN_LENGTH) {
    el = el.parentElement;
  }
  return el ? getText(el) : "";
}

// LinkedIn's csrf-token header is just the JSESSIONID cookie value.
function getCsrfToken() {
  return document.cookie.match(/JSESSIONID="?([^";]+)"?/)?.[1] || null;
}

// Reports 429 to the caller rather than swallowing it, so the caller can stop
// the whole pass and back off — the mistake that made the first attempt at
// this degrade real LinkedIn browsing.
async function fetchJobDescription(jobId) {
  const csrf = getCsrfToken();
  if (!csrf) return { text: "", rateLimited: false };

  try {
    const response = await fetch(ABOUT_THE_JOB_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        "csrf-token": csrf,
        "x-li-rsc-stream": "true",
      },
      body: JSON.stringify({
        clientArguments: {
          payload: { jobId: String(jobId), renderAsCard: false },
          states: [],
          requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
          screenId: JOB_DETAILS_SCREEN_ID,
          knownTemplateIds: [],
        },
      }),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      return {
        text: "",
        rateLimited: true,
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
      };
    }

    if (!response.ok) return { text: "", rateLimited: false };

    return { text: extractTextFromRscPayload(await response.text()), rateLimited: false };
  } catch {
    return { text: "", rateLimited: false };
  }
}

// Phase 3: whatever the regex can't decide goes to the LLM, one narrow
// question per ambiguous field, with only the surrounding snippet sent. The
// service worker owns the API call and the key.
async function resolveViaLlm(kind, description) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "resolve-ambiguous",
      kind,
      description,
    });

    if (response?.ok) {
      stats.llmResolved += 1;
      return response.result;
    }

    // No key configured isn't a failure worth counting — it just means the
    // LLM fallback is switched off.
    if (response?.reason !== "no-api-key") {
      stats.llmFailed += 1;
      console.warn(`LinkedIn Job Filter: LLM lookup failed (${response?.reason || "unknown"})`);
    }
    return null;
  } catch {
    stats.llmFailed += 1;
    return null;
  }
}

async function classifyAndCache(jobId, description) {
  if (classificationCache[jobId]) return classificationCache[jobId];

  const result = classifyJobDescription(description);
  let unresolved = false;

  for (const kind of ["experience", "sponsorship"]) {
    if (result[kind].status !== "ambiguous") continue;

    const resolved = await resolveViaLlm(kind, description);
    if (resolved) {
      result[kind] = resolved;
    } else {
      // Leaving it ambiguous shows the job, which is the fallback the roadmap
      // asks for — and unlike rewriting it to no-mention, it stays honest
      // about what we actually know and can be retried later.
      unresolved = true;
    }
  }

  // Only persist verdicts we're done with; an unresolved one would otherwise
  // be cached forever and never retried once a key is added or the API
  // recovers. It's still applied for this page load.
  if (!unresolved) {
    classificationCache[jobId] = result;
    chrome.storage.local.set({ classifications: classificationCache });
  }

  recordStats(result);
  return result;
}

function recordStats(result) {
  tally.experience[result.experience.status] += 1;
  tally.sponsorship[result.sponsorship.status] += 1;
  for (const kind of ["experience", "sponsorship"]) {
    if (result[kind].status !== "ambiguous" && result[kind].resolvedBy !== "llm") {
      stats.regexResolved += 1;
    }
  }

  chrome.storage.local.set({ stats });
  console.log(
    `LinkedIn Job Filter: tally — experience ${JSON.stringify(
      tally.experience
    )} sponsorship ${JSON.stringify(tally.sponsorship)} | resolved by regex ${
      stats.regexResolved
    }, by LLM ${stats.llmResolved}, LLM failures ${stats.llmFailed}`
  );
}

// Applies a freshly-fetched description: classify (escalating if needed),
// then hide/show. Shared by every path that obtains a description.
async function classifyAndApply(job) {
  job.classification = await classifyAndCache(job.jobId, job.description);
  applyFilter(job);
  logVerdict(job);
}

function describeField(kind, field) {
  if (field.status !== "matched") return field.status;
  if (kind === "experience") return `${field.min}+ yrs`;
  return field.sponsors === false ? "no sponsorship" : "sponsors";
}

// Printing the description's first 100 characters was close to useless: an
// RSC payload often opens with scaffolding (SduiTrackingProvenanceProvider
// and friends) and the real prose sits further in, so a correct
// classification looked like garbage input. The verdict and the resulting
// hide/show decision are what actually need checking.
function logVerdict(job) {
  const { experience, sponsorship } = job.classification;
  console.log(
    `LinkedIn Job Filter: ${shouldHideJob(job.classification) ? "HIDDEN" : "shown "} [${
      job.jobId
    }] ${job.title} @ ${job.company} — experience: ${describeField(
      "experience",
      experience
    )}, sponsorship: ${describeField("sponsorship", sponsorship)}`
  );
}

function shouldHideJob(classification) {
  const { experience, sponsorship } = classification;

  if (
    settings.minYearsExperience > 0 &&
    experience.status === "matched" &&
    experience.min > settings.minYearsExperience
  ) {
    return true;
  }

  if (settings.excludeNoSponsorship && sponsorship.status === "matched" && sponsorship.sponsors === false) {
    return true;
  }

  return false;
}

// LinkedIn re-renders/replaces a job card's DOM element (confirmed live:
// selecting a different job detaches the old node from the document) —
// a cached element reference goes stale, so this looks up whatever is
// currently live by jobId instead of storing the node on the job object.
// componentkey is stamped on both an outer wrapper and inner div sharing
// the same value; the outer one always comes first in document order
// (ancestors precede descendants), so a plain querySelector is enough.
function findCardElement(jobId) {
  return document.querySelector(`[componentkey="job-card-component-ref-${jobId}"]`);
}

function applyFilter(job) {
  if (!job.classification) return;
  const cardEl = findCardElement(job.jobId);
  if (!cardEl) return;
  cardEl.style.display = shouldHideJob(job.classification) ? "none" : "";
}

// Reuses a stored verdict for a card we've classified before, in an earlier
// session or an earlier scan on this page.
function hydrateFromCache(job) {
  const cached = classificationCache[job.jobId];
  if (!cached) return false;
  job.classification = cached;
  applyFilter(job);
  return true;
}

// The failure mode that has cost the most debugging time: with no filter set,
// every code path runs perfectly and nothing is ever hidden, which is
// indistinguishable from the extension being broken. Removing and re-adding
// an unpacked extension wipes chrome.storage.local, so it's easy to land here
// by accident. Say so out loud rather than looking dead.
function logActiveFilters() {
  const active = [];
  if (settings.minYearsExperience > 0) {
    active.push(`hide jobs asking for more than ${settings.minYearsExperience} years`);
  }
  if (settings.excludeNoSponsorship) active.push("hide jobs that state no sponsorship");

  if (active.length === 0) {
    console.warn(
      "LinkedIn Job Filter: no filters are set, so nothing will be hidden. " +
        "Open the extension's side panel and set a minimum years of experience " +
        "and/or tick the sponsorship box. Note that reinstalling the extension " +
        "clears these settings (and the API key)."
    );
    return;
  }
  console.log(`LinkedIn Job Filter: active filters — ${active.join("; ")}.`);
}

function logJob(job) {
  console.log(
    `LinkedIn Job Filter: found [${job.jobId}] ${job.title} @ ${job.company}`
  );
}

function processCard(card) {
  const jobId = getJobId(card);
  if (!jobId || jobsById.has(jobId)) return;

  const description = jobId === getActiveJobId() ? extractActiveDescription() : "";
  const job = {
    jobId,
    title: extractTitle(card),
    company: extractCompany(card),
    description,
    classification: null,
  };
  jobsById.set(jobId, job);
  logJob(job);

  // A verdict already on disk is reused immediately: the card filters with no
  // network call at all, and the lookup budget goes only to jobs never seen
  // before. Without this the persisted cache did nothing for a card on page
  // load — processCard left classification null, so enrichUnclassifiedJobs
  // re-fetched and re-classified every already-known job, spending the whole
  // 30-per-5-min budget on them and leaving the rest of the page unfiltered.
  if (hydrateFromCache(job)) return;

  // Classification is async now (it may escalate to the LLM), so the card is
  // registered first and filtered when the verdict lands.
  if (description) void classifyAndApply(job);
}

function scanForJobCards() {
  const candidates = document.querySelectorAll(JOB_CARD_ATTR_SELECTOR);
  const outerCards = Array.from(candidates).filter(
    (el) => !el.parentElement || !el.parentElement.closest(JOB_CARD_ATTR_SELECTOR)
  );
  outerCards.forEach(processCard);
}

function updateActiveJobDescription() {
  const activeJobId = getActiveJobId();
  const job = activeJobId && jobsById.get(activeJobId);
  if (!job || job.description) return;

  const description = extractActiveDescription();
  if (!description) return;

  job.description = description;
  void classifyAndApply(job);
}

// Rolling lookup budget + 429 backoff, both persisted so a page reload can't
// reset them — resetting per page load is what produced the original 429
// burst. Lookups are sequential and spaced; they touch no UI, so they keep
// running normally while you scroll or read.
let lookupTimestamps = [];
let backoffUntil = 0;
let enriching = false;
// The observer starts before stored budget/backoff have loaded; without this
// gate a mutation tick could fire a lookup during an active backoff, or after
// the budget had been set to 0.
let settingsLoaded = false;
const attemptedThisLoad = new Set();
// Why a pass did nothing, logged on change only — a mutation tick fires every
// 500ms and this would otherwise flood the console. Silence here was the other
// half of the "it just stopped working" problem: a spent budget or an active
// backoff looked exactly like a dead extension.
let lastSkipReason = "";

function noteSkip(reason) {
  if (reason === lastSkipReason) return;
  lastSkipReason = reason;
  if (reason) console.log(`LinkedIn Job Filter: ${reason}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingLookupBudget() {
  const cutoff = Date.now() - ENRICH_WINDOW_MS;
  lookupTimestamps = lookupTimestamps.filter((ts) => ts > cutoff);
  return (settings.maxLookupsPerWindow || 0) - lookupTimestamps.length;
}

function recordLookup() {
  lookupTimestamps.push(Date.now());
  chrome.storage.local.set({ lookupTimestamps });
}

function startBackoff(retryAfterMs) {
  backoffUntil = Date.now() + (retryAfterMs || ENRICH_BACKOFF_MS);
  chrome.storage.local.set({ backoffUntil });
  console.warn(
    `LinkedIn Job Filter: got HTTP 429 — description lookups paused until ${new Date(
      backoffUntil
    ).toLocaleTimeString()}. Already-classified jobs still filter normally.`
  );
}

async function enrichUnclassifiedJobs() {
  if (!settingsLoaded || enriching) return;

  if (Date.now() < backoffUntil) {
    noteSkip(
      `description lookups paused until ${new Date(
        backoffUntil
      ).toLocaleTimeString()} after an HTTP 429. Already-classified jobs still filter.`
    );
    return;
  }

  if (remainingLookupBudget() <= 0) {
    noteSkip(
      settings.maxLookupsPerWindow > 0
        ? `description lookup budget spent (${settings.maxLookupsPerWindow} per 5 min) — ` +
            "remaining cards will be classified as it refills. Clicking a job classifies it now."
        : "description lookups are disabled (budget is 0) — only jobs you click get classified."
    );
    return;
  }

  noteSkip("");
  enriching = true;
  try {
    // jobsById preserves insertion order, which matches list order, so the
    // budget goes to the top results first.
    for (const job of jobsById.values()) {
      if (Date.now() < backoffUntil || remainingLookupBudget() <= 0) break;
      if (job.classification || attemptedThisLoad.has(job.jobId)) continue;

      attemptedThisLoad.add(job.jobId);
      recordLookup();

      const { text, rateLimited, retryAfterMs } = await fetchJobDescription(job.jobId);

      if (rateLimited) {
        startBackoff(retryAfterMs);
        break;
      }

      if (text) {
        job.description = text;
        await classifyAndApply(job);
      }

      await sleep(ENRICH_DELAY_MS);
    }
  } finally {
    enriching = false;
  }
}

const handleMutations = throttle(() => {
  scanForJobCards();
  updateActiveJobDescription();
  void enrichUnclassifiedJobs();
}, 500);

const observer = new MutationObserver(handleMutations);
observer.observe(document.body, { childList: true, subtree: true });

chrome.storage.local.get(
  ["settings", "classifications", "lookupTimestamps", "backoffUntil"],
  (result) => {
    settings = { ...DEFAULT_SETTINGS, ...result.settings };
    // Freshly-computed entries (classified before this async load resolved)
    // take precedence over whatever was already on disk.
    classificationCache = { ...(result.classifications || {}), ...classificationCache };
    lookupTimestamps = Array.isArray(result.lookupTimestamps) ? result.lookupTimestamps : [];
    backoffUntil = Number(result.backoffUntil) || 0;
    settingsLoaded = true;

    if (Date.now() < backoffUntil) {
      console.warn(
        `LinkedIn Job Filter: lookups still paused after an earlier HTTP 429, until ${new Date(
          backoffUntil
        ).toLocaleTimeString()}.`
      );
    }

    // Cards scanned before this load resolved have no verdict yet; now that
    // the cache is in hand, apply whatever is already known about them.
    jobsById.forEach((job) => {
      if (job.classification) applyFilter(job);
      else hydrateFromCache(job);
    });
    logActiveFilters();
    void enrichUnclassifiedJobs();
  }
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  logActiveFilters();
  jobsById.forEach(applyFilter);
});

scanForJobCards();
updateActiveJobDescription();
