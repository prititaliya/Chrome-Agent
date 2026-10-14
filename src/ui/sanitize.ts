import DOMPurify from "dompurify";
import { marked } from "marked";

// Single chokepoint for untrusted HTML: LLM output and page text are never
// rendered without passing through here. `dangerouslySetInnerHTML` appears
// exactly once in this codebase (the Markdown component below).

marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(source: string): string {
  const raw = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: [
      "style",
      "iframe",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "option",
      "script",
      "object",
      "embed",
      "link",
      "meta",
      "base",
    ],
    FORBID_ATTR: ["style"],
  });
}
