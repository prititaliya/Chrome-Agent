// Rasterize assets/icon.svg into the PNG sizes Chrome uses (public/icon/<size>.png,
// which WXT adds to the manifest automatically). Uses Playwright's Chromium.
// Usage: node scripts/make-icons.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const SIZES = [16, 32, 48, 128];
const svg = await readFile(new URL("../assets/icon.svg", import.meta.url), "utf8");
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    await page.locator("img").evaluate((img) => img.decode());
    const out = new URL(`../public/icon/${size}.png`, import.meta.url);
    await page.screenshot({ path: fileURLToPath(out), omitBackground: true });
    await page.close();
    console.log(`public/icon/${size}.png`);
  }
} finally {
  await browser.close();
}
