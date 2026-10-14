import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatStreamEvent } from "../../src/providers/wire/chat-completions";
import {
  resumeLoop,
  resumeThreadAsNewRun,
  runLoop,
  type LoopDeps,
  type PendingToolCall,
} from "../../src/agent/loop";
import { createRunState } from "../../src/agent/machine";
import { loadState, savePhase } from "../../src/agent/checkpoint";
import { unknownOutcomeNote } from "../../src/agent/machine";
import { ChatTurnConsumer } from "../../src/providers/wire/chat-completions";
import { PayloadParser } from "../../src/providers/sse";
import { turnToSSE, type MockScript } from "../../src/providers/entries/mock";
import { createMemoryRunStore } from "../../src/storage/runs";
import { createThread, getThread } from "../../src/storage/history/store";

interface ScriptedTurn {
  events: ChatStreamEvent[];
}

function turnEvents(
  text: string,
  calls: { id: string; name: string; args: unknown }[] = [],
): ChatStreamEvent[] {
  const events: ChatStreamEvent[] = [];
  if (text !== "") events.push({ type: "text", text });
  for (const call of calls) events.push({ type: "toolCall", id: call.id, name: call.name, args: call.args });
  events.push({ type: "finished", reason: calls.length > 0 ? "tool_calls" : "stop" });
  return events;
}

/** Scripted chat backend: one entry per model turn. */
function scriptedChat(turns: ScriptedTurn[], log: { turns: number }): LoopDeps["chat"] {
  return async function* () {
    const turn = turns[Math.min(log.turns, turns.length - 1)];
    log.turns += 1;
    if (!turn) return;
    for (const event of turn.events) yield event;
  };
}

function cannedExecute(
  observations: Record<string, string>,
  log: { calls: PendingToolCall[] },
): LoopDeps["execute"] {
  return async (call) => {
    log.calls.push(call);
    return { ok: true, code: "ok", text: observations[call.name] ?? `obs:${call.name}` };
  };
}

