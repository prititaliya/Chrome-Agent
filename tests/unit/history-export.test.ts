import { describe, expect, it } from "vitest";
import {
  parseImportedThread,
  resolveImport,
  toJSONThread,
  toMarkdownThread,
} from "../../src/storage/history/export";
import type { ThreadRecord } from "../../src/storage/history/store";

function fixture(withSecret = false): ThreadRecord {
  const now = Date.now();
  return {
    id: "thread-1",
    title: "price check",
    titleSource: "derived",
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: "m1", threadId: "thread-1", role: "user", ts: now, content: "what does it cost?" },
      {
        id: "m2",
        threadId: "thread-1",
        role: "assistant",
        ts: now,
        content: withSecret ? "$12.50, and my key is sk-live-abcdef1234567890" : "$12.50",
        toolCallId: "call_1",
        toolName: "browser_extract",
      },
      {
        id: "m3",
        threadId: "thread-1",
        role: "tool",
        ts: now,
        content: '{"price":"$12.50"}',
        toolCallId: "call_1",
        toolName: "browser_extract",
      },
    ],
    schemaVersion: 1,
  };
}

describe("history export/import", () => {
  it("redacts key material in both JSON and Markdown exports", () => {
    const json = toJSONThread(fixture(true));
    expect(json).not.toContain("sk-live-");
    expect(json).toContain("[redacted]");
    const md = toMarkdownThread(fixture(true));
    expect(md).not.toContain("sk-live-");
    expect(md).toContain("[redacted]");
    expect(md).toContain("## assistant · tool:browser_extract");
  });

  it("round-trips JSON to a byte-equal thread body (modulo exportedAt)", () => {
    const original = fixture();
    expect(parseImportedThread(toJSONThread(original))).toEqual(original);
  });

  it("rejects unknown schemaVersion and non-JSON", () => {
    expect(() => parseImportedThread(JSON.stringify({ ...fixture(), schemaVersion: 99 }))).toThrowError();
    expect(() => parseImportedThread("not json")).toThrowError();
  });

  it("dedups by threadId: newer wins, older skips or copies", () => {
    const existing = fixture();
    const newer = { ...fixture(), updatedAt: existing.updatedAt + 1 };
    const older = { ...fixture(), updatedAt: existing.updatedAt - 1 };
    expect(resolveImport(null, incoming(existing), "skip").action).toBe("imported");
    expect(resolveImport(existing, newer, "skip").action).toBe("imported");
    const skipped = resolveImport(existing, older, "skip");
    expect(skipped.action).toBe("skipped");
    expect(skipped.thread.id).toBe(existing.id);
    const copied = resolveImport(existing, older, "copy", () => "new-id");
    expect(copied.action).toBe("copied");
    expect(copied.thread.id).toBe("new-id");
    expect(copied.thread.title).toBe("price check (imported)");
    expect(copied.thread.messages.every((m) => m.threadId === "new-id")).toBe(true);
  });
});

function incoming(t: ThreadRecord): ThreadRecord {
  return t;
}
