// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  clickElement,
  isInteractable,
  pressKeyOn,
  scrollByAmount,
  typeInto,
  waitForContent,
} from "../../src/dom/actions";

async function fixtureDOM(name: string): Promise<JSDOM> {
  const html = await readFile(join(process.cwd(), "fixtures/pages", name), "utf8");
  return new JSDOM(html, { url: "https://example.com/page", pretendToBeVisual: true });
}

describe("synthetic input primitives", () => {
  it("click dispatches the full mouse sequence", async () => {
    const dom = await fixtureDOM("search.html");
    const doc = dom.window.document;
    const link = doc.querySelector("a");
    expect(link).not.toBeNull();
    const seen: string[] = [];
    link?.addEventListener("mousedown", () => seen.push("down"));
    link?.addEventListener("mouseup", () => seen.push("up"));
    link?.addEventListener("click", () => seen.push("click"));
    clickElement(link as Element);
    expect(seen).toEqual(["down", "up", "click"]);
  });

  it("rejects disabled controls as non-interactable", async () => {
    const dom = await fixtureDOM("search.html");
    const button = dom.window.document.createElement("button");
    button.setAttribute("disabled", "");
    expect(isInteractable(button)).toBe(false);
  });

  it("types with fill and keys modes and fires input events", async () => {
    const dom = await fixtureDOM("form.html");
    const doc = dom.window.document;
    const input = doc.querySelector('input[name="name"]') as HTMLInputElement;
    let inputs = 0;
    input.addEventListener("input", () => {
      inputs += 1;
    });
    expect(typeInto(input, "Ada")).toBe("Ada");
    expect(inputs).toBeGreaterThan(0);
    expect(typeInto(input, "Lovelace", { mode: "keys" })).toBe("Lovelace");
    expect(typeInto(input, "!", { replace: false })).toBe("Lovelace!");
  });

  it("presses keys with the right key value", async () => {
    const dom = await fixtureDOM("form.html");
    const doc = dom.window.document;
    const seen: string[] = [];
    doc.addEventListener("keydown", (e) => seen.push((e as KeyboardEvent).key));
    pressKeyOn(doc, "Enter");
    expect(seen).toEqual(["Enter"]);
  });

  it("reports scroll metrics", async () => {
    const dom = await fixtureDOM("lazy.html");
    const metrics = scrollByAmount(dom.window, "bottom");
    expect(metrics.pageHeight).toBeGreaterThanOrEqual(0);
    expect(typeof metrics.atBottom).toBe("boolean");
  });

  it("waits for text to appear", async () => {
    const dom = await fixtureDOM("table.html");
    expect(await waitForContent(dom.window.document, "text", "Blue widget", 1000)).toBeGreaterThanOrEqual(0);
    expect(await waitForContent(dom.window.document, "selector", ".nope", 150)).toBe(-1);
  });
});
