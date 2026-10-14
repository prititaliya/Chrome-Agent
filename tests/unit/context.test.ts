import { describe, expect, it } from "vitest";
import { buildUserContent, compactHistory, dropOldestTurns, sealToolCalls } from "../../src/agent/context";
import type { ApiMessage } from "../../src/providers/types";

describe("page context", () => {
  it("puts the page block before the question", () => {
    const content = buildUserContent("What is this?", [
      { source: "current tab", tabId: 3, title: 'A "quoted" <title>', url: "https://a.test/", text: "Body text", selection: "picked" },
    ]);
    expect(content).toMatch(/^<page_context source="current tab" tab_id="3" title="A 'quoted' title" url="https:\/\/a.test\/">/);
    expect(content).toContain("picked");
    expect(content).toContain("Body text");
    expect(content.endsWith("What is this?")).toBe(true);
  });

  it("returns the bare question without pages", () => {
    expect(buildUserContent("hi", [])).toBe("hi");
  });
});

describe("history compaction", () => {
  it("drops old page dumps, truncates long tool output, and flattens images", () => {
    const api: ApiMessage[] = [
      { role: "user", content: '<page_context source="current tab" title="T" url="u">' + "x".repeat(5000) + "</page_context>\n\nQ1" },
      { role: "assistant", content: "", toolCalls: [{ id: "c", name: "get_page_text", args: "{}" }] },
      { role: "tool", toolCallId: "c", content: "y".repeat(4000) },
      { role: "user", content: [{ type: "text", text: "shot" }, { type: "image", dataUrl: "data:x" }] },
    ];
    const out = compactHistory(api);
    expect(out[0]!.content).toContain("[content from an earlier turn omitted");
    expect(out[0]!.content).toContain("Q1");
    expect((out[0]!.content as string).length).toBeLessThan(300);
    expect((out[2]!.content as string).length).toBeLessThan(1600);
    expect(out[3]!.content).toBe("shot\n[screenshot omitted]");
  });

  it("drops whole oldest turns over budget", () => {
    const api: ApiMessage[] = [
      { role: "user", content: "a".repeat(100) },
      { role: "assistant", content: "b".repeat(100) },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
    ];
    expect(dropOldestTurns(api, 50)).toEqual(api.slice(2));
    expect(dropOldestTurns(api, 10_000)).toBe(api);
  });

  it("seals tool calls that never got a result", () => {
    const api: ApiMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "1", name: "a", args: "{}" },
          { id: "2", name: "b", args: "{}" },
        ],
      },
      { role: "tool", toolCallId: "1", content: "ok" },
    ];
    const sealed = sealToolCalls(api);
    expect(sealed).toHaveLength(4);
    expect(sealed[3]).toMatchObject({ role: "tool", toolCallId: "2" });
  });
});
