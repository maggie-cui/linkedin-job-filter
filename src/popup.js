const DEFAULT_SETTINGS = {
  minYearsExperience: 0,
  excludeNoSponsorship: false,
};

const minYearsInput = document.getElementById("min-years");
const excludeNoSponsorshipCheckbox = document.getElementById("exclude-no-sponsorship");

function loadSettings() {
  chrome.storage.local.get("settings", ({ settings }) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    minYearsInput.value = merged.minYearsExperience;
    excludeNoSponsorshipCheckbox.checked = merged.excludeNoSponsorship;
  });
}

function saveSettings() {
  chrome.storage.local.set({
    settings: {
      minYearsExperience: Number(minYearsInput.value) || 0,
      excludeNoSponsorship: excludeNoSponsorshipCheckbox.checked,
    },
  });
}

minYearsInput.addEventListener("input", saveSettings);
excludeNoSponsorshipCheckbox.addEventListener("change", saveSettings);

loadSettings();
