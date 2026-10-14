import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { buildSnapshot, type RefEntry } from "../../src/dom/snapshot";
import { RefMap } from "../../src/dom/refmap";
import { attestTarget, attestFocus } from "../../src/dom/attest-facts";
import { extractFromRoot } from "../../src/dom/extract";
import { readPageText } from "../../src/dom/readability";
import { readSelection } from "../../src/dom/selection";
import { isContentRequest, type ContentResponse } from "../../src/messaging/content-protocol";
import { mountOverlay } from "./inject-overlay";

// ISOLATED world by default: page scripts cannot reach this code.
// allFrames stays true for the DOM bridge; the overlay UI mounts only in
// the top frame so iframes never sprout bubbles.
const refs = new RefMap();

function scopeFor(
  ref: number | undefined,
  gen: number,
): { ok: true; scope: Element | null; entry: RefEntry | null } | { ok: false } {
  if (ref === undefined) return { ok: true, scope: null, entry: null };
  const resolved = refs.resolve(ref, gen);
  if (!resolved.ok) return { ok: false };
  const element = document.querySelector(resolved.entry.selector);
  if (!element) return { ok: false };
  return { ok: true, scope: element, entry: resolved.entry };
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: true,
  async main(ctx) {
    if (window.top === window.self) {
      const handle = await mountOverlay(ctx);
      ctx.onInvalidated(handle.unmount);
    }

    browser.runtime.onMessage.addListener((raw: unknown): ContentResponse | undefined => {
      if (!isContentRequest(raw)) return undefined;
      switch (raw.type) {
        case "agent/snapshot": {
          const snapshot = buildSnapshot(document, { interactiveOnly: raw.interactiveOnly });
          refs.register(snapshot.refs, raw.gen);
          return {
            ok: true,
            kind: "snapshot",
            text: snapshot.text,
            snapshotGen: raw.gen,
            truncated: snapshot.truncated,
          };
        }
        case "agent/readText": {
          const scoped = scopeFor(raw.ref, raw.gen);
          if (!scoped.ok) return { ok: false, code: "E_STALE_REF" };
          const article = readPageText(document, raw.mode, scoped.scope ?? undefined);
          return {
            ok: true,
            kind: "text",
            title: article.title,
            text: article.text,
            truncated: article.truncated,
          };
        }
        case "agent/extract": {
          const scoped = scopeFor(raw.ref, raw.gen);
          if (!scoped.ok) return { ok: false, code: "E_STALE_REF" };
          try {
            return {
              ok: true,
              kind: "extract",
              data: extractFromRoot(document, raw.kind, scoped.scope ?? undefined),
            };
          } catch {
            return { ok: false, code: "E_NOT_FOUND" };
          }
        }
        case "agent/getSelection":
          return { ok: true, kind: "selection", text: readSelection(window) };
        case "agent/attest": {
          const scoped = scopeFor(raw.ref, raw.gen);
          if (!scoped.ok) return { ok: false, code: "E_STALE_REF" };
          const target =
            scoped.scope && scoped.entry
              ? { element: scoped.scope, role: scoped.entry.role, name: scoped.entry.name }
              : null;
          return {
            ok: true,
            kind: "attest",
            facts: {
              target: target ? attestTarget(target.element, target.role, target.name) : undefined,
              focus: attestFocus(document),
              url: location.href,
            },
          };
        }
      }
    });
  },
});
