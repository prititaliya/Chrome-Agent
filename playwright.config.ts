import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const EXTENSION = join(process.cwd(), ".output/chrome-mv3");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  reporter: "line",
  use: {
    launchOptions: {
      // System Chrome (extensions need a real, headful browser).
      channel: "chrome",
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    },
  },
  webServer: {
    command: "node scripts/serve-fixtures.mjs 4173",
    port: 4173,
    reuseExistingServer: true,
  },
});
