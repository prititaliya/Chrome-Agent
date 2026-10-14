import { beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

// Install the in-memory extension APIs before test modules evaluate: the
// storage layer resolves `globalThis.chrome` at import time.
(globalThis as Record<string, unknown>).chrome = fakeBrowser;

beforeEach(() => {
  fakeBrowser.reset();
});
