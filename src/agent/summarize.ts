// Extractive recap for pruned turns (no model call). The progress-summary
// model pass lands with the summarizer task; until then the recap is the
// opening lines of the dropped non-tool messages, capped.

import type { ChatMessage } from "../providers/wire/chat-completions";

export const RECAP_CHAR_BUDGET = 400;

export function summarizeRecap(dropped: ChatMessage[]): string | null {
  const lines = dropped
    .filter((m) => m.role !== "tool" && m.content.trim() !== "")
    .map((m) => `${m.role}: ${m.content.replace(/\s+/g, " ").trim().slice(0, 120)}`);
  if (lines.length === 0) return null;
  return `Earlier recap: ${lines.join(" / ").slice(0, RECAP_CHAR_BUDGET)}`;
}
