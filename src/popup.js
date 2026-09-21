const DEFAULT_SETTINGS = {
  minYearsExperience: 0,
  excludeNoSponsorship: false,
  maxLookupsPerWindow: 6,
};

const minYearsInput = document.getElementById("min-years");
const excludeNoSponsorshipCheckbox = document.getElementById("exclude-no-sponsorship");
const maxLookupsInput = document.getElementById("max-lookups");

function loadSettings() {
  chrome.storage.local.get("settings", ({ settings }) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    minYearsInput.value = merged.minYearsExperience;
    excludeNoSponsorshipCheckbox.checked = merged.excludeNoSponsorship;
    maxLookupsInput.value = merged.maxLookupsPerWindow;
  });
}

function saveSettings() {
  chrome.storage.local.set({
    settings: {
      minYearsExperience: Number(minYearsInput.value) || 0,
      excludeNoSponsorship: excludeNoSponsorshipCheckbox.checked,
      maxLookupsPerWindow: Math.max(0, Math.min(20, Number(maxLookupsInput.value) || 0)),
    },
  });
}

minYearsInput.addEventListener("input", saveSettings);
excludeNoSponsorshipCheckbox.addEventListener("change", saveSettings);
maxLookupsInput.addEventListener("input", saveSettings);

loadSettings();
