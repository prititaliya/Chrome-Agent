import { describe, expect, it } from "vitest";
import { runTurn, type TurnOptions } from "../../src/agent/loop";
import {
  addUsage,
  costLabel,
  emptyUsage,
  formatCost,
  formatTokens,
  priceOf,
  requestUsage,
  type RequestUsage,
  type UsageEvent,
} from "../../src/agent/usage";
import { toModelConfig } from "../../src/providers";
import { buildChatBody, consumeChatPayload, streamChat, ToolCallAccumulator } from "../../src/providers/chat";
import type { ProviderConfig, StreamEvent, StreamRequest } from "../../src/providers/types";
import { summarizeUsage, usageCsv, type UsageRecord } from "../../src/storage/usage";

const usage = (patch: Partial<UsageEvent> = {}): UsageEvent => ({ type: "usage", inputTokens: 1000, outputTokens: 200, ...patch });

describe("request cost", () => {
  it("prefers the provider's billed cost", () => {
    const r = requestUsage(usage({ cost: 0.0123 }), { input: 1, output: 1 });
    expect(r).toMatchObject({ cost: 0.0123, costSource: "provider", approx: false });
  });

  it("estimates from per-million prices, billing cached input at the cached rate", () => {
    const tokens = { input: 1_000_000, output: 500_000, cached: 400_000 };
    expect(priceOf(tokens, { input: 2, output: 8, cachedInput: 0.5 })).toBeCloseTo(0.6 * 2 + 0.4 * 0.5 + 0.5 * 8);
    const r = requestUsage(usage({ cachedTokens: 400 }), { input: 2, output: 8 });
    expect(r.costSource).toBe("estimate");
    expect(r.cost).toBeCloseTo((1000 * 2 + 200 * 8) / 1e6);
  });

  it("reports unknown cost without pricing, and approximate tokens without usage", () => {
    expect(requestUsage(usage(), undefined)).toMatchObject({ cost: null, costSource: "none" });
    expect(requestUsage(null, undefined, { input: 50, output: 7 })).toMatchObject({ input: 50, output: 7, approx: true });
  });

  it("sums requests and labels partial pricing as a lower bound", () => {
    const priced: RequestUsage = { input: 10, output: 5, cached: 0, reasoning: 0, cost: 0.02, costSource: "provider", approx: false };
    const unpriced: RequestUsage = { ...priced, cost: null, costSource: "none" };
    const total = addUsage(addUsage(emptyUsage(), priced), unpriced);
    expect(total).toMatchObject({ requests: 2, input: 20, output: 10, cost: 0.02, unpriced: 1, lastInput: 10 });
    expect(costLabel(total)).toBe("≥$0.020");
    expect(costLabel(addUsage(emptyUsage(), unpriced))).toBe("—");
  });

  it("formats tokens and dollars compactly", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(1_250_000)).toBe("1.25M");
    expect(formatCost(0.00004)).toBe("<$0.0001");
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(3.456)).toBe("$3.46");
  });
});

describe("provider usage reporting", () => {
  const provider: ProviderConfig = { id: "p", name: "P", baseUrl: "https://api.test/v1", apiKey: "k", wire: "chat", models: [] };
  const req: StreamRequest = { provider, model: { id: "m", vision: false, tools: true }, messages: [{ role: "user", content: "hi" }] };

  it("asks for streamed usage, and for billed cost on OpenRouter", () => {
    expect(buildChatBody(req)["stream_options"]).toEqual({ include_usage: true });
    expect(buildChatBody(req)["usage"]).toBeUndefined();
    expect(buildChatBody({ ...req, provider: { ...provider, baseUrl: "https://openrouter.ai/api/v1" } })["usage"]).toEqual({ include: true });
  });

  it("parses cached, reasoning and cost fields", () => {
    const payload = JSON.stringify({
      choices: [],
      usage: {
        prompt_tokens: 900,
        completion_tokens: 300,
        prompt_tokens_details: { cached_tokens: 600 },
        completion_tokens_details: { reasoning_tokens: 120 },
        cost: 0.0042,
      },
    });
    expect(consumeChatPayload(payload, new ToolCallAccumulator())).toEqual([
      { type: "usage", inputTokens: 900, outputTokens: 300, cachedTokens: 600, reasoningTokens: 120, cost: 0.0042 },
    ]);
  });

  it("retries without usage options when a strict server rejects them", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      if ("stream_options" in body) {
        return new Response(JSON.stringify({ error: { message: "Unrecognized request argument: stream_options" } }), { status: 400 });
      }
      return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    const events: StreamEvent[] = [];
    for await (const e of streamChat({ ...req, fetchImpl })) events.push(e);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty("stream_options");
    expect(events[0]).toEqual({ type: "text", text: "ok" });
  });

  it("reads OpenRouter prices and context length from /models", () => {
    const m = toModelConfig({ id: "a/b", pricing: { prompt: "0.0000003", completion: "0.0000012", input_cache_read: "0.00000003" }, context_length: 128000 });
    expect(m?.pricing).toEqual({ input: 0.3, output: 1.2, cachedInput: 0.03 });
    expect(m?.contextWindow).toBe(128000);
    expect(toModelConfig({ id: "x", pricing: { prompt: "-1", completion: "-1" } })?.pricing).toBeUndefined();
  });
});

