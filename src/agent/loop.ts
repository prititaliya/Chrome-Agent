// Durable agent loop (read-only class). State, not an `await` chain:
// every tool boundary checkpoints, so a dead worker resumes instead of
// repeating. Both frozen invariants live here:
// - executing_tool:* on resume is NEVER replayed (outcome unknown + snapshot first)
// - partial streamed text is display-only and discarded on mid-turn death.

import type { ChatMessage, ChatStreamEvent } from "../providers/wire/chat-completions";
import { appendMessage, createThread, finalizeThread, getThread } from "../storage/history/store";
import type { MessageRole } from "../storage/history/store";
import type { RunCheckpointStore, RunPhase, RunStatus } from "../storage/runs";
import { checkBudget, recordUsage } from "./budget";
import { clearCheckpoint, savePhase } from "./checkpoint";
import { pruneForContext } from "./compression";
import { summarizeRecap } from "./summarize";
import { classify } from "../security/write-gate";
import type { AttestFacts } from "../dom/attest-facts";
import {
  createRunState,
  snapshotFirstNote,
  unknownOutcomeNote,
  type PendingGate,
  type RunState,
} from "./machine";

export interface PendingToolCall {
  id: string;
  name: string;
  args: unknown;
}

export type LoopEvent =
  | { type: "delta"; runId: string; text: string }
  | { type: "runState"; runId: string; status: string }
  | { type: "toolResult"; runId: string; toolCallId: string; toolName: string; ok: boolean };

export interface LoopDeps {
  chat: (messages: ChatMessage[]) => AsyncGenerator<ChatStreamEvent>;
  execute: (call: PendingToolCall) => Promise<{ ok: boolean; code: string; text: string }>;
  attest: (call: PendingToolCall) => Promise<AttestFacts | undefined>;
  awaitApproval: (runId: string, gate: PendingGate) => Promise<boolean>;
  emit: (event: LoopEvent) => void;
  store: RunCheckpointStore;
  settings: { maxSteps: number; maxToolCalls: number; maxCostUSD: number };
  signal: AbortSignal;
  toolTimeoutMs?: number;
  maxToolCallsPerTurn?: number;
}

async function appendHistory(
  threadId: string,
  role: MessageRole,
  content: string,
  tool?: { toolCallId: string; toolName?: string; outcomeUnknown?: boolean },
): Promise<void> {
  await appendMessage(threadId, { role, content, ...tool });
}

async function finish(state: RunState, deps: LoopDeps, status: RunStatus): Promise<RunStatus> {
  state.status = status;
  const outcome =
    status === "done"
      ? "done"
      : status === "cancelled"
        ? "cancelled"
        : status === "budget_paused"
          ? "budget_paused"
          : "failed";
  await finalizeThread(state.runId, outcome);
  await clearCheckpoint(deps.store, state.runId);
  deps.emit({ type: "runState", runId: state.runId, status });
  return status;
}

/** Assistant tool calls with no matching tool result yet (fresh turns and resumed gates). */
function unansweredCalls(messages: ChatMessage[]): PendingToolCall[] {
  const answered = new Set(messages.filter((m) => m.role === "tool").map((m) => m.toolCallId ?? ""));
  const calls: PendingToolCall[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !m.toolCalls) continue;
    for (const c of m.toolCalls) {
      if (!answered.has(c.id)) calls.push({ id: c.id, name: c.name, args: c.args });
    }
  }
  return calls;
}

function summarizeArgs(args: unknown): string {
  try {
    return JSON.stringify(args).slice(0, 300);
  } catch {
    return "(unserializable args)";
  }
}

