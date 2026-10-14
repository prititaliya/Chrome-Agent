import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PayloadParser, pumpBody } from "../../src/providers/sse";
import {
  buildChatBody,
  ChatTurnConsumer,
  streamChatCompletions,
} from "../../src/providers/wire/chat-completions";
import { openrouterEntry } from "../../src/providers/entries/openrouter";
import type { ModelDef } from "../../src/providers/types";

const testModel: ModelDef = {
  id: "test/model",
  label: "Test",
  wire: "chat.completions",
  contextWindow: 8000,
  maxOutput: 1024,
  supportsTools: true,
  supportsVision: false,
  reasoning: false,
};

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index];
      index += 1;
      controller.enqueue(encoder.encode(chunk));
    },
  });
}

describe("PayloadParser", () => {
  it("skips heartbeats and joins split frames", () => {
    const parser = new PayloadParser("sse");
    const first = parser.feed(': ping\n\ndata: {"a":1}\n\ndata: {"b":');
    const second = parser.feed("2}\n\n");
    expect(first).toEqual(['{"a":1}']);
    expect(second).toEqual(['{"b":2}']);
  });

  it("handles CRLF framing and [DONE]-less EOF", () => {
    const parser = new PayloadParser("sse");
    expect(parser.feed('data: {"a":1}\r\n\r\ndata: {"b":2}')).toEqual(['{"a":1}']);
    expect(parser.flush()).toEqual(['{"b":2}']);
  });

  it("splits ndjson lines and yields a single json body", () => {
    const ndjson = new PayloadParser("ndjson");
    expect(ndjson.feed('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(ndjson.flush()).toEqual(['{"b":']);
    const body = new PayloadParser("json-body");
    expect(body.feed('{"a":')).toEqual([]);
    expect(body.flush()).toEqual(['{"a":']);
  });
});

describe("ChatTurnConsumer", () => {
  it("accumulates tool args across chunks and parses at finish", async () => {
    const raw = await readFile(new URL("../fixtures/sse/split-frames.txt", import.meta.url), "utf8");
    // Deterministic byte splits, including mid-line.
    const chunks = [raw.slice(0, 61), raw.slice(61, 130), raw.slice(130)];
    const seen: string[] = [];
    await pumpBody(chunkedStream(chunks), {
      framing: "sse",
      idleTimeoutMs: 1000,
      onPayload: (p) => seen.push(p),
    });
    const consumer = new ChatTurnConsumer();
    const events = seen.flatMap((p) => consumer.consume(p));
    expect(events).toContainEqual({ type: "text", text: "Hello" });
    expect(events).toContainEqual({ type: "toolCall", id: "call_abc", name: "browser_snapshot", args: {} });
    expect(events).toContainEqual({ type: "finished", reason: "tool_calls" });
  });

  it("handles a gateway that ignored stream (single JSON body)", async () => {
    const raw = await readFile(new URL("../fixtures/sse/non-sse-json.txt", import.meta.url), "utf8");
    const seen: string[] = [];
    await pumpBody(chunkedStream([raw]), {
      framing: "json-body",
      idleTimeoutMs: 1000,
      onPayload: (p) => seen.push(p),
    });
    const consumer = new ChatTurnConsumer();
    const events = seen.flatMap((p) => consumer.consume(p));
    expect(events).toContainEqual({ type: "text", text: "entire body, gateway ignored stream" });
    expect(events).toContainEqual({ type: "usage", inputTokens: 10, outputTokens: 5 });
  });

  it("reassembles UTF-8 split across chunk boundaries", () => {
    const parser = new PayloadParser("sse");
    const bytes = new TextEncoder().encode('data: {"t":"…"}\n\n');
    const decoder = new TextDecoder();
    const first = decoder.decode(bytes.slice(0, 12), { stream: true });
    const second = decoder.decode(bytes.slice(12), { stream: true });
    expect(parser.feed(first)).toEqual([]);
    expect(parser.feed(second)).toEqual(['{"t":"…"}']);
  });
});

describe("streamChatCompletions", () => {
  it("streams text, tool calls, and usage through a stub fetch", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
    const fetchImpl = (async () => new Response(chunkedStream([sse]))) as typeof fetch;
    const events = [];
    for await (const event of streamChatCompletions({
      def: openrouterEntry.def,
      model: testModel,
      apiKey: "k",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
    })) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: "text", text: "hi" });
    expect(events).toContainEqual({ type: "usage", inputTokens: 3, outputTokens: 1 });
  });

  it("strips temperature for reasoning models per quirk", () => {
    const reasoning: ModelDef = { ...testModel, reasoning: true };
    const body = buildChatBody({
      def: openrouterEntry.def,
      model: reasoning,
      apiKey: "k",
      messages: [],
    });
    expect("temperature" in body).toBe(false);
  });

  it("aborts a hung stream within 200ms", async () => {
    const hung = new ReadableStream<Uint8Array>({ pull() {} });
    const controller = new AbortController();
    const seen: string[] = [];
    const start = performance.now();
    setTimeout(() => controller.abort(), 20);
    const result = await pumpBody(hung, {
      framing: "sse",
      idleTimeoutMs: 30_000,
      signal: controller.signal,
      onPayload: (p) => seen.push(p),
    });
    expect(performance.now() - start).toBeLessThan(200);
    expect(result.aborted).toBe(true);
    expect(seen).toEqual([]);
  });
});
