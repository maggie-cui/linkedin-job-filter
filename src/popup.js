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
const clearCacheButton = document.getElementById("clear-cache");

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

function loadSettings() {
  chrome.storage.local.get(["settings", "stats", "pageStats"], ({ settings, stats, pageStats }) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    minYearsInput.value = merged.minYearsExperience;
    excludeNoSponsorshipCheckbox.checked = merged.excludeNoSponsorship;
    displayModeSelect.value = merged.displayMode;
    maxLookupsInput.value = merged.maxLookupsPerWindow;
    apiKeyInput.value = merged.anthropicApiKey;

    renderStats(stats);
    renderPageStats(pageStats);
  });
}

// The side panel stays open while you browse, so the counters have to keep
// up on their own. Only the counters are re-rendered — re-rendering the
// inputs would fight you mid-keystroke, since every keypress saves and that
// save comes straight back through this listener.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.stats) renderStats(changes.stats.newValue);
  if (changes.pageStats) renderPageStats(changes.pageStats.newValue);
});

function saveSettings() {
  chrome.storage.local.set({
    settings: {
      minYearsExperience: Number(minYearsInput.value) || 0,
      excludeNoSponsorship: excludeNoSponsorshipCheckbox.checked,
      displayMode: displayModeSelect.value,
      maxLookupsPerWindow: Math.max(0, Math.min(60, Number(maxLookupsInput.value) || 0)),
      anthropicApiKey: apiKeyInput.value.trim(),
    },
  });
}

minYearsInput.addEventListener("input", saveSettings);
excludeNoSponsorshipCheckbox.addEventListener("change", saveSettings);
displayModeSelect.addEventListener("change", saveSettings);
maxLookupsInput.addEventListener("input", saveSettings);
apiKeyInput.addEventListener("input", saveSettings);

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

loadSettings();
