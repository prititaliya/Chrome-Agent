import { describe, expect, it } from "vitest";
import { providerHeaders } from "../../src/providers/http";
import { buildChatBody, consumeChatPayload, streamChat, ToolCallAccumulator } from "../../src/providers/chat";
import type { ModelConfig, ProviderConfig, StreamEvent } from "../../src/providers/types";

const provider: ProviderConfig = {
  id: "p",
  name: "TestProvider",
  baseUrl: "https://api.test/v1",
  apiKey: "sk-test",
  wire: "chat",
  models: [],
};
const model: ModelConfig = { id: "m", vision: true, tools: true };

function sse(chunks: object[]): string[] {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`);
}

/** A response whose body is fed manually, to prove events arrive before the body ends. */
function controlledResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

describe("chat-completions streaming", () => {
  it("yields text deltas incrementally, before the body finishes", async () => {
    const ctl = controlledResponse();
    const gen = streamChat({ provider, model, messages: [{ role: "user", content: "hi" }], fetchImpl: async () => ctl.response });
    ctl.push(sse([{ choices: [{ delta: { content: "Hel" } }] }])[0]!);
    const first = await gen.next();
    expect(first.value).toEqual({ type: "text", text: "Hel" });
    ctl.push(sse([{ choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] }])[0]!);
    ctl.push("data: [DONE]\n\n");
    ctl.close();
    const rest: StreamEvent[] = [];
    for await (const e of gen) rest.push(e);
    expect(rest).toEqual([
      { type: "text", text: "lo" },
      { type: "done", reason: "stop" },
    ]);
  });

  it("accumulates split tool-call arguments and emits them at the end", async () => {
    const body = sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "click", arguments: '{"re' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'f":3}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]).join("");
    const events: StreamEvent[] = [];
    for await (const e of streamChat({
      provider,
      model,
      messages: [{ role: "user", content: "x" }],
      fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
    })) {
      events.push(e);
    }
    expect(events).toEqual([
      { type: "toolCall", call: { id: "c1", name: "click", args: '{"ref":3}' } },
      { type: "done", reason: "tool_calls" },
    ]);
  });

  it("handles providers that omit the tool-call index", () => {
    const acc = new ToolCallAccumulator();
    acc.add({ id: "a", function: { name: "snapshot", arguments: "{}" } });
    acc.add({ id: "b", function: { name: "web_search", arguments: '{"query":' } });
    acc.add({ function: { arguments: '"x"}' } });
    expect(acc.drain()).toEqual([
      { id: "a", name: "snapshot", args: "{}" },
      { id: "b", name: "web_search", args: '{"query":"x"}' },
    ]);
  });

  it("parses a non-streamed JSON body", () => {
    const acc = new ToolCallAccumulator();
    const events = consumeChatPayload(
      JSON.stringify({ choices: [{ message: { content: "Done" }, finish_reason: "stop" }] }),
      acc,
    );
    expect(events).toEqual([
      { type: "text", text: "Done" },
      { type: "done", reason: "stop" },
    ]);
  });

  it("emits reasoning deltas", () => {
    const events = consumeChatPayload(JSON.stringify({ choices: [{ delta: { reasoning_content: "hmm" } }] }), new ToolCallAccumulator());
    expect(events).toEqual([{ type: "reasoning", text: "hmm" }]);
  });

  it("turns HTTP errors into readable messages", async () => {
    const gen = streamChat({
      provider,
      model,
      messages: [{ role: "user", content: "x" }],
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }),
    });
    await expect(gen.next()).rejects.toThrow(/TestProvider rejected the API key \(401\)\. .*bad key/);
  });

  it("retries once on 429 before failing", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } });
      return new Response(sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const events: StreamEvent[] = [];
    for await (const e of streamChat({ provider, model, messages: [{ role: "user", content: "x" }], fetchImpl })) events.push(e);
    expect(calls).toBe(2);
    expect(events[0]).toEqual({ type: "text", text: "ok" });
  });

  it("throws on an error payload inside the stream", async () => {
    const body = sse([{ error: { message: "model overloaded", code: 503 } }]).join("");
    const gen = streamChat({
      provider,
      model,
      messages: [{ role: "user", content: "x" }],
      fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
    });
    await expect(gen.next()).rejects.toThrow(/model overloaded/);
  });

  it("stops promptly when aborted", async () => {
    const ctl = controlledResponse();
    const abort = new AbortController();
    const gen = streamChat({
      provider,
      model,
      messages: [{ role: "user", content: "x" }],
      signal: abort.signal,
      fetchImpl: async () => ctl.response,
    });
    ctl.push(sse([{ choices: [{ delta: { content: "a" } }] }])[0]!);
    await gen.next();
    abort.abort();
    const rest: StreamEvent[] = [];
    for await (const e of gen) rest.push(e);
    expect(rest.filter((e) => e.type === "text")).toEqual([]);
  });

  it("serializes tool calls, tool results, and images in the wire format", () => {
    const body = buildChatBody({
      provider,
      model,
      messages: [
        { role: "user", content: [{ type: "text", text: "see" }, { type: "image", dataUrl: "data:image/jpeg;base64,AA" }] },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "snapshot", args: "{}" }] },
        { role: "tool", toolCallId: "c1", content: "result" },
      ],
      tools: [{ name: "snapshot", description: "d", parameters: { type: "object" } }],
    });
    expect(body["messages"]).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "see" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,AA" } },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "snapshot", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "result" },
    ]);
    expect(body["tools"]).toEqual([{ type: "function", function: { name: "snapshot", description: "d", parameters: { type: "object" } } }]);
  });
});

describe("provider headers", () => {
  it("sends a stable session id to OpenCode Go only", () => {
    const go: ProviderConfig = { ...provider, baseUrl: "https://opencode.ai/zen/go/v1" };
    expect(providerHeaders(go, "conv-1")["x-opencode-session"]).toBe("conv-1");
    expect(providerHeaders(go)["x-opencode-session"]).toMatch(/.+/);
    expect(providerHeaders(provider, "conv-1")["x-opencode-session"]).toBeUndefined();
    expect(providerHeaders({ ...provider, baseUrl: "https://notopencode.ai.evil.test/v1" }, "c")["x-opencode-session"]).toBeUndefined();
    expect(providerHeaders(provider).authorization).toBe("Bearer sk-test");
  });
});
