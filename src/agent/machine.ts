// RunState: the durable loop is state, not an `await` chain. The worker can
// die between any two checkpoints; resume reconstructs from the snapshot.

import type { ChatMessage } from "../providers/wire/chat-completions";
import { READONLY_SYSTEM_PROMPT } from "./prompts";
import type { BudgetState } from "./budget";
import type { RunPhase, RunStatus } from "../storage/runs";

export interface PendingGate {
  toolCallId: string;
  toolName: string;
  argsSummary: string;
  reason: string;
  grantKey: string;
}

export interface RunState {
  runId: string;
  task: string;
  status: RunStatus;
  messages: ChatMessage[];
  budget: BudgetState;
  stepsUsed: number;
  toolCallsUsed: number;
  parseFailures: number;
  providerId: string;
  modelId: string;
  activeTabId?: number;
  /** Origins this run may navigate without a gate (populated by tab registry). */
  grantedOrigins: string[];
  lastPhase: RunPhase;
  cancelRequested: boolean;
  /** Set while blocked on an approval card; persisted so it survives restart. */
  pendingGate: PendingGate | null;
  /** Per-run session-scoped grants. Never persisted across runs. */
  grantedKeys: string[];
}

export function createRunState(
  runId: string,
  task: string,
  providerId: string,
  modelId: string,
  budget: BudgetState,
): RunState {
  return {
    runId,
    task,
    status: "running",
    messages: [{ role: "system", content: READONLY_SYSTEM_PROMPT }],
    budget,
    stepsUsed: 0,
    toolCallsUsed: 0,
    parseFailures: 0,
    providerId,
    modelId,
    lastPhase: "idle",
    cancelRequested: false,
    pendingGate: null,
    grantedKeys: [],
    grantedOrigins: [],
  };
}

/** Appended on resume when the last phase was `executing_tool:*`. */
export function unknownOutcomeNote(): string {
  return "Outcome of the previous action is UNKNOWN; it may or may not have applied. Never assume it succeeded.";
}

export function snapshotFirstNote(): string {
  return "Call browser_snapshot before any further action, verify the page state, then decide.";
}
