import { chromium } from "@playwright/test";
const EXT = "/home/prit-italiya/Documents/Default Project/.output/chrome-mv3";
const ctx = await chromium.launchPersistentContext("", {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const page = await ctx.newPage();
await page.goto("http://localhost:4173/table.html");
await page.waitForTimeout(3000);
console.log("workers:", ctx.serviceWorkers().length);
console.log("has host:", await page.evaluate(() => !!document.querySelector("assistant-overlay")));
await ctx.close();
