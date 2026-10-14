// Panel-side bridge to the content script, with on-demand injection for tabs
// that were open before the extension was installed or reloaded.

import { browser } from "wxt/browser";
import type { ContentRequest, ContentResponse } from "./protocol";

const CONTENT_FILE = "content-scripts/content.js";

export function isScriptableUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (!/^(https?|file):/i.test(url)) return false;
  return !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
}

async function rawSend(tabId: number, req: ContentRequest): Promise<ContentResponse> {
  return (await browser.tabs.sendMessage(tabId, req, { frameId: 0 })) as ContentResponse;
}

async function inject(tabId: number): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
}

export async function sendToTab(tabId: number, req: ContentRequest): Promise<ContentResponse> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab) return { ok: false, error: `Tab ${tabId} no longer exists.` };
  if (!isScriptableUrl(tab.url)) {
    return { ok: false, error: `Cannot access ${tab.url ?? "this page"} (browser-internal or restricted page).` };
  }
  try {
    const response = await rawSend(tabId, req);
    if (response) return response;
  } catch {
    // No listener yet: inject below and retry once.
  }
  try {
    await inject(tabId);
    const response = await rawSend(tabId, req);
    return response ?? { ok: false, error: "No response from page." };
  } catch (error) {
    return { ok: false, error: `Page not reachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Wait until the tab reports `complete` (or the timeout passes). */
export async function waitForTabLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab || tab.status === "complete") {
    await new Promise((r) => setTimeout(r, 300));
    const again = await browser.tabs.get(tabId).catch(() => null);
    if (!again || again.status === "complete") return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id: number, info: { status?: string }) {
      if (id === tabId && info.status === "complete") done();
    }
    browser.tabs.onUpdated.addListener(listener);
  });
}