async function drive(state: RunState, deps: LoopDeps): Promise<RunStatus> {
  deps.emit({ type: "runState", runId: state.runId, status: "running" });

  for (;;) {
    if (deps.signal.aborted || state.cancelRequested) {
      return finish(state, deps, "cancelled");
    }
    const verdict = checkBudget(state.budget, state.stepsUsed, state.toolCallsUsed);
    if (verdict !== "ok") {
      await appendHistory(
        state.runId,
        "system",
        `Budget limit reached (${verdict}). Send a continue instruction to resume.`,
      );
      return finish(state, deps, "budget_paused");
    }

    // Prefer unanswered calls (fresh turns and worker-restart resumes share
    // this path); only call the model when nothing is pending.
    let calls = unansweredCalls(state.messages);
    if (calls.length === 0) {
      await savePhase(deps.store, state, "calling_model");

      // --- model turn (accumulated in memory only until the turn ends) ---
      let text = "";
      const fresh: PendingToolCall[] = [];
      try {
        for await (const event of deps.chat(state.messages)) {
          if (deps.signal.aborted) break;
          if (event.type === "text") {
            text += event.text;
            deps.emit({ type: "delta", runId: state.runId, text: event.text });
          } else if (event.type === "toolCall") {
            fresh.push({ id: event.id, name: event.name, args: event.args });
          } else if (event.type === "usage") {
            state.budget = recordUsage(state.budget, event.inputTokens, event.outputTokens);
          }
        }
      } catch (error) {
        if (deps.signal.aborted) return finish(state, deps, "cancelled");
        await appendHistory(
          state.runId,
          "system",
          `Model call failed: ${error instanceof Error ? error.message : "unknown"}.`,
        );
        return finish(state, deps, "failed");
      }
      // Killed mid-turn: the partial stream was display-only. Discard it —
      // no assistant message is ever persisted for an unfinished turn.
      if (deps.signal.aborted || state.cancelRequested) {
        return finish(state, deps, "cancelled");
      }

      // --- unparseable tool args become per-call repair observations (max 2
      // repairs), so the failed calls count as answered and the model re-asks.
      const bad = fresh.filter((c) => c.args === null);
      if (bad.length > 0) {
        state.parseFailures += 1;
        state.messages.push({
          role: "assistant",
          content: text,
          toolCalls: fresh.map((c) => ({ id: c.id, name: c.name, args: c.args })),
        });
        await appendHistory(state.runId, "assistant", text === "" ? "(calling tools)" : text);
        for (const call of bad) {
          const note = `tool_parse_error for ${call.name}: unparseable args. Emit one short JSON object per call, no prose.`;
          state.messages.push({ role: "tool", content: note, toolCallId: call.id, name: call.name });
          await appendHistory(state.runId, "tool", note, { toolCallId: call.id, toolName: call.name });
        }
        if (state.parseFailures > 2) {
          return finish(state, deps, "failed");
        }
        continue;
      }

      if (fresh.length === 0) {
        if (text.trim() === "") {
          await appendHistory(state.runId, "system", "Empty model response; failing the run.");
          return finish(state, deps, "failed");
        }
        state.messages.push({ role: "assistant", content: text });
        await appendHistory(state.runId, "assistant", text);
        return finish(state, deps, "done");
      }

      state.messages.push({
        role: "assistant",
        content: text,
        toolCalls: fresh.map((c) => ({ id: c.id, name: c.name, args: c.args })),
      });
      await appendHistory(state.runId, "assistant", text === "" ? "(calling tools)" : text);
      calls = fresh;
    }

    // --- tool turns (gated) ---
    for (const call of calls.slice(0, deps.maxToolCallsPerTurn ?? 5)) {
      let facts: AttestFacts | undefined;
      try {
        facts = await deps.attest(call);
      } catch {
        facts = undefined;
      }
      const gate = classify(
        call.name,
        (call.args ?? {}) as Record<string, unknown>,
        facts,
        state.grantedOrigins,
      );
      if (gate.cls === "irreversible" && !state.grantedKeys.includes(gate.grantKey)) {
        state.pendingGate = {
          toolCallId: call.id,
          toolName: call.name,
          argsSummary: summarizeArgs(call.args),
          reason: gate.reason,
          grantKey: gate.grantKey,
        };
        await savePhase(deps.store, state, "awaiting_gate");
        deps.emit({ type: "runState", runId: state.runId, status: "awaiting_gate" });
        const approved = await deps.awaitApproval(state.runId, state.pendingGate);
        state.pendingGate = null;
        if (!approved) {
          const denied = `user_denied: "${call.name}" was not approved (${gate.reason}). Propose an alternative.`;
          state.messages.push({ role: "tool", content: denied, toolCallId: call.id, name: call.name });
          await appendHistory(state.runId, "tool", denied, { toolCallId: call.id, toolName: call.name });
          deps.emit({
            type: "toolResult",
            runId: state.runId,
            toolCallId: call.id,
            toolName: call.name,
            ok: false,
          });
          continue;
        }
        state.grantedKeys.push(gate.grantKey);
      }

      await savePhase(deps.store, state, `executing_tool:${call.id}`);
      const observation = await deps.execute(call);
      state.messages.push({
        role: "tool",
        content: observation.text,
        toolCallId: call.id,
        name: call.name,
      });
      await appendHistory(state.runId, "tool", observation.text, {
        toolCallId: call.id,
        toolName: call.name,
      });
      deps.emit({
        type: "toolResult",
        runId: state.runId,
        toolCallId: call.id,
        toolName: call.name,
        ok: observation.ok,
      });
      state.toolCallsUsed += 1;
    }

    await savePhase(deps.store, state, "idle");
    state.stepsUsed += 1;
    if (state.stepsUsed % 5 === 0) {
      const pruned = pruneForContext(state.messages);
      state.messages = pruned.messages;
      const recap = pruned.recap ?? summarizeRecap([]);
      if (recap) state.messages.push({ role: "system", content: recap });
    }
  }
}

