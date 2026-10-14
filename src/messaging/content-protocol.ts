// Background <-> content-script messages (ISOLATED world).
// The background owns the generation counter: every request carries the
// tab's current snapshotGen, and the content script answers E_STALE_REF when
// its registered generation does not match.

import type { ExtractKind } from "../dom/extract";
import type { ReadMode } from "../dom/readability";
import type { AttestFacts } from "../dom/attest-facts";

export type ContentRequest =
  | { type: "agent/snapshot"; gen: number; interactiveOnly?: boolean }
  | { type: "agent/readText"; gen: number; ref?: number; mode: ReadMode }
  | { type: "agent/extract"; gen: number; kind: ExtractKind; ref?: number }
  | { type: "agent/getSelection" }
  | { type: "agent/attest"; gen: number; ref?: number };

export type ContentResponse =
  | { ok: true; kind: "snapshot"; text: string; snapshotGen: number; truncated: boolean }
  | { ok: true; kind: "text"; title: string; text: string; truncated: boolean }
  | { ok: true; kind: "extract"; data: unknown }
  | { ok: true; kind: "selection"; text: string }
  | { ok: true; kind: "attest"; facts: AttestFacts }
  | { ok: false; code: "E_STALE_REF" | "E_NOT_FOUND" | "E_UNSUPPORTED" | "E_TAB_GONE" };

export function isContentRequest(raw: unknown): raw is ContentRequest {
  if (typeof raw !== "object" || raw === null) return false;
  const msg = raw as Record<string, unknown>;
  switch (msg["type"]) {
    case "agent/snapshot":
      return typeof msg["gen"] === "number";
    case "agent/readText":
      return (
        typeof msg["gen"] === "number" &&
        (msg["ref"] === undefined || typeof msg["ref"] === "number") &&
        (msg["mode"] === "markdown" || msg["mode"] === "text")
      );
    case "agent/extract":
      return (
        typeof msg["gen"] === "number" &&
        (msg["ref"] === undefined || typeof msg["ref"] === "number") &&
        ["table", "list", "links", "forms", "metadata"].includes(msg["kind"] as string)
      );
    case "agent/getSelection":
      return true;
    case "agent/attest":
      return typeof msg["gen"] === "number" && (msg["ref"] === undefined || typeof msg["ref"] === "number");
    default:
      return false;
  }
}

export function isContentResponse(raw: unknown): raw is ContentResponse {
  if (typeof raw !== "object" || raw === null) return false;
  const msg = raw as Record<string, unknown>;
  if (msg["ok"] === true) {
    return typeof msg["kind"] === "string";
  }
  if (msg["ok"] === false) {
    return (
      msg["code"] === "E_STALE_REF" ||
      msg["code"] === "E_NOT_FOUND" ||
      msg["code"] === "E_UNSUPPORTED" ||
      msg["code"] === "E_TAB_GONE"
    );
  }
  return false;
}
