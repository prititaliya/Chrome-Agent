# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mvp.spec.ts >> overlay bubble mounts inside a closed shadow root
- Location: tests/e2e/mvp.spec.ts:45:1

# Error details

```
TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('assistant-overlay') to be visible

```

# Test source

```ts
  1  | import { existsSync } from "node:fs";
  2  | import { join } from "node:path";
  3  | import { expect, test, type BrowserContext } from "@playwright/test";
  4  | 
  5  | const EXTENSION = join(process.cwd(), ".output/chrome-mv3");
  6  | 
  7  | async function launchWithExtension(): Promise<BrowserContext> {
  8  |   const { chromium } = await import("@playwright/test");
  9  |   return chromium.launchPersistentContext("", {
  10 |     channel: "chrome",
  11 |     headless: false,
  12 |     args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  13 |   });
  14 | }
  15 | 
  16 | test("panel asset exists at the manifest-declared path", () => {
  17 |   expect(existsSync(join(EXTENSION, "sidepanel.html"))).toBe(true);
  18 | });
  19 | 
  20 | test("content bridge answers a real snapshot on table.html", async () => {
  21 |   const context = await launchWithExtension();
  22 |   try {
  23 |     const page = await context.newPage();
  24 |     await page.goto("http://localhost:4173/table.html");
  25 |     // Overlay shadow host proves the content script runs in-page.
  26 |     await page.waitForSelector("assistant-overlay", { timeout: 15_000 });
  27 | 
  28 |     const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  29 |     const response = (await worker.evaluate(
  30 |       `;(async () => {
  31 |         const tabs = await chrome.tabs.query({ url: "http://localhost:4173/*" });
  32 |         if (tabs.length === 0 || tabs[0].id === undefined) return { ok: false, code: "E_TAB_GONE" };
  33 |         return await chrome.tabs.sendMessage(tabs[0].id, { type: "agent/snapshot", gen: 1 });
  34 |       })()`,
  35 |     )) as { ok: boolean; text?: string; code?: string };
  36 | 
  37 |     expect(response.ok).toBe(true);
  38 |     expect(response.text ?? "").toContain("table");
  39 |     expect(response.text ?? "").toMatch(/\[e\d+\]/);
  40 |   } finally {
  41 |     await context.close();
  42 |   }
  43 | });
  44 | 
  45 | test("overlay bubble mounts inside a closed shadow root", async () => {
  46 |   const context = await launchWithExtension();
  47 |   try {
  48 |     const page = await context.newPage();
  49 |     await page.goto("http://localhost:4173/search.html");
> 50 |     const host = await page.waitForSelector("assistant-overlay", { timeout: 15_000 });
     |                             ^ TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
  51 |     const mode = await host.evaluate(
  52 |       (el) => (el as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot?.mode ?? null,
  53 |     );
  54 |     expect(mode).toBe("closed");
  55 |     // Page CSS cannot reach inside: the bubble button keeps its own background.
  56 |     const buttonBg = await page.evaluate(() => {
  57 |       const h = document.querySelector("assistant-overlay");
  58 |       const root = (h as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
  59 |       const button = root.querySelector('button[aria-label="Open assistant"]') as HTMLElement | null;
  60 |       return button ? getComputedStyle(button).backgroundColor : null;
  61 |     });
  62 |     expect(buttonBg).toBe("rgb(31, 41, 55)");
  63 |   } finally {
  64 |     await context.close();
  65 |   }
  66 | });
  67 | 
```