function testDeps(
  overrides: Partial<LoopDeps> & { chat: LoopDeps["chat"]; execute: LoopDeps["execute"] },
): LoopDeps {
  return {
    emit: () => {},
    attest: async () => undefined,
    awaitApproval: async () => true,
    store: createMemoryRunStore(),
    settings: { maxSteps: 5, maxToolCalls: 10, maxCostUSD: 1 },
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("agent loop", () => {
  it("runs snapshot then answers, persisting the full transcript", async () => {
    const chatLog = { turns: 0 };
    const execLog: { calls: PendingToolCall[] } = { calls: [] };
    const emitted: string[] = [];
    const deps = testDeps({
      chat: scriptedChat(
        [
          {
            events: turnEvents("Checking the page.", [{ id: "call_1", name: "browser_snapshot", args: {} }]),
          },
          { events: turnEvents("The price is $12.50.") },
        ],
        chatLog,
      ),
      execute: cannedExecute({ browser_snapshot: '[e1] heading "Products"' }, execLog),
      emit: (e) => emitted.push(e.type),
    });
    const status = await runLoop("what does this page cost?", "run-1", deps, {
      providerId: "openrouter",
      modelId: "m",
    });
    expect(status).toBe("done");
    expect(execLog.calls.map((c) => c.id)).toEqual(["call_1"]);
    expect(emitted).toContain("toolResult");
    const thread = await getThread("run-1");
    expect(thread?.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(thread?.outcome).toBe("done");
    // Terminal states clear the checkpoint.
    expect(await deps.store.get("run-1")).toBeUndefined();
  });

  it("drives a mock-provider script through the real SSE path", async () => {
    const raw = await readFile(join(process.cwd(), "fixtures/agent-scripts/read-page.json"), "utf8");
    const script = JSON.parse(raw) as MockScript;
    const turns: ScriptedTurn[] = script.turns.map((turn) => {
      const parser = new PayloadParser("sse");
      const consumer = new ChatTurnConsumer();
      const events: ChatStreamEvent[] = [];
      for (const payload of parser.feed(turnToSSE(turn))) events.push(...consumer.consume(payload));
      for (const payload of parser.flush()) events.push(...consumer.consume(payload));
      return { events };
    });
    const chatLog = { turns: 0 };
    const execLog: { calls: PendingToolCall[] } = { calls: [] };
    const deps = testDeps({
      chat: scriptedChat(turns, chatLog),
      execute: cannedExecute({ browser_snapshot: "snapshot-text" }, execLog),
    });
    const status = await runLoop("summarize this page", "run-mock", deps, {
      providerId: "mock",
      modelId: "mock-agent",
    });
    expect(status).toBe("done");
    expect(execLog.calls.map((c) => c.name)).toEqual(["browser_snapshot"]);
    const thread = await getThread("run-mock");
    expect(thread?.messages.some((m) => m.content.includes("widgets"))).toBe(true);
  });

  it("pauses on budget breach instead of looping", async () => {
    const chatLog = { turns: 0 };
    const deps = testDeps({
      chat: scriptedChat(
        [{ events: turnEvents("", [{ id: "c1", name: "browser_snapshot", args: {} }]) }],
        chatLog,
      ),
      execute: cannedExecute({}, { calls: [] }),
      settings: { maxSteps: 1, maxToolCalls: 10, maxCostUSD: 1 },
    });
    const status = await runLoop("task", "run-budget", deps, { providerId: "openrouter", modelId: "m" });
    expect(status).toBe("budget_paused");
    expect(chatLog.turns).toBe(1);
    expect((await getThread("run-budget"))?.outcome).toBe("budget_paused");
  });

  it("discards partial streamed text on abort (never persisted)", async () => {
    const controller = new AbortController();
    const chat: LoopDeps["chat"] = async function* () {
      yield { type: "text", text: "partial answer " };
      await new Promise<void>((resolve) => {
        if (controller.signal.aborted) resolve();
        else controller.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    };
    const deps = testDeps({ chat, execute: cannedExecute({}, { calls: [] }), signal: controller.signal });
    const pending = runLoop("task", "run-abort", deps, { providerId: "openrouter", modelId: "m" });
    controller.abort();
    expect(await pending).toBe("cancelled");
    const thread = await getThread("run-abort");
    expect(thread?.messages.map((m) => m.role)).toEqual(["user"]);
    expect(thread?.outcome).toBe("cancelled");
  });

  it("resume after executing_tool never replays the tool", async () => {
    const store = createMemoryRunStore();
    await createThread({ id: "run-resume", firstMessage: { role: "user", content: "task" } });
    const state = createRunState("run-resume", "task", "openrouter", "m", {
      maxSteps: 5,
      maxToolCalls: 10,
      maxCostUSD: 1,
      tokensIn: 0,
      tokensOut: 0,
      costUSD: 0,
    });
    const assistant: ChatMessage = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "browser_snapshot", args: {} }],
    };
    state.messages.push({ role: "user", content: "task" }, assistant);
    await savePhase(store, state, "executing_tool:call_1");
    const loaded = await loadState(store, "run-resume");
    expect(loaded).not.toBeNull();
    if (!loaded) return;

    const execLog: { calls: PendingToolCall[] } = { calls: [] };
    const chatLog = { turns: 0 };
    const deps = testDeps({
      store,
      chat: scriptedChat([{ events: turnEvents("Verified: the price is $9.99.") }], chatLog),
      execute: cannedExecute({}, execLog),
    });
    expect(await resumeLoop(loaded, deps)).toBe("done");
    expect(execLog.calls).toEqual([]);
    const thread = await getThread("run-resume");
    const contents = (thread?.messages ?? []).map((m) => m.content).join("\n");
    expect(contents).toContain(unknownOutcomeNote());
    expect(contents).toContain("browser_snapshot");
  });

  it("resume after calling_model re-requests with no duplicate message", async () => {
    const store = createMemoryRunStore();
    await createThread({ id: "run-restream", firstMessage: { role: "user", content: "task" } });
    const state = createRunState("run-restream", "task", "openrouter", "m", {
      maxSteps: 5,
      maxToolCalls: 10,
      maxCostUSD: 1,
      tokensIn: 0,
      tokensOut: 0,
      costUSD: 0,
    });
    state.messages.push({ role: "user", content: "task" });
    await savePhase(store, state, "calling_model");
    const loaded = await loadState(store, "run-restream");
    if (!loaded) return;
    const chatLog = { turns: 0 };
    const deps = testDeps({
      store,
      chat: scriptedChat([{ events: turnEvents("fresh answer") }], chatLog),
      execute: cannedExecute({}, { calls: [] }),
    });
    expect(await resumeLoop(loaded, deps)).toBe("done");
    expect(chatLog.turns).toBe(1);
    const thread = await getThread("run-restream");
    expect(thread?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("resume past run", () => {
  it("seeds a new run without replaying old tools; first fresh call is a snapshot", async () => {
    const store = createMemoryRunStore();
    await createThread({ id: "old-thread", firstMessage: { role: "user", content: "old task" } });
    const { appendMessage } = await import("../../src/storage/history/store");
    await appendMessage("old-thread", { role: "assistant", content: "" });
    await appendMessage("old-thread", {
      role: "tool",
      content: "old-obs",
      toolCallId: "old-call-1",
      toolName: "browser_extract",
    });

    const execLog: { calls: PendingToolCall[] } = { calls: [] };
    const chatLog = { turns: 0 };
    const deps = testDeps({
      store,
      chat: scriptedChat(
        [
          {
            events: turnEvents("Fresh snapshot first.", [
              { id: "new-call-1", name: "browser_snapshot", args: {} },
            ]),
          },
          { events: turnEvents("Done after verifying.") },
        ],
        chatLog,
      ),
      execute: cannedExecute({ browser_snapshot: "fresh snapshot" }, execLog),
    });
    const status = await resumeThreadAsNewRun("old-thread", "new-run", deps, {
      providerId: "openrouter",
      modelId: "m",
    });
    expect(status).toBe("done");
    // Zero replay: no old call id was ever executed; the first fresh call
    // is the mandatory snapshot.
    expect(execLog.calls.map((c) => c.id)).toEqual(["new-call-1"]);
    const thread = await getThread("new-run");
    const toolRows = (thread?.messages ?? []).filter((m) => m.role === "tool");
    expect(toolRows.length).toBeGreaterThan(0);
    // Seeded stale rows carry the marker; fresh executions do not.
    expect(toolRows.find((m) => m.content === "old-obs")?.outcomeUnknown).toBe(true);
    expect(toolRows.find((m) => m.toolCallId === "new-call-1")?.outcomeUnknown).not.toBe(true);
    expect(thread?.messages.some((m) => m.content.includes("NOT replayed"))).toBe(true);
  });
});

describe("write-gate in the loop", () => {
  const destructiveAttest = async () => ({
    target: {
      role: "button",
      name: "Delete account",
      tag: "button",
      inForm: false,
      isSubmitControl: false,
      isFileInput: false,
    },
    focus: { tag: "body", inForm: false },
    url: "https://example.com/page",
  });

  function clickTurn(): ScriptedTurn {
    return {
      events: turnEvents("", [{ id: "call-del", name: "browser_click", args: { ref: 7 } }]),
    };
  }

  it("denial blocks dispatch and records user_denied", async () => {
    const execLog: { calls: PendingToolCall[] } = { calls: [] };
    let approvals = 0;
    const gates: { toolName: string; reason: string }[] = [];
    const deps = testDeps({
      chat: scriptedChat([clickTurn(), { events: turnEvents("Understood, stopping.") }], { turns: 0 }),
      execute: cannedExecute({}, execLog),
      attest: destructiveAttest,
      awaitApproval: async (_runId, gate) => {
        approvals += 1;
        gates.push({ toolName: gate.toolName, reason: gate.reason });
        return false;
      },
    });
    const status = await runLoop("delete my account", "run-gate-deny", deps, {
      providerId: "openrouter",
      modelId: "m",
    });
    expect(status).toBe("done");
    expect(approvals).toBe(1);
    expect(gates[0]?.toolName).toBe("browser_click");
    // The Delete control was provably never dispatched.
    expect(execLog.calls).toEqual([]);
    const thread = await getThread("run-gate-deny");
    expect(thread?.messages.some((m) => m.content.includes("user_denied"))).toBe(true);
  });

  it("approval dispatches once and reuses the per-run grant", async () => {
    const execLog: { calls: PendingToolCall[] } = { calls: [] };
    let approvals = 0;
    const chatLog = { turns: 0 };
    const deps = testDeps({
      chat: scriptedChat(
        [clickTurn(), clickTurn(), { events: turnEvents("Clicked twice.") }],
        chatLog,
      ),
      execute: cannedExecute({}, execLog),
      attest: destructiveAttest,
      awaitApproval: async () => {
        approvals += 1;
        return true;
      },
    });
    const status = await runLoop("task", "run-gate-approve", deps, {
      providerId: "openrouter",
      modelId: "m",
    });
    expect(status).toBe("done");
    expect(approvals).toBe(1);
    expect(execLog.calls.map((c) => c.id)).toEqual(["call-del", "call-del"]);
  });
});
