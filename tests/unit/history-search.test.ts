import { describe, expect, it } from "vitest";
import { appendMessage, createThread, listThreads } from "../../src/storage/history/store";
import { searchThreads, tokenize } from "../../src/storage/history/index";
import { getThread } from "../../src/storage/history/store";

describe("history search", () => {
  it("tokenizes words case-insensitively", () => {
    expect(tokenize("Hello, Price-CHeck!")).toContain("hello");
    expect(tokenize("Hello, Price-CHeck!")).toContain("price");
  });

  it("ranks title matches above body-only matches", async () => {
    await createThread({ id: "body-only", firstMessage: { role: "user", content: "something else" } });
    await appendMessage("body-only", { role: "assistant", content: "the price is fine" });
    await createThread({ id: "title-hit", firstMessage: { role: "user", content: "price of widgets" } });
    const entries = await listThreads();
    const results = await searchThreads(entries, "price", getThread);
    expect(results.map((r) => r.threadId)[0]).toBe("title-hit");
    expect(results.find((r) => r.threadId === "title-hit")?.snippet).toContain("price");
  });

  it("returns no rows for empty queries or misses", async () => {
    await createThread({ id: "t1", firstMessage: { role: "user", content: "hello" } });
    const entries = await listThreads();
    expect(await searchThreads(entries, "   ", getThread)).toEqual([]);
    expect(await searchThreads(entries, "zzz-no-match", getThread)).toEqual([]);
  });

  it("searches 100 threads within 500ms", async () => {
    for (let i = 0; i < 100; i += 1) {
      await createThread({ id: `bulk-${i}`, firstMessage: { role: "user", content: `filler topic ${i}` } });
    }
    await createThread({
      id: "needle",
      firstMessage: { role: "user", content: "unique needle phrase here" },
    });
    const entries = await listThreads();
    const start = performance.now();
    const results = await searchThreads(entries, "needle", getThread);
    expect(performance.now() - start).toBeLessThan(500);
    expect(results.map((r) => r.threadId)).toContain("needle");
  });
});
