// Domain run-events streamed background -> UI. Transport guards live in
// protocol.ts; this file owns the event shapes (extended by later tasks).

export type AgentRunEvent =
  | { v: 1; type: "runState"; runId: string; status: string }
  | { v: 1; type: "delta"; runId: string; text: string }
  | { v: 1; type: "toolResult"; runId: string; toolCallId: string; toolName: string; ok: boolean };
