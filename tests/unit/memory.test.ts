import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/prompt";
import { summarizeConversation, summaryCut, transcript } from "../../src/agent/summary";
import type { ApiMessage, StreamEvent } from "../../src/providers/types";
import {
  deleteMemory,
  findDuplicate,
  listMemories,
  rejectReason,
  saveMemory,
  searchMemories,
  selectMemories,
  updateMemoryText,
  type Memory,
} from "../../src/storage/memory";
import { ToolExecutor, type ExecutorDeps } from "../../src/tools/executor";
import { toolsFor } from "../../src/tools/definitions";

const mem = (id: string, text: string, updatedAt = 1): Memory => ({ id, text, createdAt: 1, updatedAt, source: "assistant" });

describe("long-term memory store", () => {
  it("adds, dedupes, replaces and deletes", async () => {
    const a = await saveMemory({ text: "User prefers answers in bullet points.", source: "assistant" });
    expect(a.action).toBe("added");
    expect((await saveMemory({ text: "User prefers answers in bullet points.", source: "assistant" })).action).toBe("duplicate");
    expect((await saveMemory({ text: "user prefers answers in bullet points", source: "user" })).action).toBe("updated");

    const city = await saveMemory({ text: "User lives in Ahmedabad.", source: "assistant" });
    const moved = await saveMemory({ text: "User lives in Mumbai.", source: "assistant", replacesId: city.memory.id });
    expect(moved).toMatchObject({ action: "updated", memory: { id: city.memory.id, text: "User lives in Mumbai." } });
    expect(await listMemories()).toHaveLength(2);

    await updateMemoryText(a.memory.id, "User prefers short answers.");
    expect((await listMemories()).find((m) => m.id === a.memory.id)?.source).toBe("user");
    expect((await deleteMemory(city.memory.id))?.text).toBe("User lives in Mumbai.");
    expect(await deleteMemory("nope")).toBeNull();
    expect(await listMemories()).toHaveLength(1);
  });

  it("refuses secrets and oversized entries", async () => {
    expect(rejectReason("My password is hunter2")).toMatch(/password/);
    expect(rejectReason("Card 4111 1111 1111 1111")).not.toBeNull();
    expect(rejectReason("Key sk-abcdefghijklmnop1234")).not.toBeNull();
    expect(rejectReason("x".repeat(400))).toMatch(/under/);
    expect(rejectReason("User's pin code area is 380001 (Ahmedabad).")).toBeNull();
    await expect(saveMemory({ text: "my password is hunter2", source: "assistant" })).rejects.toThrow(/never stored/);
  });

  it("finds near-duplicates and ranks search by relevance", () => {
    const list = [mem("m1", "User is vegetarian and avoids eggs."), mem("m2", "User works as a frontend developer in React."), mem("m3", "User's favorite color is teal.")];
    expect(findDuplicate(list, "User is vegetarian and avoids eggs")?.id).toBe("m1");
    expect(findDuplicate(list, "User likes cricket.")).toBeUndefined();
    expect(searchMemories(list, "recommend a vegetarian restaurant")[0]?.id).toBe("m1");
    expect(searchMemories(list, "react hooks question")[0]?.id).toBe("m2");
  });

  it("injects everything when small, otherwise the most relevant within budget", () => {
    const small = [mem("m1", "A fact about tea."), mem("m2", "A fact about trains.")];
    expect(selectMemories(small, "anything").selected).toHaveLength(2);
    const many = Array.from({ length: 60 }, (_, i) => mem(`m${i}`, `Filler memory number ${i} about gardening and weather patterns.`, i));
    many.push(mem("mx", "User is allergic to peanuts.", 0));
    const { selected, total } = selectMemories(many, "is this snack safe with peanuts?", 600);
    expect(total).toBe(61);
    expect(selected[0]?.id).toBe("mx");
    expect(selected.reduce((n, m) => n + m.text.length + 12, 0)).toBeLessThanOrEqual(600);
  });
});

