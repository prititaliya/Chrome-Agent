import { test as base, chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import type { ProviderConfig } from "../../src/providers/types";
import type { Settings } from "../../src/storage/settings";

// Only what the worker-side callbacks below touch.
declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  windows: { create(options: Record<string, unknown>): Promise<unknown> };
  runtime: { getURL(path: string): string };
};

const EXTENSION = join(process.cwd(), ".output/chrome-mv3");
export const FIXTURES = "http://localhost:4173";

interface Fixtures {
  context: BrowserContext;
  /** The user's tab, showing fixtures/pages/form.html. */
  site: Page;
  /** Store providers/settings, then open the side panel UI in a popup window. */
  openPanel: (providers: ProviderConfig[], settings: Partial<Settings>) => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: !process.env.HEADFUL,
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
        // A synthetic microphone that is allowed without a prompt, for dictation tests.
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    await use(context);
    await context.close();
  },
  site: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${FIXTURES}/form.html`);
    await use(page);
  },
  openPanel: async ({ context, site }, use) => {
    void site;
    await use(async (providers, settings) => {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      await worker.evaluate(
        async (items) => {
          await chrome.storage.local.set(items);
        },
        {
          "providers:v2": providers,
          "settings:v2": { maxSteps: 12, searchEngine: "duckduckgo", controlMode: "cdp", screenshots: false, attachPage: true, ...settings },
        },
      );
      const opened = context.waitForEvent("page");
      await worker.evaluate(() =>
        chrome.windows.create({ url: chrome.runtime.getURL("sidepanel.html"), type: "popup", width: 420, height: 800 }),
      );
      const panel = await opened;
      await panel.setViewportSize({ width: 400, height: 720 });
      await panel.waitForLoadState("domcontentloaded");
      return panel;
    });
  },
});

/** Send a message and wait until the turn has finished (or is waiting for approval). */
export async function ask(panel: Page, text: string, { waitForEnd = true, timeout = 150_000 } = {}): Promise<void> {
  const box = panel.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  await box.press("Enter");
  if (!waitForEnd) return;
  const stop = panel.getByRole("button", { name: "Stop" });
  await stop.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  await expect(stop).toBeHidden({ timeout });
}

export { expect };
