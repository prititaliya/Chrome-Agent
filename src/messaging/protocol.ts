// Typed RPC protocol between panel/overlay (commands) and background (events).
// Every inbound message is validated by a guard: ports are an untrusted
// boundary (a compromised panel must not crash the background).
import type { AgentRunEvent } from "./events";
import type { ModelDef } from "../providers/types";
import type { PendingGate } from "../agent/machine";
import type { ThreadIndexEntry, ThreadRecord } from "../storage/history/store";
import type { SearchResult } from "../storage/history/index";

export const PROTOCOL_VERSION = 1 as const;

export type PanelCommand =
  | { v: typeof PROTOCOL_VERSION; type: "ping" }
  | { v: typeof PROTOCOL_VERSION; type: "startRun"; task: string }
  | { v: typeof PROTOCOL_VERSION; type: "stopRun"; runId: string }
  | { v: typeof PROTOCOL_VERSION; type: "resumeThread"; threadId: string }
  | { v: typeof PROTOCOL_VERSION; type: "resolveGate"; runId: string; approved: boolean }
  | { v: typeof PROTOCOL_VERSION; type: "listModels"; providerId: string; force?: boolean }
  | { v: typeof PROTOCOL_VERSION; type: "listThreads" }
  | { v: typeof PROTOCOL_VERSION; type: "openThread"; threadId: string }
  | { v: typeof PROTOCOL_VERSION; type: "renameThread"; threadId: string; title: string }
  | { v: typeof PROTOCOL_VERSION; type: "deleteThread"; threadId: string }
  | { v: typeof PROTOCOL_VERSION; type: "cloneThread"; threadId: string }
  | { v: typeof PROTOCOL_VERSION; type: "pinThread"; threadId: string; pinned: boolean }
  | { v: typeof PROTOCOL_VERSION; type: "importThread"; json: string; onConflict: "skip" | "copy" }
  | { v: typeof PROTOCOL_VERSION; type: "searchThreads"; query: string };

export type BackgroundEvent =
  | { v: typeof PROTOCOL_VERSION; type: "pong" }
  | { v: typeof PROTOCOL_VERSION; type: "protocolError"; reason: string }
  | { v: typeof PROTOCOL_VERSION; type: "models"; providerId: string; models: ModelDef[] }
  | { v: typeof PROTOCOL_VERSION; type: "modelsError"; providerId: string; reason: string }
  | { v: typeof PROTOCOL_VERSION; type: "threads"; threads: ThreadIndexEntry[] }
  | { v: typeof PROTOCOL_VERSION; type: "thread"; thread: ThreadRecord | null }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "importResult";
      action: "imported" | "copied" | "skipped";
      threadId: string;
    }
  | { v: typeof PROTOCOL_VERSION; type: "historyError"; reason: string }
  | { v: typeof PROTOCOL_VERSION; type: "searchResults"; results: SearchResult[] }
  | { v: typeof PROTOCOL_VERSION; type: "gateRequest"; runId: string; gate: PendingGate }
  | AgentRunEvent;

function hasVersion1(raw: Record<string, unknown>): boolean {
  return raw["v"] === PROTOCOL_VERSION && typeof raw["type"] === "string";
}

export function isPanelCommand(raw: unknown): raw is PanelCommand {
  if (typeof raw !== "object" || raw === null) return false;
  const msg = raw as Record<string, unknown>;
  if (!hasVersion1(msg)) return false;
  switch (msg["type"]) {
    case "ping":
      return true;
    case "startRun":
      return typeof msg["task"] === "string";
    case "stopRun":
      return typeof msg["runId"] === "string";
    case "resumeThread":
      return typeof msg["threadId"] === "string";
    case "resolveGate":
      return typeof msg["runId"] === "string" && typeof msg["approved"] === "boolean";
    case "listModels":
      return typeof msg["providerId"] === "string";
    case "listThreads":
      return true;
    case "openThread":
    case "deleteThread":
    case "cloneThread":
      return typeof msg["threadId"] === "string";
    case "renameThread":
      return typeof msg["threadId"] === "string" && typeof msg["title"] === "string";
    case "pinThread":
      return typeof msg["threadId"] === "string" && typeof msg["pinned"] === "boolean";
    case "importThread":
      return (
        typeof msg["json"] === "string" && (msg["onConflict"] === "skip" || msg["onConflict"] === "copy")
      );
    default:
      return false;
  }
}

export function isBackgroundEvent(raw: unknown): raw is BackgroundEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const msg = raw as Record<string, unknown>;
  if (!hasVersion1(msg)) return false;
  switch (msg["type"]) {
    case "pong":
      return true;
    case "protocolError":
      return typeof msg["reason"] === "string";
    case "runState":
      return typeof msg["runId"] === "string" && typeof msg["status"] === "string";
    case "toolResult":
      return (
        typeof msg["runId"] === "string" &&
        typeof msg["toolCallId"] === "string" &&
        typeof msg["toolName"] === "string" &&
        typeof msg["ok"] === "boolean"
      );
    case "models":
      return typeof msg["providerId"] === "string" && Array.isArray(msg["models"]);
    case "modelsError":
      return typeof msg["providerId"] === "string" && typeof msg["reason"] === "string";
    case "threads":
      return Array.isArray(msg["threads"]);
    case "thread":
      return msg["thread"] === null || typeof msg["thread"] === "object";
    case "importResult":
      return (
        typeof msg["threadId"] === "string" &&
        (msg["action"] === "imported" || msg["action"] === "copied" || msg["action"] === "skipped")
      );
    case "searchResults":
      return Array.isArray(msg["results"]);
    case "gateRequest":
      return typeof msg["runId"] === "string" && typeof msg["gate"] === "object" && msg["gate"] !== null;
    case "historyError":
      return typeof msg["reason"] === "string";
    case "delta":
      return typeof msg["runId"] === "string" && typeof msg["text"] === "string";
    default:
      return false;
  }
}
