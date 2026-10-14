// Page context attached to user messages, and history compaction so long
// chats stay within the model's context window.

import { isScriptableUrl, sendToTab } from "../browser/content";
import { getTab } from "../browser/tabs";
import type { ApiMessage } from "../providers/types";

export interface PageContext {
  source: "current tab" | "attached tab";
  tabId: number;
  title: string;
  url: string;
  text?: string;
  truncated?: boolean;
  selection?: string;
  note?: string;
}

const CURRENT_TAB_CHARS = 14_000;
const ATTACHED_TAB_CHARS = 7_000;
const TOOL_RESULT_KEEP = 1_500;
const HISTORY_CHAR_BUDGET = 120_000;

function attr(value: string): string {
  return value.replace(/"/g, "'").replace(/[<>]/g, "");
}

export function formatPageContext(pages: PageContext[]): string {
  return pages
    .map((p) => {
      const head = `<page_context source="${p.source}" tab_id="${p.tabId}" title="${attr(p.title)}" url="${attr(p.url)}">`;
      const body: string[] = [];
      if (p.note) body.push(p.note);
      if (p.selection) body.push(`User's selected text on this page:\n"""${p.selection}"""`);
      if (p.text !== undefined) body.push(p.text + (p.truncated ? "\n…[page truncated; use get_page_text or scroll for more]" : ""));
      return `${head}\n${body.join("\n\n")}\n</page_context>`;
    })
    .join("\n\n");
}

export function buildUserContent(question: string, pages: PageContext[]): string {
  if (pages.length === 0) return question;
  return `${formatPageContext(pages)}\n\n${question}`;
}

export async function readTabContext(tabId: number, source: PageContext["source"]): Promise<PageContext | null> {
  const tab = await getTab(tabId);
  if (!tab) return null;
  const base: PageContext = { source, tabId, title: tab.title, url: tab.url };
  if (!isScriptableUrl(tab.url)) {
    return { ...base, note: "(This is a browser page whose content cannot be read.)" };
  }
  const maxChars = source === "current tab" ? CURRENT_TAB_CHARS : ATTACHED_TAB_CHARS;
  const [page, selection] = await Promise.all([
    sendToTab(tabId, { type: "cs/pageText", maxChars }),
    source === "current tab" ? sendToTab(tabId, { type: "cs/selection" }) : Promise.resolve(null),
  ]);
  if (!page.ok || page.kind !== "pageText") {
    return { ...base, note: `(Page content unavailable: ${page.ok ? "unexpected response" : page.error})` };
  }
  const selected = selection && selection.ok && selection.kind === "text" ? selection.text.trim().slice(0, 4000) : "";
  return {
    ...base,
    title: page.title || tab.title,
    url: page.url,
    text: page.text,
    truncated: page.truncated,
    selection: selected || undefined,
  };
}

const PAGE_CONTEXT_RE = /<page_context([^>]*)>[\s\S]*?<\/page_context>/g;

function compactText(text: string): string {
  return text.replace(PAGE_CONTEXT_RE, "<page_context$1>[content from an earlier turn omitted; read the tab again if needed]</page_context>");
}

/** Shrink earlier turns: drop old page dumps, truncate long tool output, remove images. */
export function compactMessages(api: ApiMessage[]): ApiMessage[] {
  return api.map((m): ApiMessage => {
    if (typeof m.content !== "string") {
      return {
        ...m,
        content: m.content
          .filter((p) => p.type === "text")
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("\n")
          .concat(m.content.some((p) => p.type === "image") ? "\n[screenshot omitted]" : ""),
      };
    }
    if (m.role === "user") return { ...m, content: compactText(m.content) };
    if (m.role === "tool" && m.content.length > TOOL_RESULT_KEEP) {
      return { ...m, content: `${m.content.slice(0, TOOL_RESULT_KEEP)}\n…[truncated]` };
    }
    return m;
  });
}

/** Compacted history, with the oldest turns dropped if it still exceeds the budget. */
export function compactHistory(api: ApiMessage[]): ApiMessage[] {
  return dropOldestTurns(compactMessages(api), HISTORY_CHAR_BUDGET);
}

/** A user message that starts a turn (screenshot follow-ups are image-part arrays mid-turn). */
export function isTurnStart(m: ApiMessage): boolean {
  return m.role === "user" && typeof m.content === "string";
}

export function messageSize(m: ApiMessage): number {
  const content = typeof m.content === "string" ? m.content.length : 1000;
  return content + (m.toolCalls?.reduce((n, c) => n + c.args.length + c.name.length, 0) ?? 0);
}

/** Remove whole turns (a user message and everything up to the next one) from the start. */
export function dropOldestTurns(api: ApiMessage[], budget: number): ApiMessage[] {
  let total = api.reduce((n, m) => n + messageSize(m), 0);
  let start = 0;
  while (total > budget) {
    const next = api.findIndex((m, i) => i > start && isTurnStart(m));
    if (next < 0) break;
    for (let i = start; i < next; i++) total -= messageSize(api[i]!);
    start = next;
  }
  return start === 0 ? api : api.slice(start);
}

/** Every assistant tool call needs a matching tool result or the next request is rejected. */
export function sealToolCalls(api: ApiMessage[], note = "Cancelled by the user before it ran."): ApiMessage[] {
  const answered = new Set(api.filter((m) => m.role === "tool").map((m) => m.toolCallId));
  const sealed: ApiMessage[] = [];
  for (let i = 0; i < api.length; i++) {
    const m = api[i]!;
    sealed.push(m);
    if (m.role !== "assistant" || !m.toolCalls) continue;
    // Insert missing results right after the existing results for this assistant message.
    let j = i + 1;
    while (j < api.length && api[j]!.role === "tool") {
      sealed.push(api[j]!);
      j++;
    }
    for (const call of m.toolCalls) {
      if (!answered.has(call.id)) sealed.push({ role: "tool", toolCallId: call.id, content: note });
    }
    i = j - 1;
  }
  return sealed;
}
