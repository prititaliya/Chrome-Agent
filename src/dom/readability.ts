// Article text via Readability, plus a minimal HTML→Markdown serializer
// for the `markdown` read mode. Runs in page context and in jsdom tests.

import { Readability } from "@mozilla/readability";

export type ReadMode = "markdown" | "text";

export interface ArticleText {
  title: string;
  text: string;
  truncated: boolean;
}

interface ParsedArticle {
  title: string;
  textContent: string;
  content: string;
}

function serializeNode(node: Node, doc: Document): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return [...node.childNodes].map((c) => serializeNode(c, doc)).join("");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const children = [...element.childNodes].map((c) => serializeNode(c, doc)).join("");
  switch (tag) {
    case "h1":
      return `\n\n# ${children.trim()}\n\n`;
    case "h2":
      return `\n\n## ${children.trim()}\n\n`;
    case "h3":
      return `\n\n### ${children.trim()}\n\n`;
    case "li":
      return `\n- ${children.trim()}`;
    case "a": {
      const href = element.getAttribute("href") ?? "";
      return href !== "" ? `[${children.trim()}](${href})` : children;
    }
    case "br":
      return "\n";
    case "pre":
      return `\n\n\`\`\`\n${children.trim()}\n\`\`\`\n\n`;
    case "blockquote":
      return `\n\n> ${children.trim()}\n\n`;
    case "p":
    case "div":
    case "section":
    case "article":
      return `\n\n${children.trim()}\n\n`;
    default:
      return children;
  }
}

export function htmlToMarkdown(html: string, doc: Document): string {
  const template = doc.createElement("template");
  template.innerHTML = html;
  return serializeNode(template.content, doc)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function readPageText(doc: Document, mode: ReadMode, scope?: Element, maxChars = 8000): ArticleText {
  if (scope) {
    const raw = mode === "markdown" ? htmlToMarkdown(scope.outerHTML, doc) : (scope.textContent ?? "");
    const text = raw
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { title: doc.title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
  }
  let parsed: ParsedArticle | null = null;
  try {
    parsed = new Readability(doc.cloneNode(true) as Document).parse() as ParsedArticle | null;
  } catch {
    parsed = null;
  }
  const raw =
    parsed === null
      ? (doc.body?.textContent ?? "")
      : mode === "markdown"
        ? htmlToMarkdown(parsed.content, doc)
        : parsed.textContent;
  const text = raw
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    title: parsed?.title ?? doc.title,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}
