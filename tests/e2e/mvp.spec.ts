import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";

const EXTENSION = join(process.cwd(), ".output/chrome-mv3");

async function launchWithExtension(): Promise<BrowserContext> {
  const { chromium } = await import("@playwright/test");
  return chromium.launchPersistentContext("", {
    channel: "chrome",
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
}

test("panel asset exists at the manifest-declared path", () => {
  expect(existsSync(join(EXTENSION, "sidepanel.html"))).toBe(true);
});

test("content bridge answers a real snapshot on table.html", async () => {
  const context = await launchWithExtension();
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:4173/table.html");
    // Overlay shadow host proves the content script runs in-page.
    await page.waitForSelector("assistant-overlay", { timeout: 15_000 });

    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const response = (await worker.evaluate(
      `;(async () => {
        const tabs = await chrome.tabs.query({ url: "http://localhost:4173/*" });
        if (tabs.length === 0 || tabs[0].id === undefined) return { ok: false, code: "E_TAB_GONE" };
        return await chrome.tabs.sendMessage(tabs[0].id, { type: "agent/snapshot", gen: 1 });
      })()`,
    )) as { ok: boolean; text?: string; code?: string };

    expect(response.ok).toBe(true);
    expect(response.text ?? "").toContain("table");
    expect(response.text ?? "").toMatch(/\[e\d+\]/);
  } finally {
    await context.close();
  }
});

test("overlay bubble mounts inside a closed shadow root", async () => {
  const context = await launchWithExtension();
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:4173/search.html");
    const host = await page.waitForSelector("assistant-overlay", { timeout: 15_000 });
    const mode = await host.evaluate(
      (el) => (el as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot?.mode ?? null,
    );
    expect(mode).toBe("closed");
    // Page CSS cannot reach inside: the bubble button keeps its own background.
    const buttonBg = await page.evaluate(() => {
      const h = document.querySelector("assistant-overlay");
      const root = (h as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
      const button = root.querySelector('button[aria-label="Open assistant"]') as HTMLElement | null;
      return button ? getComputedStyle(button).backgroundColor : null;
    });
    expect(buttonBg).toBe("rgb(31, 41, 55)");
  } finally {
    await context.close();
  }
});
