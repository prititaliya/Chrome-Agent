// Background-side tool dispatch (read-only class). Browser-free: the caller
// injects the content sender, so unit tests use a fake tab. Generation
// tracking lives in TabGenerations (one instance per background).

import { capObservation } from "../agent/compression";
import { checkOriginPermission, originOfUrl } from "../security/origins";
import { isContentResponse, type ContentRequest, type ContentResponse } from "../messaging/content-protocol";
import { getTool, parseToolArgs } from "./registry";

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export type ObservationCode =
  "ok" | "parse_error" | "invalid_args" | "unknown_tool" | "tool_error" | "timeout";

export interface ToolObservation {
  ok: boolean;
  code: ObservationCode;
  text: string;
}

export type ContentSender = (tabId: number, request: ContentRequest) => Promise<ContentResponse>;

export interface ExecutorDeps {
  sender: ContentSender;
  activeTab: () => Promise<number>;
  getTabUrl: (tabId: number) => Promise<string | undefined>;
  generations: TabGenerations;
  timeoutMs?: number;
}

/** Per-tab snapshot generations. Snapshot bumps; navigation bumps (later task). */
export class TabGenerations {
  private readonly gens = new Map<number, number>();

  current(tabId: number): number {
    return this.gens.get(tabId) ?? 0;
  }

  next(tabId: number): number {
    const gen = this.current(tabId) + 1;
    this.gens.set(tabId, gen);
    return gen;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      promise.then((value) => {
        if (timer !== undefined) clearTimeout(timer);
        return value;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
    return { timedOut: false, value };
  } catch {
    promise.catch(() => {});
    return { timedOut: true };
  }
}

async function send(deps: ExecutorDeps, tabId: number, request: ContentRequest): Promise<ContentResponse> {
  const timeoutMs = deps.timeoutMs ?? 25_000;
  const result = await withTimeout(
    deps.sender(tabId, request).then((response) => {
      if (!isContentResponse(response)) throw new Error("bad-bridge-response");
      return response;
    }),
    timeoutMs,
  );
  if (result.timedOut) throw new Error("timeout");
  return result.value;
}

function err(code: ObservationCode, text: string): ToolObservation {
  return { ok: false, code, text };
}

export async function executeToolCall(call: ToolCall, deps: ExecutorDeps): Promise<ToolObservation> {
  const tool = getTool(call.name);
  if (!tool) {
    return err(
      "unknown_tool",
      `unknown tool "${call.name}". Use browser_snapshot first to see what is available.`,
    );
  }
  if (call.args === null || call.args === undefined) {
    return err(
      "parse_error",
      `tool_parse_error: unparseable args for ${call.name}. Emit one short JSON object per call, no prose.`,
    );
  }
  const parsed = parseToolArgs(call.name, call.args);
  if (!parsed.ok) {
    return err("invalid_args", `invalid args for ${call.name}: ${parsed.error}`);
  }
  const args = parsed.args;
  const tabId = typeof args["tab"] === "number" ? args["tab"] : await deps.activeTab();

  // Per-dispatch origin check (no prompts here — prompting happens at run
  // start). Revoking an origin mid-run blocks the next action with a reason.
  const tabUrl = await deps.getTabUrl(tabId).catch(() => undefined);
  const origin = tabUrl ? originOfUrl(tabUrl) : null;
  if (origin && (await checkOriginPermission(origin)) !== "granted") {
    return err(
      "tool_error",
      `E_NO_ORIGIN_PERMISSION: ${origin} is not granted for agent use. Grant it in Settings or start the run on that page.`,
    );
  }

  try {
    switch (call.name) {
      case "browser_snapshot": {
        const gen = deps.generations.next(tabId);
        const response = await send(deps, tabId, {
          type: "agent/snapshot",
          gen,
          interactiveOnly: args["interactiveOnly"] as boolean | undefined,
        });
        if (!response.ok) return err("tool_error", response.code);
        if (response.kind !== "snapshot") return err("tool_error", "unexpected bridge response");
        const note = response.truncated ? "\n(snapshot truncated; use browser_read_text for the rest)" : "";
        return { ok: true, code: "ok", text: capObservation(`${response.text}${note}`) };
      }
      case "browser_read_text": {
        const response = await send(deps, tabId, {
          type: "agent/readText",
          gen: deps.generations.current(tabId),
          ref: args["ref"] as number | undefined,
          mode: args["mode"] as "markdown" | "text",
        });
        if (!response.ok) {
          return response.code === "E_STALE_REF"
            ? err("tool_error", "stale refs: call browser_snapshot first")
            : err("tool_error", response.code);
        }
        if (response.kind !== "text") return err("tool_error", "unexpected bridge response");
        const note = response.truncated ? "\n(text truncated)" : "";
        return { ok: true, code: "ok", text: capObservation(`${response.title}\n\n${response.text}${note}`) };
      }
      case "read_selection": {
        const response = await send(deps, tabId, { type: "agent/getSelection" });
        if (!response.ok) return err("tool_error", response.code);
        if (response.kind !== "selection") return err("tool_error", "unexpected bridge response");
        return {
          ok: true,
          code: "ok",
          text: response.text === "" ? "(nothing selected)" : response.text.slice(0, 2000),
        };
      }
      case "browser_extract": {
        const response = await send(deps, tabId, {
          type: "agent/extract",
          gen: deps.generations.current(tabId),
          kind: args["kind"] as "table" | "list" | "links" | "forms" | "metadata",
          ref: args["ref"] as number | undefined,
        });
        if (!response.ok) {
          return response.code === "E_STALE_REF"
            ? err("tool_error", "stale refs: call browser_snapshot first")
            : err("tool_error", `nothing found (${response.code})`);
        }
        if (response.kind !== "extract") return err("tool_error", "unexpected bridge response");
        return { ok: true, code: "ok", text: capObservation(JSON.stringify(response.data, null, 2)) };
      }
      default:
        return err("unknown_tool", `tool "${call.name}" is not wired in this build`);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "timeout") {
      return err("timeout", `tool ${call.name} timed out; the page may be busy. Snapshot again and retry.`);
    }
    return err("tool_error", `tab unreachable (closed or no content bridge). Snapshot again on a live tab.`);
  }
}
