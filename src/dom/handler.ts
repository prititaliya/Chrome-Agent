// Content-script request handler. Runs in the page's isolated world and only
// touches the DOM; everything privileged (CDP, tabs) lives in the panel.

import type { ContentRequest, ContentResponse, SearchEngine, SearchResult, TargetFacts } from "../browser/protocol";
import { clickElement, pressKeyOn, scrollByAmount, typeInto, waitForContent } from "./actions";
import { accessibleName } from "./axname";
import { extractFromRoot } from "./extract";
import { readPageText } from "./readability";
import { buildSnapshot, findByRef } from "./snapshot";

const PAYMENT_HINT = /card|cc-|cvc|cvv|expir|iban|billing|payment/i;

function visibleText(doc: Document): string {
  const body = doc.body;
  if (!body) return "";
  const text = typeof body.innerText === "string" ? body.innerText : (body.textContent ?? "");
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Article pages read best through Readability; app-like pages through innerText. */
export function pageText(doc: Document, maxChars: number): { text: string; truncated: boolean } {
  const plain = visibleText(doc);
  const article = readPageText(doc, "markdown", undefined, Number.MAX_SAFE_INTEGER);
  const useArticle = article.text.length >= 1500 || article.text.length >= plain.length * 0.5;
  const text = useArticle ? article.text : plain;
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

function isSearchForm(form: Element, fields: Element[]): boolean {
  if (form.getAttribute("role") === "search" || form.closest("[role=search], search")) return true;
  if (/search|\/s\b|query/i.test(form.getAttribute("action") ?? "")) return true;
  const textual = fields.filter((f) => {
    const type = (f.getAttribute("type") ?? "text").toLowerCase();
    return f.tagName.toLowerCase() === "textarea" || ["text", "search", ""].includes(type);
  });
  return (
    textual.length === 1 &&
    textual.some((f) => f.getAttribute("type") === "search" || /^(q|query|search|s|k|keywords?)$/i.test(f.getAttribute("name") ?? ""))
  );
}

export function targetFacts(element: Element): TargetFacts {
  const tag = element.tagName.toLowerCase();
  const inputType = (element.getAttribute("type") ?? "").toLowerCase();
  const form = element.closest("form");
  const fields = form ? [...form.querySelectorAll("input, select, textarea")] : [];
  const fieldHint = (field: Element) =>
    `${field.getAttribute("name") ?? ""} ${field.getAttribute("id") ?? ""} ${field.getAttribute("autocomplete") ?? ""}`;
  return {
    tag,
    role: element.getAttribute("role") ?? tag,
    name: accessibleName(element),
    inputType,
    href: element.closest("a")?.getAttribute("href") ?? "",
    isSubmit:
      (tag === "button" && (inputType === "" || inputType === "submit") && form !== null) ||
      (tag === "input" && (inputType === "submit" || inputType === "image")),
    inForm: form !== null,
    formHasPassword: fields.some((f) => f.getAttribute("type") === "password"),
    formHasPayment: fields.some((f) => PAYMENT_HINT.test(fieldHint(f))),
    formIsSearch: form !== null && isSearchForm(form, fields),
    formAction: form?.getAttribute("action") ?? "",
  };
}

function findMatches(doc: Document, query: string): string {
  const needle = query.toLowerCase();
  const text = visibleText(doc);
  const lower = text.toLowerCase();
  const hits: string[] = [];
  let from = 0;
  while (hits.length < 10) {
    const index = lower.indexOf(needle, from);
    if (index < 0) break;
    const start = Math.max(0, index - 120);
    const end = Math.min(text.length, index + needle.length + 120);
    hits.push(`…${text.slice(start, end).replace(/\s+/g, " ")}…`);
    from = index + needle.length;
  }
  if (hits.length === 0) return `No matches for "${query}" on this page.`;
  return `${hits.length} match(es) for "${query}":\n${hits.map((h, i) => `${i + 1}. ${h}`).join("\n")}`;
}

function decodeGoogleUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.pathname === "/url") return url.searchParams.get("q") ?? url.searchParams.get("url") ?? href;
  } catch {
    // Relative or malformed: return as-is.
  }
  return href;
}

