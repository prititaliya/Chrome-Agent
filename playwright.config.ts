import { defineConfig } from "@playwright/test";

// The extension is loaded per test via launchPersistentContext (see tests/e2e).
// Run `pnpm build` first; set HEADFUL=1 to watch.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "line",
  webServer: {
    command: "node scripts/serve-fixtures.mjs 4173",
    port: 4173,
    reuseExistingServer: true,
  },
});
