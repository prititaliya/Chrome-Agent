// OpenAI Responses wire, for models that reject tools on chat-completions.

import { usageEvent } from "./chat";
import { joinUrl, postWithRetry, providerHeaders, readPayloads } from "./http";
import { ProviderError, type ApiMessage, type StreamEvent, type StreamRequest, type ToolCall } from "./types";

export function toInputItems(messages: ApiMessage[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: m.toolCallId ?? "",
        output: typeof m.content === "string" ? m.content : "",
      });
      continue;
    }
    if (m.role === "assistant") {
      const text = typeof m.content === "string" ? m.content : "";
      if (text !== "") items.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const call of m.toolCalls ?? []) {
        items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.args || "{}" });
      }
      continue;
    }
    const parts =
      typeof m.content === "string"
        ? [{ type: "input_text", text: m.content }]
        : m.content.map((p) =>
            p.type === "text" ? { type: "input_text", text: p.text } : { type: "input_image", image_url: p.dataUrl },
          );
    items.push({ role: m.role === "system" ? "developer" : m.role, content: parts });
  }
  return items;
}

export function buildResponsesBody(req: StreamRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model.id, input: toInputItems(req.messages), stream: true };
  if (req.maxTokens !== undefined) body["max_output_tokens"] = req.maxTokens;
  if (req.tools && req.tools.length > 0) {
    body["tools"] = req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters }));
  }
  return body;
}

export class ResponsesConsumer {
  private readonly slots = new Map<string, ToolCall>();
  private order: string[] = [];

  consume(payload: string): StreamEvent[] {
    if (payload.trim() === "[DONE]") return [];
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return [];
    }
    const type = json["type"];
    switch (type) {
      case "response.output_text.delta":
        return typeof json["delta"] === "string" && json["delta"] !== "" ? [{ type: "text", text: json["delta"] }] : [];
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta":
        return typeof json["delta"] === "string" && json["delta"] !== ""
          ? [{ type: "reasoning", text: json["delta"] }]
          : [];
      case "response.output_item.added":
      case "response.output_item.done": {
        const item = json["item"] as Record<string, unknown> | undefined;
        if (!item || item["type"] !== "function_call") return [];
        const key = String(item["id"] ?? item["call_id"] ?? "");
        const slot = this.slots.get(key) ?? { id: String(item["call_id"] ?? key), name: "", args: "" };
        if (typeof item["name"] === "string" && item["name"] !== "") slot.name = item["name"];
        if (typeof item["arguments"] === "string" && item["arguments"] !== "") slot.args = item["arguments"];
        if (!this.slots.has(key)) this.order.push(key);
        this.slots.set(key, slot);
        return [];
      }
      case "response.function_call_arguments.delta": {
        const slot = this.slots.get(String(json["item_id"] ?? ""));
        if (slot && typeof json["delta"] === "string") slot.args += json["delta"];
        return [];
      }
      case "response.completed":
      case "response.incomplete": {
        const usage = (json["response"] as Record<string, unknown> | undefined)?.["usage"] as Record<string, unknown> | undefined;
        if (usage && typeof usage["input_tokens"] === "number" && typeof usage["output_tokens"] === "number") {
          return [
            usageEvent(
              usage["input_tokens"],
              usage["output_tokens"],
              (usage["input_tokens_details"] as Record<string, unknown> | undefined)?.["cached_tokens"],
              (usage["output_tokens_details"] as Record<string, unknown> | undefined)?.["reasoning_tokens"],
              usage["cost"],
            ),
          ];
        }
        return [];
      }
      case "response.failed":
      case "error": {
        const err = (json["response"] as Record<string, unknown> | undefined)?.["error"] ?? json["error"] ?? json;
        const message = (err as { message?: unknown }).message;
        throw new ProviderError(`Provider error: ${typeof message === "string" ? message : "response failed"}`, 500);
      }
      default:
        return [];
    }
  }

  drain(): ToolCall[] {
    const calls = this.order
      .map((key) => this.slots.get(key))
      .filter((c): c is ToolCall => c !== undefined && c.name !== "")
      .map((c) => ({ ...c, args: c.args.trim() === "" ? "{}" : c.args }));
    this.slots.clear();
    this.order = [];
    return calls;
  }
}

export async function* streamResponses(req: StreamRequest): AsyncGenerator<StreamEvent> {
  const response = await postWithRetry(
    joinUrl(req.provider.baseUrl, "/responses"),
    { headers: providerHeaders(req.provider, req.sessionId), body: JSON.stringify(buildResponsesBody(req)), signal: req.signal },
    req.provider,
    req.fetchImpl,
  );
  const consumer = new ResponsesConsumer();
  for await (const payload of readPayloads(response, req.signal)) {
    for (const event of consumer.consume(payload)) yield event;
  }
  for (const call of consumer.drain()) yield { type: "toolCall", call };
  yield { type: "done", reason: "stop" };
}
