// OpenAI chat-completions wire (OpenRouter, OpenCode Go, most gateways).

import { joinUrl, postWithRetry, providerHeaders, readPayloads } from "./http";
import { ProviderError, type ApiMessage, type StreamEvent, type StreamRequest, type ToolCall } from "./types";

function wireContent(content: ApiMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text" ? { type: "text", text: part.text } : { type: "image_url", image_url: { url: part.dataUrl } },
  );
}

export function toChatMessages(messages: ApiMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId ?? "", content: typeof m.content === "string" ? m.content : "" };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: typeof m.content === "string" && m.content !== "" ? m.content : null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args || "{}" },
        })),
      };
    }
    return { role: m.role, content: wireContent(m.content) };
  });
}

export function buildChatBody(req: StreamRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model.id,
    messages: toChatMessages(req.messages),
    stream: true,
    stream_options: { include_usage: true },
  };
  // OpenRouter adds the billed cost to the usage block when asked.
  if (/openrouter\.ai/i.test(req.provider.baseUrl)) body["usage"] = { include: true };
  if (req.maxTokens !== undefined) body["max_tokens"] = req.maxTokens;
  if (req.tools && req.tools.length > 0) {
    body["tools"] = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  return body;
}

let generatedIds = 0;
function newCallId(): string {
  generatedIds += 1;
  return `call_${Date.now().toString(36)}_${generatedIds}`;
}

/** Accumulates streamed tool-call fragments; tolerant of providers that omit `index`. */
export class ToolCallAccumulator {
  private readonly slots = new Map<number, { id: string; name: string; args: string }>();
  private lastIndex = -1;

  add(raw: Record<string, unknown>): void {
    const fn = (raw["function"] ?? {}) as Record<string, unknown>;
    const id = typeof raw["id"] === "string" && raw["id"] !== "" ? raw["id"] : undefined;
    let index = typeof raw["index"] === "number" ? raw["index"] : undefined;
    if (index === undefined) {
      const existing = id ? [...this.slots.entries()].find(([, s]) => s.id === id) : undefined;
      index = existing ? existing[0] : id ? this.slots.size : Math.max(this.lastIndex, 0);
    }
    this.lastIndex = index;
    const slot = this.slots.get(index) ?? { id: "", name: "", args: "" };
    if (id) slot.id = id;
    if (typeof fn["name"] === "string" && fn["name"] !== "") slot.name = fn["name"];
    const args = fn["arguments"];
    if (typeof args === "string") slot.args += args;
    else if (args && typeof args === "object") slot.args = JSON.stringify(args);
    this.slots.set(index, slot);
  }

  drain(): ToolCall[] {
    const calls = [...this.slots.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, s]) => s)
      .filter((s) => s.name !== "")
      .map((s) => ({ id: s.id || newCallId(), name: s.name, args: s.args.trim() === "" ? "{}" : s.args }));
    this.slots.clear();
    this.lastIndex = -1;
    return calls;
  }
}

function reasoningOf(delta: Record<string, unknown>): string {
  for (const key of ["reasoning_content", "reasoning"]) {
    const value = delta[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

export function usageEvent(input: number, output: number, cached: unknown, reasoning: unknown, cost: unknown): StreamEvent {
  return {
    type: "usage",
    inputTokens: input,
    outputTokens: output,
    ...(typeof cached === "number" && cached > 0 ? { cachedTokens: cached } : {}),
    ...(typeof reasoning === "number" && reasoning > 0 ? { reasoningTokens: reasoning } : {}),
    ...(typeof cost === "number" && Number.isFinite(cost) ? { cost } : {}),
  };
}

/** Parse one chat-completions payload (stream chunk or full JSON body). */
export function consumeChatPayload(payload: string, calls: ToolCallAccumulator): StreamEvent[] {
  if (payload.trim() === "[DONE]") return [];
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return [];
  }
  const error = json["error"];
  if (error) {
    const message = typeof error === "string" ? error : String((error as { message?: unknown }).message ?? "unknown error");
    throw new ProviderError(`Provider error: ${message}`, Number((error as { code?: unknown }).code) || 500);
  }
  const events: StreamEvent[] = [];
  const usage = json["usage"] as Record<string, unknown> | undefined;
  if (usage && typeof usage["prompt_tokens"] === "number" && typeof usage["completion_tokens"] === "number") {
    events.push(
      usageEvent(
        usage["prompt_tokens"],
        usage["completion_tokens"],
        (usage["prompt_tokens_details"] as Record<string, unknown> | undefined)?.["cached_tokens"],
        (usage["completion_tokens_details"] as Record<string, unknown> | undefined)?.["reasoning_tokens"],
        usage["cost"],
      ),
    );
  }
  const choices = json["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return events;
  const choice = choices[0] as Record<string, unknown>;
  const delta = (choice["delta"] ?? choice["message"] ?? {}) as Record<string, unknown>;
  const reasoning = reasoningOf(delta);
  if (reasoning !== "") events.push({ type: "reasoning", text: reasoning });
  if (typeof delta["content"] === "string" && delta["content"] !== "") {
    events.push({ type: "text", text: delta["content"] });
  }
  const toolCalls = delta["tool_calls"];
  if (Array.isArray(toolCalls)) {
    for (const raw of toolCalls) {
      if (raw && typeof raw === "object") calls.add(raw as Record<string, unknown>);
    }
  }
  const finish = choice["finish_reason"];
  if (typeof finish === "string" && finish !== "") events.push({ type: "done", reason: finish });
  return events;
}

export async function* streamChat(req: StreamRequest): AsyncGenerator<StreamEvent> {
  const post = (body: Record<string, unknown>) =>
    postWithRetry(
      joinUrl(req.provider.baseUrl, "/chat/completions"),
      { headers: providerHeaders(req.provider, req.sessionId), body: JSON.stringify(body), signal: req.signal },
      req.provider,
      req.fetchImpl,
    );
  const body = buildChatBody(req);
  let response: Response;
  try {
    response = await post(body);
  } catch (error) {
    // A few strict servers reject the usage-reporting extras; retry without them.
    if (!(error instanceof ProviderError) || error.status !== 400 || !/stream_options|usage/i.test(error.message)) throw error;
    const { stream_options: _streamOptions, usage: _usage, ...plain } = body;
    response = await post(plain);
  }
  const calls = new ToolCallAccumulator();
  let finish = "stop";
  for await (const payload of readPayloads(response, req.signal)) {
    for (const event of consumeChatPayload(payload, calls)) {
      if (event.type === "done") finish = event.reason;
      else yield event;
    }
  }
  for (const call of calls.drain()) yield { type: "toolCall", call };
  yield { type: "done", reason: finish };
}
