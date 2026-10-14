// Observation caps and context-window pruning. DOM observations are huge;
// the model sees AX outlines and JSON, never raw HTML, and older turns decay
// to summaries so the window holds the whole run.

import type { ChatMessage } from "../providers/wire/chat-completions";

export const OBS_CHAR_BUDGET = 4000;
export const RECENT_VERBATIM_TURNS = 6;

export function capObservation(text: string, budget: number = OBS_CHAR_BUDGET): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}\n… [observation truncated to ${budget} chars]`;
}

export interface PruneResult {
  messages: ChatMessage[];
  /** Non-null when older turns were decayed (append as a system note). */
  recap: string | null;
}

/**
 * Keep recent turns verbatim; decay older ones. Boundary-safe: an assistant
 * message keeps only the tool calls whose results are still present, and a
 * leading orphaned tool message is dropped (providers 400 on dangling calls).
 */
export function pruneForContext(
  messages: ChatMessage[],
  keepLast: number = RECENT_VERBATIM_TURNS,
): PruneResult {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length <= keepLast) return { messages, recap: null };

  const kept = rest.slice(-keepLast);
  const dropped = rest.slice(0, rest.length - keepLast);

  // Drop leading orphaned tool results (their assistant turn aged out).
  while (kept.length > 0 && kept[0]?.role === "tool") kept.shift();
  const keptCallIds = new Set(kept.filter((m) => m.role === "tool").map((m) => m.toolCallId ?? ""));
  const safeKept: ChatMessage[] = kept
    .map((m) => {
      if (m.role !== "assistant" || !m.toolCalls) return m;
      const linked = m.toolCalls.filter((c) => keptCallIds.has(c.id));
      if (linked.length === m.toolCalls.length) return m;
      if (m.content.trim() === "" || linked.length === 0) {
        return m.content.trim() === "" ? null : { role: "assistant", content: m.content };
      }
      return { ...m, toolCalls: linked };
    })
    .filter((m): m is ChatMessage => m !== null);

  const recap =
    dropped.length === 0
      ? null
      : `Earlier recap: ${dropped
          .filter((m) => m.role !== "tool")
          .map((m) => m.content.slice(0, 120))
          .join(" / ")
          .slice(0, 400)}`;
  return { messages: [...system, ...safeKept], recap };
}
