// Page outline for the model: interactive elements get integer refs stamped
// onto the live DOM as `data-ai-ref`, so later actions resolve the exact
// element instead of re-deriving a selector. Headings and short text runs are
// included (without refs) so the model can orient itself.

import { accessibleName } from "./axname";

export const REF_ATTR = "data-ai-ref";
export const SNAPSHOT_CHAR_CAP = 15_000;

// Numeric node types instead of the `Node` global, which is realm-specific.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template", "svg", "head", "meta", "link"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "slider",
  "spinbutton",
  "treeitem",
]);

export interface SnapshotResult {
  text: string;
  refCount: number;
  truncated: boolean;
}

function roleOf(element: Element): string | null {
  const explicit = element.getAttribute("role")?.toLowerCase().trim();
  if (explicit) return explicit.split(/\s+/)[0] ?? null;
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case "a":
      return element.hasAttribute("href") ? "link" : null;
    case "button":
    case "summary":
      return "button";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "input": {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (type === "hidden") return null;
      if (type === "checkbox" || type === "radio") return type;
      if (["submit", "button", "reset", "image"].includes(type)) return "button";
      if (type === "range") return "slider";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    default:
      return null;
  }
}

function isInteractive(element: Element): boolean {
  const role = roleOf(element);
  if (role !== null && INTERACTIVE_ROLES.has(role)) return true;
  if ((element as HTMLElement).isContentEditable === true && element.getAttribute("contenteditable") !== null) {
    return true;
  }
  const tabindex = element.getAttribute("tabindex");
  if (tabindex !== null && tabindex !== "-1" && element.hasAttribute("onclick")) return true;
  return false;
}

function isDisplayed(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  return !view || view.getComputedStyle(element).display !== "none";
}

export function isVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  const style = view.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  if (Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return true;
  // jsdom has no layout engine, so every rect is empty there.
  return view.navigator.userAgent.includes("jsdom");
}

function describe(element: Element, role: string): string {
  const tag = element.tagName.toLowerCase();
  const name = accessibleName(element).slice(0, 100);
  const parts = [`${role} "${name}"`];
  if (tag === "input" || tag === "textarea") {
    const field = element as HTMLInputElement;
    const type = (field.getAttribute("type") ?? "").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      parts.push(field.checked ? "checked" : "unchecked");
    } else if (type === "password") {
      if (field.value !== "") parts.push('value="••••"');
    } else if (field.value !== "") {
      parts.push(`value="${field.value.slice(0, 60)}"`);
    }
    const placeholder = field.getAttribute("placeholder");
    if (placeholder && placeholder !== name) parts.push(`placeholder="${placeholder.slice(0, 40)}"`);
  } else if (tag === "select") {
    const select = element as HTMLSelectElement;
    const selected = select.selectedOptions[0]?.textContent?.trim() ?? "";
    const options = [...select.options].slice(0, 12).map((o) => o.textContent?.trim() ?? "");
    parts.push(`selected="${selected}" options=[${options.join(" | ")}]`);
  } else if (tag === "a") {
    const href = element.getAttribute("href") ?? "";
    if (href !== "" && !href.startsWith("javascript:")) parts.push(`-> ${href.slice(0, 80)}`);
  }
  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") parts.push("disabled");
  const expanded = element.getAttribute("aria-expanded");
  if (expanded !== null) parts.push(expanded === "true" ? "expanded" : "collapsed");
  return parts.join(" ");
}

/** Remove refs stamped by a previous snapshot. */
export function clearRefs(doc: Document): void {
  for (const el of doc.querySelectorAll(`[${REF_ATTR}]`)) el.removeAttribute(REF_ATTR);
}

export function findByRef(doc: Document, ref: number): Element | null {
  const direct = doc.querySelector(`[${REF_ATTR}="${ref}"]`);
  if (direct) return direct;
  // Elements inside open shadow roots are not reachable by a document query.
  const stack: ParentNode[] = [doc];
  while (stack.length > 0) {
    const root = stack.pop()!;
    for (const el of root.querySelectorAll("*")) {
      if (el.getAttribute(REF_ATTR) === String(ref)) return el;
      if (el.shadowRoot) stack.push(el.shadowRoot);
    }
  }
  return null;
}

export function buildSnapshot(doc: Document, maxChars = SNAPSHOT_CHAR_CAP): SnapshotResult {
  clearRefs(doc);
  const lines: string[] = [];
  let chars = 0;
  let nextRef = 1;
  let truncated = false;

  const emit = (line: string): boolean => {
    if (chars + line.length > maxChars) {
      truncated = true;
      return false;
    }
    lines.push(line);
    chars += line.length + 1;
    return true;
  };

  const visit = (node: Node): boolean => {
    if (node.nodeType === TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length >= 25) return emit(`  text: ${text.slice(0, 160)}`);
      return true;
    }
    if (node.nodeType !== ELEMENT_NODE) return true;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(tag)) return true;
    if (element.getAttribute("aria-hidden") === "true" || element.hasAttribute("hidden")) return true;
    if (!isDisplayed(element)) return true;

    if (HEADING_TAGS.has(tag)) {
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text !== "") return emit(`${"#".repeat(Number(tag[1]))} ${text.slice(0, 120)}`);
      return true;
    }

    if (isInteractive(element) && isVisible(element)) {
      const ref = nextRef++;
      element.setAttribute(REF_ATTR, String(ref));
      const role = roleOf(element) ?? "button";
      if (!emit(`[${ref}] ${describe(element, role)}`)) return false;
      // Buttons and links rarely contain further interactive content worth listing.
      if (role === "button" || role === "link" || tag === "select") return true;
    }

    if (tag === "iframe") return emit("  [iframe content not shown]");
    const children = element.shadowRoot ? [...element.shadowRoot.childNodes, ...element.childNodes] : [...element.childNodes];
    for (const child of children) {
      if (!visit(child)) return false;
    }
    return true;
  };

  visit(doc.body ?? doc.documentElement);
  if (truncated) lines.push(`… truncated at ${maxChars} chars (${nextRef - 1} refs). Scroll or use get_page_text for more.`);
  return { text: lines.join("\n"), refCount: nextRef - 1, truncated };
}
