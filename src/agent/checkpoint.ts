// Atomic checkpointing: every tool boundary persists the full resumable
// state (messages, budget, counters) into the runs store. Terminal states
// delete the checkpoint after the history thread is finalized (see loop).

import type { RunPhase } from "../storage/runs";
import type { RunCheckpointStore } from "../storage/runs";
import type { ChatMessage } from "../providers/wire/chat-completions";
import type { RunState } from "./machine";

export async function savePhase(store: RunCheckpointStore, state: RunState, phase: RunPhase): Promise<void> {
  state.lastPhase = phase;
  await store.save({
    runId: state.runId,
    threadId: state.runId,
    task: state.task,
    status: state.status,
    lastPhase: phase,
    updatedAt: Date.now(),
    snapshot: {
      messages: state.messages,
      budget: state.budget,
      stepsUsed: state.stepsUsed,
      toolCallsUsed: state.toolCallsUsed,
      parseFailures: state.parseFailures,
      providerId: state.providerId,
      modelId: state.modelId,
      activeTabId: state.activeTabId,
      grantedOrigins: state.grantedOrigins,
      pendingGate: state.pendingGate,
      grantedKeys: state.grantedKeys,
    },
  });
}

export async function loadState(store: RunCheckpointStore, runId: string): Promise<RunState | null> {
  const checkpoint = await store.get(runId);
  if (!checkpoint?.snapshot) return null;
  const snap = checkpoint.snapshot;
  return {
    runId: checkpoint.runId,
    task: checkpoint.task,
    status: checkpoint.status,
    messages: snap.messages as unknown as ChatMessage[],
    budget: snap.budget,
    stepsUsed: snap.stepsUsed,
    toolCallsUsed: snap.toolCallsUsed,
    parseFailures: snap.parseFailures,
    providerId: snap.providerId,
    modelId: snap.modelId,
    activeTabId: snap.activeTabId,
    lastPhase: checkpoint.lastPhase,
    cancelRequested: false,
    pendingGate: snap.pendingGate ?? null,
    grantedKeys: snap.grantedKeys ?? [],
    grantedOrigins: snap.grantedOrigins ?? [],
  };
}

export async function clearCheckpoint(store: RunCheckpointStore, runId: string): Promise<void> {
  await store.delete(runId);
}
