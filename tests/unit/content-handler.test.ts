// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseKeyCombo } from "../../src/browser/cdp";
import { handleRequest, searchResults, targetFacts } from "../../src/dom/handler";
import { buildSnapshot, findByRef } from "../../src/dom/snapshot";

function dom(html: string): Document {
  document.title = "Fixture";
  document.body.innerHTML = html;
  return document;
}

describe("snapshot", () => {
  it("stamps refs on interactive elements and lists headings", () => {
    const doc = dom(`
      <h1>Store</h1>
      <a href="/cart">Cart</a>
      <input name="q" placeholder="Search products">
      <button>Buy now</button>
      <div style="display:none"><button>Hidden</button></div>
      <select name="size"><option>S</option><option selected>M</option></select>
    `);
    const snap = buildSnapshot(doc);
    expect(snap.text).toContain("# Store");
    expect(snap.text).toContain('[1] link "Cart" -> /cart');
    expect(snap.text).toContain('[2] textbox "Search products"');
    expect(snap.text).toContain('[3] button "Buy now"');
    expect(snap.text).toContain('selected="M"');
    expect(snap.text).not.toContain("Hidden");
    expect(findByRef(doc, 3)?.textContent).toBe("Buy now");
  });

  it("re-numbers on each snapshot", () => {
    const doc = dom(`<button>A</button>`);
    buildSnapshot(doc);
    doc.body.insertAdjacentHTML("afterbegin", "<button>B</button>");
    buildSnapshot(doc);
    expect(findByRef(doc, 1)?.textContent).toBe("B");
    expect(findByRef(doc, 2)?.textContent).toBe("A");
  });
});

describe("content requests", () => {
  it("types into fields and reports stale refs", async () => {
    const doc = dom(`<input name="email">`);
    buildSnapshot(doc);
    const typed = await handleRequest(doc, { type: "cs/domType", ref: 1, text: "a@b.c", replace: true });
    expect(typed).toMatchObject({ ok: true });
    expect((doc.querySelector("input") as HTMLInputElement).value).toBe("a@b.c");
    const stale = await handleRequest(doc, { type: "cs/domClick", ref: 99 });
    expect(stale).toMatchObject({ ok: false });
  });

  it("selects options by visible text", async () => {
    const doc = dom(`<select><option value="s">Small</option><option value="l">Large</option></select>`);
    buildSnapshot(doc);
    await handleRequest(doc, { type: "cs/domSelect", ref: 1, value: "large" });
    expect((doc.querySelector("select") as HTMLSelectElement).value).toBe("l");
  });

  it("finds text with context", async () => {
    const doc = dom(`<p>The price of the blue widget is $42 today.</p>`);
    const r = await handleRequest(doc, { type: "cs/find", query: "$42" });
    expect(r).toMatchObject({ ok: true, kind: "text" });
    expect(r.ok && r.kind === "text" ? r.text : "").toContain("blue widget is $42");
  });
});

describe("target facts", () => {
  it("recognises search forms vs other forms", () => {
    const doc = dom(`
      <form action="/search"><input name="q"><button id="s">Go</button></form>
      <form action="/login"><input name="user"><input type="password" name="pw"><button id="l">Sign in</button></form>
      <form><input name="card-number" autocomplete="cc-number"><button id="p">Continue</button></form>
    `);
    expect(targetFacts(doc.getElementById("s")!)).toMatchObject({ isSubmit: true, formIsSearch: true });
    expect(targetFacts(doc.getElementById("l")!)).toMatchObject({ isSubmit: true, formIsSearch: false, formHasPassword: true });
    expect(targetFacts(doc.getElementById("p")!)).toMatchObject({ formHasPayment: true });
  });
});

describe("search result parsing", () => {
  it("reads DuckDuckGo HTML results", () => {
    const doc = dom(`
      <div class="result"><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Example A</a>
      <a class="result__snippet">Snippet A</a></div>
      <div class="result"><a class="result__a" href="https://example.org/b">Example B</a><div class="result__snippet">Snippet B</div></div>
    `);
    expect(searchResults(doc, "duckduckgo")).toEqual([
      { title: "Example A", url: "https://example.com/a", snippet: "Snippet A" },
      { title: "Example B", url: "https://example.org/b", snippet: "Snippet B" },
    ]);
  });

  it("reads Google-style results and skips internal links", () => {
    const doc = dom(`
      <div id="search">
        <div class="g"><a href="https://news.test/story"><h3>Big story</h3></a><span>Details here</span></div>
        <div class="g"><a href="https://www.google.com/preferences"><h3>Settings</h3></a></div>
      </div>
    `);
    const results = searchResults(doc, "google");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: "Big story", url: "https://news.test/story" });
    expect(results[0]!.snippet).toContain("Details here");
  });
});

describe("key combos", () => {
  it("parses special keys and modifiers", () => {
    expect(parseKeyCombo("Enter")).toMatchObject({ spec: { key: "Enter", keyCode: 13, text: "\r" }, modifiers: 0 });
    expect(parseKeyCombo("Control+a")).toMatchObject({ spec: { key: "a", code: "KeyA", text: undefined }, modifiers: 2 });
    expect(parseKeyCombo("Shift+Tab")).toMatchObject({ spec: { key: "Tab" }, modifiers: 8 });
  });
});
