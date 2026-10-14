// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { computeAttestFacts } from "../../src/dom/attest-facts";
import { buildSnapshot } from "../../src/dom/snapshot";
import { classify } from "../../src/security/write-gate";

async function fixtureDOM(name: string): Promise<JSDOM> {
  const html = await readFile(join(process.cwd(), "fixtures/pages", name), "utf8");
  return new JSDOM(html, { url: "https://example.com/page", pretendToBeVisual: true });
}

describe("attested facts on fixture pages", () => {
  it("Delete button on injection.html classifies irreversible via the lexicon", async () => {
    const dom = await fixtureDOM("injection.html");
    const doc = dom.window.document;
    const snapshot = buildSnapshot(doc);
    const entry = snapshot.refs.find((r) => r.name === "Delete account");
    expect(entry).toBeDefined();
    if (!entry) return;
    const element = doc.querySelector(entry.selector);
    expect(element).not.toBeNull();
    if (!element) return;
    const facts = computeAttestFacts(doc, { element, role: entry.role, name: entry.name }, doc.URL);
    expect(facts.target?.isSubmitControl).toBe(false);
    const verdict = classify("browser_click", { ref: entry.ref }, facts, []);
    expect(verdict.cls).toBe("irreversible");
    expect(verdict.reason).toContain("Delete account");
  });

  it("form submit control attests isSubmitControl with its form action", async () => {
    const dom = await fixtureDOM("form.html");
    const doc = dom.window.document;
    const snapshot = buildSnapshot(doc);
    const entry = snapshot.refs.find((r) => r.name === "Send message");
    expect(entry).toBeDefined();
    if (!entry) return;
    const element = doc.querySelector(entry.selector);
    if (!element) return;
    const facts = computeAttestFacts(doc, { element, role: entry.role, name: entry.name }, doc.URL);
    expect(facts.target?.isSubmitControl).toBe(true);
    expect(facts.target?.inForm).toBe(true);
    expect(classify("browser_click", { ref: entry.ref }, facts, []).cls).toBe("irreversible");
  });

  it("focused input attests focus-in-form for Enter classification", async () => {
    const dom = await fixtureDOM("form.html");
    const doc = dom.window.document;
    const input = doc.querySelector('input[name="name"]');
    expect(input).not.toBeNull();
    (input as HTMLInputElement).focus();
    const facts = computeAttestFacts(doc, null, doc.URL);
    expect(facts.focus.inForm).toBe(true);
    expect(classify("browser_press_key", { key: "Enter" }, facts, []).cls).toBe("irreversible");
  });
});
