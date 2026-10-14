// OpenAI chat-completions wire: request building (quirks applied), SSE
// consumption, and tool-call accumulation. Tool args are parsed ONLY at a
// terminal finish reason — never mid-stream. A null `args` on a yielded
// toolCall means "unparseable": the loop turns it into a repair observation.

import { pumpBody } from "../sse";
import type { ModelDef, ProviderDef } from "../types";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: { id: string; name: string; args: unknown }[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "toolCall"; id: string; name: string; args: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "truncated" }
  | { type: "finished"; reason: string };

export interface ChatRequest {
  def: ProviderDef;
  model: ModelDef;
  apiKey: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  fetchImpl?: typeof fetch;
}

interface AccumulatedCall {
  id: string;
  name: string;
  argsText: string;
}

function extractReasoning(delta: Record<string, unknown>): string | undefined {
  for (const key of ["reasoning", "reasoning_content", "reasoning_details"]) {
    const value: unknown = delta[key];
    if (typeof value === "string" && value !== "") return value;
    if (Array.isArray(value)) {
      const text = value
        .map((part) =>
          typeof part === "object" && part !== null
            ? String((part as Record<string, unknown>)["text"] ?? "")
            : "",
        )
        .join("");
      if (text !== "") return text;
    }
  }
  return undefined;
}

export function buildChatBody(req: ChatRequest): Record<string, unknown> {
  const stripTemperature = req.model.reasoning && req.def.quirks.includes("strip_temperature_when_reasoning");
  const body: Record<string, unknown> = {
    model: req.model.id,
    messages: req.messages,
    max_tokens: req.def.defaults.maxTokens,
    stream: true,
  };
  if (!stripTemperature) body["temperature"] = req.def.defaults.temperature;
  if (req.tools !== undefined && req.tools.length > 0) {
    body["tools"] = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  if (req.def.capabilities.streamWire.includeUsageParam === "stream_options") {
    body["stream_options"] = { include_usage: true };
  }
  return body;
}

function parseArgs(argsText: string): unknown {
  if (argsText.trim() === "") return null;
  try {
    return JSON.parse(argsText) as unknown;
  } catch {
    return null;
  }
}

/** Consume one parsed SSE payload, yielding stream events. Stateful per turn. */
export class ChatTurnConsumer {
  private readonly calls = new Map<number, AccumulatedCall>();

  consume(payload: string): ChatStreamEvent[] {
    if (payload.trim() === "[DONE]") return [];
    let json: unknown;
    try {
      json = JSON.parse(payload) as unknown;
    } catch {
      return [];
    }
    if (typeof json !== "object" || json === null) return [];
    const events: ChatStreamEvent[] = [];
    const record = json as Record<string, unknown>;

    const usage = record["usage"];
    if (typeof usage === "object" && usage !== null) {
      const u = usage as Record<string, unknown>;
      if (typeof u["prompt_tokens"] === "number" && typeof u["completion_tokens"] === "number") {
        events.push({ type: "usage", inputTokens: u["prompt_tokens"], outputTokens: u["completion_tokens"] });
      }
    }

    const choices = record["choices"];
    if (!Array.isArray(choices)) return events;
    const [choice] = choices as { delta?: Record<string, unknown>; finish_reason?: unknown }[];
    if (!choice) return events;
    const delta = choice.delta ?? {};

    if (typeof delta["content"] === "string" && delta["content"] !== "") {
      events.push({ type: "text", text: delta["content"] });
    }
    const reasoning = extractReasoning(delta);
    if (reasoning !== undefined) events.push({ type: "reasoning", text: reasoning });

    const toolCalls = delta["tool_calls"];
    if (Array.isArray(toolCalls)) {
      for (const raw of toolCalls) {
        if (typeof raw !== "object" || raw === null) continue;
        const tc = raw as Record<string, unknown>;
        if (typeof tc["index"] !== "number") continue;
        const fn = (tc["function"] ?? {}) as Record<string, unknown>;
        const slot = this.calls.get(tc["index"]) ?? { id: "", name: "", argsText: "" };
        if (typeof tc["id"] === "string") slot.id = tc["id"];
        if (typeof fn["name"] === "string") slot.name = fn["name"];
        if (typeof fn["arguments"] === "string") slot.argsText += fn["arguments"];
        this.calls.set(tc["index"], slot);
      }
    }

    if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
      for (const slot of [...this.calls.values()]) {
        if (slot.name === "") continue;
        events.push({ type: "toolCall", id: slot.id, name: slot.name, args: parseArgs(slot.argsText) });
      }
      this.calls.clear();
      events.push({ type: "finished", reason: String(choice.finish_reason) });
    } else if (choice.finish_reason === "length") {
      events.push({ type: "truncated" });
    } else if (typeof choice.finish_reason === "string" && choice.finish_reason !== "") {
      events.push({ type: "finished", reason: choice.finish_reason });
    }
    return events;
  }
}

export async function* streamChatCompletions(req: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  const fetchImpl = req.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${req.apiKey}`,
    ...req.def.headers,
  };
  const response = await fetchImpl(`${req.def.baseUrl}${req.def.endpoints.chat}`, {
    method: "POST",
    headers,
    body: JSON.stringify(buildChatBody(req)),
  });
  if (!response.ok || response.body === null) {
    throw new Error(`provider ${req.def.id} responded ${response.status}`);
  }
  const consumer = new ChatTurnConsumer();
  const events: ChatStreamEvent[] = [];
  const { aborted } = await pumpBody(response.body, {
    framing: req.def.capabilities.streamWire.framing,
    idleTimeoutMs: req.def.capabilities.streamWire.idleTimeoutMs,
    onPayload: (payload) => {
      events.push(...consumer.consume(payload));
    },
  });
  for (const event of events) yield event;
  if (aborted) throw new Error("stream aborted");
}
