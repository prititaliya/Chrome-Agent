import { describe, expect, it, vi } from "vitest";
import {
  autoCandidates,
  classifyByRules,
  classifyWithJev,
  classifyWithModel,
  decisionsUrl,
  guessTier,
  isFree,
  JEV_MODEL,
  rankCandidates,
  routeModel,
  type Candidate,
} from "../../src/agent/router";
import type { ModelConfig, ProviderConfig, StreamEvent, StreamRequest } from "../../src/providers/types";
import { DEFAULT_AUTO, type AutoSettings } from "../../src/storage/settings";

const model = (id: string, patch: Partial<ModelConfig> = {}): ModelConfig => ({ id, vision: false, tools: true, ...patch });

const OPENROUTER: ProviderConfig = {
  id: "openrouter",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "or-key",
  wire: "chat",
  preset: "openrouter",
  models: [
    model("z-ai/glm-5.3:free", { pricing: { input: 0, output: 0 } }),
    model("openai/gpt-6-luna", { pricing: { input: 5, output: 20 }, vision: true }),
    model("deepseek/deepseek-v4.1-flash", { pricing: { input: 0.1, output: 0.4 } }),
    model("vendor/chatty", { pricing: { input: 1, output: 3 }, tools: false }),
  ],
};
const NOKEY: ProviderConfig = { id: "nokey", name: "No key", baseUrl: "https://x/v1", apiKey: "", wire: "chat", models: [model("best-pro")] };

const auto = (patch: Partial<AutoSettings> = {}): AutoSettings => ({ ...DEFAULT_AUTO, enabled: true, ...patch });
const ids = (list: Candidate[]) => list.map((c) => c.model.id);

function scriptedStream(text: string | Error, delayMs = 0) {
  const calls: StreamRequest[] = [];
  const stream = async function* (req: StreamRequest): AsyncGenerator<StreamEvent> {
    calls.push(req);
    if (delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        req.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }
    if (text instanceof Error) throw text;
    yield { type: "text", text };
    yield { type: "usage", inputTokens: 50, outputTokens: 10 };
  };
  return { stream, calls };
}