/** Fresh run: creates state + history thread, then drives. runId === threadId. */
export async function runLoop(
  task: string,
  runId: string,
  deps: LoopDeps,
  provider: { providerId: string; modelId: string; grantedOrigins?: string[] },
): Promise<RunStatus> {
  const state = createRunState(runId, task, provider.providerId, provider.modelId, {
    maxSteps: deps.settings.maxSteps,
    maxToolCalls: deps.settings.maxToolCalls,
    maxCostUSD: deps.settings.maxCostUSD,
    tokensIn: 0,
    tokensOut: 0,
    costUSD: 0,
  });
  state.grantedOrigins = provider.grantedOrigins ?? [];
  await createThread({ id: runId, firstMessage: { role: "user", content: task } });
  return drive(state, deps);
}

/**
 * Worker-restart resume on the SAME run/thread. The `executing_tool:*`
 * branch is the no-double-side-effect invariant: record outcome unknown,
 * force a fresh snapshot, never replay the tool.
 */
export async function resumeLoop(state: RunState, deps: LoopDeps): Promise<RunStatus> {
  if (state.lastPhase.startsWith("executing_tool:")) {
    // No-double-side-effect invariant: the in-flight call is NEVER replayed.
    // Record it as outcome-unknown (answered, so reconciliation skips it),
    // then force a fresh snapshot before the next decision.
    const inFlightId = state.lastPhase.slice("executing_tool:".length);
    const unknown = unknownOutcomeNote();
    state.messages.push({ role: "tool", content: unknown, toolCallId: inFlightId });
    await appendHistory(state.runId, "tool", unknown, { toolCallId: inFlightId, outcomeUnknown: true });
    const snapFirst = snapshotFirstNote();
    state.messages.push({ role: "system", content: snapFirst });
    await appendHistory(state.runId, "system", snapFirst);
    state.lastPhase = "idle";
  }
  // lastPhase === 'calling_model': the partial stream was display-only, so
  // there is nothing to discard from state — the turn is simply re-requested.
  return drive(state, deps);
}

/**
 * User-initiated "resume past run": a NEW runId and NEW thread seeded with
 * the prior transcript as context. Tool results are carried as
 * outcomeUnknown summaries; zero tool calls are replayed — the model must
 * take a fresh browser_snapshot before acting.
 */
export async function resumeThreadAsNewRun(
  oldThreadId: string,
  newRunId: string,
  deps: LoopDeps,
  provider: { providerId: string; modelId: string; grantedOrigins?: string[] },
): Promise<RunStatus> {
  const source = await getThread(oldThreadId);
  if (!source) throw new Error(`Unknown thread "${oldThreadId}"`);

  const seedNote =
    "Resumed from a previous thread. Previous tool calls are NOT replayed; their results below are stale context. Call browser_snapshot before any further action.";
  const seedMessages: ChatMessage[] = [{ role: "system", content: seedNote }];
  const seedEnvelopes: {
    role: MessageRole;
    content: string;
    toolCallId?: string;
    toolName?: string;
    outcomeUnknown?: boolean;
  }[] = [];

  for (const m of source.messages) {
    if (m.role === "user" || m.role === "assistant") {
      seedMessages.push({ role: m.role, content: m.content });
      seedEnvelopes.push({ role: m.role, content: m.content });
    } else if (m.role === "tool") {
      seedMessages.push({
        role: "system",
        content: `[previous ${m.toolName ?? "tool"} result, stale — do not act on it without re-verifying]: ${m.content.slice(0, 500)}`,
      });
      seedEnvelopes.push({
        role: "tool",
        content: m.content,
        toolCallId: m.toolCallId,
        toolName: m.toolName,
        outcomeUnknown: true,
      });
    }
  }

  const state = createRunState(newRunId, `Resume: ${source.title}`, provider.providerId, provider.modelId, {
    maxSteps: deps.settings.maxSteps,
    maxToolCalls: deps.settings.maxToolCalls,
    maxCostUSD: deps.settings.maxCostUSD,
    tokensIn: 0,
    tokensOut: 0,
    costUSD: 0,
  });
  state.grantedOrigins = provider.grantedOrigins ?? [];
  state.messages.push(...seedMessages);

  await createThread({ id: newRunId, firstMessage: { role: "user", content: state.task } });
  await appendMessage(newRunId, { role: "system", content: seedNote });
  for (const envelope of seedEnvelopes) {
    await appendMessage(newRunId, {
      role: envelope.role,
      content: envelope.content,
      toolCallId: envelope.toolCallId,
      toolName: envelope.toolName,
      outcomeUnknown: envelope.outcomeUnknown,
    });
  }
  return drive(state, deps);
}

export type { RunState };
export type { RunPhase };
