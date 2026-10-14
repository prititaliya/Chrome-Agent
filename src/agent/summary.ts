// Short-term memory: once a chat gets long, older turns are condensed into a
// running summary that rides along in the system prompt, instead of being dropped.

import { compactMessages, isTurnStart, messageSize } from "./context";
import { requestUsage, type RequestUsage, type UsageEvent } from "./usage";
import type { ApiMessage, ModelConfig, ProviderConfig, StreamEvent, StreamRequest } from "../providers/types";

export interface ConversationSummary {
  text: string;
  /** Number of `api` messages the summary covers; the model sees api.slice(upTo) verbatim. */
  upTo: number;
  updatedAt: number;
}

/** Summarize when the verbatim history grows past this many characters… */
export const SUMMARY_TRIGGER_CHARS = 60_000;
/** …keeping roughly this much of the most recent conversation verbatim. */
export const SUMMARY_KEEP_CHARS = 24_000;

/**
 * Index (relative to `api`) up to which messages should be folded into the summary,
 * always at a turn boundary, or 0 when no summarization is needed.
 */
export function summaryCut(api: ApiMessage[], trigger = SUMMARY_TRIGGER_CHARS, keep = SUMMARY_KEEP_CHARS): number {
  const sizes = compactMessages(api).map(messageSize);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= trigger) return 0;
  const starts = api.map((m, i) => (isTurnStart(m) ? i : -1)).filter((i) => i >= 0);
  let tail = total;
  let cut = 0;
  for (const start of starts) {
    if (start === 0) continue;
    for (let i = cut; i < start; i++) tail -= sizes[i]!;
    cut = start;
    if (tail <= keep) break;
  }
  return cut;
}

const PART_CHARS = 1_200;

function clip(text: string, max = PART_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Plain-text transcript of messages for the summarizer. */
export function transcript(api: ApiMessage[]): string {
  const lines: string[] = [];
  for (const m of compactMessages(api)) {
    const text = typeof m.content === "string" ? m.content : "";
    if (m.role === "user") lines.push(`USER: ${clip(text.replace(/<page_context([^>]*)>[\s\S]*?<\/page_context>/g, "[page: $1]"))}`);
    else if (m.role === "assistant") {
      if (text.trim() !== "") lines.push(`ASSISTANT: ${clip(text)}`);
      for (const c of m.toolCalls ?? []) lines.push(`ASSISTANT used ${c.name}(${clip(c.args, 200)})`);
    } else if (m.role === "tool") lines.push(`TOOL RESULT: ${clip(text, 400)}`);
  }
  return lines.join("\n");
}

const SUMMARIZER_PROMPT = [
  "You maintain the running memory of a conversation between a user and an AI browser assistant.",
  "Update the summary so it captures everything needed to continue the conversation:",
  "- the user's goals and requests, and whether each is done or still open",
  "- facts, numbers, names, and URLs found, with the key findings from pages read",
  "- decisions made, actions taken in the browser and their results",
  "- preferences or constraints the user stated",
  "Be specific and dense. Use short bullet points, at most about 350 words. Output only the updated summary.",
].join("\n");

export interface SummarizeOptions {
  provider: ProviderConfig;
  model: ModelConfig;
  previous: string | undefined;
  messages: ApiMessage[];
  stream: (req: StreamRequest) => AsyncGenerator<StreamEvent>;
  signal?: AbortSignal;
  sessionId?: string;
}

export async function summarizeConversation(opts: SummarizeOptions): Promise<{ text: string; usage: RequestUsage }> {
  const body = [
    opts.previous ? `<previous_summary>\n${opts.previous}\n</previous_summary>` : "<previous_summary>(none yet)</previous_summary>",
    `<new_messages>\n${transcript(opts.messages).slice(-60_000)}\n</new_messages>`,
  ].join("\n\n");
  const messages: ApiMessage[] = [
    { role: "system", content: SUMMARIZER_PROMPT },
    { role: "user", content: body },
  ];
  let text = "";
  let usage: UsageEvent | null = null;
  for await (const event of opts.stream({
    provider: opts.provider,
    model: opts.model,
    messages,
    maxTokens: 4000,
    signal: opts.signal,
    sessionId: opts.sessionId,
  })) {
    if (event.type === "text") text += event.text;
    else if (event.type === "usage") usage = event;
  }
  text = text.trim();
  if (text === "") throw new Error("The model returned an empty summary.");
  const approx = { input: Math.ceil((SUMMARIZER_PROMPT.length + body.length) / 4), output: Math.ceil(text.length / 4) };
  return { text, usage: requestUsage(usage, opts.model.pricing, approx) };
}
