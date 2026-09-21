const DEFAULT_SETTINGS = {
  minYearsExperience: 0,
  excludeNoSponsorship: false,
  maxLookupsPerWindow: 30,
  anthropicApiKey: "",
};

const minYearsInput = document.getElementById("min-years");
const excludeNoSponsorshipCheckbox = document.getElementById("exclude-no-sponsorship");
const maxLookupsInput = document.getElementById("max-lookups");
const apiKeyInput = document.getElementById("api-key");

function loadSettings() {
  chrome.storage.local.get(["settings", "stats"], ({ settings, stats }) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    minYearsInput.value = merged.minYearsExperience;
    excludeNoSponsorshipCheckbox.checked = merged.excludeNoSponsorship;
    maxLookupsInput.value = merged.maxLookupsPerWindow;
    apiKeyInput.value = merged.anthropicApiKey;

    document.getElementById("stat-regex").textContent = stats?.regexResolved ?? 0;
    document.getElementById("stat-llm").textContent = stats?.llmResolved ?? 0;
    document.getElementById("stat-failed").textContent = stats?.llmFailed ?? 0;
  });
}

function saveSettings() {
  chrome.storage.local.set({
    settings: {
      minYearsExperience: Number(minYearsInput.value) || 0,
      excludeNoSponsorship: excludeNoSponsorshipCheckbox.checked,
      maxLookupsPerWindow: Math.max(0, Math.min(60, Number(maxLookupsInput.value) || 0)),
      anthropicApiKey: apiKeyInput.value.trim(),
    },
  });
}

minYearsInput.addEventListener("input", saveSettings);
excludeNoSponsorshipCheckbox.addEventListener("change", saveSettings);
maxLookupsInput.addEventListener("input", saveSettings);
apiKeyInput.addEventListener("input", saveSettings);

loadSettings();
