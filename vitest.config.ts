import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/setup.ts installs the fake extension APIs (storage, runtime)
    // before any test module loads, so storage modules run without a browser.
    setupFiles: ["./tests/setup.ts"],
    // Playwright specs live under tests/e2e and run via pnpm e2e, not vitest.
    include: ["tests/unit/**/*.test.ts"],
  },
});