export function searchResults(doc: Document, engine: SearchEngine): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const push = (title: string, url: string, snippet: string) => {
    const cleanUrl = engine === "google" ? decodeGoogleUrl(url) : url;
    if (!/^https?:/i.test(cleanUrl) || seen.has(cleanUrl)) return;
    if (engine === "google" && /^https?:\/\/(www\.)?google\./i.test(cleanUrl)) return;
    seen.add(cleanUrl);
    results.push({
      title: title.replace(/\s+/g, " ").trim().slice(0, 200),
      url: cleanUrl,
      snippet: snippet.replace(/\s+/g, " ").trim().slice(0, 300),
    });
  };

  if (engine === "duckduckgo") {
    for (const a of doc.querySelectorAll<HTMLAnchorElement>("a.result__a")) {
      const container = a.closest(".result");
      let href = a.href;
      try {
        const uddg = new URL(href).searchParams.get("uddg");
        if (uddg) href = uddg;
      } catch {
        // Keep original href.
      }
      push(a.textContent ?? "", href, container?.querySelector(".result__snippet")?.textContent ?? "");
    }
  } else if (engine === "bing") {
    for (const item of doc.querySelectorAll("#b_results li.b_algo")) {
      const a = item.querySelector<HTMLAnchorElement>("h2 a");
      if (a) push(a.textContent ?? "", a.href, item.querySelector(".b_caption p, p")?.textContent ?? "");
    }
  }

  if (results.length === 0) {
    // Generic: result headings wrapped in links (Google's markup, and a fallback for the others).
    const scope = doc.querySelector("#search, #rso, #links, #b_results, main") ?? doc.body;
    for (const heading of scope?.querySelectorAll("a h3, a h2") ?? []) {
      const a = heading.closest("a") as HTMLAnchorElement | null;
      if (!a) continue;
      const container = a.closest("div.g, div.MjjYud, li, article, [data-hveid]") ?? a.parentElement;
      const snippet = (container?.textContent ?? "").replace(heading.textContent ?? "", "");
      push(heading.textContent ?? "", a.href, snippet);
    }
  }
  return results.slice(0, 8);
}

let highlightHost: HTMLElement | null = null;
let highlightBox: HTMLElement | null = null;
let glow: HTMLElement | null = null;

function overlayRoot(doc: Document): ShadowRoot {
  if (!highlightHost || !highlightHost.isConnected) {
    highlightHost = doc.createElement("comet-agent-overlay");
    highlightHost.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const root = highlightHost.attachShadow({ mode: "open" });
    highlightBox = doc.createElement("div");
    highlightBox.style.cssText =
      "position:fixed;border:2px solid #7c5cff;border-radius:6px;background:rgba(124,92,255,.12);" +
      "box-shadow:0 0 0 4px rgba(124,92,255,.18);transition:all .15s ease;display:none;";
    glow = doc.createElement("div");
    glow.style.cssText =
      "position:fixed;inset:0;box-shadow:inset 0 0 0 3px rgba(124,92,255,.75),inset 0 0 24px rgba(124,92,255,.35);display:none;";
    root.append(glow, highlightBox);
    doc.documentElement.append(highlightHost);
  }
  return highlightHost.shadowRoot!;
}

function highlight(doc: Document, element: Element): void {
  overlayRoot(doc);
  if (!highlightBox) return;
  const rect = element.getBoundingClientRect();
  Object.assign(highlightBox.style, {
    display: "block",
    left: `${rect.left - 3}px`,
    top: `${rect.top - 3}px`,
    width: `${rect.width + 6}px`,
    height: `${rect.height + 6}px`,
  });
  const box = highlightBox;
  setTimeout(() => {
    box.style.display = "none";
  }, 1500);
}

function staleRef(ref: number): ContentResponse {
  return { ok: false, error: `Element [${ref}] not found. The page changed; call snapshot again for fresh refs.` };
}

