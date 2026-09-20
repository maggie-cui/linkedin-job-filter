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

const DEFAULT_SETTINGS = {
  minYearsExperience: 0,
  excludeNoSponsorship: false,
};

const jobsById = new Map();
let settings = { ...DEFAULT_SETTINGS };
let classificationCache = {};
const tally = {
  experience: { matched: 0, ambiguous: 0, "no-mention": 0 },
  sponsorship: { matched: 0, ambiguous: 0, "no-mention": 0 },
};

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

function classifyAndCache(jobId, description) {
  if (classificationCache[jobId]) return classificationCache[jobId];

  const result = classifyJobDescription(description);
  classificationCache[jobId] = result;
  chrome.storage.local.set({ classifications: classificationCache });

  tally.experience[result.experience.status] += 1;
  tally.sponsorship[result.sponsorship.status] += 1;
  console.log(
    `LinkedIn Job Filter: classification tally — experience ${JSON.stringify(
      tally.experience
    )} sponsorship ${JSON.stringify(tally.sponsorship)}`
  );

  return result;
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

function applyFilter(job) {
  if (!job.cardEl || !job.classification) return;
  job.cardEl.style.display = shouldHideJob(job.classification) ? "none" : "";
}

function logJob(job, isUpdate) {
  const snippet = job.description
    ? job.description.slice(0, 100)
    : "(description not loaded yet — click the job to load it)";
  const prefix = isUpdate ? "LinkedIn Job Filter (updated):" : "LinkedIn Job Filter:";
  console.log(`${prefix} [${job.jobId}] ${job.title} @ ${job.company} — ${snippet}`);
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
    cardEl: card,
    classification: description ? classifyAndCache(jobId, description) : null,
  };
  jobsById.set(jobId, job);
  applyFilter(job);
  logJob(job, false);
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
  job.classification = classifyAndCache(job.jobId, description);
  applyFilter(job);
  logJob(job, true);
}

const handleMutations = throttle(() => {
  scanForJobCards();
  updateActiveJobDescription();
}, 500);

const observer = new MutationObserver(handleMutations);
observer.observe(document.body, { childList: true, subtree: true });

chrome.storage.local.get(["settings", "classifications"], (result) => {
  settings = { ...DEFAULT_SETTINGS, ...result.settings };
  // Freshly-computed entries (classified before this async load resolved)
  // take precedence over whatever was already on disk.
  classificationCache = { ...(result.classifications || {}), ...classificationCache };
  jobsById.forEach(applyFilter);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  jobsById.forEach(applyFilter);
});

scanForJobCards();
updateActiveJobDescription();