describe("agent loop usage", () => {
  function options(script: StreamEvent[][], onUsage: (u: RequestUsage) => void): TurnOptions {
    let i = 0;
    return {
      provider: { id: "p", name: "P", baseUrl: "https://x", apiKey: "k", wire: "chat", models: [] },
      model: { id: "m", vision: false, tools: true, pricing: { input: 1, output: 2 } },
      systemPrompt: "SYS",
      history: [],
      userMessage: { role: "user", content: "question" },
      tools: [],
      maxSteps: 5,
      signal: new AbortController().signal,
      executor: { execute: async () => ({ ok: true, text: "done" }) },
      callbacks: { onText: () => {}, onReasoning: () => {}, onStep: () => {}, onUsage },
      stream: async function* () {
        for (const e of script[i++] ?? []) yield e;
      },
    };
  }

  it("reports one usage entry per model request", async () => {
    const seen: RequestUsage[] = [];
    await runTurn(
      options(
        [
          [{ type: "toolCall", call: { id: "c1", name: "snapshot", args: "{}" } }, usage({ inputTokens: 100, outputTokens: 10 })],
          [{ type: "text", text: "Answer" }, usage({ inputTokens: 150, outputTokens: 20 })],
        ],
        (u) => seen.push(u),
      ),
    );
    expect(seen.map((u) => [u.input, u.output, u.costSource])).toEqual([
      [100, 10, "estimate"],
      [150, 20, "estimate"],
    ]);
  });

  it("approximates tokens when the provider sends no usage", async () => {
    const seen: RequestUsage[] = [];
    await runTurn(options([[{ type: "text", text: "x".repeat(400) }]], (u) => seen.push(u)));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ approx: true, output: 100 });
    expect(seen[0]!.input).toBeGreaterThan(0);
  });
});

describe("usage ledger", () => {
  const now = new Date(2026, 9, 14, 12).getTime();
  const rec = (patch: Partial<UsageRecord>): UsageRecord => ({
    ts: now,
    convId: "c1",
    providerId: "or",
    providerName: "OpenRouter",
    modelId: "a/m1",
    input: 100,
    output: 10,
    cached: 0,
    reasoning: 0,
    cost: 0.01,
    costSource: "provider",
    approx: false,
    ...patch,
  });

  it("aggregates by model and day within the range", () => {
    const records = [
      rec({}),
      rec({ modelId: "a/m2", cost: 0.05, convId: "c2" }),
      rec({ ts: now - 86_400_000, cost: 0.02 }),
      rec({ ts: now - 40 * 86_400_000, cost: 9 }),
    ];
    const s = summarizeUsage(records, now - 7 * 86_400_000, 7, now);
    expect(s.total.requests).toBe(3);
    expect(s.total.cost).toBeCloseTo(0.08);
    expect(s.conversations).toBe(2);
    expect(s.byModel.map((m) => m.modelId)).toEqual(["a/m2", "a/m1"]);
    expect(s.byDay).toHaveLength(7);
    expect(s.byDay[6]!.usage.cost).toBeCloseTo(0.06);
    expect(s.byDay[5]!.usage.cost).toBeCloseTo(0.02);
  });

  it("exports CSV", () => {
    const csv = usageCsv([rec({ cost: null, costSource: "none" })]).split("\n");
    expect(csv[0]).toMatch(/^time,provider,model,/);
    expect(csv[1]).toContain('"OpenRouter","a/m1",100,0,10,0,,none,false,c1');
  });
});