export async function handleRequest(doc: Document, req: ContentRequest): Promise<ContentResponse> {
  const win = doc.defaultView!;
  switch (req.type) {
    case "cs/ping":
      return { ok: true, kind: "pong" };
    case "cs/snapshot": {
      const snap = buildSnapshot(doc, req.maxChars);
      return { ok: true, kind: "snapshot", url: win.location.href, title: doc.title, text: snap.text, refCount: snap.refCount };
    }
    case "cs/pageText": {
      const { text, truncated } = pageText(doc, req.maxChars ?? 12_000);
      return { ok: true, kind: "pageText", url: win.location.href, title: doc.title, text, truncated };
    }
    case "cs/extract":
      try {
        return { ok: true, kind: "data", data: extractFromRoot(doc, req.kind) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "extract failed" };
      }
    case "cs/find":
      return { ok: true, kind: "text", text: findMatches(doc, req.query) };
    case "cs/selection":
      return { ok: true, kind: "text", text: win.getSelection()?.toString() ?? "" };
    case "cs/target": {
      const el = findByRef(doc, req.ref);
      if (!el) return staleRef(req.ref);
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
      const rect = el.getBoundingClientRect();
      return {
        ok: true,
        kind: "target",
        target: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, facts: targetFacts(el) },
      };
    }
    case "cs/activeFacts": {
      const active = doc.activeElement;
      return { ok: true, kind: "facts", facts: active && active !== doc.body ? targetFacts(active) : null };
    }
    case "cs/focus": {
      const el = findByRef(doc, req.ref) as HTMLElement | null;
      if (!el) return staleRef(req.ref);
      el.focus();
      if (req.clear) {
        if (el instanceof win.HTMLInputElement || el instanceof win.HTMLTextAreaElement) el.select();
        else if (el.isContentEditable) {
          const range = doc.createRange();
          range.selectNodeContents(el);
          const sel = win.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
      return { ok: true, kind: "done", note: "focused" };
    }
    case "cs/domClick": {
      const el = findByRef(doc, req.ref);
      if (!el) return staleRef(req.ref);
      (el as HTMLElement).focus?.();
      clickElement(el);
      return { ok: true, kind: "done", note: "clicked" };
    }
    case "cs/domType": {
      const el = findByRef(doc, req.ref);
      if (!el) return staleRef(req.ref);
      const value = typeInto(el, req.text, { replace: req.replace });
      return { ok: true, kind: "done", note: `value is now "${value.slice(0, 80)}"` };
    }
    case "cs/domSelect": {
      const el = findByRef(doc, req.ref);
      if (!el) return staleRef(req.ref);
      if (el.tagName.toLowerCase() !== "select") return { ok: false, error: "Element is not a <select>; click it instead." };
      const select = el as HTMLSelectElement;
      const wanted = req.value.trim().toLowerCase();
      const option = [...select.options].find(
        (o) => o.value.toLowerCase() === wanted || (o.textContent ?? "").trim().toLowerCase() === wanted,
      );
      if (!option) {
        const options = [...select.options].map((o) => (o.textContent ?? "").trim()).join(" | ");
        return { ok: false, error: `No option "${req.value}". Options: ${options}` };
      }
      select.value = option.value;
      select.dispatchEvent(new win.Event("input", { bubbles: true }));
      select.dispatchEvent(new win.Event("change", { bubbles: true }));
      return { ok: true, kind: "done", note: `selected "${(option.textContent ?? "").trim()}"` };
    }
    case "cs/domHover": {
      const el = findByRef(doc, req.ref);
      if (!el) return staleRef(req.ref);
      for (const type of ["pointerover", "mouseover", "mouseenter", "mousemove"]) {
        el.dispatchEvent(new win.MouseEvent(type, { bubbles: type !== "mouseenter", cancelable: true }));
      }
      return { ok: true, kind: "done", note: "hovered" };
    }
    case "cs/domKey": {
      const target = doc.activeElement ?? doc.body;
      pressKeyOn(target, req.key);
      if (req.key === "Enter") {
        const form = target.closest?.("form");
        if (form) form.requestSubmit();
      }
      return { ok: true, kind: "done", note: `pressed ${req.key}` };
    }
    case "cs/submitOf": {
      const el = findByRef(doc, req.ref);
      if (!el) return staleRef(req.ref);
      const form = el.closest("form");
      if (form) {
        form.requestSubmit();
        return { ok: true, kind: "done", note: "form submitted" };
      }
      pressKeyOn(el, "Enter");
      return { ok: true, kind: "done", note: "pressed Enter" };
    }
    case "cs/scroll": {
      const scope = req.ref !== undefined ? findByRef(doc, req.ref) : null;
      if (req.ref !== undefined && !scope) return staleRef(req.ref);
      const m = scrollByAmount(win, req.direction, req.amount, scope);
      const where = m.atBottom ? "at bottom" : m.atTop ? "at top" : `at ${Math.round((m.scrollY / Math.max(1, m.pageHeight)) * 100)}%`;
      return { ok: true, kind: "done", note: `scrolled ${req.direction}; now ${where} of page` };
    }
    case "cs/waitText": {
      const elapsed = await waitForContent(doc, "text", req.text, req.timeoutMs);
      if (elapsed < 0) return { ok: false, error: `"${req.text}" did not appear within ${req.timeoutMs} ms` };
      return { ok: true, kind: "done", note: `"${req.text}" appeared after ${elapsed} ms` };
    }
    case "cs/highlight": {
      const el = findByRef(doc, req.ref);
      if (el) highlight(doc, el);
      return { ok: true, kind: "done", note: "highlighted" };
    }
    case "cs/agentActive": {
      overlayRoot(doc);
      if (glow) glow.style.display = req.on ? "block" : "none";
      return { ok: true, kind: "done", note: req.on ? "active" : "idle" };
    }
    case "cs/searchResults":
      return { ok: true, kind: "search", results: searchResults(doc, req.engine) };
  }
}
