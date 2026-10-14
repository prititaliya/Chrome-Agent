// @vitest-environment jsdom
// Fixture matrix for structured extraction (plan Task 44): table, list,
// paginated and SPA fixtures must score ≥95% field accuracy.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { extractFromRoot, extractList, extractTable } from "../../src/dom/extract";

async function fixtureDOM(name: string): Promise<JSDOM> {
  const html = await readFile(join(process.cwd(), "fixtures/pages", name), "utf8");
  return new JSDOM(html, {
    url: "https://example.com/page",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
}

/** Field accuracy = matched expected fields / total expected fields. */
function accuracy(matched: number, total: number): number {
  return total === 0 ? 0 : matched / total;
}

describe("extraction accuracy matrix", () => {
  it("table fixture: headers and cells match exactly", async () => {
    const dom = await fixtureDOM("table.html");
    const data = extractFromRoot(dom.window.document, "table") as ReturnType<typeof extractTable>;
    expect(data.headers).toEqual(["Product", "Price"]);
    const expected = [
      ["Red widget", "$12.50"],
      ["Blue widget", "$9.99"],
      ["Green widget", "$14.00"],
    ];
    let matched = 0;
    let total = data.headers.length;
    for (const [index, row] of expected.entries()) {
      for (const [cellIndex, cell] of row.entries()) {
        total += 1;
        if (data.rows[index]?.[cellIndex] === cell) matched += 1;
      }
    }
    for (const header of ["Product", "Price"]) if (data.headers.includes(header)) matched += 1;
    expect(accuracy(matched, total)).toBeGreaterThanOrEqual(0.95);
    expect(accuracy(matched, total)).toBe(1); // exact on this fixture
  });

  it("list fixture: every result row keeps its name and price", async () => {
    const dom = await fixtureDOM("search.html");
    const doc = dom.window.document;
    const list = extractList(doc.querySelector("ul") as HTMLUListElement);
    const expected = [
      { name: "Red widget", price: "$12.50" },
      { name: "Blue widget", price: "$9.99" },
      { name: "Green widget", price: "$14.00" },
    ];
    let matched = 0;
    let total = 0;
    for (const [index, item] of expected.entries()) {
      total += 2;
      const row = list[index] ?? "";
      if (row.includes(item.name)) matched += 1;
      if (row.includes(item.price)) matched += 1;
    }
    expect(accuracy(matched, total)).toBeGreaterThanOrEqual(0.95);
    expect(accuracy(matched, total)).toBe(1);
    // Links carry resolvable hrefs for follow-up navigation.
    const links = extractFromRoot(doc, "links") as { text: string; href: string }[];
    expect(links.some((l) => l.href.includes("red-widget"))).toBe(true);
  });

  it("paginated fixture: revealed items are extractable after load-more", async () => {
    const dom = await fixtureDOM("lazy.html");
    const doc = dom.window.document;
    const before = extractList(doc.querySelector("#feed") as HTMLUListElement);
    expect(before).toEqual(["Item one", "Item two"]);

    const button = doc.querySelector("#load-more") as HTMLButtonElement;
    button.click();
    button.click();
    button.click();
    const after = extractList(doc.querySelector("#feed") as HTMLUListElement);
    const expected = ["Item one", "Item two", "Item three", "Item four", "Item five"];
    const matched = expected.filter((item, index) => after[index] === item).length;
    expect(accuracy(matched, expected.length)).toBeGreaterThanOrEqual(0.95);
    expect(after).toEqual(expected);
  });

  it("SPA fixture: table is extractable after the deferred render", async () => {
    const dom = await fixtureDOM("dynamic.html");
    const doc = dom.window.document;
    expect(doc.querySelector("#app table")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 260));
    const data = extractFromRoot(doc, "table") as ReturnType<typeof extractTable>;
    expect(data.headers).toEqual(["Metric", "Value"]);
    const expected = [
      ["Visits", "1,204"],
      ["Signups", "87"],
    ];
    let matched = data.headers.length;
    let total = data.headers.length;
    for (const [index, row] of expected.entries()) {
      for (const [cellIndex, cell] of row.entries()) {
        total += 1;
        if (data.rows[index]?.[cellIndex] === cell) matched += 1;
      }
    }
    expect(accuracy(matched, total)).toBeGreaterThanOrEqual(0.95);
    expect(accuracy(matched, total)).toBe(1);
  });
});
