// Live run checkpoints. This module is browser-agnostic: it talks to a
// `StorageAreaLike`, so unit tests inject memory and the background injects
// `browser.storage.session`. (The Firefox `storage.local` mirror lands with
// the durable-resume work; see plan Task 29.)

export type RunStatus =
  "running" | "awaiting_model" | "awaiting_gate" | "budget_paused" | "done" | "failed" | "cancelled";

export type RunPhase = "calling_model" | "awaiting_gate" | "idle" | `executing_tool:${string}`;

export interface RunCheckpoint {
  runId: string;
  threadId: string;
  task: string;
  status: RunStatus;
  lastPhase: RunPhase;
  updatedAt: number;
  /** Full resumable loop state (agent checkpoint task). Absent for legacy rows. */
  snapshot?: RunSnapshotData;
}

export interface RunSnapshotData {
  messages: {
    role: string;
    content: string;
    toolCallId?: string;
    name?: string;
    toolCalls?: { id: string; name: string; args: unknown }[];
  }[];
  budget: {
    maxSteps: number;
    maxToolCalls: number;
    maxCostUSD: number;
    tokensIn: number;
    tokensOut: number;
    costUSD: number;
  };
  stepsUsed: number;
  toolCallsUsed: number;
  parseFailures: number;
  providerId: string;
  modelId: string;
  activeTabId?: number;
  grantedOrigins?: string[];
  pendingGate?: {
    toolCallId: string;
    toolName: string;
    argsSummary: string;
    reason: string;
    grantKey: string;
  } | null;
  grantedKeys?: string[];
}

export function isTerminal(status: RunStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

export const RUN_KEY_PREFIX = "run:v1:";

export function runStorageKey(runId: string): string {
  return `${RUN_KEY_PREFIX}${runId}`;
}

export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface RunCheckpointStore {
  get(runId: string): Promise<RunCheckpoint | undefined>;
  save(checkpoint: RunCheckpoint): Promise<void>;
  delete(runId: string): Promise<void>;
  listNonTerminal(): Promise<RunCheckpoint[]>;
}

function isCheckpoint(raw: unknown): raw is RunCheckpoint {
  if (typeof raw !== "object" || raw === null) return false;
  const cp = raw as Record<string, unknown>;
  return (
    typeof cp["runId"] === "string" &&
    typeof cp["threadId"] === "string" &&
    typeof cp["task"] === "string" &&
    typeof cp["status"] === "string" &&
    typeof cp["lastPhase"] === "string" &&
    typeof cp["updatedAt"] === "number"
  );
}

/** Area-backed store (background passes `browser.storage.session`). */
export function createAreaRunStore(area: StorageAreaLike): RunCheckpointStore {
  return {
    async get(runId) {
      const record = await area.get(runStorageKey(runId));
      const raw: unknown = record[runStorageKey(runId)];
      return isCheckpoint(raw) ? raw : undefined;
    },
    async save(checkpoint) {
      await area.set({ [runStorageKey(checkpoint.runId)]: checkpoint });
    },
    async delete(runId) {
      await area.remove(runStorageKey(runId));
    },
    async listNonTerminal() {
      const record = await area.get(null);
      const out: RunCheckpoint[] = [];
      for (const [key, raw] of Object.entries(record)) {
        if (!key.startsWith(RUN_KEY_PREFIX)) continue;
        if (isCheckpoint(raw) && !isTerminal(raw.status)) out.push(raw);
      }
      return out;
    },
  };
}

/** In-memory store for unit tests and offline dev. */
export function createMemoryRunStore(seed: RunCheckpoint[] = []): RunCheckpointStore {
  const table = new Map<string, RunCheckpoint>();
  for (const cp of seed) table.set(cp.runId, cp);
  return {
    async get(runId) {
      return table.get(runId);
    },
    async save(checkpoint) {
      table.set(checkpoint.runId, checkpoint);
    },
    async delete(runId) {
      table.delete(runId);
    },
    async listNonTerminal() {
      return [...table.values()].filter((cp) => !isTerminal(cp.status));
    },
  };
}

/**
 * Boot hook: re-enter every non-terminal run. The caller supplies `resume`
 * (the durable loop in a later task); this function owns discovery only.
 * Returns the resumed run ids.
 */
export async function resumeRuns(
  store: RunCheckpointStore,
  resume: (checkpoint: RunCheckpoint) => Promise<void>,
): Promise<string[]> {
  const pending = await store.listNonTerminal();
  const resumed: string[] = [];
  for (const cp of pending) {
    await resume(cp);
    resumed.push(cp.runId);
  }
  return resumed;
}
