console.log("LinkedIn Job Filter: content script loaded");

const JOB_CARD_SELECTOR = ".job-card-container[data-job-id], li[data-occludable-job-id]";
const DESCRIPTION_PANE_SELECTOR = ".jobs-description__content, .jobs-box__html-content, #job-details";

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

function debounce(fn, waitMs) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), waitMs);
  };
}

function getText(el) {
  return el ? el.textContent.trim().replace(/\s+/g, " ") : "";
}

function getJobId(card) {
  return card.dataset.jobId || card.dataset.occludableJobId || null;
}

function getActiveJobId() {
  return new URLSearchParams(location.search).get("currentJobId");
}

function extractTitle(card) {
  const el = card.querySelector(
    '.job-card-list__title, .job-card-container__link, a[class*="job-card-list__title"]'
  );
  return getText(el);
}

function extractCompany(card) {
  const el = card.querySelector(
    ".job-card-container__primary-description, .artdeco-entity-lockup__subtitle, .job-card-container__company-name"
  );
  return getText(el);
}

// LinkedIn renders the full description into one shared pane for whichever
// job is currently selected — it isn't present inline on each card — so this
// only returns text for the job that matches the page's currentJobId.
function extractActiveDescription() {
  return getText(document.querySelector(DESCRIPTION_PANE_SELECTOR));
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
  document.querySelectorAll(JOB_CARD_SELECTOR).forEach(processCard);
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

const handleMutations = debounce(() => {
  scanForJobCards();
  updateActiveJobDescription();
}, 250);

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