describe("short-term memory (rolling summary)", () => {
  const turn = (q: string, a: string): ApiMessage[] => [
    { role: "user", content: q },
    { role: "assistant", content: a },
  ];

  it("cuts at a turn boundary only when history is long, keeping recent turns verbatim", () => {
    const short = [...turn("hi", "hello")];
    expect(summaryCut(short)).toBe(0);
    const long = Array.from({ length: 10 }, (_, i) => turn(`question ${i}`, "x".repeat(5_000))).flat();
    const cut = summaryCut(long, 30_000, 12_000);
    expect(cut).toBeGreaterThan(0);
    expect(long[cut]?.role).toBe("user");
    expect(long.slice(cut).reduce((n, m) => n + String(m.content).length, 0)).toBeLessThanOrEqual(12_000);
  });

  it("never splits a tool call from its result", () => {
    const api: ApiMessage[] = [];
    for (let i = 0; i < 8; i++) {
      api.push({ role: "user", content: `task ${i}` });
      api.push({ role: "assistant", content: "", toolCalls: [{ id: `c${i}`, name: "read_url", args: "{}" }] });
      api.push({ role: "tool", toolCallId: `c${i}`, content: "y".repeat(1_400) });
      api.push({ role: "user", content: [{ type: "image", dataUrl: "data:," }] });
      api.push({ role: "assistant", content: "z".repeat(6_000) });
    }
    const cut = summaryCut(api, 20_000, 10_000);
    expect(api[cut]).toMatchObject({ role: "user" });
    expect(typeof api[cut]!.content).toBe("string");
  });

  it("summarizes with the previous summary and reports usage", async () => {
    const seen: ApiMessage[][] = [];
    const stream = async function* (req: { messages: ApiMessage[] }): AsyncGenerator<StreamEvent> {
      seen.push(req.messages);
      yield { type: "text", text: "- User is planning a Goa trip." };
      yield { type: "usage", inputTokens: 500, outputTokens: 20 };
    };
    const result = await summarizeConversation({
      provider: { id: "p", name: "P", baseUrl: "https://x", apiKey: "k", wire: "chat", models: [] },
      model: { id: "m", vision: false, tools: true, pricing: { input: 1, output: 1 } },
      previous: "- Earlier: user asked about flights.",
      messages: turn("<page_context title=\"Hotels\">long page</page_context>\n\nFind hotels in Goa", "Here are three."),
      stream,
    });
    expect(result.text).toBe("- User is planning a Goa trip.");
    expect(result.usage).toMatchObject({ input: 500, output: 20, costSource: "estimate" });
    const prompt = String(seen[0]![1]!.content);
    expect(prompt).toContain("Earlier: user asked about flights.");
    expect(prompt).toContain("Find hotels in Goa");
    expect(prompt).not.toContain("long page");
  });

  it("renders tool calls compactly in the transcript", () => {
    const text = transcript([
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "web_search", args: '{"query":"goa"}' }] },
      { role: "tool", toolCallId: "c1", content: "results" },
    ]);
    expect(text).toContain('ASSISTANT used web_search({"query":"goa"})');
    expect(text).toContain("TOOL RESULT: results");
  });
});

describe("prompt and tools", () => {
  it("includes memories, memory rules and the conversation summary", () => {
    const prompt = buildSystemPrompt({
      now: new Date(2026, 9, 14),
      canAct: true,
      vision: false,
      memories: [mem("m1", "User prefers metric units.")],
      memoryTotal: 5,
      canRemember: true,
      summary: "- Comparing two laptops.",
    });
    expect(prompt).toContain("<memory>\n- [m1] User prefers metric units.\n</memory>");
    expect(prompt).toContain("4 more memories are stored; call recall");
    expect(prompt).toContain("call remember");
    expect(prompt).toContain("<conversation_summary>\n- Comparing two laptops.\n</conversation_summary>");
    const plain = buildSystemPrompt({ now: new Date(), canAct: true, vision: false });
    expect(plain).not.toContain("<memory>");
    expect(plain).not.toContain("remember");
  });

  it("tells the model to act in the working tab before searching the web", () => {
    const prompt = buildSystemPrompt({ now: new Date(), canAct: true, vision: false });
    const working = prompt.indexOf("is your working tab");
    expect(working).toBeGreaterThan(-1);
    expect(working).toBeLessThan(prompt.indexOf("Use web_search"));
    expect(prompt).toContain("Use open_tab only when");
    expect(prompt).toContain("call use_saved_password");
    expect(prompt).toContain("call get_email_code");
    expect(buildSystemPrompt({ now: new Date(), canAct: false, vision: false })).not.toContain("working tab");
  });

  it("offers memory tools only when enabled and routes them to the memory deps", async () => {
    expect(toolsFor({ vision: false, screenshots: false }).some((t) => t.name === "remember")).toBe(false);
    expect(toolsFor({ vision: false, screenshots: false, memory: true }).map((t) => t.name)).toEqual(expect.arrayContaining(["remember", "forget", "recall"]));

    const calls: string[] = [];
    const deps = {
      memory: {
        remember: async (text: string, replaces?: string) => (calls.push(`remember:${text}:${replaces ?? ""}`), "Saved"),
        forget: async (id: string) => (calls.push(`forget:${id}`), "Deleted"),
        recall: async (q: string) => (calls.push(`recall:${q}`), "- [m1] fact"),
      },
    } as unknown as ExecutorDeps;
    const executor = new ToolExecutor(deps, null);
    const noop = () => {};
    expect(await executor.execute({ id: "1", name: "remember", args: '{"text":"User likes tea.","replaces_id":"m9"}' }, noop)).toEqual({ ok: true, text: "Saved" });
    await executor.execute({ id: "2", name: "forget", args: '{"id":"m1"}' }, noop);
    await executor.execute({ id: "3", name: "recall", args: '{"query":"drinks"}' }, noop);
    expect(calls).toEqual(["remember:User likes tea.:m9", "forget:m1", "recall:drinks"]);

    const off = new ToolExecutor({} as ExecutorDeps, null);
    expect((await off.execute({ id: "4", name: "remember", args: '{"text":"x"}' }, noop)).ok).toBe(false);
  });
});
