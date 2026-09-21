import { defineManifest } from "@crxjs/vite-plugin";

const linkedInMatches = ["*://www.linkedin.com/jobs/*"];

export default defineManifest({
  manifest_version: 3,
  name: "LinkedIn Job Filter",
  description: "Custom filtering for LinkedIn job search results.",
  version: "0.2.0",
  permissions: ["storage", "sidePanel"],
  // api.anthropic.com is called from the service worker, not the content
  // script — a content script calling it would be cross-origin from
  // linkedin.com, and this keeps the API key out of any page-adjacent context.
  host_permissions: ["*://www.linkedin.com/*", "https://api.anthropic.com/*"],
  // No default_popup: a popup closes the moment it loses focus and Chrome
  // gives no way to keep it open. The same page is served as a side panel
  // instead, which stays docked until it's explicitly closed. The action
  // click is wired to open it in background.js.
  action: {
    default_title: "LinkedIn Job Filter Settings",
  },
  side_panel: {
    default_path: "src/popup.html",
  },
  background: {
    service_worker: "src/background.js",
    type: "module",
  },
  content_scripts: [
    {
      matches: linkedInMatches,
      js: ["src/content.js"],
      run_at: "document_idle",
    },
  ],
});
