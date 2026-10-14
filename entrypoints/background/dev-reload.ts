import { browser } from "wxt/browser";

// Dev-workflow client for scripts/dev-reload.mjs (unpacked-build testing).
// Connects to a localhost SSE stream; on any event, reloads the extension.
// Silent no-op when nothing listens (normal installs, store builds).
export async function armDevReload(port = 35929): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/events`);
    if (response.body === null) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (decoder.decode(value).includes("event: reload")) {
        browser.runtime.reload();
        return;
      }
    }
  } catch {
    // No dev server: ignore.
  }
}
