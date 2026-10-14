// Spec-compliant accessible-name resolution with a plain-attribute fallback.
// Runs in page context (content script) and in jsdom tests.

import { computeAccessibleName } from "dom-accessibility-api";

export function accessibleName(element: Element): string {
  try {
    const name = computeAccessibleName(element).trim();
    if (name !== "") return name.slice(0, 120);
  } catch {
    // Fall through to attribute heuristics below.
  }
  const fallback =
    element.getAttribute("aria-label") ??
    element.getAttribute("alt") ??
    element.getAttribute("title") ??
    element.getAttribute("value") ??
    element.getAttribute("placeholder") ??
    element.textContent ??
    "";
  return fallback.trim().replace(/\s+/g, " ").slice(0, 120);
}
