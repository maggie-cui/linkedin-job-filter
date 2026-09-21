import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    // Chrome unpacks from dist/ — load that folder, not the repo root.
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
