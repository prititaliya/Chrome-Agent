import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import type { ContentRequest } from "../../src/browser/protocol";
import { handleRequest } from "../../src/dom/handler";

const MARKER = "__cometAssistantContent";

function isContentRequest(raw: unknown): raw is ContentRequest {
  return (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { type?: unknown }).type === "string" &&
    (raw as { type: string }).type.startsWith("cs/")
  );
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    // The panel re-injects this file into tabs opened before install; never listen twice.
    const scope = globalThis as Record<string, unknown>;
    if (scope[MARKER]) return;
    scope[MARKER] = true;

    browser.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
      if (!isContentRequest(raw)) return undefined;
      handleRequest(document, raw)
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
        );
      return true;
    });
  },
});
