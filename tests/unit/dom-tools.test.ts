// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildSnapshot } from "../../src/dom/snapshot";
import { RefMap } from "../../src/dom/refmap";
import { extractFromRoot, extractTable } from "../../src/dom/extract";
import { htmlToMarkdown, readPageText } from "../../src/dom/readability";
import { readSelection } from "../../src/dom/selection";

async function fixtureDOM(name: string): Promise<JSDOM> {
  const html = await readFile(join(process.cwd(), "fixtures/pages", name), "utf8");
  return new JSDOM(html);
}

describe("snapshot walker", () => {
  it("emits refs for every interactive node on table.html", async () => {
    const dom = await fixtureDOM("table.html");
    const snapshot = buildSnapshot(dom.window.document);
    const linkLines = snapshot.text.split("\n").filter((l) => l.includes("link"));
    expect(linkLines.length).toBe(0); // table.html has no links
    expect(snapshot.text).toContain("table");
    expect(snapshot.refs.length).toBeGreaterThan(0);
    for (const ref of snapshot.refs) {
      expect(dom.window.document.querySelector(ref.selector)).not.toBeNull();
    }
  });

  it("emits link refs on search.html", async () => {
    const dom = await fixtureDOM("search.html");
    const snapshot = buildSnapshot(dom.window.document);
    const linkLines = snapshot.text.split("\n").filter((l) => l.includes("link"));
    expect(linkLines.length).toBe(3);
  });

  it("caps output at maxChars with a truncation marker", async () => {
    const dom = await fixtureDOM("search.html");
    const snapshot = buildSnapshot(dom.window.document, { maxChars: 60 });
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.text.length).toBeLessThan(300);
  });
});

describe("ref map generations", () => {
  it("rejects older generations and unknown refs as stale", async () => {
    const dom = await fixtureDOM("table.html");
    const refs = new RefMap();
    const gen1 = buildSnapshot(dom.window.document);
    refs.register(gen1.refs, 1);
    const first = gen1.refs[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(refs.resolve(first.ref, 1)).toEqual({ ok: true, entry: first });
    expect(refs.resolve(first.ref, 2)).toEqual({ ok: false, code: "E_STALE_REF" });
    // Simulate reload: new snapshot registered under gen 2 kills gen-1 refs.
    const gen2 = buildSnapshot(dom.window.document);
    refs.register(gen2.refs, 2);
    expect(refs.resolve(first.ref, 1)).toEqual({ ok: false, code: "E_STALE_REF" });
    expect(refs.resolve(9999, 2)).toEqual({ ok: false, code: "E_STALE_REF" });
  });
});

describe("extraction", () => {
  it("extracts the exact table rows from table.html", async () => {
    const dom = await fixtureDOM("table.html");
    const table = dom.window.document.querySelector("table");
    expect(table).not.toBeNull();
    if (!table) return;
    expect(extractTable(table as HTMLTableElement)).toEqual({
      headers: ["Product", "Price"],
      rows: [
        ["Red widget", "$12.50"],
        ["Blue widget", "$9.99"],
        ["Green widget", "$14.00"],
      ],
    });
    expect(extractFromRoot(dom.window.document, "table")).toEqual({
      headers: ["Product", "Price"],
      rows: [
        ["Red widget", "$12.50"],
        ["Blue widget", "$9.99"],
        ["Green widget", "$14.00"],
      ],
    });
  });

  it("extracts links and metadata from search.html", async () => {
    const dom = await fixtureDOM("search.html");
    const links = extractFromRoot(dom.window.document, "links") as { text: string; href: string }[];
    expect(links).toHaveLength(3);
    expect(links[0]?.text).toBe("Red widget");
  });
});

describe("page text", () => {
  it("reads markdown with prices preserved", async () => {
    const dom = await fixtureDOM("shop.html");
    const article = readPageText(dom.window.document, "markdown");
    expect(article.text).toContain("$12.50");
    expect(article.truncated).toBe(false);
  });

  it("serializes links to markdown", async () => {
    const dom = await fixtureDOM("search.html");
    expect(htmlToMarkdown('<p>See <a href="shop.html">shop</a></p>', dom.window.document)).toContain(
      "[shop](shop.html)",
    );
  });
});

describe("selection", () => {
  it("returns highlighted text", async () => {
    const dom = await fixtureDOM("table.html");
    const { document } = dom.window;
    const range = document.createRange();
    const cell = document.querySelector("td");
    expect(cell).not.toBeNull();
    if (!cell?.firstChild) return;
    range.selectNodeContents(cell);
    dom.window.getSelection()?.removeAllRanges();
    dom.window.getSelection()?.addRange(range);
    expect(readSelection(dom.window)).toBe("Red widget");
  });
});
