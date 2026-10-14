import { describe, expect, it } from "vitest";
import { isBackgroundEvent, isPanelCommand } from "../../src/messaging/protocol";

describe("protocol round-trip", () => {
  it("accepts a constructed ping command", () => {
    expect(isPanelCommand({ v: 1, type: "ping" })).toBe(true);
  });

  it("accepts startRun/stopRun with their required fields", () => {
    expect(isPanelCommand({ v: 1, type: "startRun", task: "summarize this page" })).toBe(true);
    expect(isPanelCommand({ v: 1, type: "stopRun", runId: "r1" })).toBe(true);
  });

  it("accepts constructed background events", () => {
    expect(isBackgroundEvent({ v: 1, type: "pong" })).toBe(true);
    expect(isBackgroundEvent({ v: 1, type: "runState", runId: "r1", status: "running" })).toBe(true);
  });

  it("rejects garbage: null, strings, wrong version, unknown types, missing fields", () => {
    expect(isPanelCommand(null)).toBe(false);
    expect(isPanelCommand("ping")).toBe(false);
    expect(isPanelCommand({ v: 2, type: "ping" })).toBe(false);
    expect(isPanelCommand({ v: 1, type: "launchMissiles" })).toBe(false);
    expect(isPanelCommand({ v: 1, type: "startRun" })).toBe(false);
    expect(isPanelCommand({ v: 1, type: "stopRun", runId: 42 })).toBe(false);
    expect(isBackgroundEvent({ v: 1, type: "pong", extra: "ignored-shape-still-valid" })).toBe(true);
    expect(isBackgroundEvent({ v: 1, type: "delta", runId: "r1" })).toBe(false);
  });
});

describe("model listing messages", () => {
  it("accepts listModels/models/modelsError shapes", () => {
    expect(isPanelCommand({ v: 1, type: "listModels", providerId: "openrouter" })).toBe(true);
    expect(isPanelCommand({ v: 1, type: "listModels", providerId: "openrouter", force: true })).toBe(
      true,
    );
    expect(isPanelCommand({ v: 1, type: "listModels" })).toBe(false);
    expect(isBackgroundEvent({ v: 1, type: "models", providerId: "p", models: [] })).toBe(true);
    expect(isBackgroundEvent({ v: 1, type: "models", providerId: "p" })).toBe(false);
    expect(isBackgroundEvent({ v: 1, type: "modelsError", providerId: "p", reason: "x" })).toBe(true);
  });
});
