const DEFAULT_SETTINGS = {
  minYearsExperience: 0,
  excludeNoSponsorship: false,
  displayMode: "collapse",
  maxLookupsPerWindow: 30,
  anthropicApiKey: "",
};

const minYearsInput = document.getElementById("min-years");
const excludeNoSponsorshipCheckbox = document.getElementById("exclude-no-sponsorship");
const displayModeSelect = document.getElementById("display-mode");
const maxLookupsInput = document.getElementById("max-lookups");
const apiKeyInput = document.getElementById("api-key");
const applyButton = document.getElementById("apply");
const applyStatus = document.getElementById("apply-status");
const clearCacheButton = document.getElementById("clear-cache");

const INPUTS = [
  minYearsInput,
  excludeNoSponsorshipCheckbox,
  displayModeSelect,
  maxLookupsInput,
  apiKeyInput,
];

// The last values written to storage, so "has anything changed?" is a
// comparison against what is actually saved rather than a flag that can drift
// out of sync with the form.
let savedSettings = { ...DEFAULT_SETTINGS };
let savedNotice = null;

function readForm() {
  return {
    minYearsExperience: Number(minYearsInput.value) || 0,
    excludeNoSponsorship: excludeNoSponsorshipCheckbox.checked,
    displayMode: displayModeSelect.value,
    maxLookupsPerWindow: Math.max(0, Math.min(60, Number(maxLookupsInput.value) || 0)),
    anthropicApiKey: apiKeyInput.value.trim(),
  };
}

function writeForm(settings) {
  minYearsInput.value = settings.minYearsExperience;
  excludeNoSponsorshipCheckbox.checked = settings.excludeNoSponsorship;
  displayModeSelect.value = settings.displayMode;
  maxLookupsInput.value = settings.maxLookupsPerWindow;
  apiKeyInput.value = settings.anthropicApiKey;
}

function isDirty() {
  return JSON.stringify(readForm()) !== JSON.stringify(savedSettings);
}

function setStatus(state, text) {
  applyStatus.dataset.state = state;
  applyStatus.textContent = text;
}

// Called on every edit and after every save, so the button and the message
// are always derived from whether the form differs from storage — there is no
// separate state to keep correct.
function refreshApplyState() {
  if (savedNotice) return; // let the "Applied" confirmation finish showing

  const dirty = isDirty();
  applyButton.disabled = !dirty;
  setStatus(dirty ? "dirty" : "clean", dirty ? "Unsaved changes" : "Saved");
}

function applySettings() {
  const settings = readForm();

  chrome.storage.local.set({ settings }, () => {
    savedSettings = settings;
    // Normalizing the form to what was stored makes the save visible: a
    // lookup budget of 90 snaps to 60, blank years becomes 0.
    writeForm(settings);

    applyButton.disabled = true;
    setStatus("saved", "Applied to the page");

    clearTimeout(savedNotice);
    savedNotice = setTimeout(() => {
      savedNotice = null;
      refreshApplyState();
    }, 2000);
  });
}

function renderStats(stats) {
  document.getElementById("stat-regex").textContent = stats?.regexResolved ?? 0;
  document.getElementById("stat-llm").textContent = stats?.llmResolved ?? 0;
  document.getElementById("stat-failed").textContent = stats?.llmFailed ?? 0;
}

// Written by the content script, which is the only context that can see the
// page. Without it the panel could report how classification went but not
// whether anything actually got filtered — the question people ask first.
function renderPageStats(pageStats) {
  document.getElementById("stat-filtered").textContent = pageStats?.filtered ?? 0;
  document.getElementById("stat-total").textContent = pageStats?.total ?? 0;
}

function load() {
  chrome.storage.local.get(["settings", "stats", "pageStats"], ({ settings, stats, pageStats }) => {
    savedSettings = { ...DEFAULT_SETTINGS, ...settings };
    writeForm(savedSettings);
    refreshApplyState();

    renderStats(stats);
    renderPageStats(pageStats);
  });
}

// The side panel stays open while you browse, so the counters have to keep up
// on their own.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.stats) renderStats(changes.stats.newValue);
  if (changes.pageStats) renderPageStats(changes.pageStats.newValue);

  // Settings can also change from another window running this panel. The
  // form deliberately keeps whatever is in it — overwriting what someone has
  // typed is never right — so this only updates what "saved" means, and the
  // status reports that the form no longer matches storage.
  if (changes.settings) {
    savedSettings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    refreshApplyState();
  }
});

for (const input of INPUTS) {
  input.addEventListener("input", refreshApplyState);
  input.addEventListener("change", refreshApplyState);
  // Enter applies, which is what a form is expected to do.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && isDirty()) {
      event.preventDefault();
      applySettings();
    }
  });
}

applyButton.addEventListener("click", applySettings);

// A stored verdict is reused forever, so a bad one — from a regex since
// fixed, or an LLM answer that was wrong — would otherwise stick around with
// no way out short of wiping the extension. Reloading the page reclassifies.
clearCacheButton.addEventListener("click", () => {
  chrome.storage.local.set(
    { classifications: {}, stats: { regexResolved: 0, llmResolved: 0, llmFailed: 0 } },
    () => {
      clearCacheButton.textContent = "Cleared — reload the page";
      setTimeout(() => {
        clearCacheButton.textContent = "Clear cached classifications";
      }, 2500);
    }
  );
});

load();