function jevFetch(response: unknown, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("model tiers and prices", () => {
  it("detects free models by price or the :free suffix", () => {
    expect(isFree(model("a", { pricing: { input: 0, output: 0 } }))).toBe(true);
    expect(isFree(model("vendor/x:free"))).toBe(true);
    expect(isFree(model("vendor/x", { pricing: { input: 0, output: 1 } }))).toBe(false);
    expect(isFree(model("vendor/x"))).toBe(false);
  });

  it("guesses tiers from price, then name, and respects the user's choice", () => {
    expect(guessTier(model("a", { pricing: { input: 3, output: 15 } }))).toBe("best");
    expect(guessTier(model("a", { pricing: { input: 0.1, output: 0.4 } }))).toBe("basic");
    expect(guessTier(model("a", { pricing: { input: 1, output: 4 } }))).toBe("strong");
    expect(guessTier(model("glm-5.3-flash"))).toBe("basic");
    expect(guessTier(model("meta/llama-3-8b"))).toBe("basic");
    expect(guessTier(model("deepseek/deepseek-v4-pro"))).toBe("best");
    expect(guessTier(model("minimax/minimax-m3"))).toBe("strong");
    expect(guessTier(model("kimi-k2.6"))).toBe("strong");
    expect(guessTier(model("glm-5.3-flash", { tier: "best" }))).toBe("best");
  });
});

describe("rule classifier", () => {
  it.each([
    ["hi", "simple", false],
    ["What is this page?", "simple", false],
    ["Summarize this article in three bullet points for me please, focusing on the main argument and the data", "simple", false],
    ["Sign in to github and open my notifications", "standard", true],
    ["Add the blue one to my cart", "standard", true],
    ["Compare the prices of these laptops on amazon.com and bestbuy.com", "complex", false],
    ["Write code that scrapes this table", "complex", false],
  ])("%s -> %s", (question, level, tools) => {
    const result = classifyByRules(question);
    expect(result.level).toBe(level);
    expect(result.tools).toBe(tools);
    expect(result.confident).toBe(true);
  });

  it("flags vision and is unsure about long requests without clear signals", () => {
    expect(classifyByRules("What does the chart on this page show?").vision).toBe(true);
    const vague = classifyByRules(
      "So I have been thinking about the situation with the landlord and the deposit, and I am not sure whether the clause about repairs in my lease applies here at all",
    );
    expect(vague.confident).toBe(false);
  });
});

describe("ranking", () => {
  const all = autoCandidates([OPENROUTER, NOKEY], auto());

  it("only uses allowed models whose provider has a key", () => {
    expect(ids(all)).not.toContain("best-pro");
    const allowed = autoCandidates([OPENROUTER], auto({ allowed: [{ providerId: "openrouter", modelId: "openai/gpt-6-luna" }] }));
    expect(ids(allowed)).toEqual(["openai/gpt-6-luna"]);
  });

  it("prefers a free model that is good enough", () => {
    expect(ids(rankCandidates(all, { level: "simple", tools: false, vision: false }, true))[0]).toBe("z-ai/glm-5.3:free");
    expect(ids(rankCandidates(all, { level: "standard", tools: true, vision: false }, true))[0]).toBe("z-ai/glm-5.3:free");
  });

  it("picks the cheapest model when free models are not preferred", () => {
    expect(ids(rankCandidates(all, { level: "simple", tools: true, vision: false }, false))[0]).toBe("z-ai/glm-5.3:free");
    const paid = all.filter((c) => !c.free);
    expect(ids(rankCandidates(paid, { level: "simple", tools: true, vision: false }, false))[0]).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("respects the tier floor and capability filters", () => {
    expect(ids(rankCandidates(all, { level: "complex", tools: true, vision: false }, true))[0]).toBe("openai/gpt-6-luna");
    expect(ids(rankCandidates(all, { level: "simple", tools: false, vision: true }, true))[0]).toBe("openai/gpt-6-luna");
    expect(ids(rankCandidates(all, { level: "standard", tools: true, vision: false }, true))).not.toContain("vendor/chatty");
  });

  it("falls back to the highest tier when nothing is good enough", () => {
    const weak = all.filter((c) => c.model.id === "deepseek/deepseek-v4.1-flash" || c.model.id === "z-ai/glm-5.3:free");
    expect(ids(rankCandidates(weak, { level: "complex", tools: true, vision: false }, true))[0]).toBe("z-ai/glm-5.3:free");
  });
});

describe("tiny model classifier", () => {
  const cheap = autoCandidates([OPENROUTER], auto())[0]!;

  it("parses the JSON reply", async () => {
    const { stream, calls } = scriptedStream('Sure: {"level":"complex","tools":true,"vision":false}');
    const result = await classifyWithModel({ candidate: cheap, question: "do the thing", stream });
    expect(result.need).toEqual({ level: "complex", tools: true, vision: false });
    expect(calls[0]!.maxTokens).toBe(60);
    expect(result.usage.input).toBe(50);
  });

  it("rejects bad JSON and times out", async () => {
    await expect(classifyWithModel({ candidate: cheap, question: "x", stream: scriptedStream("no idea").stream })).rejects.toThrow();
    await expect(classifyWithModel({ candidate: cheap, question: "x", stream: scriptedStream('{"level":"huge"}').stream })).rejects.toThrow();
    await expect(classifyWithModel({ candidate: cheap, question: "x", stream: scriptedStream("{}", 200).stream, timeoutMs: 20 })).rejects.toThrow();
  });
});

describe("Jev classifier", () => {
  const answer = (choice: string, confidence: number, browser = 0.1, vision = 0.1) => ({
    answers: {
      level: { choice, confidence, probabilities: {}, type: "choice" },
      browser: { noul: browser, type: "noul" },
      vision: { noul: vision, type: "noul" },
    },
    usage: { cost: 0.00002, input_tokens: 120, output_tokens: 3 },
  });

  it("builds the decisions URL from the OpenRouter base URL", () => {
    expect(decisionsUrl(OPENROUTER)).toBe("https://openrouter.ai/api/alpha/decisions");
  });

  it("sends one request with the three questions and maps the answer", async () => {
    const { impl, calls } = jevFetch(answer("standard", 0.9, 0.97, 0.2));
    const result = await classifyWithJev({
      provider: OPENROUTER,
      question: "Book a table for two",
      page: { title: "Bistro", url: "https://bistro.test" },
      earlier: ["hi"],
      fetchImpl: impl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(calls[0]!.body["model"]).toBe(JEV_MODEL);
    expect(calls[0]!.body["state"]).toEqual({ request: "Book a table for two", page: "Bistro - https://bistro.test", earlier: ["hi"] });
    expect(Object.keys(calls[0]!.body["questions"] as object)).toEqual(["level", "browser", "vision"]);
    expect(result.need).toEqual({ level: "standard", tools: true, vision: false });
    expect(result.usage.cost).toBe(0.00002);
    expect(result.usage.costSource).toBe("provider");
  });

  it("moves up a level when Jev is unsure", async () => {
    const { impl } = jevFetch(answer("simple", 0.4));
    expect((await classifyWithJev({ provider: OPENROUTER, question: "x", fetchImpl: impl })).need.level).toBe("standard");
  });

  it("routes with Jev and records its cost", async () => {
    const { impl } = jevFetch(answer("complex", 0.95, 0.9));
    const onUsage = vi.fn();
    const route = await routeModel({ providers: [OPENROUTER], auto: auto(), question: "Plan my trip", stream: scriptedStream("").stream, fetchImpl: impl, onUsage });
    expect(route?.classifiedBy).toBe("jev");
    expect(route?.model.id).toBe("openai/gpt-6-luna");
    expect(route?.reason).toContain("Jev 95%");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ cost: 0.00002 }), expect.objectContaining({ modelId: JEV_MODEL }));
  });

  it("falls back to the rules on HTTP errors, bad answers, or without an OpenRouter key", async () => {
    const stream = scriptedStream("").stream;
    for (const fetchImpl of [jevFetch({ error: "x" }, 500).impl, jevFetch({ answers: { level: { choice: "huge" } } }).impl]) {
      const route = await routeModel({ providers: [OPENROUTER], auto: auto(), question: "What is this page?", stream, fetchImpl });
      expect(route?.classifiedBy).toBe("rules");
      expect(route?.model.id).toBe("z-ai/glm-5.3:free");
    }
    const noKey = { ...OPENROUTER, id: "local", preset: "custom" as const, baseUrl: "http://localhost:1234/v1", apiKey: "" };
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const route = await routeModel({ providers: [noKey], auto: auto(), question: "What is this page?", stream, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(route?.classifiedBy).toBe("rules");
  });

  it("times out quickly", async () => {
    const slow = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
    ) as unknown as typeof fetch;
    await expect(classifyWithJev({ provider: OPENROUTER, question: "x", fetchImpl: slow, timeoutMs: 20 })).rejects.toThrow();
  });

  it("uses the tiny model only when the rules are unsure and Jev is off", async () => {
    const { stream, calls } = scriptedStream('{"level":"complex","tools":false,"vision":false}');
    const vague =
      "So I have been thinking about the situation with the landlord and the deposit, and I am not sure whether the clause about repairs in my lease applies here at all";
    const route = await routeModel({ providers: [OPENROUTER], auto: auto({ classifier: "rules" }), question: vague, stream });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model.id).toBe("z-ai/glm-5.3:free");
    expect(route?.classifiedBy).toBe("model");
    expect(route?.model.id).toBe("openai/gpt-6-luna");
  });

  it("returns null when no model is usable", async () => {
    expect(await routeModel({ providers: [NOKEY], auto: auto(), question: "hi", stream: scriptedStream("").stream })).toBeNull();
  });
});
