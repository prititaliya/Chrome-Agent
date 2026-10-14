// AX-style outline walker: one line per interesting node, stable integer
// refs, hard char cap. Same code on both engines — observations are identical
// cross-browser. Never emits HTML.

import { accessibleName } from "./axname";

export interface RefEntry {
  ref: number;
  role: string;
  name: string;
  tag: string;
  selector: string;
}

export interface Snapshot {
  text: string;
  refs: RefEntry[];
  truncated: boolean;
}

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);
const BUTTON_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "textbox",
  "combobox",
  "menuitem",
  "tab",
  "slider",
]);

export const SNAPSHOT_CHAR_CAP = 12_000;

function implicitRole(tag: string, element: Element): string | null {
  if (INTERACTIVE_TAGS.has(tag)) {
    if (tag === "a") return "link";
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      return "textbox";
    }
    return tag;
  }
  if (HEADING_TAGS.has(tag)) return "heading";
  if (tag === "img") return "img";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "li") return "listitem";
  if (tag === "table") return "table";
  return null;
}

function isHidden(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (SKIPPED_TAGS.has(tag)) return true;
  if (element.hasAttribute("hidden")) return true;
  if (element.getAttribute("aria-hidden") === "true") return true;
  if (element instanceof HTMLElement && element.style.display === "none") return true;
  return false;
}

/** Stable queryable CSS path for re-resolution (verified by querySelector). */
export function cssPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.tagName.toLowerCase() !== "html") {
    const tag = current.tagName.toLowerCase();
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblings = [...parent.children].filter((s) => s.tagName.toLowerCase() === tag);
    const index = siblings.indexOf(current);
    parts.unshift(index > 0 ? `${tag}:nth-of-type(${index + 1})` : tag);
    current = parent;
    if (parts.length > 12) break;
  }
  return parts.join(" > ");
}

export interface SnapshotOptions {
  maxChars?: number;
  startRef?: number;
  interactiveOnly?: boolean;
}

export function buildSnapshot(root: ParentNode, options: SnapshotOptions = {}): Snapshot {
  const maxChars = options.maxChars ?? SNAPSHOT_CHAR_CAP;
  let nextRef = options.startRef ?? 1;
  const lines: string[] = [];
  const refs: RefEntry[] = [];
  let truncated = false;
  let chars = 0;

  const emit = (line: string) => {
    if (chars + line.length > maxChars) {
      truncated = true;
      return false;
    }
    lines.push(line);
    chars += line.length + 1;
    return true;
  };

  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of [...node.childNodes]) {
        if (!visit(child)) return false;
      }
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length > 40 && !options.interactiveOnly) {
        const parent: HTMLElement | null = node.parentElement;
        const parentTag = parent?.tagName.toLowerCase() ?? "";
        if (parent && !INTERACTIVE_TAGS.has(parentTag) && !HEADING_TAGS.has(parentTag)) {
          const ref = nextRef++;
          refs.push({ ref, role: "text", name: text.slice(0, 120), tag: "text", selector: cssPath(parent) });
          return emit(`[e${ref}] text "${text.slice(0, 120)}"`);
        }
      }
      return true;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return true;
    const element = node as Element;
    if (isHidden(element)) return true;

    const tag = element.tagName.toLowerCase();
    const explicitRole = element.getAttribute("role")?.toLowerCase();
    const role = explicitRole ?? implicitRole(tag, element);
    const interesting =
      (role !== null && (INTERACTIVE_TAGS.has(tag) || BUTTON_ROLES.has(role) || HEADING_TAGS.has(tag))) ||
      tag === "img" ||
      tag === "table" ||
      tag === "ul" ||
      tag === "ol";

    if (interesting) {
      const ref = nextRef++;
      const name = accessibleName(element);
      refs.push({ ref, role: role ?? tag, name, tag, selector: cssPath(element) });
      if (!emit(`[e${ref}] ${role ?? tag} "${name}"`)) return false;
    }
    for (const child of [...element.childNodes]) {
      if (!visit(child)) return false;
    }
    return true;
  };

  // nodeType check (not instanceof): callers may pass a document from another
  // realm (tests) where cross-realm instanceof is false.
  const scope = root.nodeType === Node.DOCUMENT_NODE ? ((root as Document).body ?? root) : root;
  visit(scope);
  if (truncated) {
    lines.push(`… ${nextRef - 1} refs shown; call browser_read_text for the rest.`);
  }
  return { text: lines.join("\n"), refs, truncated };
}
